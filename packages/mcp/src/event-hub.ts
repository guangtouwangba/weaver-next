import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, rmSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { projectEventSchema, type ProjectEvent } from "@weaver/contracts";
import { WorkspaceStore } from "@weaver/storage";
import { bundledWidgetHtml, inlineWidgetHtml, runtimeMode, widgetBundle, widgetDistMtimeMs, widgetRoot, type WidgetBundle } from "./widget.js";
import { log } from "./logger.js";

/**
 * Preview host configuration. When the MCP process is the Claude Code agent host,
 * a standalone browser widget attaches over this same loopback server: it fetches
 * bootstrap + calls tools over `/mcp-rpc`, converging on the process's synthetic
 * chat session key so it becomes a fully bound, agent-eligible canvas.
 */
export type PreviewConfig = {
  workspaceDir: string;
  chatSessionKey: string;
  dispatch: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  allowlist: Set<string>;
};

const MAX_RPC_BODY_BYTES = 30 * 1024 * 1024;

type StreamGrant = {
  token: string;
  workspaceDir: string;
  projectId: string;
  canvasSessionId: string;
  initialSequence: number;
  expiresAt: number;
};

type StreamClient = {
  grant: StreamGrant;
  response: ServerResponse;
  lastSequence: number;
};

export class SseEventHub {
  private readonly server = createServer((request, response) => void this.handle(request, response));
  private readonly assetToken = randomBytes(32).toString("hex");
  // Deterministic per launch (see deterministicToken); overwritten in start().
  private rpcToken = randomBytes(32).toString("hex");
  private isLeader = false;
  private rebindTimer?: NodeJS.Timeout;
  // Widget bundles keyed by buildId. The HTML a page loads and the assets it later
  // fetches always resolve to the same buildId, so a rebuild never yields a 404 split.
  private readonly bundles = new Map<string, WidgetBundle>();
  private activeBundle: WidgetBundle;
  private distMtimeMs = 0;
  private distWatcher?: FSWatcher;
  private reloadTimer?: NodeJS.Timeout;
  private preview?: PreviewConfig;

  constructor() {
    const initial = widgetBundle();
    this.activeBundle = initial;
    this.bundles.set(initial.buildId, initial);
    this.distMtimeMs = widgetDistMtimeMs();
  }

  /** Current bundle. In development, re-read the built widget when it changes on disk so
   *  rebuilds are served without restarting the MCP process; installed mode pins one build. */
  private resolveBundle(): WidgetBundle {
    if (runtimeMode() === "development") {
      const mtime = widgetDistMtimeMs();
      if (mtime && mtime !== this.distMtimeMs) {
        this.distMtimeMs = mtime;
        try { this.register(widgetBundle()); } catch { /* keep the last good bundle if a rebuild is mid-flight */ }
      }
    }
    return this.activeBundle;
  }

  private register(bundle: WidgetBundle) {
    this.bundles.set(bundle.buildId, bundle);
    this.activeBundle = bundle;
    // Keep a few recent builds so in-flight loads of a just-replaced build still resolve.
    while (this.bundles.size > 5) {
      const oldest = this.bundles.keys().next().value as string;
      if (oldest === bundle.buildId) break;
      this.bundles.delete(oldest);
    }
  }

  private assetBaseUrlFor(bundle: WidgetBundle) { return `${this.origin}/widget-assets/${bundle.buildId}/${this.assetToken}/`; }
  private readonly grants = new Map<string, StreamGrant>();
  private readonly clients = new Set<StreamClient>();
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly flushTimers = new Map<string, NodeJS.Timeout>();
  private heartbeat?: NodeJS.Timeout;
  private port = 0;

  get origin() {
    if (!this.port) throw new Error("SSE_EVENT_HUB_NOT_STARTED");
    return `http://127.0.0.1:${this.port}`;
  }

  get widgetAssetBaseUrl() { return this.assetBaseUrlFor(this.resolveBundle()); }

  get buildId() { return this.resolveBundle().buildId; }

