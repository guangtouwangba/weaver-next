import { createHash } from "node:crypto";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createNetServer, type Server as NetServer, type Socket } from "node:net";
import { fork, type ChildProcess } from "node:child_process";
import { join, resolve } from "node:path";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { CANVAS_RUNTIME_PROTOCOL_VERSION, canvasRuntimeDescriptorSchema, runtimeControlRequestSchema, type RuntimeControlRequest, type WorkspaceLaunchResult } from "@weaver/contracts";
import { RuntimeDiagnostics, WorkspaceWorker, type RuntimeDiagnostic } from "@weaver/workspace-service";

export type SupervisorOptions = { workspaceDir: string; runtimeRoot: string; buildId: string; workerEntry?: string };
const instances = new Map<string, Promise<WorkspaceSupervisor>>();

export function workspaceKey(workspaceDir: string) {
  const canonical = realpathSync(resolve(workspaceDir));
  return createHash("sha256").update(canonical).digest("hex");
}

export function runtimeControlSocketPath(runtimeRoot: string, key: string) {
  const name = `${key.slice(0, 24)}.sock`;
  const preferred = join(resolve(runtimeRoot), "sockets", name);
  if (Buffer.byteLength(preferred) < 96) return preferred;
  return join(tmpdir(), `weaver-${typeof process.getuid === "function" ? process.getuid() : "user"}`, name);
}

function sendUnavailable(response: ServerResponse, code = "WORKER_RESTARTING") {
  response.writeHead(503, { "content-type": "application/json; charset=utf-8", "retry-after": "1", "cache-control": "no-store" });
  response.end(JSON.stringify({ ok: false, error: { code } }));
}

type WorkerHandle = {
  origin: string;
  pid: number;
  createLaunch(input: { chatSessionKey: string; projectId?: string; requestedViewId?: string }): Promise<WorkspaceLaunchResult>;
  readBinding(chatSessionKey: string): Promise<unknown>;
  dispatch(chatSessionKey: string, operation: string, arguments_: Record<string, unknown>): Promise<unknown>;
  heartbeat(chatSessionKey: string, hostLabel?: "Codex" | "Claude"): Promise<unknown>;
  diagnostics(): Promise<RuntimeDiagnostic[]>;
  setPublicOrigin(origin: string): Promise<void>;
  quiesce(): Promise<void>;
  resume(): Promise<void>;
  close(): Promise<void>;
  kill(): void;
};

class ChildWorkerHandle implements WorkerHandle {
  origin = "";
  pid = 0;
  #child: ChildProcess;
  #nextId = 1;
  #pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  #intentional = false;

