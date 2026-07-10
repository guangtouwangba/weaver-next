import { randomBytes } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { projectEventSchema, type ProjectEvent } from "@weaver/contracts";
import { WorkspaceStore } from "@weaver/storage";

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
  private readonly server = createServer((request, response) => void this.handle(request.url ?? "/", request.headers["last-event-id"], response));
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

  async start() {
    if (this.port) return this.origin;
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        this.server.off("error", reject);
        const address = this.server.address();
        if (!address || typeof address === "string") return reject(new Error("SSE_EVENT_HUB_ADDRESS_UNAVAILABLE"));
        this.port = address.port;
        resolve();
      });
    });
    this.heartbeat = setInterval(() => {
      for (const client of this.clients) client.response.write(": heartbeat\n\n");
    }, 20_000);
    this.heartbeat.unref();
    return this.origin;
  }

  openStream(input: { workspaceDir: string; projectId: string; canvasSessionId: string }) {
    const store = new WorkspaceStore(input.workspaceDir);
    let currentSequence: number;
    try {
      const context = store.getCanvasContext(input.canvasSessionId);
      if (!context || context.projectId !== input.projectId) throw new Error("CANVAS_SESSION_NOT_FOUND_OR_MISMATCH");
      currentSequence = store.getLatestEventSequence(input.projectId);
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

  private handle(rawUrl: string, lastEventId: string | string[] | undefined, response: ServerResponse) {
    const url = new URL(rawUrl, this.origin);
    if (url.pathname !== "/events") return this.reject(response, 404, "Not found");
    const token = url.searchParams.get("token") ?? "";
    const grant = this.grants.get(token);
    if (!grant || grant.expiresAt <= Date.now()) {
      this.grants.delete(token);
      return this.reject(response, 401, "Invalid or expired stream token");
    }
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