  /** Widget HTML with its asset URLs pinned to the same bundle it renders (Codex resource + preview). */
  widgetHtml(extraBoot = "") {
    const bundle = this.resolveBundle();
    const html = bundledWidgetHtml(this.assetBaseUrlFor(bundle), bundle);
    return extraBoot ? html.replace("<body>", `<body>${extraBoot}`) : html;
  }

  /** Self-contained HTML for the native Codex app resource. The embedded panel calls
   *  tools over this process's loopback `/mcp-rpc` first — the exact data path the
   *  browser preview has proven — and only falls back to the Apps-SDK `tools/call`
   *  proxy if the loopback is unreachable from the sandbox. The endpoint is baked
   *  into the HTML rather than returned from the open tool: a URL in the tool result
   *  makes Codex open a browser sidebar instead of rendering the native panel. */
  inlineWidgetHtml() {
    const boot = `<script>window.__weaverCodexLoopback=${JSON.stringify({ origin: this.origin, token: this.rpcToken })};</script>`;
    return inlineWidgetHtml(this.resolveBundle()).replace("<body>", `<body>${boot}`);
  }

  /** Enable the token-gated loopback host used by Claude preview and Codex widgets. */
  configurePreview(config: PreviewConfig) {
    this.preview = config;
    // Earlier versions kept the cross-process target in the plugin/workspace.
    // It is no longer read; remove the stale absolute-path record during upgrade.
    try { rmSync(join(config.workspaceDir, ".weaver", "preview-target.json"), { force: true }); }
    catch { /* read-only installation or workspace */ }
  }

  /**
   * Realign the preview to the workspace the agent is actually operating on.
   * Codex runs the MCP from its plugin cache dir, so the boot-time cwd is NOT
   * the user's repo — the preview would otherwise bind an empty cache workspace
   * (no projects, no binding → the widget hangs at "Connecting"). The agent
   * passes the real `workspaceDir` to `weaver_open_space`; we retarget
   * the preview store + RPC pin + preview.json to it. Returns true if it changed.
   */
  retargetPreviewWorkspace(workspaceDir: string) {
    if (!this.preview) return false;
    // Publish the target in owner-only runtime state so whichever sibling process is the preview leader serves
    // this workspace — even when THIS process (which handled the tool call) is only
    // a follower. The leader reads it per request via currentWorkspace().
    if (!process.env.VITEST) {
      try {
        const runtimeDir = this.runtimeDir();
        mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
        chmodSync(runtimeDir, 0o700);
        writeFileSync(this.targetFile(), `${JSON.stringify({ workspaceDir })}\n`, { mode: 0o600 });
        chmodSync(this.targetFile(), 0o600);
      }
      catch { /* best effort */ }
    }
    const changed = this.preview.workspaceDir !== workspaceDir;
    this.preview = { ...this.preview, workspaceDir };
    this.writePreviewFile();
    return changed;
  }

  get previewToken() { return this.rpcToken; }

  get previewUrl() { return `${this.origin}/preview?token=${this.rpcToken}`; }