  private constructor(child: ChildProcess, private readonly onExit: (worker: ChildWorkerHandle) => void) {
    this.#child = child;
    child.on("message", (message: any) => {
      if (message?.kind === "ready") { this.origin = String(message.origin); this.pid = Number(message.pid); return; }
      const pending = this.#pending.get(Number(message?.id));
      if (!pending) return;
      this.#pending.delete(Number(message.id));
      if (message.ok) pending.resolve(message.result); else pending.reject(new Error(String(message.error ?? "WORKER_OPERATION_FAILED")));
    });
    child.once("exit", () => {
      for (const pending of this.#pending.values()) pending.reject(new Error("WORKER_EXITED"));
      this.#pending.clear();
      if (!this.#intentional) this.onExit(this);
    });
  }

  static start(options: { entry: string; workspaceDir: string; buildId: string }, onExit: (worker: ChildWorkerHandle) => void) {
    return new Promise<ChildWorkerHandle>((resolveStart, reject) => {
      const child = fork(options.entry, ["--worker", "--workspace", options.workspaceDir, "--build-id", options.buildId], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
      const handle = new ChildWorkerHandle(child, onExit);
      const timer = setTimeout(() => { handle.kill(); reject(new Error("SERVICE_START_FAILED")); }, Math.max(250, Number(process.env.WEAVER_WORKER_START_TIMEOUT_MS ?? 10_000)));
      const ready = (message: any) => {
        if (message?.kind !== "ready") return;
        clearTimeout(timer); child.off("exit", failed); child.off("message", ready); resolveStart(handle);
      };
      const failed = () => { clearTimeout(timer); child.off("message", ready); reject(new Error("SERVICE_START_FAILED")); };
      child.on("message", ready); child.once("exit", failed);
    });
  }

  #call(kind: string, payload: Record<string, unknown> = {}) {
    const id = this.#nextId++;
    return new Promise<unknown>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#child.send({ id, kind, payload }, (error) => { if (error) { this.#pending.delete(id); reject(error); } });
    });
  }
  createLaunch(input: { chatSessionKey: string; projectId?: string; requestedViewId?: string }) { return this.#call("create_launch", input) as Promise<WorkspaceLaunchResult>; }
  readBinding(chatSessionKey: string) { return this.#call("read_binding", { chatSessionKey }); }
  dispatch(chatSessionKey: string, operation: string, arguments_: Record<string, unknown>) { return this.#call("dispatch", { chatSessionKey, operation, arguments: arguments_ }); }
  heartbeat(chatSessionKey: string, hostLabel?: "Codex" | "Claude") { return this.#call("heartbeat", { chatSessionKey, hostLabel }); }
  diagnostics() { return this.#call("diagnostics") as Promise<RuntimeDiagnostic[]>; }
  async setPublicOrigin(origin: string) { await this.#call("set_public_origin", { origin }); }
  async quiesce() { await this.#call("quiesce"); }
  async resume() { await this.#call("resume"); }
  async close() { this.#intentional = true; if (!this.#child.connected) return; await this.#call("close").catch(() => undefined); }
  kill() { this.#intentional = false; this.#child.kill("SIGKILL"); }
}

async function inProcessWorker(options: { workspaceDir: string; buildId: string }): Promise<WorkerHandle> {
  const worker = new WorkspaceWorker(options);
  const origin = await worker.listen();
  return {
    origin, pid: process.pid,
    createLaunch: async (input) => worker.createLaunch(input),
    readBinding: async (key) => worker.readBinding(key),
    dispatch: async (key, operation, args) => worker.dispatchChatOperation(key, operation, args),
    heartbeat: async (key, hostLabel) => worker.heartbeatBridge(key, hostLabel),
    diagnostics: async () => worker.getDiagnostics(),
    setPublicOrigin: async (value) => { worker.setPublicOrigin(value); },
    quiesce: async () => { worker.quiesce(); },
    resume: async () => { worker.resume(); },
    close: () => worker.close(),
    kill: () => { void worker.close(); },
  };
}

export class WorkspaceSupervisor {
  readonly workspaceDir: string;
  readonly runtimeRoot: string;
  buildId: string;
  readonly key: string;
  origin = "";
  #server: Server;
  #controlServer?: NetServer;
  #worker?: WorkerHandle;
  #workerOrigin?: string;
  #closed = false;
  #restart?: Promise<void>;
  #registryKey: string;
  #lockFd?: number;
  #idleTimer?: NodeJS.Timeout;
  #publicSockets = new Set<Socket>();
  #idleMs = Math.max(1_000, Number(process.env.WEAVER_RUNTIME_IDLE_MS ?? 600_000));
  #workerEntry?: string;
  #crashes: number[] = [];
  #failureCode?: "SERVICE_START_FAILED";
  #diagnostics: RuntimeDiagnostics;

  private constructor(options: SupervisorOptions, registryKey: string) {
    this.workspaceDir = realpathSync(resolve(options.workspaceDir));
    this.runtimeRoot = resolve(options.runtimeRoot);
    this.buildId = options.buildId;
    this.#workerEntry = options.workerEntry;
    this.#diagnostics = new RuntimeDiagnostics(this.workspaceDir, "supervisor");
    this.#diagnostics.record("supervisor.created", { buildId: this.buildId, protocolVersion: CANVAS_RUNTIME_PROTOCOL_VERSION });
    this.key = workspaceKey(this.workspaceDir);
    this.#registryKey = registryKey;
    this.#server = createServer((request, response) => this.#proxy(request, response));
    this.#server.on("connection", (socket) => {
      this.#publicSockets.add(socket);
      socket.once("close", () => this.#publicSockets.delete(socket));
    });
  }

  static async start(options: SupervisorOptions, registryKey: string) {
    const supervisor = new WorkspaceSupervisor(options, registryKey);
    try {
      supervisor.#acquireLock();
      await supervisor.#startWorker();
      await new Promise<void>((resolveListen, reject) => {
        supervisor.#server.once("error", reject);
        supervisor.#server.listen(0, "127.0.0.1", () => { supervisor.#server.off("error", reject); resolveListen(); });
      });
      const address = supervisor.#server.address();
      if (!address || typeof address === "string") throw new Error("SUPERVISOR_ADDRESS_UNAVAILABLE");
      supervisor.origin = `http://127.0.0.1:${address.port}`;
      await supervisor.#worker?.setPublicOrigin(supervisor.origin);
      await supervisor.#listenControl();
      supervisor.#writeDescriptor(address.port, "ready");
      supervisor.#diagnostics.record("supervisor.ready", { buildId: supervisor.buildId, protocolVersion: CANVAS_RUNTIME_PROTOCOL_VERSION });
      supervisor.#touch();
      return supervisor;
    } catch (error) {
      supervisor.#releaseLock();
      throw error;
    }
  }

  async createLaunch(input: { chatSessionKey: string; projectId?: string; requestedViewId?: string }): Promise<WorkspaceLaunchResult> {
    if (!this.#worker) throw new Error("WORKER_UNAVAILABLE");
    const result = await this.#worker.createLaunch(input);
    const launch = new URL(result.launchUrl);
    return { ...result, launchUrl: `${this.origin}${launch.pathname}${launch.search}` };
  }

  async restartWorkerForTest() { await this.#restartWorker(); }
  workerPidForTest() { return this.#worker?.pid; }
  killWorkerForTest() { this.#worker?.kill(); }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#diagnostics.record("supervisor.stopping", { buildId: this.buildId });
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    instances.delete(this.#registryKey);
    if (this.#restart) await this.#restart.catch(() => undefined);
    for (const socket of this.#publicSockets) socket.destroy();
    this.#publicSockets.clear();
    const worker = this.#worker;
    this.#worker = undefined;
    this.#workerOrigin = undefined;
    if (worker) await worker.close();
    if (this.#controlServer) await new Promise<void>((resolveClose) => this.#controlServer!.close(() => resolveClose()));
    await new Promise<void>((resolveClose) => this.#server.close(() => resolveClose()));
    rmSync(this.#descriptorDir(), { recursive: true, force: true });
    rmSync(this.controlSocketPath, { force: true });
    this.#releaseLock();
    this.#diagnostics.record("supervisor.stopped", { buildId: this.buildId });
  }

  async #startWorker() {
    const startedAt = Date.now();
    this.#diagnostics.record("worker.starting", { buildId: this.buildId });
    const worker = this.#workerEntry
      ? await ChildWorkerHandle.start({ entry: this.#workerEntry, workspaceDir: this.workspaceDir, buildId: this.buildId }, (exited) => this.#workerExited(exited))
      : await inProcessWorker({ workspaceDir: this.workspaceDir, buildId: this.buildId });
    try {
      const response = await fetch(`${worker.origin}/healthz`);
      const health = await response.json() as { ok?: boolean; buildId?: string; protocolVersion?: number };
      if (!response.ok || health.ok !== true || health.buildId !== this.buildId || health.protocolVersion !== CANVAS_RUNTIME_PROTOCOL_VERSION) throw new Error("WORKER_HEALTH_MISMATCH");
      this.#workerOrigin = worker.origin;
      if (this.origin) await worker.setPublicOrigin(this.origin);
      this.#worker = worker;
      this.#failureCode = undefined;
      this.#diagnostics.record("worker.ready", { buildId: this.buildId, workerPid: worker.pid, durationMs: Date.now() - startedAt });
    } catch (error) {
      await worker.close().catch(() => undefined);
      this.#diagnostics.record("worker.startFailed", { buildId: this.buildId, code: error instanceof Error ? error.message : "SERVICE_START_FAILED", durationMs: Date.now() - startedAt });
      throw error;
    }
  }

  #workerExited(worker: WorkerHandle) {
    if (this.#closed || this.#worker !== worker) return;
    this.#worker = undefined;
    this.#workerOrigin = undefined;
    const now = Date.now();
    this.#crashes = this.#crashes.filter((time) => now - time < 60_000);
    this.#crashes.push(now);
    this.#diagnostics.record("worker.crashed", { buildId: this.buildId, workerPid: worker.pid, crashCount: this.#crashes.length });
    if (this.#crashes.length >= 5) {
      this.#failureCode = "SERVICE_START_FAILED";
      this.#diagnostics.record("worker.circuitOpened", { buildId: this.buildId, code: this.#failureCode, crashCount: this.#crashes.length });
      return;
    }
    const delays = [250, 1_000, 3_000, 5_000];
    const delay = delays[Math.min(this.#crashes.length - 1, delays.length - 1)];
    this.#diagnostics.record("worker.restartScheduled", { buildId: this.buildId, delayMs: delay, crashCount: this.#crashes.length });
    setTimeout(() => { if (!this.#closed && !this.#worker) void this.#restartWorker().catch(() => { this.#failureCode = "SERVICE_START_FAILED"; }); }, delay).unref();
  }

  async #upgradeWorker(requestedBuildId: string) {
    if (requestedBuildId === this.buildId) {
      if (!this.#worker) { this.#crashes = []; this.#failureCode = undefined; await this.#startWorker(); }
      return;
    }
    const candidateEntry = join(this.runtimeRoot, "runtimes", requestedBuildId, "runtime", "supervisor.mjs");
    if (!existsSync(candidateEntry)) throw new Error("BUILD_MISMATCH");
    const previousBuildId = this.buildId;
    const previous = this.#worker;
    this.#diagnostics.record("runtime.upgradeStarted", { fromBuildId: previousBuildId, toBuildId: requestedBuildId });
    let candidate: WorkerHandle | undefined;
    try {
      if (previous) await previous.quiesce();
      candidate = await ChildWorkerHandle.start({ entry: candidateEntry, workspaceDir: this.workspaceDir, buildId: requestedBuildId }, (exited) => this.#workerExited(exited));
      const response = await fetch(`${candidate.origin}/healthz`);
      const health = await response.json() as { ok?: boolean; state?: string; buildId?: string; protocolVersion?: number };
      if (!response.ok || health.ok !== true || health.state !== "ready" || health.buildId !== requestedBuildId || health.protocolVersion !== CANVAS_RUNTIME_PROTOCOL_VERSION) throw new Error("WORKER_HEALTH_MISMATCH");
      await candidate.setPublicOrigin(this.origin);
      this.buildId = requestedBuildId;
      this.#workerEntry = candidateEntry;
      this.#worker = candidate;
      this.#workerOrigin = candidate.origin;
      this.#crashes = [];
      this.#failureCode = undefined;
      const port = Number(new URL(this.origin).port);
      this.#writeDescriptor(port, "ready");
      this.#diagnostics.record("runtime.upgradeCompleted", { fromBuildId: previousBuildId, toBuildId: requestedBuildId });
      if (previous) await previous.close();
    } catch (error) {
      if (candidate) await candidate.close().catch(() => undefined);
      if (previous) await previous.resume().catch(() => undefined);
      this.#diagnostics.record("runtime.upgradeRolledBack", { fromBuildId: previousBuildId, toBuildId: requestedBuildId, code: error instanceof Error ? error.message : "UNKNOWN" });
      throw new Error(`BUILD_UPGRADE_FAILED:${error instanceof Error ? error.message : "UNKNOWN"}`);
    }
  }

  async #restartWorker() {
    if (this.#restart) return this.#restart;
    this.#restart = (async () => {
      const previous = this.#worker;
      this.#worker = undefined;
      this.#workerOrigin = undefined;
      if (previous) await previous.close();
      if (!this.#closed) await this.#startWorker();
    })().finally(() => { this.#restart = undefined; });
    return this.#restart;
  }

  #proxy(request: IncomingMessage, response: ServerResponse) {
    this.#touch();
    if (!this.#workerOrigin) { sendUnavailable(response, this.#failureCode); return; }
    const target = new URL(request.url ?? "/", this.#workerOrigin);
    const upstream = httpRequest(target, {
      method: request.method,
      headers: request.headers,
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    upstream.on("error", () => {
      if (!response.headersSent) sendUnavailable(response); else response.destroy();
      if (!this.#closed) void this.#restartWorker();
    });
    request.pipe(upstream);
  }

  #descriptorDir() { return join(this.runtimeRoot, "workspaces", this.key); }
  get controlSocketPath() {
    return runtimeControlSocketPath(this.runtimeRoot, this.key);
  }

  async #listenControl() {
    mkdirSync(this.#descriptorDir(), { recursive: true, mode: 0o700 });
    chmodSync(this.#descriptorDir(), 0o700);
    mkdirSync(dirname(this.controlSocketPath), { recursive: true, mode: 0o700 });
    chmodSync(dirname(this.controlSocketPath), 0o700);
    rmSync(this.controlSocketPath, { force: true });
    this.#controlServer = createNetServer((socket) => this.#handleControlSocket(socket));
    await new Promise<void>((resolveListen, reject) => {
      this.#controlServer!.once("error", reject);
      this.#controlServer!.listen(this.controlSocketPath, () => { this.#controlServer!.off("error", reject); resolveListen(); });
    });
    chmodSync(this.controlSocketPath, 0o600);
  }

  #acquireLock() {
    mkdirSync(this.#descriptorDir(), { recursive: true, mode: 0o700 });
    chmodSync(this.#descriptorDir(), 0o700);
    const path = join(this.#descriptorDir(), "supervisor.lock");
    try {
      this.#lockFd = openSync(path, "wx", 0o600);
    } catch (error) {
      try {
        const pid = Number(readFileSync(path, "utf8"));
        if (Number.isInteger(pid) && pid > 0) process.kill(pid, 0);
        throw new Error("RUNTIME_ALREADY_RUNNING");
      } catch (probe) {
        if (probe instanceof Error && probe.message === "RUNTIME_ALREADY_RUNNING") throw probe;
        rmSync(path, { force: true });
        this.#lockFd = openSync(path, "wx", 0o600);
      }
    }
    writeFileSync(this.#lockFd, String(process.pid));
  }

  #releaseLock() {
    if (this.#lockFd !== undefined) { closeSync(this.#lockFd); this.#lockFd = undefined; }
    rmSync(join(this.#descriptorDir(), "supervisor.lock"), { force: true });
  }

  #handleControlSocket(socket: Socket) {
    this.#touch();
    socket.setEncoding("utf8");
    let data = "";
    socket.on("data", async (chunk) => {
      data += chunk;
      if (data.length > 1_048_576) { socket.end(JSON.stringify({ ok: false, error: { code: "CONTROL_REQUEST_TOO_LARGE" } })); return; }
      const newline = data.indexOf("\n");
      if (newline < 0) return;
      try {
        const request = runtimeControlRequestSchema.parse(JSON.parse(data.slice(0, newline)));
        const result = await this.#dispatchControl(request);
        socket.end(`${JSON.stringify({ ok: true, result })}\n`);
      } catch (error) {
        socket.end(`${JSON.stringify({ ok: false, error: { code: error instanceof Error ? error.message : "CONTROL_REQUEST_INVALID" } })}\n`);
      }
    });
  }

  #dispatchControl(request: RuntimeControlRequest) {
    this.#touch();
    if (request.kind === "ensure_runtime") {
      if (request.workspaceKey !== this.key) throw new Error("WORKSPACE_KEY_MISMATCH");
      if (request.protocolVersion !== CANVAS_RUNTIME_PROTOCOL_VERSION) throw new Error("PROTOCOL_MISMATCH");
      return this.#upgradeWorker(request.requestedBuildId).then(() => ({ origin: this.origin, buildId: this.buildId, protocolVersion: CANVAS_RUNTIME_PROTOCOL_VERSION }));
    }
    if (!this.#worker) throw new Error("WORKER_UNAVAILABLE");
    if (request.kind === "create_launch") return this.createLaunch(request);
    if (request.kind === "read_binding") return this.#worker.readBinding(request.chatSessionKey);
    if (request.kind === "dispatch_agent_operation") return this.#worker.dispatch(request.chatSessionKey, request.tool, request.arguments);
    if (request.kind === "bridge_heartbeat") return this.#worker.heartbeat(request.chatSessionKey, request.hostLabel);
    if (request.kind === "get_diagnostics") return this.#diagnostics.export(request.limit ?? 50).filter((entry) => !request.errorsOnly || (typeof entry.code === "string" && entry.code !== "OK"));
    if (request.kind === "clear_diagnostics") return this.#diagnostics.clear() ?? { cleared: true };
    if (request.kind === "record_surface_fallback") return this.#diagnostics.record("canvas.legacyFallbackUsed", { code: request.code, status: "active", actionKey: "legacy-widget" });
    if (request.kind === "shutdown_if_idle") return { stopped: false, reason: "ACTIVE_RUNTIME" };
    throw new Error("CONTROL_OPERATION_NOT_FOUND");
  }

  #writeDescriptor(port: number, state: "ready") {
    const directory = this.#descriptorDir();
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    const now = new Date().toISOString();
    const descriptor = canvasRuntimeDescriptorSchema.parse({
      workspaceKey: this.key,
      protocolVersion: CANVAS_RUNTIME_PROTOCOL_VERSION,
      buildId: this.buildId,
      supervisorPid: process.pid,
      port,
      controlSocketName: `${this.key.slice(0, 24)}.sock`,
      state,
      startedAt: now,
      updatedAt: now,
    });
    const target = join(directory, "runtime.json");
    const temporary = join(directory, `runtime.${process.pid}.tmp`);
    writeFileSync(temporary, `${JSON.stringify(descriptor, null, 2)}\n`, { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, target);
  }

  #touch() {
    if (this.#closed) return;
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = setTimeout(() => {
      if (this.#publicSockets.size > 0) { this.#touch(); return; }
      void this.close();
    }, this.#idleMs);
  }
}

export function ensureWorkspaceSupervisor(options: SupervisorOptions) {
  const key = `${resolve(options.runtimeRoot)}:${workspaceKey(options.workspaceDir)}`;
  const existing = instances.get(key);
  if (existing) return existing;
  const starting = WorkspaceSupervisor.start(options, key).catch((error) => { instances.delete(key); throw error; });
  instances.set(key, starting);
  return starting;
}
