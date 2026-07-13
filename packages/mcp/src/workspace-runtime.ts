import { spawn } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canvasRuntimeDescriptorSchema, CANVAS_RUNTIME_PROTOCOL_VERSION, type WorkspaceLaunchResult } from "@weaver/contracts";
import { runtimeControlSocketPath, sendRuntimeControl, workspaceKey } from "@weaver/workspace-supervisor";
import { cleanupRuntimeCache, markRuntimeUsed } from "./runtime-cache.js";

const ownedTestProcesses = new Set<number>();
const bridgeHeartbeats = new Map<string, NodeJS.Timeout>();
const sleep = (ms: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function bridgeHostLabel(): "Codex" | "Claude" {
  return process.env.WEAVER_HOST_KIND === "claude" ? "Claude" : "Codex";
}

async function maintainBridgeHeartbeat(input: { workspaceDir: string; buildId: string; chatSessionKey: string }, socketPath: string) {
  await sendRuntimeControl(socketPath, { kind: "bridge_heartbeat", chatSessionKey: input.chatSessionKey, hostLabel: bridgeHostLabel() });
  const key = `${resolve(input.workspaceDir)}:${input.buildId}:${input.chatSessionKey}`;
  if (bridgeHeartbeats.has(key)) return;
  const timer = setInterval(() => {
    void ensureWorkspaceRuntime(input.workspaceDir, input.buildId)
      .then((runtime) => sendRuntimeControl(runtime.socketPath, { kind: "bridge_heartbeat", chatSessionKey: input.chatSessionKey, hostLabel: bridgeHostLabel() }))
      .catch(() => undefined);
  }, 5_000);
  timer.unref();
  bridgeHeartbeats.set(key, timer);
}

function runtimeRoot(workspaceDir: string) {
  if (process.env.WEAVER_RUNTIME_ROOT) return resolve(process.env.WEAVER_RUNTIME_ROOT);
  if (process.env.VITEST) return join(workspaceDir, ".weaver-test-runtime");
  return join(homedir(), ".weaver");
}

function supervisorScript() {
  const candidates = [
    fileURLToPath(new URL("../scripts/start-workspace-supervisor.mjs", import.meta.url)),
    fileURLToPath(new URL("../../../scripts/start-workspace-supervisor.mjs", import.meta.url)),
  ];
  const candidate = candidates.find(existsSync);
  if (!candidate) throw new Error("SUPERVISOR_ENTRY_NOT_FOUND");
  return candidate;
}

type RuntimeManifest = { buildId: string; files: Record<string, string> };

function sha256(path: string) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }

function releaseRoot() {
  const current = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(current, ".."), resolve(current, "../../..")];
  return candidates.find((candidate) => existsSync(join(candidate, "runtime", "manifest.json")));
}

function verifyRuntime(directory: string, manifest: RuntimeManifest) {
  return Object.entries(manifest.files).every(([relative, digest]) => {
    const path = join(directory, relative);
    return existsSync(path) && sha256(path) === digest;
  });
}