  /**
   * Publish the loopback preview URL + capability token to `<workspace>/.weaver/preview.json`
   * (0600) so a launcher or the user can open the canvas without guessing the ephemeral port.
   */
  writePreviewFile() {
    if (!this.preview) return;
    const dir = join(this.preview.workspaceDir, ".weaver");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    const file = join(dir, "preview.json");
    writeFileSync(file, `${JSON.stringify({ url: this.previewUrl, token: this.rpcToken, origin: this.origin, buildId: this.resolveBundle().buildId }, null, 2)}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
    return file;
  }

  // A STABLE loopback endpoint. Codex renders the canvas by opening this preview
  // URL in its browser sidebar and caches that URL; if the port/token were random
  // per process (they were), every process-churn left the sidebar pointed at a dead
  // port → "fail to fetch". So port and token are derived deterministically from the
  // launcher's cwd (shared by all of a host's processes) and the URL is identical
  // across restarts. The first process to boot binds the port (leader) and serves;
  // others are followers that hand back the same URL and periodically try to take
  // over if the leader dies — so the URL never goes stale.
  private deterministicPort(): number {
    const h = createHash("sha256").update(process.cwd()).digest();
    return 20000 + (h.readUInt32BE(0) % 40000); // [20000, 60000)
  }
  private deterministicToken(): string {
    // The secret MUST outlive plugin reinstalls: Codex caches the preview URL (with
    // its token), and a reinstall wipes the plugin cache dir. So store the secret in
    // the user's HOME (`~/.weaver/preview-secret`), not the cache — otherwise every
    // reinstall mints a new token and the cached sidebar URL 401s ("Failed to fetch").
    const dir = join(homedir(), ".weaver");
    const file = join(dir, "preview-secret");
    let secret: Buffer;
    try { secret = readFileSync(file); chmodSync(file, 0o600); }
    catch {
      secret = randomBytes(32);
      try { mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700); writeFileSync(file, secret, { mode: 0o600, flag: "wx" }); }
      catch { try { secret = readFileSync(file); } catch { /* lost the create race harmlessly; keep generated */ } }
    }
    return createHash("sha256").update(secret).update(process.cwd()).digest("hex");
  }
  private runtimeDir() {
    const instanceId = createHash("sha256").update(process.cwd()).digest("hex").slice(0, 32);
    return join(homedir(), ".weaver", "runtime", instanceId);
  }
  private targetFile() { return join(this.runtimeDir(), "preview-target.json"); }
  /** The workspace the preview currently serves — read fresh so a sibling's retarget is honored.
   *  Under VITEST the shared file is disabled (many hubs share one cwd), using in-memory state. */
  private currentWorkspace(): string {
    if (!process.env.VITEST) {
      try { const t = JSON.parse(readFileSync(this.targetFile(), "utf8")); if (typeof t?.workspaceDir === "string") return t.workspaceDir; }
      catch { /* no target set yet */ }
    }
    return this.preview?.workspaceDir ?? process.cwd();
  }

  private async tryBind(): Promise<void> {
    if (this.isLeader) return;
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: unknown) => reject(error);
        this.server.once("error", onError);
        this.server.listen(this.port, "127.0.0.1", () => { this.server.off("error", onError); resolve(); });
      });
      this.isLeader = true;
      if (this.rebindTimer) { clearInterval(this.rebindTimer); this.rebindTimer = undefined; }
      this.heartbeat ??= setInterval(() => { for (const client of this.clients) client.response.write(": heartbeat\n\n"); }, 20_000);
      this.heartbeat.unref();
      this.startDistWatcher();
      log("info", "preview.leader", { port: this.port });
    } catch {
      // EADDRINUSE: a sibling holds the stable port and serves the same URL. Stay a
      // follower and retry so we take over the moment the leader exits.
      this.isLeader = false;
      this.rebindTimer ??= setInterval(() => { void this.tryBind(); }, 3000);
      this.rebindTimer.unref();
    }
  }

  async start() {
    if (this.port) return this.origin;
    if (process.env.VITEST) {
      // Tests spin up many hubs in one process/cwd; a shared deterministic port
      // would make them collide. Use an ephemeral per-hub port (pre-stable behavior).
      await new Promise<void>((resolve, reject) => {
        this.server.once("error", reject);
        this.server.listen(0, "127.0.0.1", () => {
          this.server.off("error", reject);
          const address = this.server.address();
          if (!address || typeof address === "string") return reject(new Error("SSE_EVENT_HUB_ADDRESS_UNAVAILABLE"));
          this.port = address.port; this.isLeader = true;
          this.heartbeat = setInterval(() => { for (const client of this.clients) client.response.write(": heartbeat\n\n"); }, 20_000);
          this.heartbeat.unref();
          this.startDistWatcher();
          resolve();
        });
      });
      return this.origin;
    }
    this.port = this.deterministicPort();
    this.rpcToken = this.deterministicToken();
    await this.tryBind();
    return this.origin;
  }

  /** Development-only: watch the built widget and push a reload event to open browsers on rebuild. */
  private startDistWatcher() {
    if (runtimeMode() !== "development" || this.distWatcher) return;
    try {
      this.distWatcher = watch(join(widgetRoot(), "apps", "widget", "dist"), (_event, fileName) => {
        if (fileName && !String(fileName).startsWith("index.html")) return;
        if (this.reloadTimer) clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(() => this.broadcastReload(), 200);
        this.reloadTimer.unref();
      });
      this.distWatcher.on("error", () => { this.distWatcher?.close(); this.distWatcher = undefined; });
    } catch { /* dist may not exist yet */ }
  }

  private broadcastReload() {
    const previous = this.activeBundle.buildId;
    const bundle = this.resolveBundle();
    if (bundle.buildId === previous) return;
    for (const client of this.clients) {
      if (client.response.destroyed) continue;
      client.response.write("event: widget.reload\n");
      client.response.write(`data: ${JSON.stringify({ buildId: bundle.buildId })}\n\n`);
    }
  }

  openStream(input: { workspaceDir: string; projectId: string; canvasSessionId: string }) {
    const store = new WorkspaceStore(input.workspaceDir);
    let currentSequence: number;
    try {
      const context = store.sessions.canvasContext(input.canvasSessionId);
      if (!context || context.projectId !== input.projectId) throw new Error("CANVAS_SESSION_NOT_FOUND_OR_MISMATCH");
      currentSequence = store.sessions.latestSequence(input.projectId);
    } finally {
      store.close();
    }
    const token = randomBytes(32).toString("hex");
    const expiresAt = Date.now() + 12 * 60 * 60_000;
    this.grants.set(token, { token, ...input, initialSequence: currentSequence, expiresAt });
    this.ensureWatcher(input.workspaceDir);
    return {
      eventStreamUrl: `${this.origin}/events?token=${token}&after=${currentSequence}`,
      currentSequence,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  async close() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.rebindTimer) clearInterval(this.rebindTimer);
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.distWatcher?.close();
    for (const timer of this.flushTimers.values()) clearTimeout(timer);
    for (const watcher of this.watchers.values()) watcher.close();
    for (const client of this.clients) client.response.end();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    this.port = 0;
  }

  notifyWorkspace(workspaceDir: string) {
    this.scheduleFlush(workspaceDir);
  }

  private ensureWatcher(workspaceDir: string) {
    if (this.watchers.has(workspaceDir)) return;
    const watcher = watch(join(workspaceDir, ".weaver"), (_event, fileName) => {
      if (fileName && !String(fileName).startsWith("weaver.sqlite")) return;
      this.scheduleFlush(workspaceDir);
    });
    watcher.on("error", () => {
      watcher.close();
      this.watchers.delete(workspaceDir);
    });
    this.watchers.set(workspaceDir, watcher);
  }

  private scheduleFlush(workspaceDir: string) {
    const current = this.flushTimers.get(workspaceDir);
    if (current) clearTimeout(current);
    const timer = setTimeout(() => {
      this.flushTimers.delete(workspaceDir);
      for (const client of this.clients) {
        if (client.grant.workspaceDir === workspaceDir) this.flush(client);
      }
    }, 25);
    timer.unref();
    this.flushTimers.set(workspaceDir, timer);
  }

  // The embedded Codex widget is served from a sandboxed `ui://` origin, so its
  // fetch()/EventSource to this loopback origin is cross-origin. Allow it: the
  // capability token still gates every request, so `*` here only lets the browser
  // READ a response it already had to authenticate to get. This is what lets the
  // embedded widget bypass Codex's broken tools/call proxy (-32000) and talk to
  // the loopback directly, exactly like the standalone browser preview.
  private corsHeaders() {
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, x-weaver-preview-token",
      "Access-Control-Max-Age": "600",
    };
  }

  private handle(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? "/", this.origin);
    const method = request.method ?? "GET";
    // CORS preflight (the widget's fetch with x-weaver-preview-token triggers one).
    // Carries no token/body — answer with the allow headers only.
    if (method === "OPTIONS") { response.writeHead(204, this.corsHeaders()); return void response.end(); }
    if (this.preview) {
      if (method === "POST" && url.pathname === "/mcp-rpc") return void this.handleRpc(request, response, url);
      if (method === "GET" && url.pathname === "/api/bootstrap") return this.handleBootstrap(request, response, url);
      if (method === "GET" && url.pathname === "/preview") return this.handlePreview(request, response, url);
    }
    if (method !== "GET") return this.reject(response, 405, "Method not allowed");
    if (url.pathname.startsWith("/widget-assets/")) {
      const match = url.pathname.match(/^\/widget-assets\/([^/]+)\/([^/]+)\/(.+)$/);
      if (!match || match[2] !== this.assetToken) return this.reject(response, 401, "Invalid widget asset token");
      const asset = this.bundles.get(match[1])?.assets.find((candidate) => candidate.path === decodeURIComponent(match[3]));
      if (!asset) { log("warn", "asset.notFound", { requestedBuildId: match[1], currentBuildId: this.buildId, path: decodeURIComponent(match[3]) }); return this.reject(response, 404, "Widget asset not found"); }
      response.writeHead(200, { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=31536000, immutable", "Content-Type": asset.contentType, "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
      return response.end(asset.data);
    }
    if (url.pathname !== "/events") return this.reject(response, 404, "Not found");
    const token = url.searchParams.get("token") ?? "";
    const grant = this.grants.get(token);
    if (!grant || grant.expiresAt <= Date.now()) {
      this.grants.delete(token);
      return this.reject(response, 401, "Invalid or expired stream token");
    }
    const lastEventId = request.headers["last-event-id"];
    const requested = Array.isArray(lastEventId) ? lastEventId[0] : lastEventId;
    const after = Number(requested ?? url.searchParams.get("after") ?? grant.initialSequence);
    response.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Accel-Buffering": "no",
    });
    response.write("retry: 1000\n\n");
    const client: StreamClient = { grant, response, lastSequence: Number.isFinite(after) ? after : grant.initialSequence };
    this.clients.add(client);
    response.on("close", () => this.clients.delete(client));
    this.flush(client);
  }

