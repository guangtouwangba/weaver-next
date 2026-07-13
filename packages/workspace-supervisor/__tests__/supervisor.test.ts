import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CANVAS_RUNTIME_PROTOCOL_VERSION } from "@weaver/contracts";
import { ensureWorkspaceSupervisor, sendRuntimeControl, workspaceKey } from "../src/index.js";
import { pathToFileURL } from "node:url";

const roots: string[] = [];
const supervisors: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(supervisors.splice(0).map((supervisor) => supervisor.close()));
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
  delete process.env.WEAVER_WORKER_START_TIMEOUT_MS;
  delete process.env.WEAVER_RUNTIME_IDLE_MS;
});

async function waitFor(predicate: () => boolean, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("WAIT_FOR_TIMEOUT");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "weaver-supervisor-")); roots.push(root);
  const workspaceDir = join(root, "workspace");
  const runtimeRoot = join(root, "runtime");
  mkdirSync(workspaceDir);
  return { workspaceDir, runtimeRoot };
}

describe("workspace supervisor", () => {
  it("derives a deterministic opaque workspace key", () => {
    const { workspaceDir } = fixture();
    const first = workspaceKey(workspaceDir);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(workspaceKey(workspaceDir)).toBe(first);
    expect(first).not.toContain(workspaceDir);
  });

  it("reuses one supervisor and writes an owner-only redacted descriptor", async () => {
    const options = { ...fixture(), buildId: "build-a" };
    const [first, second] = await Promise.all([ensureWorkspaceSupervisor(options), ensureWorkspaceSupervisor(options)]);
    supervisors.push(first);
    expect(second).toBe(first);
    expect(second.origin).toBe(first.origin);

    const descriptorPath = join(options.runtimeRoot, "workspaces", workspaceKey(options.workspaceDir), "runtime.json");
    const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8"));
    expect(descriptor).toMatchObject({ state: "ready", buildId: "build-a", port: Number(new URL(first.origin).port) });
    expect(JSON.stringify(descriptor)).not.toContain(options.workspaceDir);
    expect(statSync(descriptorPath).mode & 0o777).toBe(0o600);
    const diagnosticsPath = join(options.workspaceDir, ".weaver", "logs", "runtime.jsonl");
    expect(statSync(diagnosticsPath).mode & 0o777).toBe(0o600);
    const diagnostics = await sendRuntimeControl(first.controlSocketPath, { kind: "get_diagnostics", limit: 50 }) as Array<{ event: string }>;
    expect(diagnostics.map((entry) => entry.event)).toEqual(expect.arrayContaining(["supervisor.ready", "worker.ready"]));
    await sendRuntimeControl(first.controlSocketPath, { kind: "record_surface_fallback", code: "P0_OPEN_FAILURE" });
    expect(await sendRuntimeControl(first.controlSocketPath, { kind: "get_diagnostics", limit: 50 })).toEqual(expect.arrayContaining([
      expect.objectContaining({ component: "supervisor", event: "canvas.legacyFallbackUsed", code: "P0_OPEN_FAILURE" }),
    ]));
    expect(readFileSync(diagnosticsPath, "utf8")).toContain('"event":"canvas.legacyFallbackUsed"');
    expect(JSON.stringify(diagnostics)).not.toContain(options.workspaceDir);
    expect(await sendRuntimeControl(first.controlSocketPath, { kind: "clear_diagnostics" })).toEqual({ cleared: true });
    expect(await sendRuntimeControl(first.controlSocketPath, { kind: "get_diagnostics", limit: 50 })).toEqual([]);
  });

  it("keeps the public origin stable while replacing a failed worker", async () => {
    const supervisor = await ensureWorkspaceSupervisor({ ...fixture(), buildId: "build-a" }); supervisors.push(supervisor);
    const origin = supervisor.origin;
    expect(await fetch(`${origin}/healthz`).then((response) => response.json())).toMatchObject({ ok: true, buildId: "build-a" });
    await supervisor.restartWorkerForTest();
    expect(supervisor.origin).toBe(origin);
    expect(await fetch(`${origin}/healthz`).then((response) => response.json())).toMatchObject({ ok: true, buildId: "build-a" });
  });

  it("shuts down after the configured idle window and can be started again", async () => {
    process.env.WEAVER_RUNTIME_IDLE_MS = "1000";
    const options = { ...fixture(), buildId: "build-a" };
    const first = await ensureWorkspaceSupervisor(options); supervisors.push(first);
    const descriptorPath = join(options.runtimeRoot, "workspaces", workspaceKey(options.workspaceDir), "runtime.json");
    expect(existsSync(descriptorPath)).toBe(true);

    await waitFor(() => !existsSync(descriptorPath));
    await expect(fetch(`${first.origin}/healthz`)).rejects.toThrow();

    const second = await ensureWorkspaceSupervisor(options); supervisors.push(second);
    expect(second).not.toBe(first);
    expect(await fetch(`${second.origin}/healthz`).then((response) => response.json())).toMatchObject({ ok: true, buildId: "build-a" });
  });

  it("creates launches through the owner-only validated control socket", async () => {
    const supervisor = await ensureWorkspaceSupervisor({ ...fixture(), buildId: "build-a" }); supervisors.push(supervisor);
    expect(statSync(supervisor.controlSocketPath).mode & 0o777).toBe(0o600);
    const launch = await sendRuntimeControl(supervisor.controlSocketPath, {
      kind: "create_launch",
      chatSessionKey: "a".repeat(64),
      projectId: "project-1",
    }) as { launchUrl: string };
    expect(launch.launchUrl.startsWith(`${supervisor.origin}/launch/`)).toBe(true);
    expect((await fetch(launch.launchUrl, { redirect: "manual" })).status).toBe(303);
    expect(() => sendRuntimeControl(supervisor.controlSocketPath, { kind: "read_binding", chatSessionKey: "raw-thread-id" } as never)).toThrow();
  });

  it("rolls back to the healthy worker when a candidate runtime is corrupt", async () => {
    const options = { ...fixture(), buildId: "build-a" };
    const supervisor = await ensureWorkspaceSupervisor(options); supervisors.push(supervisor);
    const candidateDir = join(options.runtimeRoot, "runtimes", "build-b", "runtime");
    mkdirSync(candidateDir, { recursive: true });
    writeFileSync(join(candidateDir, "supervisor.mjs"), "throw new Error('corrupt candidate')\n");
    process.env.WEAVER_WORKER_START_TIMEOUT_MS = "250";
    await expect(sendRuntimeControl(supervisor.controlSocketPath, { kind: "ensure_runtime", workspaceKey: workspaceKey(options.workspaceDir), requestedBuildId: "build-b", protocolVersion: CANVAS_RUNTIME_PROTOCOL_VERSION })).rejects.toThrow("BUILD_UPGRADE_FAILED");
    expect(await fetch(`${supervisor.origin}/healthz`).then((response) => response.json())).toMatchObject({ ok: true, buildId: "build-a" });
  });

  it("keeps the public origin stable across repeated healthy runtime upgrades", async () => {
    const options = { ...fixture(), buildId: "build-a", workerEntry: join(process.cwd(), "packages/workspace-supervisor/dist/server.js") };
    const supervisor = await ensureWorkspaceSupervisor(options); supervisors.push(supervisor);
    const origin = supervisor.origin;
    for (const buildId of ["build-b", "build-c"]) {
      const candidateDir = join(options.runtimeRoot, "runtimes", buildId, "runtime");
      mkdirSync(candidateDir, { recursive: true });
      writeFileSync(join(candidateDir, "supervisor.mjs"), `import ${JSON.stringify(pathToFileURL(options.workerEntry).href)};\n`);
    }

    const firstUpgrade = await sendRuntimeControl(supervisor.controlSocketPath, { kind: "ensure_runtime", workspaceKey: workspaceKey(options.workspaceDir), requestedBuildId: "build-b", protocolVersion: CANVAS_RUNTIME_PROTOCOL_VERSION });
    const secondUpgrade = await sendRuntimeControl(supervisor.controlSocketPath, { kind: "ensure_runtime", workspaceKey: workspaceKey(options.workspaceDir), requestedBuildId: "build-c", protocolVersion: CANVAS_RUNTIME_PROTOCOL_VERSION });

    expect(firstUpgrade).toMatchObject({ origin, buildId: "build-b", protocolVersion: CANVAS_RUNTIME_PROTOCOL_VERSION });
    expect(secondUpgrade).toMatchObject({ origin, buildId: "build-c", protocolVersion: CANVAS_RUNTIME_PROTOCOL_VERSION });
    expect(supervisor.origin).toBe(origin);
    expect(await fetch(`${origin}/healthz`).then((response) => response.json())).toMatchObject({ ok: true, buildId: "build-c" });
    const diagnostics = await sendRuntimeControl(supervisor.controlSocketPath, { kind: "get_diagnostics", limit: 100 }) as Array<{ event: string }>;
    expect(diagnostics.filter((entry) => entry.event === "runtime.upgradeStarted")).toHaveLength(2);
    expect(diagnostics.filter((entry) => entry.event === "runtime.upgradeCompleted")).toHaveLength(2);
  });
});
