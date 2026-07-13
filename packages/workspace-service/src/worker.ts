import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { CANVAS_RUNTIME_PROTOCOL_VERSION } from "@weaver/contracts";
import { canvasBootstrapSchema, workspaceLaunchResultSchema, type WorkspaceLaunchResult } from "@weaver/contracts";
import { WorkspaceStore } from "@weaver/storage";
import { hashBrowserCredential, hashLaunchNonce, parseSessionCookie, randomToken, verifyBrowserCredential } from "./browser-auth.js";
import { dispatchApplicationOperation } from "./operations/index.js";
import { RuntimeDiagnostics } from "./runtime-diagnostics.js";

export type WorkspaceWorkerOptions = { workspaceDir: string; buildId: string; canvasRoot?: string };
type PendingLaunch = { hash: string; chatSessionKey?: string; projectId?: string; requestedViewId?: string; expiresAt: string };

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_048_576) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

export class WorkspaceWorker {
  readonly store: WorkspaceStore;
  readonly buildId: string;
  readonly canvasRoot: string;
  #server: Server;
  #origin?: string;
  #launches = new Map<string, PendingLaunch>();
  #diagnostics: RuntimeDiagnostics;
  #eventStreams = new Set<{ response: ServerResponse; timer: NodeJS.Timeout }>();
  #closed = false;
  #quiesced = false;
  #publicOrigin?: string;
  #bridgeHeartbeats = new Map<string, { seenAt: number; hostLabel?: "Codex" | "Claude" }>();

  constructor(options: WorkspaceWorkerOptions) {
    this.store = new WorkspaceStore(options.workspaceDir);
    this.buildId = options.buildId;
    this.#diagnostics = new RuntimeDiagnostics(options.workspaceDir, "worker");
    this.#diagnostics.record("worker.created", { buildId: this.buildId, protocolVersion: CANVAS_RUNTIME_PROTOCOL_VERSION });
    const canvasCandidates = [
      process.env.WEAVER_CANVAS_ROOT,
      fileURLToPath(new URL("../apps/widget/dist", import.meta.url)),
      fileURLToPath(new URL("../../../apps/widget/dist", import.meta.url)),
    ].filter((value): value is string => Boolean(value));
    this.canvasRoot = resolve(options.canvasRoot ?? canvasCandidates.find(existsSync) ?? canvasCandidates.at(-1)!);
    this.#server = createServer((request, response) => void this.#handle(request, response));
  }

  async listen(port = 0) {
    await new Promise<void>((resolve, reject) => {
      this.#server.once("error", reject);
      this.#server.listen(port, "127.0.0.1", () => { this.#server.off("error", reject); resolve(); });
    });
    const address = this.#server.address();
    if (!address || typeof address === "string") throw new Error("WORKER_ADDRESS_UNAVAILABLE");
    this.#origin = `http://127.0.0.1:${address.port}`;
    this.#publicOrigin = this.#origin;
    this.#diagnostics.record("worker.ready", { buildId: this.buildId, protocolVersion: CANVAS_RUNTIME_PROTOCOL_VERSION });
    return this.#origin;
  }

  setPublicOrigin(origin: string) {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/") throw new Error("INVALID_PUBLIC_ORIGIN");
    this.#publicOrigin = parsed.origin;
  }