  private reject(response: ServerResponse, status: number, message: string) {
    response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    response.end(message);
  }

  private previewAuthorized(request: IncomingMessage, url: URL) {
    const header = request.headers["x-weaver-preview-token"];
    const supplied = (Array.isArray(header) ? header[0] : header) ?? url.searchParams.get("token") ?? "";
    const expected = Buffer.from(this.rpcToken);
    const given = Buffer.from(supplied);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  private json(response: ServerResponse, status: number, body: unknown) {
    // json() serves only the token-gated preview routes (/mcp-rpc, /api/bootstrap),
    // so CORS here is what the cross-origin embedded widget needs.
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", ...this.corsHeaders() });
    response.end(JSON.stringify(body));
  }

  private async handleRpc(request: IncomingMessage, response: ServerResponse, url: URL) {
    const preview = this.preview;
    if (!preview) return this.reject(response, 404, "Not found");
    if (!this.previewAuthorized(request, url)) return this.reject(response, 401, "Invalid preview token");
    let raw = "";
    let tooLarge = false;
    try {
      for await (const chunk of request) {
        raw += chunk;
        if (raw.length > MAX_RPC_BODY_BYTES) { tooLarge = true; break; }
      }
    } catch {
      return this.json(response, 400, { isError: true, structuredContent: { code: "REQUEST_READ_FAILED", message: "Failed to read request body" } });
    }
    if (tooLarge) return this.json(response, 413, { isError: true, structuredContent: { code: "REQUEST_TOO_LARGE", message: "Request body exceeds limit" } });
    let payload: { name?: unknown; arguments?: unknown };
    try { payload = JSON.parse(raw || "{}"); } catch { return this.json(response, 400, { isError: true, structuredContent: { code: "INVALID_JSON", message: "Body is not valid JSON" } }); }
    const name = typeof payload.name === "string" ? payload.name : "";
    if (!preview.allowlist.has(name)) { log("warn", "rpc.toolNotAllowed", { tool: name || "<unknown>" }); return this.json(response, 403, { isError: true, structuredContent: { code: "TOOL_NOT_ALLOWED", message: `Tool ${name || "<unknown>"} is not exposed to the preview` } }); }
    const args = (payload.arguments && typeof payload.arguments === "object" ? payload.arguments : {}) as Record<string, unknown>;
    const workspace = this.currentWorkspace();
    if (typeof args.workspaceDir === "string" && args.workspaceDir !== workspace) {
      log("warn", "rpc.workspaceScopeViolation", { tool: name, requested: args.workspaceDir });
      return this.json(response, 403, { isError: true, structuredContent: { code: "WORKSPACE_SCOPE_VIOLATION", message: "Preview may only drive its own workspace" } });
    }
    args.workspaceDir = workspace;
    try {
      const output = await preview.dispatch(name, args);
      return this.json(response, 200, output);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.json(response, 200, { isError: true, content: [{ type: "text", text: message }], structuredContent: { code: message.split(":", 1)[0], message } });
    }
  }

  private handleBootstrap(request: IncomingMessage, response: ServerResponse, url: URL) {
    const preview = this.preview;
    if (!preview) return this.reject(response, 404, "Not found");
    if (!this.previewAuthorized(request, url)) return this.reject(response, 401, "Invalid preview token");
    const workspace = this.currentWorkspace();
    const store = new WorkspaceStore(workspace);
    try {
      const binding = store.sessions.getBinding(preview.chatSessionKey);
      return this.json(response, 200, {
        host: "claude",
        workspaceDir: workspace,
        buildId: this.resolveBundle().buildId,
        runtimeMode: runtimeMode(),
        chatBinding: binding ? { leaseId: binding.leaseId, bindingRevision: binding.bindingRevision, projectId: binding.projectId, viewId: binding.viewId } : undefined,
      });
    } finally {
      store.close();
    }
  }

  private handlePreview(request: IncomingMessage, response: ServerResponse, url: URL) {
    const preview = this.preview;
    if (!preview) return this.reject(response, 404, "Not found");
    if (!this.previewAuthorized(request, url)) return this.reject(response, 401, "Invalid preview token");
    const bundle = this.resolveBundle();
    const bootstrap = { host: "claude", origin: this.origin, rpcPath: "/mcp-rpc", bootstrapPath: "/api/bootstrap", token: this.rpcToken, buildId: bundle.buildId };
    const html = this.widgetHtml(`<script>window.__weaverPreview=${JSON.stringify(bootstrap)};</script>`);
    const csp = `default-src 'none'; script-src 'self' 'unsafe-inline' ${this.origin}; style-src 'self' 'unsafe-inline' ${this.origin}; img-src 'self' data: blob: ${this.origin}; font-src 'self' data: ${this.origin}; connect-src 'self' ${this.origin}; base-uri 'none'`;
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": csp,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(html);
  }

  private flush(client: StreamClient) {
    try {
      while (!client.response.destroyed) {
        const events = this.readEvents(client.grant, client.lastSequence);
        if (!events.length) break;
        for (const event of events) {
          client.lastSequence = event.sequence;
          client.response.write(`id: ${event.sequence}\n`);
          client.response.write(`event: ${event.kind}\n`);
          client.response.write(`data: ${JSON.stringify(event)}\n\n`);
        }
        if (events.length < 500) break;
      }
    } catch (error) {
      client.response.write(`event: stream.reset\ndata: ${JSON.stringify({ code: "EVENT_REPLAY_FAILED", message: error instanceof Error ? error.message : String(error) })}\n\n`);
    }
  }

  private readEvents(grant: StreamGrant, afterSequence: number): ProjectEvent[] {
    const database = new DatabaseSync(join(grant.workspaceDir, ".weaver", "weaver.sqlite"), { readOnly: true });
    try {
      return (database.prepare(`
        SELECT sequence, project_id, canvas_session_id, task_id, kind, graph_revision, view_id, layout_revision, payload, created_at
        FROM project_event
        WHERE project_id = ? AND sequence > ?
          AND (kind NOT IN ('task.updated', 'chat.binding.changed') OR canvas_session_id = ?)
        ORDER BY sequence ASC LIMIT 500
      `).all(grant.projectId, afterSequence, grant.canvasSessionId) as any[]).map((row) => projectEventSchema.parse({
        sequence: Number(row.sequence), projectId: row.project_id, canvasSessionId: row.canvas_session_id ?? undefined,
        taskId: row.task_id ?? undefined, kind: row.kind, graphRevision: row.graph_revision ?? undefined,
        viewId: row.view_id ?? undefined, layoutRevision: row.layout_revision ?? undefined,
        payload: JSON.parse(String(row.payload)), createdAt: row.created_at,
      }));
    } finally {
      database.close();
    }
  }
}