function installImmutableRuntime(root: string, buildId: string) {
  const sourceRoot = releaseRoot();
  if (!sourceRoot) return supervisorScript();
  const manifest = JSON.parse(readFileSync(join(sourceRoot, "runtime", "manifest.json"), "utf8")) as RuntimeManifest;
  if (manifest.buildId !== buildId) throw new Error(`BUILD_MISMATCH:${manifest.buildId}:${buildId}`);
  const runtimes = join(root, "runtimes");
  const target = join(runtimes, buildId);
  if (existsSync(target)) {
    if (!verifyRuntime(target, manifest)) throw new Error("RUNTIME_CACHE_CORRUPT");
    return join(target, "runtime", "supervisor.mjs");
  }
  mkdirSync(runtimes, { recursive: true, mode: 0o700 });
  const temporary = join(runtimes, `.${buildId}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  try {
    for (const [relative, digest] of Object.entries(manifest.files)) {
      const source = join(sourceRoot, relative);
      if (sha256(source) !== digest) throw new Error(`RUNTIME_SOURCE_CORRUPT:${relative}`);
      const destination = join(temporary, relative);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(source, destination);
      if (sha256(destination) !== digest) throw new Error(`RUNTIME_COPY_CORRUPT:${relative}`);
    }
    chmodSync(join(temporary, "runtime", "supervisor.mjs"), 0o500);
    try { renameSync(temporary, target); }
    catch (error) {
      if (!existsSync(target) || !verifyRuntime(target, manifest)) throw error;
      rmSync(temporary, { recursive: true, force: true });
    }
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
  return join(target, "runtime", "supervisor.mjs");
}

async function connectExisting(workspaceDir: string, buildId: string) {
  const root = runtimeRoot(workspaceDir);
  const key = workspaceKey(workspaceDir);
  const descriptorPath = join(root, "workspaces", key, "runtime.json");
  const descriptor = canvasRuntimeDescriptorSchema.parse(JSON.parse(readFileSync(descriptorPath, "utf8")));
  const socketPath = runtimeControlSocketPath(root, key);
  await sendRuntimeControl(socketPath, { kind: "ensure_runtime", workspaceKey: key, requestedBuildId: buildId, protocolVersion: CANVAS_RUNTIME_PROTOCOL_VERSION });
  return { root, key, descriptor, socketPath };
}

export async function ensureWorkspaceRuntime(workspaceDir: string, buildId: string) {
  const finish = <T extends { root: string }>(runtime: T) => {
    markRuntimeUsed(runtime.root, buildId);
    cleanupRuntimeCache(runtime.root);
    return runtime;
  };
  try { return finish(await connectExisting(workspaceDir, buildId)); }
  catch { /* cold start or stale descriptor */ }
  const root = runtimeRoot(workspaceDir);
  const executable = installImmutableRuntime(root, buildId);
  try { return finish(await connectExisting(workspaceDir, buildId)); }
  catch { /* no compatible live supervisor, start a new owner */ }
  const child = spawn(process.execPath, [executable, "--workspace", resolve(workspaceDir), "--runtime-root", root, "--build-id", buildId], {
    cwd: dirname(executable),
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  if (process.env.VITEST && child.pid) ownedTestProcesses.add(child.pid);
  let lastError: unknown;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { return finish(await connectExisting(workspaceDir, buildId)); }
    catch (error) { lastError = error; await sleep(50); }
  }
  throw new Error(`SERVICE_START_FAILED:${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export async function createWorkspaceLaunch(input: { workspaceDir: string; buildId: string; chatSessionKey: string; projectId?: string }) {
  const runtime = await ensureWorkspaceRuntime(input.workspaceDir, input.buildId);
  await maintainBridgeHeartbeat(input, runtime.socketPath);
  let requestedViewId: string | undefined;
  if (input.projectId) {
    const project = await sendRuntimeControl(runtime.socketPath, { kind: "dispatch_agent_operation", chatSessionKey: input.chatSessionKey, tool: "catalog.getProject", arguments: { projectId: input.projectId } }) as { defaultViewId: string };
    requestedViewId = project.defaultViewId;
  }
  return await sendRuntimeControl(runtime.socketPath, { kind: "create_launch", chatSessionKey: input.chatSessionKey, projectId: input.projectId, requestedViewId }) as WorkspaceLaunchResult;
}

export async function openWorkspaceNativeBinding(input: { workspaceDir: string; buildId: string; chatSessionKey: string; projectId?: string }) {
  const runtime = await ensureWorkspaceRuntime(input.workspaceDir, input.buildId);
  await maintainBridgeHeartbeat(input, runtime.socketPath);
  let viewId: string | undefined;
  if (input.projectId) {
    const project = await sendRuntimeControl(runtime.socketPath, { kind: "dispatch_agent_operation", chatSessionKey: input.chatSessionKey, tool: "catalog.getProject", arguments: { projectId: input.projectId } }) as { defaultViewId: string };
    viewId = project.defaultViewId;
  }
  return await sendRuntimeControl(runtime.socketPath, {
    kind: "dispatch_agent_operation",
    chatSessionKey: input.chatSessionKey,
    tool: "bridge.openNativeBinding",
    arguments: { projectId: input.projectId, viewId },
  }) as { leaseId: string; bindingRevision: number; projectId?: string; viewId?: string };
}

export async function recordWorkspaceSurfaceFallback(input: { workspaceDir: string; buildId: string; code: string }) {
  const runtime = await ensureWorkspaceRuntime(input.workspaceDir, input.buildId);
  return await sendRuntimeControl(runtime.socketPath, { kind: "record_surface_fallback", code: input.code });
}

export async function dispatchWorkspaceAgentOperation(input: { workspaceDir: string; buildId: string; chatSessionKey: string; operation: string; arguments: Record<string, unknown> }) {
  const runtime = await ensureWorkspaceRuntime(input.workspaceDir, input.buildId);
  await maintainBridgeHeartbeat(input, runtime.socketPath);
  return await sendRuntimeControl(runtime.socketPath, {
    kind: "dispatch_agent_operation",
    chatSessionKey: input.chatSessionKey,
    tool: input.operation,
    arguments: input.arguments,
  });
}

export async function readWorkspaceRuntimeDiagnostics(input: { workspaceDir: string; buildId: string; errorsOnly?: boolean; limit?: number }) {
  const runtime = await ensureWorkspaceRuntime(input.workspaceDir, input.buildId);
  return await sendRuntimeControl(runtime.socketPath, { kind: "get_diagnostics", errorsOnly: input.errorsOnly, limit: input.limit });
}

export async function clearWorkspaceRuntimeDiagnostics(input: { workspaceDir: string; buildId: string }) {
  const runtime = await ensureWorkspaceRuntime(input.workspaceDir, input.buildId);
  return await sendRuntimeControl(runtime.socketPath, { kind: "clear_diagnostics" });
}

export function closeOwnedTestRuntimes() {
  for (const timer of bridgeHeartbeats.values()) clearInterval(timer);
  bridgeHeartbeats.clear();
  if (!process.env.VITEST) return;
  for (const pid of ownedTestProcesses) { try { process.kill(pid, "SIGTERM"); } catch { /* already exited */ } }
  ownedTestProcesses.clear();
}