  quiesce() { this.#quiesced = true; return { quiesced: true }; }
  resume() { this.#quiesced = false; return { quiesced: false }; }

  createLaunch(input: { chatSessionKey: string; projectId?: string; requestedViewId?: string }): WorkspaceLaunchResult {
    if (this.#quiesced) throw new Error("WORKER_QUIESCED");
    if (!this.#origin) throw new Error("WORKER_NOT_LISTENING");
    if (!/^[a-f0-9]{64}$/.test(input.chatSessionKey)) throw new Error("INVALID_CHAT_SESSION_KEY");
    this.heartbeatBridge(input.chatSessionKey);
    return this.#createLaunch(input);
  }

  createLocalLaunch(input: { projectId?: string; requestedViewId?: string } = {}): WorkspaceLaunchResult {
    if (input.requestedViewId && !input.projectId) throw new Error("INVALID_LOCAL_LAUNCH_TARGET");
    return this.#createLaunch(input);
  }

  #createLaunch(input: { chatSessionKey?: string; projectId?: string; requestedViewId?: string }): WorkspaceLaunchResult {
    if (!this.#origin) throw new Error("WORKER_NOT_LISTENING");
    const nonce = randomToken();
    const expiresAt = new Date(Date.now() + 30_000).toISOString();
    this.#launches.set(hashLaunchNonce(nonce), { hash: hashLaunchNonce(nonce), ...input, expiresAt });
    this.#diagnostics.record("pairing.created", { buildId: this.buildId, expiresInMs: 30_000 });
    return workspaceLaunchResultSchema.parse({
      launchUrl: `${this.#origin}/launch/${nonce}`,
      expiresAt,
      projectId: input.projectId,
      viewId: input.requestedViewId,
      buildId: this.buildId,
      protocolVersion: CANVAS_RUNTIME_PROTOCOL_VERSION,
    });
  }

  getDiagnostics(limit = 200) { return this.#diagnostics.export(limit); }
  clearDiagnostics() { this.#diagnostics.clear(); return { cleared: true }; }
  readBinding(chatSessionKey: string) { return this.store.sessions.getBinding(chatSessionKey); }
  heartbeatBridge(chatSessionKey: string, hostLabel?: "Codex" | "Claude") {
    if (!/^[a-f0-9]{64}$/.test(chatSessionKey)) throw new Error("INVALID_CHAT_SESSION_KEY");
    this.#bridgeHeartbeats.set(chatSessionKey, { seenAt: Date.now(), hostLabel });
    return { online: true, seenAt: new Date().toISOString() };
  }
  dispatchChatOperation(chatSessionKey: string, operation: string, arguments_: Record<string, unknown>) {
    if (this.#quiesced) throw new Error("WORKER_QUIESCED");
    if (!/^[a-f0-9]{64}$/.test(chatSessionKey)) throw new Error("INVALID_CHAT_SESSION_KEY");
    this.heartbeatBridge(chatSessionKey);
    return dispatchApplicationOperation(this.store, { kind: "chat", chatSessionKey }, { operation, arguments: arguments_ });
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#diagnostics.record("worker.stopping", { buildId: this.buildId });
    for (const stream of this.#eventStreams) { clearInterval(stream.timer); stream.response.end(); }
    this.#eventStreams.clear();
    await new Promise<void>((resolve, reject) => this.#server.close((error) => error ? reject(error) : resolve()));
    this.store.close();
  }

  async #handle(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (!this.#validHost(request)) { sendJson(response, 421, { ok: false, error: { code: "INVALID_HOST" } }); return; }
    if (request.method === "GET" && url.pathname === "/healthz") {
      sendJson(response, 200, { ok: true, state: this.#quiesced ? "quiesced" : "ready", buildId: this.buildId, protocolVersion: CANVAS_RUNTIME_PROTOCOL_VERSION });
      return;
    }
    if (this.#quiesced) {
      sendJson(response, 503, { ok: false, error: { code: "RUNTIME_UPGRADING" } });
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/launch/")) {
      try {
        const nonce = decodeURIComponent(url.pathname.slice("/launch/".length));
        const key = hashLaunchNonce(nonce);
        const launch = this.#launches.get(key);
        this.#launches.delete(key);
        if (!launch || launch.hash !== key || Date.parse(launch.expiresAt) <= Date.now()) {
          sendJson(response, 410, { ok: false, error: { code: "PAIRING_EXPIRED" } });
          return;
        }
        const now = new Date().toISOString();
        const sessionId = randomToken(18);
        const credential = randomToken();
        this.store.transaction(() => {
          const session = this.store.browserSessions.create({
            id: sessionId,
            credentialHash: hashBrowserCredential(credential),
            now,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString(),
            projectId: launch.projectId,
            viewId: launch.requestedViewId,
          });
          if (launch.chatSessionKey) {
            const binding = this.store.sessions.openBinding({ chatSessionKey: launch.chatSessionKey, projectId: launch.projectId, viewId: launch.requestedViewId });
            this.store.browserSessions.pairChat({ id: session.id, chatSessionKey: launch.chatSessionKey, bindingRevision: binding.bindingRevision, now });
          }
          if (launch.projectId) {
            try { this.store.browserSessions.claimWriter({ projectId: launch.projectId, browserSessionId: session.id, now }); }
            catch (error) { if (!(error instanceof Error) || error.message !== "PROJECT_WRITER_EXISTS") throw error; }
          }
        });
        const forwarded = new URLSearchParams();
        for (const name of ["demo", "benchmark", "inline"]) if (url.searchParams.has(name)) forwarded.set(name, url.searchParams.get(name)!);
        response.writeHead(303, {
          location: `/app/${forwarded.size ? `?${forwarded}` : ""}`,
          "cache-control": "no-store",
          "set-cookie": `weaver_session=${sessionId}.1.${credential}; HttpOnly; SameSite=Strict; Path=/`,
        });
        response.end();
        this.#diagnostics.record("pairing.claimed", { buildId: this.buildId, durationMs: 0 });
      } catch (error) {
        this.#diagnostics.record("pairing.failed", { safeStage: "launch.consume", code: error instanceof Error ? error.message : "UNKNOWN" });
        sendJson(response, 400, { ok: false, error: { code: "CANVAS_BOOTSTRAP_FAILED" } });
      }
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/bootstrap") {
      const auth = this.#authenticateBrowser(request, true);
      if (!auth) { sendJson(response, 401, { ok: false, error: { code: "BROWSER_SESSION_INVALID" } }); return; }
      const session = auth.session;
      const binding = session.pairedChatSessionKey ? this.store.sessions.getBinding(session.pairedChatSessionKey) : null;
      const projectId = binding?.projectId ?? session.projectId;
      const viewId = binding?.viewId ?? session.viewId;
      const writerLease = projectId ? this.store.browserSessions.writer(projectId) : undefined;
      const ownsWriter = session.status === "active" && writerLease?.status === "active" && writerLease.browserSessionId === session.id;
      const pairedBindingCurrent = Boolean(binding && session.pairedBindingRevision === binding.bindingRevision && binding.status !== "detached");
      const bridge = session.pairedChatSessionKey ? this.#bridgeHeartbeats.get(session.pairedChatSessionKey) : undefined;
      const bridgeOnline = Boolean(bridge && Date.now() - bridge.seenAt <= Math.max(50, Number(process.env.WEAVER_BRIDGE_GRACE_MS ?? 30_000)));
      const bootstrap = canvasBootstrapSchema.parse({
        protocolVersion: CANVAS_RUNTIME_PROTOCOL_VERSION,
        buildId: this.buildId,
        serverVersion: "0.1.0",
        browserSession: { id: session.id, status: session.status },
        csrfToken: this.#csrfToken(session),
        capabilities: {
          manualWrite: Boolean(ownsWriter),
          agentConnected: Boolean(pairedBindingCurrent && bridgeOnline),
          agentWrite: Boolean(pairedBindingCurrent && bridgeOnline && ownsWriter),
          canTakeOver: Boolean(session.status === "active" && projectId && writerLease?.status === "active" && !ownsWriter),
          hostLabel: bridgeOnline ? bridge?.hostLabel : undefined,
          disconnectReason: session.status === "detached" ? "SESSION_TAKEN_OVER" : pairedBindingCurrent && !bridgeOnline ? "AGENT_DISCONNECTED" : undefined,
        },
        projectId,
        viewId,
        writerLease: ownsWriter ? writerLease : undefined,
        chatBinding: binding && session.status === "active" ? { leaseId: binding.leaseId, bindingRevision: binding.bindingRevision, projectId: binding.projectId, viewId: binding.viewId } : undefined,
      });
      sendJson(response, 200, bootstrap);
      this.#diagnostics.record("bootstrap.ready", { buildId: this.buildId, manualWrite: bootstrap.capabilities.manualWrite, agentConnected: bootstrap.capabilities.agentConnected });
      return;
    }
    if (request.method === "GET" && url.pathname === "/events") {
      const auth = this.#authenticateBrowser(request, true);
      if (!auth) { sendJson(response, 401, { ok: false, error: { code: "BROWSER_SESSION_INVALID" } }); return; }
      const projectId = url.searchParams.get("projectId");
      const canvasSessionId = url.searchParams.get("canvasSessionId");
      const context = canvasSessionId ? this.store.sessions.canvasContext(canvasSessionId) : null;
      const binding = auth.session.pairedChatSessionKey ? this.store.sessions.getBinding(auth.session.pairedChatSessionKey) : null;
      const sessionProjectId = binding?.projectId ?? auth.session.projectId;
      const sessionCanvasId = binding?.canvasSessionId ?? context?.canvasSessionId;
      if (!projectId || !canvasSessionId || !context || context.projectId !== projectId || sessionProjectId !== projectId || sessionCanvasId !== canvasSessionId) {
        sendJson(response, 403, { ok: false, error: { code: "EVENT_STREAM_FORBIDDEN" } }); return;
      }
      let sequence = Math.max(Number(url.searchParams.get("after") ?? 0) || 0, Number(request.headers["last-event-id"] ?? 0) || 0);
      response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
      response.write(": connected\n\n");
      const flush = () => {
        const events = this.store.sessions.listEvents(projectId, sequence, 200);
        for (const event of events) {
          sequence = event.sequence;
          const privateEvent = event.kind === "task.updated" || event.kind === "chat.binding.changed";
          if (privateEvent && event.canvasSessionId && event.canvasSessionId !== canvasSessionId) continue;
          response.write(`id: ${event.sequence}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`);
        }
      };
      flush();
      const stream = { response, timer: setInterval(() => { if (!response.destroyed) flush(); }, 200) };
      this.#eventStreams.add(stream);
      request.once("close", () => { clearInterval(stream.timer); this.#eventStreams.delete(stream); });
      return;
    }
    if (request.method === "GET" && (url.pathname === "/app" || url.pathname === "/app/")) {
      const auth = this.#authenticateBrowser(request, true);
      if (!auth) { sendJson(response, 401, { ok: false, error: { code: "BROWSER_SESSION_INVALID" } }); return; }
      try {
        const html = readFileSync(resolve(this.canvasRoot, "index.html"), "utf8");
        const nonce = randomToken(18);
        const injected = html.replace("<head>", `<head><script nonce="${nonce}">window.__weaverRuntime={rpcPath:"/api/rpc",bootstrapPath:"/api/bootstrap",buildId:${JSON.stringify(this.buildId)},protocolVersion:${CANVAS_RUNTIME_PROTOCOL_VERSION}};</script>`);
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
          "content-security-policy": `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
        });
        response.end(injected);
      } catch { sendJson(response, 503, { ok: false, error: { code: "CANVAS_ASSETS_UNAVAILABLE" } }); }
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/app/")) {
      const auth = this.#authenticateBrowser(request, true);
      if (!auth) { sendJson(response, 401, { ok: false, error: { code: "BROWSER_SESSION_INVALID" } }); return; }
      const relative = decodeURIComponent(url.pathname.slice("/app/".length));
      const path = resolve(this.canvasRoot, relative);
      if (!path.startsWith(`${this.canvasRoot}${sep}`)) { sendJson(response, 404, { ok: false, error: { code: "ASSET_NOT_FOUND" } }); return; }
      try {
        if (!statSync(path).isFile()) throw new Error("NOT_FILE");
        const contentType: Record<string, string> = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp" };
        response.writeHead(200, { "content-type": contentType[extname(path)] ?? "application/octet-stream", "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
        createReadStream(path).pipe(response);
      } catch { sendJson(response, 404, { ok: false, error: { code: "ASSET_NOT_FOUND" } }); }
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/session/refresh") {
      const auth = this.#authenticateBrowser(request);
      if (!auth) { sendJson(response, 401, { ok: false, error: { code: "BROWSER_SESSION_INVALID" } }); return; }
      if (!this.#validWriteRequest(request, auth.session)) { sendJson(response, 403, { ok: false, error: { code: "CSRF_REJECTED" } }); return; }
      const credential = randomToken();
      const now = new Date().toISOString();
      const rotated = this.store.browserSessions.rotateCredential({
        id: auth.session.id,
        expectedVersion: auth.session.credentialVersion,
        credentialHash: hashBrowserCredential(credential),
        now,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString(),
      });
      response.setHeader("set-cookie", `weaver_session=${rotated.id}.${rotated.credentialVersion}.${credential}; HttpOnly; SameSite=Strict; Path=/`);
      sendJson(response, 200, { ok: true, browserSession: { id: rotated.id, status: rotated.status } });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/session/takeover") {
      const auth = this.#authenticateBrowser(request);
      if (!auth) { sendJson(response, 401, { ok: false, error: { code: "BROWSER_SESSION_INVALID" } }); return; }
      if (!this.#validWriteRequest(request, auth.session)) { sendJson(response, 403, { ok: false, error: { code: "CSRF_REJECTED" } }); return; }
      try {
        const body = await readJson(request) as { projectId?: unknown; confirm?: unknown };
        if (typeof body.projectId !== "string" || body.confirm !== true) throw new Error("TAKEOVER_CONFIRMATION_REQUIRED");
        const lease = this.store.browserSessions.claimWriter({ projectId: body.projectId, browserSessionId: auth.session.id, now: new Date().toISOString(), takeover: true });
        sendJson(response, 200, lease);
      } catch (error) {
        sendJson(response, 400, { ok: false, error: { code: error instanceof Error ? error.message : "TAKEOVER_FAILED" } });
      }
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/rpc") {
      const auth = this.#authenticateBrowser(request);
      if (!auth) { sendJson(response, 401, { ok: false, error: { code: "BROWSER_SESSION_INVALID" } }); return; }
      if (!this.#validWriteRequest(request, auth.session)) { sendJson(response, 403, { ok: false, error: { code: "CSRF_REJECTED" } }); return; }
      try {
        const startedAt = Date.now();
        const body = await readJson(request);
        if (!body || typeof body !== "object" || !("operation" in body) || typeof body.operation !== "string") throw new Error("INVALID_REQUEST");
        const args = "arguments" in body && body.arguments && typeof body.arguments === "object" && !Array.isArray(body.arguments) ? body.arguments as Record<string, unknown> : {};
        const result = await dispatchApplicationOperation(this.store, { kind: "browser", browserSessionId: auth.session.id }, { operation: body.operation, arguments: args });
        sendJson(response, 200, { ok: true, result });
        this.#diagnostics.record("rpc.completed", { operation: body.operation, durationMs: Date.now() - startedAt });
      } catch (error) {
        const code = error instanceof Error ? error.message : "INTERNAL_ERROR";
        this.#diagnostics.record("rpc.failed", { safeStage: "api.rpc", code });
        sendJson(response, code === "OPERATION_NOT_FOUND" ? 404 : 400, { ok: false, error: { code } });
      }
      return;
    }
    sendJson(response, 404, { ok: false, error: { code: "ROUTE_NOT_FOUND" } });
  }

  #authenticateBrowser(request: IncomingMessage, allowDetached = false) {
    const parsed = parseSessionCookie(request.headers.cookie);
    if (!parsed) return null;
    const session = this.store.browserSessions.get(parsed.id);
    if (!session || session.status === "expired" || (session.status === "detached" && !allowDetached)) return null;
    if (Date.parse(session.expiresAt) <= Date.now()) {
      this.store.browserSessions.expire(session.id, new Date().toISOString());
      return null;
    }
    if (parsed.version !== session.credentialVersion) {
      if (parsed.version < session.credentialVersion) this.store.browserSessions.expire(session.id, new Date().toISOString());
      return null;
    }
    return verifyBrowserCredential(parsed.credential, session.credentialHash) ? { session } : null;
  }

  #validHost(request: IncomingMessage) {
    if (!this.#publicOrigin) return false;
    return request.headers.host === new URL(this.#publicOrigin).host;
  }

  #csrfToken(session: { id: string; credentialHash: string; credentialVersion: number }) {
    return createHash("sha256").update(`weaver-csrf-v1\0${session.id}\0${session.credentialVersion}\0${session.credentialHash}`).digest("hex");
  }

  #validWriteRequest(request: IncomingMessage, session: { id: string; credentialHash: string; credentialVersion: number }) {
    if (!this.#publicOrigin || request.headers.origin !== this.#publicOrigin) return false;
    const provided = request.headers["x-weaver-csrf"];
    if (typeof provided !== "string") return false;
    const expected = this.#csrfToken(session);
    return provided.length === expected.length && timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  }
}
