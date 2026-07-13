import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RuntimeDiagnostics } from "../src/runtime-diagnostics.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("runtime diagnostics", () => {
  it("persists owner-only records and redacts paths, content and credentials again on export", () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-runtime-diagnostics-")); roots.push(root);
    const diagnostics = new RuntimeDiagnostics(root, "worker");
    diagnostics.record("rpc.failed", { code: "INVALID_ARGS", workspaceDir: root, prompt: "secret product plan", cookie: "weaver_session=secret", safeStage: "api.rpc" });

    expect(statSync(diagnostics.directory).mode & 0o777).toBe(0o700);
    expect(statSync(diagnostics.path).mode & 0o777).toBe(0o600);
    const raw = readFileSync(diagnostics.path, "utf8");
    expect(raw).not.toContain(root);
    expect(raw).not.toContain("secret product plan");
    expect(raw).not.toContain("weaver_session=secret");
    expect(diagnostics.export()).toEqual([expect.objectContaining({ component: "worker", event: "rpc.failed", code: "INVALID_ARGS", safeStage: "api.rpc" })]);
  });

  it("rotates at the configured bound, deletes files older than seven days, and clears all runtime logs", () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-runtime-diagnostics-")); roots.push(root);
    const directory = join(root, ".weaver", "logs");
    mkdirSync(directory, { recursive: true }); chmodSync(directory, 0o700);
    const expired = join(directory, "runtime.2.jsonl");
    writeFileSync(expired, "expired\n", { mode: 0o600 });
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000); utimesSync(expired, old, old);

    const diagnostics = new RuntimeDiagnostics(root, "supervisor", { maxBytes: 256 });
    for (let index = 0; index < 12; index += 1) diagnostics.record("worker.restart", { code: `RESTART_${index}`, padding: "x".repeat(80) });
    expect(readFileSync(expired, "utf8")).not.toContain("expired");
    expect(statSync(join(directory, "runtime.1.jsonl")).isFile()).toBe(true);
    expect(diagnostics.export().length).toBeGreaterThan(0);
    diagnostics.clear();
    expect(diagnostics.export()).toEqual([]);
  });
});
