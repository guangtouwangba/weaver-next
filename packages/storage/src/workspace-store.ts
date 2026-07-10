import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import {
  agentTaskSchema,
  assetSchema,
  canvasViewStateSchema,
  canvasContextSnapshotSchema,
  chatCanvasBindingSchema,
  changeSetSchema,
  edgeSchema,
  layoutDocumentSchema,
  nodeContentSchema,
  nodeSchema,
  projectSchema,
  projectEventSchema,
  projectViewSchema,
  type AgentTask,
  type Asset,
  type CanvasContextSnapshot,
  type CanvasViewState,
  type ChatCanvasBinding,
  type ChangeSet,
  type LayoutCandidate,
  type LayoutDocument,
  type NodeContent,
  type ProjectEvent,
  type ProjectView,
  type ScenePack,
  type SpaceEdge,
  type SpaceNode,
  type SpaceProject,
  type VisualTemplate,
} from "@weaver/contracts";
import { applyGraphOperations, applyLayoutOperations, type GraphSnapshot } from "@weaver/core";

function now() { return new Date().toISOString(); }
function json<T>(value: T) { return JSON.stringify(value); }
function parse<T>(value: unknown): T { return JSON.parse(String(value)) as T; }
function friendlyViewName(layout: Pick<LayoutDocument, "viewName" | "viewType">) { return layout.viewName === layout.viewType ? `${layout.viewType[0].toUpperCase()}${layout.viewType.slice(1)}` : layout.viewName; }

const terminalTaskStatuses = new Set<AgentTask["status"]>(["completed", "stale", "failed", "cancelled"]);
const canvasOfflineAfterMs = 30_000;
const taskTransitions: Record<AgentTask["status"], Set<AgentTask["status"]>> = {
  prepared: new Set(["dispatched", "failed", "cancelled"]),
  dispatched: new Set(["running", "failed", "cancelled"]),
  running: new Set(["pending_review", "completed", "stale", "failed", "cancelled"]),
  pending_review: new Set(["ready_to_continue", "completed", "stale", "cancelled"]),
  ready_to_continue: new Set(["prepared", "stale", "cancelled"]),
  completed: new Set(), stale: new Set(), failed: new Set(), cancelled: new Set(),
};

function safeWorkspaceDir(input: string) {
  const absolute = resolve(input);
  return realpathSync(absolute);
}

function defaultLayout(project: SpaceProject, viewId: string, viewType: LayoutDocument["viewType"], strategy: LayoutDocument["strategy"], viewName: string = viewType): LayoutDocument {
  return layoutDocumentSchema.parse({
    projectId: project.id,
    viewId,
    viewType,
    graphRevision: project.graphRevision,
    layoutRevision: 0,
    viewName,
    strategy,
    config: { direction: "left-right", nodeSpacing: 72, rankSpacing: 120, density: 1, viewportWidth: 1280, viewportHeight: 800 },
    nodes: {}, edges: {}, groups: {}, bounds: { x: 0, y: 0, width: 0, height: 0 }, createdBy: "user", updatedAt: now(),
  });
}

export class WorkspaceStore {
  readonly workspaceDir: string;
  readonly dataDir: string;
  readonly dbPath: string;
  readonly db: DatabaseSync;

  constructor(workspaceDir: string) {
    this.workspaceDir = safeWorkspaceDir(workspaceDir);
    this.dataDir = join(this.workspaceDir, ".weaver");
    mkdirSync(join(this.dataDir, "assets", "tasks"), { recursive: true });
    mkdirSync(join(this.dataDir, "assets", "original"), { recursive: true });
    mkdirSync(join(this.dataDir, "assets", "thumbnails"), { recursive: true });
    mkdirSync(join(this.dataDir, "exports"), { recursive: true });
    this.dbPath = join(this.dataDir, "weaver.sqlite");
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.migrate();
    this.migrateProjectViewPrimaryKey();
    this.migrateLegacyNodes();
    this.migrateLegacyCanvasContexts();
    this.migrateLegacyAgentTasks();
    this.migrateLegacyProjectViews();
    this.purgeExpiredProjectViews();
  }

  close() { this.db.close(); }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS project (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS node (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS ix_node_project ON node(project_id);
      CREATE TABLE IF NOT EXISTS edge (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS ix_edge_project ON edge(project_id);
      CREATE TABLE IF NOT EXISTS layout (project_id TEXT NOT NULL, view_id TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(project_id, view_id));
      CREATE TABLE IF NOT EXISTS layout_history (project_id TEXT NOT NULL, view_id TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(project_id, view_id, revision));
      CREATE TABLE IF NOT EXISTS layout_run (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, view_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS project_view (id TEXT NOT NULL, project_id TEXT NOT NULL, status TEXT NOT NULL, pinned_order INTEGER, data TEXT NOT NULL, PRIMARY KEY(project_id, id));
      CREATE INDEX IF NOT EXISTS ix_project_view_project_status ON project_view(project_id, status);
      CREATE TABLE IF NOT EXISTS canvas_view_state (canvas_session_id TEXT NOT NULL, view_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(canvas_session_id, view_id));
      CREATE TABLE IF NOT EXISTS canvas_session (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, sequence INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chat_canvas_binding (chat_session_key TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_task (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS changeset (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS artifact (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS asset (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, sha256 TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(project_id, sha256));
      CREATE INDEX IF NOT EXISTS ix_asset_project ON asset(project_id);
      CREATE TABLE IF NOT EXISTS project_event (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        canvas_session_id TEXT,
        task_id TEXT,
        kind TEXT NOT NULL,
        graph_revision INTEGER,
        view_id TEXT,
        layout_revision INTEGER,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_project_event_project_sequence ON project_event(project_id, sequence);
      CREATE INDEX IF NOT EXISTS ix_project_event_session_sequence ON project_event(canvas_session_id, sequence);
      PRAGMA user_version = 6;
    `);
  }

  private transaction<T>(callback: () => T): T {
    if (this.db.isTransaction) return callback();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = callback();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  appendProjectEvent(input: Omit<ProjectEvent, "sequence" | "createdAt"> & { createdAt?: string }) {
    const createdAt = input.createdAt ?? now();
    const result = this.db.prepare(`
      INSERT INTO project_event(project_id, canvas_session_id, task_id, kind, graph_revision, view_id, layout_revision, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.projectId, input.canvasSessionId ?? null, input.taskId ?? null, input.kind, input.graphRevision ?? null, input.viewId ?? null, input.layoutRevision ?? null, json(input.payload), createdAt);
    return projectEventSchema.parse({ ...input, sequence: Number(result.lastInsertRowid), createdAt });
  }

  listProjectEvents(projectId: string, afterSequence = 0, limit = 500) {
    return (this.db.prepare(`
      SELECT sequence, project_id, canvas_session_id, task_id, kind, graph_revision, view_id, layout_revision, payload, created_at
      FROM project_event WHERE project_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT ?
    `).all(projectId, afterSequence, limit) as any[]).map((row) => projectEventSchema.parse({
      sequence: Number(row.sequence), projectId: row.project_id, canvasSessionId: row.canvas_session_id ?? undefined,
      taskId: row.task_id ?? undefined, kind: row.kind, graphRevision: row.graph_revision ?? undefined,
      viewId: row.view_id ?? undefined, layoutRevision: row.layout_revision ?? undefined,
      payload: parse(row.payload), createdAt: row.created_at,
    }));
  }

  getLatestEventSequence(projectId: string) {
    const row = this.db.prepare("SELECT MAX(sequence) AS sequence FROM project_event WHERE project_id = ?").get(projectId) as any;
    return Number(row?.sequence ?? 0);
  }

  private migrateLegacyNodes() {
    const rows = this.db.prepare("SELECT id, data FROM node").all() as Array<{ id: string; data: string }>;
    const update = this.db.prepare("UPDATE node SET data = ? WHERE id = ?");
    for (const row of rows) {
      const raw = parse<Record<string, unknown>>(row.data);
      if (raw.content && raw.contentKind) continue;
      update.run(json(nodeSchema.parse(raw)), row.id);
    }
  }

  private migrateProjectViewPrimaryKey() {
    const columns = this.db.prepare("PRAGMA table_info(project_view)").all() as Array<{ name: string; pk: number }>;
    const primaryKey = columns.filter((column) => column.pk > 0).sort((left, right) => left.pk - right.pk).map((column) => column.name);
    if (primaryKey.join(",") === "project_id,id") return;
    this.transaction(() => {
      this.db.exec(`
        ALTER TABLE project_view RENAME TO project_view_legacy_pk;
        CREATE TABLE project_view (id TEXT NOT NULL, project_id TEXT NOT NULL, status TEXT NOT NULL, pinned_order INTEGER, data TEXT NOT NULL, PRIMARY KEY(project_id, id));
        INSERT OR REPLACE INTO project_view(id, project_id, status, pinned_order, data) SELECT id, project_id, status, pinned_order, data FROM project_view_legacy_pk;
        DROP TABLE project_view_legacy_pk;
        CREATE INDEX IF NOT EXISTS ix_project_view_project_status ON project_view(project_id, status);
      `);
    });
  }

  private migrateLegacyCanvasContexts() {
    const rows = this.db.prepare("SELECT id, data FROM canvas_session").all() as Array<{ id: string; data: string }>;
    const update = this.db.prepare("UPDATE canvas_session SET data = ? WHERE id = ?");
    for (const row of rows) {
      const raw = parse<Record<string, unknown>>(row.data);
      if (raw.version === 2) continue;
      update.run(json(canvasContextSnapshotSchema.parse({ ...raw, version: 2, chatBinding: undefined, agentEligible: false })), row.id);
    }
  }

  private migrateLegacyAgentTasks() {
    const rows = this.db.prepare("SELECT id, data FROM agent_task").all() as Array<{ id: string; data: string }>;
    const update = this.db.prepare("UPDATE agent_task SET data = ? WHERE id = ?");
    for (const row of rows) {
      const raw = parse<Record<string, any>>(row.data);
      if (raw.chatSessionKey) continue;
      const status = terminalTaskStatuses.has(raw.status) ? raw.status : "cancelled";
      const migrated = agentTaskSchema.parse({
        ...raw,
        chatSessionKey: "legacy-unbound",
        bindingRevision: 0,
        status,
        taskRevision: Number(raw.taskRevision ?? 0) + (status === raw.status ? 0 : 1),
        error: status === raw.status ? raw.error : { code: "LEGACY_TASK_UNBOUND", message: "Legacy task is not bound to a Codex chat" },
        updatedAt: status === raw.status ? raw.updatedAt : now(),
      });
      update.run(json(migrated), row.id);
    }
  }

  private migrateLegacyProjectViews() {
    const layoutRows = this.db.prepare("SELECT project_id, view_id, data FROM layout").all() as Array<{ project_id: string; view_id: string; data: string }>;
    const insert = this.db.prepare("INSERT OR IGNORE INTO project_view(id, project_id, status, pinned_order, data) VALUES (?, ?, ?, ?, ?)");
    const touchedProjects = new Set<string>();
    for (const row of layoutRows) {
      const layout = layoutDocumentSchema.parse({ ...parse<any>(row.data), viewName: parse<any>(row.data).viewName ?? parse<any>(row.data).viewType });
      const project = this.getProject(row.project_id); if (!project) continue;
      const timestamp = layout.updatedAt ?? now();
      const view = projectViewSchema.parse({ id: row.view_id, projectId: row.project_id, name: friendlyViewName(layout), viewType: layout.viewType, templateRef: layout.templateRef, status: "active", pinned: row.view_id === project.defaultViewId, pinnedOrder: row.view_id === project.defaultViewId ? 0 : undefined, createdBy: layout.templateRef ? "template" : "user", createdAt: timestamp, updatedAt: timestamp, lastOpenedAt: timestamp });
      insert.run(view.id, view.projectId, view.status, view.pinnedOrder ?? null, json(view));
      touchedProjects.add(view.projectId);
    }
    for (const projectId of touchedProjects) {
      const project = this.getProject(projectId); if (!project || project.viewCatalogRevision > 0) continue;
      this.db.prepare("UPDATE project SET data = ? WHERE id = ?").run(json({ ...project, viewCatalogRevision: 1 }), projectId);
    }
    const existingViews = this.db.prepare("SELECT project_id, id, data FROM project_view").all() as Array<{ project_id: string; id: string; data: string }>;
    for (const row of existingViews) {
      const view = projectViewSchema.parse(parse(row.data));
      if (view.name !== view.viewType) continue;
      this.putProjectView({ ...view, name: `${view.viewType[0].toUpperCase()}${view.viewType.slice(1)}` });
    }
  }

  private purgeExpiredProjectViews() {
    const rows = this.db.prepare("SELECT data FROM project_view WHERE status = 'trashed'").all() as any[];
    for (const row of rows) {
      const view = projectViewSchema.parse(parse(row.data));
      if (!view.purgeAfter || Date.parse(view.purgeAfter) > Date.now()) continue;
      const project = this.getProject(view.projectId); if (!project) continue;
      this.purgeProjectView({ projectId: view.projectId, viewId: view.id, baseCatalogRevision: project.viewCatalogRevision });
    }
  }

  private newLeaseId() { return randomBytes(32).toString("hex"); }

  getChatCanvasBinding(chatSessionKey: string) {
    const row = this.db.prepare("SELECT data FROM chat_canvas_binding WHERE chat_session_key = ?").get(chatSessionKey) as any;
    return row ? chatCanvasBindingSchema.parse(parse(row.data)) : null;
  }

  private saveChatCanvasBinding(binding: ChatCanvasBinding) {
    const validated = chatCanvasBindingSchema.parse(binding);
    this.db.prepare(`
      INSERT INTO chat_canvas_binding(chat_session_key, revision, data) VALUES (?, ?, ?)
      ON CONFLICT(chat_session_key) DO UPDATE SET revision=excluded.revision, data=excluded.data
    `).run(validated.chatSessionKey, validated.bindingRevision, json(validated));
    return validated;
  }

  private rejectBindingWork(binding: ChatCanvasBinding) {
    if (!binding.canvasSessionId) return;
    const tasks = this.listCanvasTasks(binding.canvasSessionId, true).filter((task) => !terminalTaskStatuses.has(task.status));
    this.rejectTasks(tasks, "CHAT_CANVAS_REBOUND", "This Codex chat was rebound to another canvas");
  }

  private rejectTasks(tasks: AgentTask[], code: string, message: string) {
    for (const task of tasks) {
      const changeSetId = task.results.changeSetId;
      if (changeSetId) {
        const changeSet = this.getChangeSet(changeSetId);
        if (changeSet?.status === "pending") {
          this.db.prepare("UPDATE changeset SET data = ? WHERE id = ?").run(json({ ...changeSet, status: "rejected", updatedAt: now() }), changeSetId);
        }
      }
      const layoutRunId = task.results.layoutRunId;
      if (layoutRunId) {
        const row = this.db.prepare("SELECT data FROM layout_run WHERE id = ?").get(layoutRunId) as any;
        if (row) {
          const run = parse<Record<string, any>>(row.data);
          if (run.status === "preview") this.db.prepare("UPDATE layout_run SET data = ? WHERE id = ?").run(json({ ...run, status: "rejected", updatedAt: now() }), layoutRunId);
        }
      }
      this.updateAgentTask(task.taskId, { status: "cancelled", error: { code, message } });
    }
  }

  openChatCanvasBinding(input: { chatSessionKey: string; projectId?: string; viewId?: string }) {
    return this.transaction(() => {
      if (input.projectId && input.viewId) {
        const target = this.getProjectView(input.projectId, input.viewId); if (!target || target.status !== "active") throw new Error("VIEW_NOT_FOUND");
      }
      const current = this.getChatCanvasBinding(input.chatSessionKey);
      const sameTarget = current?.projectId === input.projectId && current?.viewId === input.viewId;
      if (current && sameTarget && current.status === "opening") return current;
      if (current) this.rejectBindingWork(current);
      const binding = this.saveChatCanvasBinding({
        chatSessionKey: input.chatSessionKey,
        bindingRevision: (current?.bindingRevision ?? 0) + 1,
        leaseId: this.newLeaseId(),
        projectId: input.projectId,
        viewId: input.viewId,
        status: "opening",
        lastSeenAt: now(),
      });
      if (current?.projectId) this.appendProjectEvent({
        projectId: current.projectId,
        canvasSessionId: current.canvasSessionId,
        kind: "chat.binding.changed",
        payload: { bindingRevision: binding.bindingRevision, status: "detached" },
      });
      return binding;
    });
  }

  switchChatCanvasBinding(input: { chatSessionKey: string; leaseId: string; bindingRevision: number; projectId: string; viewId: string }) {
    return this.transaction(() => {
      const current = this.getChatCanvasBinding(input.chatSessionKey);
      if (!current) throw new Error("NO_CANVAS_BOUND_TO_CHAT");
      if (current.leaseId !== input.leaseId || current.bindingRevision !== input.bindingRevision) throw new Error("CHAT_CANVAS_LEASE_STALE");
      const targetView = this.getProjectView(input.projectId, input.viewId); if (!targetView || targetView.status !== "active") throw new Error("VIEW_NOT_FOUND");
      if (current.projectId === input.projectId && current.viewId === input.viewId) return current;
      this.rejectBindingWork(current);
      const next = this.saveChatCanvasBinding({ ...current, projectId: input.projectId, viewId: input.viewId, canvasSessionId: undefined, bindingRevision: current.bindingRevision + 1, status: "opening", lastSeenAt: now() });
      if (current.projectId) this.appendProjectEvent({
        projectId: current.projectId, canvasSessionId: current.canvasSessionId, kind: "chat.binding.changed",
        payload: { bindingRevision: next.bindingRevision, status: "detached" },
      });
      return next;
    });
  }

  private validateBindingLease(input: { chatSessionKey: string; leaseId: string; bindingRevision: number }) {
    const binding = this.getChatCanvasBinding(input.chatSessionKey);
    if (!binding) throw new Error("NO_CANVAS_BOUND_TO_CHAT");
    if (binding.leaseId !== input.leaseId || binding.bindingRevision !== input.bindingRevision) throw new Error("CHAT_CANVAS_LEASE_STALE");
    return binding;
  }

  getBoundCanvas(chatSessionKey: string, requireOnline = false) {
    const binding = this.getChatCanvasBinding(chatSessionKey);
    if (!binding?.projectId || !binding.viewId) throw new Error("NO_CANVAS_BOUND_TO_CHAT");
    if (binding.status !== "active" || !binding.canvasSessionId) throw new Error("BOUND_CANVAS_NOT_READY");
    const view = this.getProjectView(binding.projectId, binding.viewId); if (!view || view.status !== "active") throw new Error("BOUND_CANVAS_NOT_READY");
    const context = this.getCanvasContext(binding.canvasSessionId);
    if (!context || !context.agentEligible) throw new Error("BOUND_CANVAS_NOT_READY");
    const seenAt = Date.parse(context.presence?.lastSeenAt ?? context.updatedAt);
    if (requireOnline && (!Number.isFinite(seenAt) || Date.now() - seenAt > canvasOfflineAfterMs)) throw new Error("BOUND_CANVAS_OFFLINE");
    return { binding, context };
  }

  listProjects(): SpaceProject[] {
    return this.db.prepare("SELECT data FROM project ORDER BY json_extract(data, '$.updatedAt') DESC").all().map((row: any) => projectSchema.parse(parse(row.data)));
  }

  getProject(projectId: string) {
    const row = this.db.prepare("SELECT data FROM project WHERE id = ?").get(projectId) as any;
    return row ? projectSchema.parse(parse(row.data)) : null;
  }

  listProjectViews(projectId: string, status?: ProjectView["status"]) {
    const rows = status
      ? this.db.prepare("SELECT data FROM project_view WHERE project_id = ? AND status = ?").all(projectId, status)
      : this.db.prepare("SELECT data FROM project_view WHERE project_id = ?").all(projectId);
    return (rows as any[]).map((row) => projectViewSchema.parse(parse(row.data))).sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      if (left.pinned && right.pinned) return (left.pinnedOrder ?? Number.MAX_SAFE_INTEGER) - (right.pinnedOrder ?? Number.MAX_SAFE_INTEGER);
      return Date.parse(right.lastOpenedAt) - Date.parse(left.lastOpenedAt) || left.name.localeCompare(right.name);
    });
  }

  getProjectView(projectId: string, viewId: string) {
    const row = this.db.prepare("SELECT data FROM project_view WHERE project_id = ? AND id = ?").get(projectId, viewId) as any;
    return row ? projectViewSchema.parse(parse(row.data)) : null;
  }

  private putProjectView(view: ProjectView) {
    const validated = projectViewSchema.parse(view);
    this.db.prepare(`
      INSERT INTO project_view(id, project_id, status, pinned_order, data) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id, id) DO UPDATE SET status=excluded.status, pinned_order=excluded.pinned_order, data=excluded.data
    `).run(validated.id, validated.projectId, validated.status, validated.pinnedOrder ?? null, json(validated));
    return validated;
  }

  private bumpViewCatalog(projectId: string, input: { upsertedViews?: ProjectView[]; removedViewIds?: string[]; defaultViewId?: string }) {
    const project = this.getProject(projectId); if (!project) throw new Error("PROJECT_NOT_FOUND");
    const nextProject = projectSchema.parse({ ...project, defaultViewId: input.defaultViewId ?? project.defaultViewId, viewCatalogRevision: project.viewCatalogRevision + 1, updatedAt: now() });
    const delta = { projectId, fromRevision: project.viewCatalogRevision, toRevision: nextProject.viewCatalogRevision, upsertedViews: input.upsertedViews ?? [], removedViewIds: input.removedViewIds ?? [], defaultViewId: nextProject.defaultViewId };
    this.db.prepare("UPDATE project SET data = ? WHERE id = ?").run(json(nextProject), projectId);
    this.appendProjectEvent({ projectId, kind: "view.catalog.changed", payload: delta });
    return { project: nextProject, delta };
  }

  private catalogViewFromLayout(layout: LayoutDocument, createdBy: ProjectView["createdBy"] = "user") {
    const existing = this.getProjectView(layout.projectId, layout.viewId);
    const project = this.getProject(layout.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND");
    const timestamp = now();
    const view = this.putProjectView({
      id: layout.viewId, projectId: layout.projectId, name: friendlyViewName(layout), viewType: layout.viewType, templateRef: layout.templateRef,
      status: existing?.status ?? "active", pinned: existing?.pinned ?? layout.viewId === project.defaultViewId,
      pinnedOrder: existing?.pinnedOrder ?? (layout.viewId === project.defaultViewId ? 0 : undefined), createdBy: existing?.createdBy ?? createdBy,
      createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp, lastOpenedAt: existing?.lastOpenedAt ?? timestamp,
      trashedAt: existing?.trashedAt, purgeAfter: existing?.purgeAfter,
    });
    const bumped = this.bumpViewCatalog(layout.projectId, { upsertedViews: [view] });
    return { view, ...bumped };
  }

  private assertCatalogRevision(project: SpaceProject, baseCatalogRevision: number) {
    if (project.viewCatalogRevision !== baseCatalogRevision) throw new Error("VIEW_CATALOG_REVISION_CONFLICT");
  }

  renameProjectView(input: { projectId: string; viewId: string; name: string; baseCatalogRevision: number }) {
    return this.transaction(() => {
      const project = this.getProject(input.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); this.assertCatalogRevision(project, input.baseCatalogRevision);
      const current = this.getProjectView(input.projectId, input.viewId); if (!current || current.status !== "active") throw new Error("VIEW_NOT_FOUND");
      const name = input.name.trim(); if (!name) throw new Error("VIEW_NAME_REQUIRED");
      const view = this.putProjectView({ ...current, name, updatedAt: now() });
      const layout = this.getLayout(input.projectId, input.viewId); if (layout) this.db.prepare("UPDATE layout SET data = ? WHERE project_id = ? AND view_id = ?").run(json({ ...layout, viewName: name }), input.projectId, input.viewId);
      return { view, ...this.bumpViewCatalog(input.projectId, { upsertedViews: [view] }) };
    });
  }

  pinProjectView(input: { projectId: string; viewId: string; pinned: boolean; baseCatalogRevision: number }) {
    return this.transaction(() => {
      const project = this.getProject(input.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); this.assertCatalogRevision(project, input.baseCatalogRevision);
      const current = this.getProjectView(input.projectId, input.viewId); if (!current || current.status !== "active") throw new Error("VIEW_NOT_FOUND");
      if (current.pinned === input.pinned) return { view: current, project, delta: { projectId: project.id, fromRevision: project.viewCatalogRevision, toRevision: project.viewCatalogRevision, upsertedViews: [], removedViewIds: [], defaultViewId: project.defaultViewId } };
      const nextOrder = input.pinned ? Math.max(-1, ...this.listProjectViews(input.projectId, "active").filter((view) => view.pinned).map((view) => view.pinnedOrder ?? -1)) + 1 : undefined;
      const view = this.putProjectView({ ...current, pinned: input.pinned, pinnedOrder: nextOrder, updatedAt: now() });
      return { view, ...this.bumpViewCatalog(input.projectId, { upsertedViews: [view] }) };
    });
  }

  reorderPinnedViews(input: { projectId: string; viewIds: string[]; baseCatalogRevision: number }) {
    return this.transaction(() => {
      const project = this.getProject(input.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); this.assertCatalogRevision(project, input.baseCatalogRevision);
      const pinned = this.listProjectViews(input.projectId, "active").filter((view) => view.pinned);
      if (new Set(input.viewIds).size !== input.viewIds.length || input.viewIds.length !== pinned.length || pinned.some((view) => !input.viewIds.includes(view.id))) throw new Error("PINNED_VIEW_ORDER_INVALID");
      const views = input.viewIds.map((viewId, index) => this.putProjectView({ ...pinned.find((view) => view.id === viewId)!, pinnedOrder: index, updatedAt: now() }));
      return { views, ...this.bumpViewCatalog(input.projectId, { upsertedViews: views }) };
    });
  }

  setDefaultProjectView(input: { projectId: string; viewId: string; baseCatalogRevision: number }) {
    return this.transaction(() => {
      const project = this.getProject(input.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); this.assertCatalogRevision(project, input.baseCatalogRevision);
      const view = this.getProjectView(input.projectId, input.viewId); if (!view || view.status !== "active") throw new Error("VIEW_NOT_FOUND");
      if (project.defaultViewId === input.viewId) return { view, project, delta: { projectId: project.id, fromRevision: project.viewCatalogRevision, toRevision: project.viewCatalogRevision, upsertedViews: [], removedViewIds: [], defaultViewId: project.defaultViewId } };
      return { view, ...this.bumpViewCatalog(input.projectId, { defaultViewId: input.viewId }) };
    });
  }

  searchProjectViews(projectId: string, query: string, status: ProjectView["status"] = "active") {
    const normalized = query.trim().toLocaleLowerCase();
    return this.listProjectViews(projectId, status).filter((view) => !normalized || `${view.name} ${view.viewType} ${view.templateRef?.id ?? ""}`.toLocaleLowerCase().includes(normalized));
  }

  trashProjectView(input: { projectId: string; viewId: string; fallbackViewId?: string; baseCatalogRevision: number }) {
    return this.transaction(() => {
      const project = this.getProject(input.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); this.assertCatalogRevision(project, input.baseCatalogRevision);
      const current = this.getProjectView(input.projectId, input.viewId); if (!current || current.status !== "active") throw new Error("VIEW_NOT_FOUND");
      const active = this.listProjectViews(input.projectId, "active"); if (active.length <= 1) throw new Error("LAST_ACTIVE_VIEW");
      const fallback = (input.fallbackViewId ? active.find((view) => view.id === input.fallbackViewId) : undefined) ?? active.find((view) => view.id !== input.viewId);
      if (!fallback || fallback.id === input.viewId) throw new Error("VIEW_FALLBACK_REQUIRED");
      const timestamp = now(); const purgeAfter = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();
      const view = this.putProjectView({ ...current, status: "trashed", pinned: false, pinnedOrder: undefined, trashedAt: timestamp, purgeAfter, updatedAt: timestamp });
      const tasks = this.listProjectTasks(input.projectId, true).filter((task) => task.viewId === input.viewId && !terminalTaskStatuses.has(task.status));
      this.rejectTasks(tasks, "VIEW_TRASHED", "The task View was moved to the recycle bin");
      const bindingRows = this.db.prepare("SELECT data FROM chat_canvas_binding").all() as any[];
      for (const row of bindingRows) {
        const binding = chatCanvasBindingSchema.parse(parse(row.data));
        if (binding.projectId !== input.projectId || binding.viewId !== input.viewId) continue;
        const next = this.saveChatCanvasBinding({ ...binding, viewId: fallback.id, canvasSessionId: undefined, bindingRevision: binding.bindingRevision + 1, status: "opening", lastSeenAt: timestamp });
        this.appendProjectEvent({ projectId: input.projectId, canvasSessionId: binding.canvasSessionId, kind: "chat.binding.changed", payload: { bindingRevision: next.bindingRevision, status: "detached", fallbackViewId: fallback.id, reason: "VIEW_TRASHED" } });
      }
      return { view, fallbackView: fallback, ...this.bumpViewCatalog(input.projectId, { upsertedViews: [view], defaultViewId: project.defaultViewId === input.viewId ? fallback.id : project.defaultViewId }) };
    });
  }

  restoreProjectView(input: { projectId: string; viewId: string; baseCatalogRevision: number }) {
    return this.transaction(() => {
      const project = this.getProject(input.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); this.assertCatalogRevision(project, input.baseCatalogRevision);
      const current = this.getProjectView(input.projectId, input.viewId); if (!current || current.status !== "trashed") throw new Error("VIEW_NOT_TRASHED");
      const view = this.putProjectView({ ...current, status: "active", trashedAt: undefined, purgeAfter: undefined, updatedAt: now() });
      return { view, ...this.bumpViewCatalog(input.projectId, { upsertedViews: [view] }) };
    });
  }

  purgeProjectView(input: { projectId: string; viewId: string; baseCatalogRevision: number }) {
    return this.transaction(() => {
      const project = this.getProject(input.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); this.assertCatalogRevision(project, input.baseCatalogRevision);
      const current = this.getProjectView(input.projectId, input.viewId); if (!current || current.status !== "trashed") throw new Error("VIEW_NOT_TRASHED");
      this.db.prepare("DELETE FROM project_view WHERE project_id = ? AND id = ?").run(input.projectId, input.viewId);
      this.db.prepare("DELETE FROM layout WHERE project_id = ? AND view_id = ?").run(input.projectId, input.viewId);
      this.db.prepare("DELETE FROM layout_history WHERE project_id = ? AND view_id = ?").run(input.projectId, input.viewId);
      this.db.prepare("DELETE FROM layout_run WHERE project_id = ? AND view_id = ?").run(input.projectId, input.viewId);
      this.db.prepare("DELETE FROM canvas_view_state WHERE view_id = ?").run(input.viewId);
      return { view: current, ...this.bumpViewCatalog(input.projectId, { removedViewIds: [input.viewId] }) };
    });
  }

  duplicateProjectView(input: { projectId: string; viewId: string; name?: string; baseCatalogRevision: number }) {
    return this.transaction(() => {
      const project = this.getProject(input.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); this.assertCatalogRevision(project, input.baseCatalogRevision);
      const sourceView = this.getProjectView(input.projectId, input.viewId); if (!sourceView || sourceView.status !== "active") throw new Error("VIEW_NOT_FOUND");
      const source = this.getLayout(input.projectId, input.viewId); if (!source) throw new Error("LAYOUT_NOT_FOUND");
      const viewId = `${source.viewType}-${randomUUID().slice(0, 8)}`; const name = input.name?.trim() || `${sourceView.name} copy`;
      const layout = layoutDocumentSchema.parse({ ...source, viewId, viewName: name, layoutRevision: 1, createdBy: "user", updatedAt: now() });
      this.saveLayout(layout, false);
      const catalog = this.catalogViewFromLayout(layout, "user");
      return { layout, ...catalog };
    });
  }

  saveCanvasViewState(input: CanvasViewState) {
    const state = canvasViewStateSchema.parse(input);
    this.db.prepare("INSERT INTO canvas_view_state(canvas_session_id, view_id, data) VALUES (?, ?, ?) ON CONFLICT(canvas_session_id, view_id) DO UPDATE SET data=excluded.data").run(state.canvasSessionId, state.viewId, json(state));
    return state;
  }

  getCanvasViewState(canvasSessionId: string, viewId: string) {
    const row = this.db.prepare("SELECT data FROM canvas_view_state WHERE canvas_session_id = ? AND view_id = ?").get(canvasSessionId, viewId) as any;
    return row ? canvasViewStateSchema.parse(parse(row.data)) : null;
  }

  createProject(input: { title: string; goal: string; scenePack: ScenePack; automationLevel?: SpaceProject["automationLevel"]; createdFromTemplate?: { id: string; version: string }; writeSnapshots?: boolean }) {
    const timestamp = now();
    const project = projectSchema.parse({
      id: randomUUID(), title: input.title, goal: input.goal, scenePackId: input.scenePack.id, scenePackVersion: input.scenePack.version,
      automationLevel: input.automationLevel ?? "collaborative", defaultViewId: `${input.scenePack.defaultView}-default`, graphRevision: 0, createdAt: timestamp, updatedAt: timestamp,
      createdFromTemplate: input.createdFromTemplate,
    });
    this.db.prepare("INSERT INTO project(id, data) VALUES (?, ?)").run(project.id, json(project));
    const layout = defaultLayout(project, project.defaultViewId, input.scenePack.defaultView, input.scenePack.defaultStrategy as LayoutDocument["strategy"]);
    this.transaction(() => { this.saveLayout(layout, false); this.catalogViewFromLayout(layout); });
    const created = this.getProject(project.id)!;
    if (input.writeSnapshots !== false) this.writeProjectSnapshots(created, input.scenePack);
    return created;
  }

  createSeededProject(input: { title: string; goal: string; scenePack: ScenePack; automationLevel?: SpaceProject["automationLevel"]; chatSessionKey?: string }) {
    let project!: SpaceProject;
    this.transaction(() => {
      project = this.createProject({ title: input.title, goal: input.goal, scenePack: input.scenePack, automationLevel: input.automationLevel, writeSnapshots: false });
      const timestamp = now();
      const root = nodeSchema.parse({ id: randomUUID(), projectId: project.id, type: input.scenePack.nodeTypes[0].key, title: project.goal || project.title, body: "", properties: {}, archived: false, createdAt: timestamp, updatedAt: timestamp });
      this.replaceGraph({ projectId: project.id, revision: 1, nodes: [root], edges: [] });
      project = this.getProject(project.id)!;
      const layout = this.getLayout(project.id, project.defaultViewId)!;
      layout.graphRevision = 1;
      layout.nodes[root.id] = { nodeId: root.id, x: 0, y: 0, width: input.scenePack.nodeTypes[0].defaultWidth, height: input.scenePack.nodeTypes[0].defaultHeight, rotation: 0, zIndex: 0, pinned: false, hidden: false, collapsed: false };
      layout.bounds = { x: 0, y: 0, width: input.scenePack.nodeTypes[0].defaultWidth, height: input.scenePack.nodeTypes[0].defaultHeight };
      this.saveLayout(layout, false);
      if (input.chatSessionKey) this.openChatCanvasBinding({ chatSessionKey: input.chatSessionKey, projectId: project.id, viewId: project.defaultViewId });
    });
    this.writeProjectSnapshots(project, input.scenePack);
    return { project, graph: this.getGraph(project.id), layout: this.getLayout(project.id, project.defaultViewId)!, binding: input.chatSessionKey ? this.getChatCanvasBinding(input.chatSessionKey) : undefined };
  }

  private writeProjectSnapshots(project: SpaceProject, scenePack: ScenePack) {
    writeFileSync(join(this.dataDir, "scene-pack.snapshot.json"), `${JSON.stringify(scenePack, null, 2)}\n`, "utf8");
    writeFileSync(join(this.dataDir, "project.json"), `${JSON.stringify(project, null, 2)}\n`, "utf8");
  }

  getGraph(projectId: string): GraphSnapshot {
    const project = this.getProject(projectId);
    if (!project) throw new Error(`PROJECT_NOT_FOUND:${projectId}`);
    const nodes = this.db.prepare("SELECT data FROM node WHERE project_id = ?").all(projectId).map((row: any) => nodeSchema.parse(parse(row.data)));
    const edges = this.db.prepare("SELECT data FROM edge WHERE project_id = ?").all(projectId).map((row: any) => parse<SpaceEdge>(row.data));
    return { projectId, revision: project.graphRevision, nodes, edges };
  }

  private graphDelta(previous: GraphSnapshot, next: GraphSnapshot) {
    const beforeNodes = new Map(previous.nodes.map((node) => [node.id, node]));
    const beforeEdges = new Map(previous.edges.map((edge) => [edge.id, edge]));
    const summarize = (node: SpaceNode) => {
      const assetIds = node.content.kind === "image" ? [node.content.assetId]
        : node.content.kind === "document" ? [node.content.coverAssetId, ...node.content.embeddedAssetIds].filter(Boolean) as string[]
          : [node.content.imageAssetId].filter(Boolean) as string[];
      return {
        ...node,
        body: "",
        content: node.content.kind === "document" ? { ...node.content, markdown: "" } : node.content,
        assets: assetIds.map((id) => this.getAsset(id)).filter(Boolean),
      };
    };
    return {
      fromRevision: previous.revision,
      toRevision: next.revision,
      addedNodes: next.nodes.filter((node) => !beforeNodes.has(node.id)).map(summarize),
      updatedNodes: next.nodes.filter((node) => beforeNodes.has(node.id) && json(beforeNodes.get(node.id)) !== json(node)).map(summarize),
      archivedNodeIds: next.nodes.filter((node) => node.archived && !beforeNodes.get(node.id)?.archived).map((node) => node.id),
      addedEdges: next.edges.filter((edge) => !beforeEdges.has(edge.id)),
      updatedEdges: next.edges.filter((edge) => beforeEdges.has(edge.id) && json(beforeEdges.get(edge.id)) !== json(edge)),
      archivedEdgeIds: next.edges.filter((edge) => edge.archived && !beforeEdges.get(edge.id)?.archived).map((edge) => edge.id),
    };
  }

  replaceGraph(snapshot: GraphSnapshot, eventContext: { taskId?: string; canvasSessionId?: string } = {}) {
    const project = this.getProject(snapshot.projectId);
    if (!project) throw new Error(`PROJECT_NOT_FOUND:${snapshot.projectId}`);
    const previous = this.getGraph(snapshot.projectId);
    this.transaction(() => {
      this.db.prepare("DELETE FROM node WHERE project_id = ?").run(snapshot.projectId);
      this.db.prepare("DELETE FROM edge WHERE project_id = ?").run(snapshot.projectId);
      const nodeInsert = this.db.prepare("INSERT INTO node(id, project_id, data) VALUES (?, ?, ?)");
      const edgeInsert = this.db.prepare("INSERT INTO edge(id, project_id, data) VALUES (?, ?, ?)");
      for (const node of snapshot.nodes) {
        const validated = nodeSchema.parse(node);
        nodeInsert.run(validated.id, snapshot.projectId, json(validated));
      }
      for (const edge of snapshot.edges) edgeInsert.run(edge.id, snapshot.projectId, json(edge));
      const nextProject = { ...project, graphRevision: snapshot.revision, updatedAt: now() };
      this.db.prepare("UPDATE project SET data = ? WHERE id = ?").run(json(nextProject), snapshot.projectId);
      if (snapshot.revision !== previous.revision) this.appendProjectEvent({
        projectId: snapshot.projectId, taskId: eventContext.taskId, canvasSessionId: eventContext.canvasSessionId,
        kind: "graph.changed", graphRevision: snapshot.revision, payload: this.graphDelta(previous, snapshot),
      });
    });
  }

  getLayout(projectId: string, viewId: string) {
    const row = this.db.prepare("SELECT data FROM layout WHERE project_id = ? AND view_id = ?").get(projectId, viewId) as any;
    if (!row) return null;
    const raw = parse<any>(row.data); if (!raw.viewName) raw.viewName = raw.viewType;
    return layoutDocumentSchema.parse(raw);
  }

  listLayouts(projectId: string) {
    return this.db.prepare("SELECT data FROM layout WHERE project_id = ? ORDER BY view_id").all(projectId)
      .map((row: any) => { const raw = parse<any>(row.data); if (!raw.viewName) raw.viewName = raw.viewType; return layoutDocumentSchema.parse(raw); });
  }

  ensureView(input: { projectId: string; viewId: string; viewType: LayoutDocument["viewType"]; strategy: LayoutDocument["strategy"]; viewName?: string }) {
    const existing = this.getLayout(input.projectId, input.viewId);
    if (existing) {
      if (!this.getProjectView(input.projectId, input.viewId)) this.transaction(() => this.catalogViewFromLayout(existing));
      return existing;
    }
    const project = this.getProject(input.projectId);
    if (!project) throw new Error(`PROJECT_NOT_FOUND:${input.projectId}`);
    const graph = this.getGraph(input.projectId);
    const document = defaultLayout(project, input.viewId, input.viewType, input.strategy, input.viewName);
    document.graphRevision = graph.revision;
    graph.nodes.filter((node) => !node.archived).forEach((node, index) => {
      document.nodes[node.id] = {
        nodeId: node.id,
        x: (index % 4) * 292,
        y: Math.floor(index / 4) * 176,
        width: 220,
        height: 112,
        rotation: 0,
        zIndex: 0,
        pinned: false,
        hidden: false,
        collapsed: false,
      };
    });
    document.bounds = {
      x: 0,
      y: 0,
      width: graph.nodes.length ? Math.min(4, graph.nodes.length) * 292 - 72 : 0,
      height: graph.nodes.length ? Math.ceil(graph.nodes.length / 4) * 176 - 64 : 0,
    };
    this.transaction(() => { this.saveLayout(document, false); this.catalogViewFromLayout(document); });
    return document;
  }

  private uniqueViewName(projectId: string, requested: string) {
    const names = new Set(this.listLayouts(projectId).map((layout) => layout.viewName));
    if (!names.has(requested)) return requested;
    let index = 2;
    while (names.has(`${requested} ${index}`)) index += 1;
    return `${requested} ${index}`;
  }

  private templateLayout(input: { project: SpaceProject; template: VisualTemplate; viewId: string; viewName: string; graph: GraphSnapshot; layoutRevision: number }) {
    const { project, template, graph } = input;
    const document = defaultLayout(project, input.viewId, template.renderer, template.layoutPreset.strategy, input.viewName);
    document.graphRevision = graph.revision; document.layoutRevision = input.layoutRevision; document.templateRef = { id: template.id, version: template.version };
    document.projection = template.projection; document.theme = template.theme;
    document.config = { ...document.config, ...template.layoutPreset.config, direction: template.layoutPreset.direction ?? document.config.direction };
    const nodes = graph.nodes.filter((node) => !node.archived);
    const projection = template.projection;
    const statusValues = projection.kind === "board" ? projection.columnOrder : [];
    nodes.forEach((node, index) => {
      let x = (index % 4) * 300; let y = Math.floor(index / 4) * 180;
      if (projection.kind === "tree" || projection.kind === "flow") { x = (index % 4) * 310; y = Math.floor(index / 4) * 190; }
      if (projection.kind === "timeline") { const ordered = [...nodes].sort((a, b) => String(a.properties[projection.timeField] ?? "").localeCompare(String(b.properties[projection.timeField] ?? ""))); const order = ordered.findIndex((candidate) => candidate.id === node.id); x = order * 290; y = projection.groupField ? [...new Set(nodes.map((item) => String(item.properties[projection.groupField!] ?? "未分组")))].indexOf(String(node.properties[projection.groupField] ?? "未分组")) * 190 : 0; }
      if (projection.kind === "board") { const column = Math.max(0, statusValues.indexOf(String(node.properties[projection.columnField] ?? statusValues[0] ?? "未分组"))); const laneValues = projection.laneField ? [...new Set(nodes.map((item) => String(item.properties[projection.laneField!] ?? "未分组")))] : [""]; const lane = projection.laneField ? laneValues.indexOf(String(node.properties[projection.laneField] ?? "未分组")) : Math.floor(index / Math.max(statusValues.length, 1)); x = column * 320; y = lane * 210 + nodes.slice(0, index).filter((item) => String(item.properties[projection.columnField] ?? statusValues[0]) === String(node.properties[projection.columnField] ?? statusValues[0])).length * 140; }
      if (projection.kind === "matrix") { const rawX = Number(node.properties[projection.xField] ?? 50); const rawY = Number(node.properties[projection.yField] ?? 50); x = Math.max(0, Math.min(100, rawX)) * 8; y = (100 - Math.max(0, Math.min(100, rawY))) * 6; }
      if (projection.kind === "table") { x = 0; y = index * 132; }
      if (template.layoutPreset.strategy === "radial" && index > 0) { const angle = (index - 1) * Math.PI * 2 / Math.max(nodes.length - 1, 1); x = Math.cos(angle) * Math.max(280, nodes.length * 42); y = Math.sin(angle) * Math.max(240, nodes.length * 36); }
      document.nodes[node.id] = { ...this.defaultNodeFrame(node, x, y), rank: projection.kind === "tree" || projection.kind === "flow" ? Math.floor(index / 4) : undefined };
    });
    if (projection.kind === "board") {
      const columns = projection.columnOrder.length ? projection.columnOrder : [...new Set(nodes.map((node) => String(node.properties[projection.columnField] ?? "未分组")))];
      columns.forEach((label, index) => { document.groups[`column:${label}`] = { groupId: `column:${label}`, x: index * 320 - 24, y: -58, width: 292, height: Math.max(520, document.bounds.height + 120), direction: "vertical", padding: 24, collapsed: false }; });
    }
    if (projection.kind === "matrix") {
      projection.quadrantLabels.forEach((label, index) => { document.groups[`quadrant:${label}`] = { groupId: `quadrant:${label}`, x: index % 2 * 440 - 22, y: Math.floor(index / 2) * 330 - 42, width: 420, height: 310, padding: 22, collapsed: false }; });
    }
    for (const edge of graph.edges.filter((edge) => !edge.archived)) document.edges[edge.id] = { edgeId: edge.id, routing: template.theme.edgeStyles.default?.routing ?? "bezier", waypoints: [], hidden: false };
    const frames = Object.values(document.nodes);
    if (frames.length) { const minX = Math.min(...frames.map((item) => item.x)); const minY = Math.min(...frames.map((item) => item.y)); const maxX = Math.max(...frames.map((item) => item.x + item.width)); const maxY = Math.max(...frames.map((item) => item.y + item.height)); document.bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY }; }
    return layoutDocumentSchema.parse(document);
  }

  previewVisualTemplate(input: { projectId: string; template: VisualTemplate; baseGraphRevision: number; viewName?: string }) {
    const project = this.getProject(input.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND");
    const graph = this.getGraph(project.id); if (graph.revision !== input.baseGraphRevision) throw new Error("GRAPH_REVISION_CONFLICT");
    return this.templateLayout({ project, graph, template: input.template, viewId: `preview-${input.template.id}`, viewName: input.viewName ?? input.template.name, layoutRevision: 0 });
  }

  createViewFromVisualTemplate(input: { projectId: string; template: VisualTemplate; baseGraphRevision: number; viewName?: string; chatBinding?: { chatSessionKey: string; leaseId: string; bindingRevision: number } }) {
    const project = this.getProject(input.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND");
    const graph = this.getGraph(project.id); if (graph.revision !== input.baseGraphRevision) throw new Error("GRAPH_REVISION_CONFLICT");
    const viewName = this.uniqueViewName(project.id, input.viewName ?? input.template.name); const viewId = `${input.template.renderer}-${randomUUID().slice(0, 8)}`;
    const document = this.templateLayout({ project, graph, template: input.template, viewId, viewName, layoutRevision: 1 });
    this.transaction(() => {
      this.saveLayout(document, false);
      this.catalogViewFromLayout(document, "template");
      this.appendProjectEvent({ projectId: project.id, kind: "view.created", viewId, layoutRevision: 1, graphRevision: graph.revision, payload: { viewId, viewName, viewType: document.viewType, layoutRevision: 1, templateRef: document.templateRef } });
      if (input.chatBinding) this.switchChatCanvasBinding({ ...input.chatBinding, projectId: project.id, viewId });
    });
    return document;
  }

  createProjectFromVisualTemplate(input: { title: string; goal: string; scenePack: ScenePack; template: VisualTemplate; automationLevel?: SpaceProject["automationLevel"]; chatBinding?: { chatSessionKey: string; leaseId?: string; bindingRevision?: number } }) {
    const binding = input.template.sceneBindings[input.scenePack.id]; if (!input.template.compatibleScenePackIds.includes(input.scenePack.id) || !binding) throw new Error("VISUAL_TEMPLATE_SCENE_INCOMPATIBLE");
    let project!: SpaceProject;
    this.transaction(() => {
      project = this.createProject({ title: input.title, goal: input.goal, scenePack: input.scenePack, automationLevel: input.automationLevel, createdFromTemplate: { id: input.template.id, version: input.template.version }, writeSnapshots: false });
      const timestamp = now(); const ids = new Map(input.template.starterBlueprint.nodes.map((node) => [node.key, randomUUID()]));
      const nodes = input.template.starterBlueprint.nodes.map((item) => nodeSchema.parse({ id: ids.get(item.key), projectId: project.id, type: binding.nodeRoles[item.role] ?? input.scenePack.nodeTypes[0].key, title: item.title, body: "", contentKind: item.contentKind, content: { kind: "document", mode: "note", markdown: "", excerpt: "", embeddedAssetIds: [] }, properties: item.properties, archived: false, createdAt: timestamp, updatedAt: timestamp }));
      const edges = input.template.starterBlueprint.edges.map((item) => edgeSchema.parse({ id: randomUUID(), projectId: project.id, type: binding.edgeRoles[item.role] ?? input.scenePack.edgeTypes[0]?.key ?? "relation", sourceNodeId: ids.get(item.sourceKey), targetNodeId: ids.get(item.targetKey), directed: true, properties: {}, archived: false, createdAt: timestamp, updatedAt: timestamp }));
      this.replaceGraph({ projectId: project.id, revision: 1, nodes, edges });
      project = this.getProject(project.id)!;
      const layout = this.templateLayout({ project, graph: this.getGraph(project.id), template: input.template, viewId: project.defaultViewId, viewName: input.template.name, layoutRevision: 1 });
      this.saveLayout(layout, false);
      this.catalogViewFromLayout(layout, "template");
      if (input.chatBinding) {
        if (input.chatBinding.leaseId && input.chatBinding.bindingRevision) this.switchChatCanvasBinding({ chatSessionKey: input.chatBinding.chatSessionKey, leaseId: input.chatBinding.leaseId, bindingRevision: input.chatBinding.bindingRevision, projectId: project.id, viewId: project.defaultViewId });
        else this.openChatCanvasBinding({ chatSessionKey: input.chatBinding.chatSessionKey, projectId: project.id, viewId: project.defaultViewId });
      }
    });
    project = this.getProject(project.id)!;
    this.writeProjectSnapshots(project, input.scenePack);
    return { project, graph: this.getGraph(project.id), layout: this.getLayout(project.id, project.defaultViewId)!, binding: input.chatBinding ? this.getChatCanvasBinding(input.chatBinding.chatSessionKey) : undefined };
  }

  saveLayout(document: LayoutDocument, archive = true, eventContext: { taskId?: string; canvasSessionId?: string; operations?: unknown[] } = {}) {
    const validated = layoutDocumentSchema.parse(document);
    const current = this.getLayout(document.projectId, document.viewId);
    this.transaction(() => {
      if (archive) {
      if (current) this.db.prepare("INSERT OR IGNORE INTO layout_history(project_id, view_id, revision, data) VALUES (?, ?, ?, ?)").run(current.projectId, current.viewId, current.layoutRevision, json(current));
      }
      this.db.prepare("INSERT INTO layout(project_id, view_id, revision, data) VALUES (?, ?, ?, ?) ON CONFLICT(project_id, view_id) DO UPDATE SET revision=excluded.revision, data=excluded.data").run(validated.projectId, validated.viewId, validated.layoutRevision, json(validated));
      if (!current || current.layoutRevision !== validated.layoutRevision) this.appendProjectEvent({
        projectId: validated.projectId, taskId: eventContext.taskId, canvasSessionId: eventContext.canvasSessionId,
        kind: "layout.changed", viewId: validated.viewId, layoutRevision: validated.layoutRevision,
        payload: { viewId: validated.viewId, fromRevision: current?.layoutRevision ?? 0, toRevision: validated.layoutRevision, operations: eventContext.operations ?? [], document: eventContext.operations?.length ? undefined : validated },
      });
    });
    return validated;
  }

  getAsset(assetId: string) {
    const row = this.db.prepare("SELECT data FROM asset WHERE id = ?").get(assetId) as any;
    return row ? assetSchema.parse(parse(row.data)) : null;
  }

  getAssetByHash(projectId: string, sha256: string) {
    const row = this.db.prepare("SELECT data FROM asset WHERE project_id = ? AND sha256 = ?").get(projectId, sha256) as any;
    return row ? assetSchema.parse(parse(row.data)) : null;
  }

  readAsset(assetId: string, thumbnail = false) {
    const asset = this.getAsset(assetId);
    if (!asset) throw new Error(`ASSET_NOT_FOUND:${assetId}`);
    const uri = thumbnail ? asset.thumbnailUri : asset.storageUri;
    const relative = uri.split("/files/")[1];
    if (!relative) throw new Error("ASSET_URI_INVALID");
    const target = resolve(this.dataDir, "assets", relative);
    if (!target.startsWith(resolve(this.dataDir, "assets"))) throw new Error("UNSAFE_ASSET_PATH");
    return { asset, data: readFileSync(target) };
  }

  async importImageAsset(input: { projectId: string; mimeType: Asset["mimeType"]; data: Uint8Array }) {
    if (!this.getProject(input.projectId)) throw new Error(`PROJECT_NOT_FOUND:${input.projectId}`);
    if (input.data.byteLength > 20 * 1024 * 1024) throw new Error("IMAGE_TOO_LARGE:Maximum image size is 20MB");
    const data = Buffer.from(input.data);
    const sha256 = createHash("sha256").update(data).digest("hex");
    const existing = this.getAssetByHash(input.projectId, sha256);
    if (existing) return { asset: existing, deduplicated: true };
    const image = sharp(data, { animated: false, limitInputPixels: 40_000_000 });
    const metadata = await image.metadata();
    const actualMime = ({ jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" } as const)[metadata.format as "jpeg" | "png" | "webp" | "gif"];
    if (!actualMime || actualMime !== input.mimeType) throw new Error("IMAGE_TYPE_MISMATCH:Only JPEG, PNG, WebP and GIF are supported");
    if (!metadata.width || !metadata.height) throw new Error("IMAGE_DIMENSIONS_MISSING");
    const id = randomUUID();
    const extension = actualMime === "image/jpeg" ? "jpg" : actualMime.split("/")[1];
    const originalName = `original/${sha256}.${extension}`;
    const thumbnailName = `thumbnails/${sha256}.webp`;
    writeFileSync(join(this.dataDir, "assets", originalName), data);
    const thumbnail = await sharp(data, { animated: false, limitInputPixels: 40_000_000 }).rotate().resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    writeFileSync(join(this.dataDir, "assets", thumbnailName), thumbnail);
    const asset = assetSchema.parse({
      id, projectId: input.projectId, kind: "image", mimeType: actualMime, size: data.byteLength, sha256,
      width: metadata.width, height: metadata.height,
      storageUri: `weaver://projects/${input.projectId}/assets/${id}/files/${originalName}`,
      thumbnailUri: `weaver://projects/${input.projectId}/assets/${id}/files/${thumbnailName}`,
      createdAt: now(),
    });
    this.db.prepare("INSERT INTO asset(id, project_id, sha256, data) VALUES (?, ?, ?, ?)").run(asset.id, asset.projectId, asset.sha256, json(asset));
    return { asset, deduplicated: false };
  }

  createContentNode(input: { projectId: string; viewId: string; type: string; title: string; content: NodeContent; x: number; y: number }) {
    const graph = this.getGraph(input.projectId);
    const layout = this.getLayout(input.projectId, input.viewId);
    if (!layout) throw new Error(`LAYOUT_NOT_FOUND:${input.viewId}`);
    if (input.content.kind === "image") {
      const asset = this.getAsset(input.content.assetId);
      if (!asset || asset.projectId !== input.projectId) throw new Error("ASSET_NOT_FOUND_OR_CROSS_PROJECT");
    }
    const timestamp = now();
    const node = nodeSchema.parse({ id: randomUUID(), projectId: input.projectId, type: input.type, title: input.title, body: input.content.kind === "document" ? input.content.markdown : "", contentKind: input.content.kind, content: nodeContentSchema.parse(input.content), properties: {}, archived: false, createdAt: timestamp, updatedAt: timestamp });
    this.replaceGraph(applyGraphOperations(graph, [{ type: "add-node", node }]));
    const frame = this.defaultNodeFrame(node, input.x, input.y);
    const nextLayout = structuredClone(layout);
    nextLayout.nodes[node.id] = frame;
    nextLayout.graphRevision = graph.revision + 1;
    nextLayout.layoutRevision += 1;
    nextLayout.updatedAt = timestamp;
    this.saveLayout(nextLayout);
    return { node, project: this.getProject(input.projectId), layout: nextLayout };
  }

  updateNodeContent(input: { projectId: string; nodeId: string; baseGraphRevision: number; title?: string; type?: string; content?: NodeContent }) {
    const graph = this.getGraph(input.projectId);
    if (graph.revision !== input.baseGraphRevision) throw new Error(`GRAPH_REVISION_CONFLICT:Expected ${input.baseGraphRevision}, current ${graph.revision}`);
    const current = graph.nodes.find((node) => node.id === input.nodeId);
    if (!current) throw new Error(`NODE_NOT_FOUND:${input.nodeId}`);
    const operations: Parameters<typeof applyGraphOperations>[1] = [];
    if (input.title !== undefined || input.type !== undefined) operations.push({ type: "update-node", nodeId: input.nodeId, patch: { title: input.title ?? current.title, type: input.type ?? current.type, updatedAt: now() } });
    if (input.content) {
      this.assertContentAssets(input.projectId, input.content);
      operations.push({ type: "set-node-content", nodeId: input.nodeId, content: nodeContentSchema.parse(input.content) });
    }
    if (!operations.length) return { node: current, project: this.getProject(input.projectId) };
    const next = applyGraphOperations(graph, operations);
    this.replaceGraph(next);
    return { node: next.nodes.find((node) => node.id === input.nodeId)!, project: this.getProject(input.projectId) };
  }

  attachAsset(input: { projectId: string; nodeId: string; assetId: string; role: "embedded" | "cover"; baseGraphRevision: number }) {
    const asset = this.getAsset(input.assetId);
    if (!asset || asset.projectId !== input.projectId) throw new Error("ASSET_NOT_FOUND_OR_CROSS_PROJECT");
    const graph = this.getGraph(input.projectId);
    if (graph.revision !== input.baseGraphRevision) throw new Error("GRAPH_REVISION_CONFLICT");
    const next = applyGraphOperations(graph, [{ type: "attach-asset", nodeId: input.nodeId, assetId: input.assetId, role: input.role }]);
    this.replaceGraph(next);
    return { node: next.nodes.find((node) => node.id === input.nodeId)!, project: this.getProject(input.projectId) };
  }

  private assertContentAssets(projectId: string, content: NodeContent) {
    const ids = content.kind === "image" ? [content.assetId] : content.kind === "document" ? [content.coverAssetId, ...content.embeddedAssetIds].filter(Boolean) as string[] : [content.imageAssetId].filter(Boolean) as string[];
    for (const id of ids) {
      const asset = this.getAsset(id);
      if (!asset || asset.projectId !== projectId) throw new Error(`ASSET_NOT_FOUND_OR_CROSS_PROJECT:${id}`);
    }
  }

  private defaultNodeFrame(node: SpaceNode, x: number, y: number) {
    let width = 280; let height = 160;
    if (node.content.kind === "document" && node.content.mode === "note") { width = 220; height = 112; }
    if (node.content.kind === "link") { width = 300; height = 180; }
    if (node.content.kind === "image") {
      const asset = this.getAsset(node.content.assetId)!;
      width = Math.max(180, Math.min(360, asset.width));
      height = Math.max(120, Math.min(300, width * asset.height / asset.width));
    }
    return { nodeId: node.id, x, y, width, height, rotation: 0, zIndex: 0, pinned: false, hidden: false, collapsed: false };
  }

  saveLayoutRun(input: { id?: string; projectId: string; viewId: string; taskId?: string; plan: unknown; candidates: LayoutCandidate[] }) {
    const id = input.id ?? randomUUID();
    const { id: _requestedId, ...runInput } = input;
    const data = { id, ...runInput, status: "preview", createdAt: now() };
    this.db.prepare("INSERT INTO layout_run(id, project_id, view_id, data) VALUES (?, ?, ?, ?)").run(id, input.projectId, input.viewId, json(data));
    return data;
  }

  getLayoutRun(id: string) {
    const row = this.db.prepare("SELECT data FROM layout_run WHERE id = ?").get(id) as any;
    return row ? parse<any>(row.data) : null;
  }

  applyLayoutCandidate(runId: string, candidateId: string) {
    const run = this.getLayoutRun(runId);
    if (!run) throw new Error(`LAYOUT_RUN_NOT_FOUND:${runId}`);
    const candidate = run.candidates.find((item: LayoutCandidate) => item.id === candidateId);
    if (!candidate) throw new Error(`LAYOUT_CANDIDATE_NOT_FOUND:${candidateId}`);
    if (candidate.metrics.hardViolations.length) throw new Error(`LAYOUT_HARD_VIOLATION:${candidate.metrics.hardViolations.join(",")}`);
    const current = this.getLayout(run.projectId, run.viewId);
    if (!current) throw new Error("LAYOUT_NOT_FOUND");
    if (current.layoutRevision !== run.plan.baseLayoutRevision) {
      if (run.taskId) this.updateAgentTask(run.taskId, { status: "stale", error: { code: "LAYOUT_REVISION_CONFLICT", message: `Expected layout r${run.plan.baseLayoutRevision}, current r${current.layoutRevision}` } });
      throw new Error("LAYOUT_REVISION_CONFLICT");
    }
    const next = { ...candidate.document, layoutRevision: current.layoutRevision + 1, graphRevision: this.getProject(run.projectId)?.graphRevision ?? candidate.document.graphRevision, updatedAt: now() };
    const task = run.taskId ? this.getAgentTask(run.taskId) : null;
    this.transaction(() => {
      this.saveLayout(next, true, { taskId: run.taskId, canvasSessionId: task?.canvasSessionId, operations: candidate.operations });
      run.status = "applied"; run.appliedCandidateId = candidateId; run.updatedAt = now();
      this.db.prepare("UPDATE layout_run SET data = ? WHERE id = ?").run(json(run), runId);
      if (run.taskId && task) this.updateAgentTask(run.taskId, { status: "completed", results: { ...task.results, layoutRunId: runId } });
    });
    return next;
  }

  rejectLayoutRun(runId: string) {
    const run = this.getLayoutRun(runId);
    if (!run) throw new Error(`LAYOUT_RUN_NOT_FOUND:${runId}`);
    if (run.status !== "preview") throw new Error(`LAYOUT_RUN_NOT_PENDING:${run.status}`);
    const task = run.taskId ? this.getAgentTask(run.taskId) : null;
    this.transaction(() => {
      run.status = "rejected"; run.updatedAt = now();
      this.db.prepare("UPDATE layout_run SET data = ? WHERE id = ?").run(json(run), runId);
      if (task) this.updateAgentTask(task.taskId, { status: "completed", results: { ...task.results, layoutRunId: runId } });
    });
    return run;
  }

  revertLayout(projectId: string, viewId: string) {
    const current = this.getLayout(projectId, viewId);
    if (!current) throw new Error("LAYOUT_NOT_FOUND");
    const row = this.db.prepare("SELECT data FROM layout_history WHERE project_id = ? AND view_id = ? ORDER BY revision DESC LIMIT 1").get(projectId, viewId) as any;
    if (!row) throw new Error("LAYOUT_HISTORY_EMPTY");
    const previous = layoutDocumentSchema.parse(parse(row.data));
    const restored = { ...previous, layoutRevision: current.layoutRevision + 1, updatedAt: now() };
    this.saveLayout(restored);
    return restored;
  }

  syncCanvasContext(snapshot: CanvasContextSnapshot, chatSessionKey?: string) {
    const validated = canvasContextSnapshotSchema.parse(snapshot);
    this.transaction(() => {
      const existing = this.db.prepare("SELECT sequence FROM canvas_session WHERE id = ?").get(validated.canvasSessionId) as any;
      if (existing && Number(existing.sequence) >= validated.sequence) throw new Error("STALE_CANVAS_SEQUENCE");
      if (validated.agentEligible) {
        if (!chatSessionKey || !validated.chatBinding) throw new Error("CODEX_THREAD_CONTEXT_REQUIRED");
        const binding = this.validateBindingLease({ chatSessionKey, ...validated.chatBinding });
        if ((binding.projectId && binding.projectId !== validated.projectId) || (binding.viewId && binding.viewId !== validated.viewId)) throw new Error("CHAT_CANVAS_LEASE_STALE");
        this.saveChatCanvasBinding({
          ...binding,
          projectId: validated.projectId,
          viewId: validated.viewId,
          canvasSessionId: validated.canvasSessionId,
          status: "active",
          lastSeenAt: validated.presence?.lastSeenAt ?? validated.updatedAt,
        });
      } else if (validated.chatBinding) {
        throw new Error("BROWSER_PREVIEW_AGENT_UNAVAILABLE");
      }
      this.db.prepare("INSERT INTO canvas_session(id, project_id, sequence, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id, sequence=excluded.sequence, data=excluded.data").run(validated.canvasSessionId, validated.projectId, validated.sequence, json(validated));
      this.saveCanvasViewState({ canvasSessionId: validated.canvasSessionId, viewId: validated.viewId, viewport: validated.viewport, selectedNodeIds: validated.selectedNodeIds, focusedNodeId: validated.focusedNodeId, lastOpenedAt: validated.presence?.lastSeenAt ?? validated.updatedAt });
      const projectView = this.getProjectView(validated.projectId, validated.viewId);
      if (projectView?.status === "active") this.putProjectView({ ...projectView, lastOpenedAt: validated.presence?.lastSeenAt ?? validated.updatedAt });
    });
    return validated;
  }

  getCanvasContext(sessionId: string) {
    const row = this.db.prepare("SELECT data FROM canvas_session WHERE id = ?").get(sessionId) as any;
    return row ? canvasContextSnapshotSchema.parse(parse(row.data)) : null;
  }

  prepareAgentTask(input: { canvasSessionId: string; actionKey: string; userInstruction?: string; dispatchKey?: string; chatSessionKey?: string }) {
    const context = this.getCanvasContext(input.canvasSessionId);
    if (!context) throw new Error(`CANVAS_SESSION_NOT_FOUND:${input.canvasSessionId}`);
    if (!context.agentEligible || !context.chatBinding || !input.chatSessionKey) throw new Error("BROWSER_PREVIEW_AGENT_UNAVAILABLE");
    const { binding } = this.getBoundCanvas(input.chatSessionKey, true);
    if (binding.canvasSessionId !== context.canvasSessionId || binding.bindingRevision !== context.chatBinding.bindingRevision) throw new Error("CHAT_CANVAS_LEASE_STALE");
    const timestamp = now();
    const dispatchKey = input.dispatchKey ?? randomUUID();
    const existingTasks = this.listCanvasTasks(context.canvasSessionId, true);
    const duplicate = existingTasks.find((task) => task.dispatches.some((dispatch) => dispatch.dispatchKey === dispatchKey));
    if (duplicate) return duplicate;
    for (const task of existingTasks.filter((candidate) => !terminalTaskStatuses.has(candidate.status))) {
      if (task.status === "prepared" && Date.now() - Date.parse(task.updatedAt) > 120_000) {
        this.updateAgentTask(task.taskId, { status: "failed", error: { code: "PREPARED_TASK_EXPIRED", message: "Prepared task was not dispatched within two minutes" } });
        continue;
      }
      throw new Error(`ACTIVE_CANVAS_TASK_EXISTS:${task.taskId}`);
    }
    const intent = ["develop_selection", "layout_view", "develop_then_layout"].includes(input.actionKey) ? input.actionKey : input.actionKey === "layout_view" ? "layout_view" : "develop_selection";
    const task = agentTaskSchema.parse({
      taskId: randomUUID(), canvasSessionId: context.canvasSessionId, workspaceDir: context.workspaceDir, projectId: context.projectId, viewId: context.viewId,
      chatSessionKey: input.chatSessionKey, bindingRevision: binding.bindingRevision,
      actionKey: input.actionKey, selectedNodeIds: context.selectedNodeIds, selectedEdgeIds: context.selectedEdgeIds,
      pinnedContextNodeIds: context.pinnedContextNodeIds, userInstruction: input.userInstruction, expectedGraphRevision: context.graphRevision,
      baseLayoutRevision: this.getLayout(context.projectId, context.viewId)?.layoutRevision ?? 0,
      contextResourceUri: `weaver://canvas-sessions/${context.canvasSessionId}/context`, attachmentResourceUris: [],
      intent, activeStage: intent === "layout_view" ? "layout" : "content", taskRevision: 0, results: {},
      dispatches: [{ dispatchKey, stage: intent === "layout_view" ? "layout" : "content", state: "prepared", attemptedAt: timestamp }],
      status: "prepared", createdAt: timestamp, updatedAt: timestamp,
    });
    this.transaction(() => {
      this.db.prepare("INSERT INTO agent_task(id, project_id, data) VALUES (?, ?, ?)").run(task.taskId, task.projectId, json(task));
      this.appendProjectEvent({ projectId: task.projectId, canvasSessionId: task.canvasSessionId, taskId: task.taskId, kind: "task.updated", payload: task });
    });
    return task;
  }

  prepareAgentTaskFromBoundCanvas(input: { chatSessionKey: string; actionKey: string; userInstruction?: string; dispatchKey?: string }) {
    const { context } = this.getBoundCanvas(input.chatSessionKey, true);
    return this.prepareAgentTask({ canvasSessionId: context.canvasSessionId, actionKey: input.actionKey, userInstruction: input.userInstruction, dispatchKey: input.dispatchKey, chatSessionKey: input.chatSessionKey });
  }

  assertTaskChat(taskId: string, chatSessionKey: string, requireOnline = true) {
    const task = this.getAgentTask(taskId);
    if (!task) throw new Error(`AGENT_TASK_NOT_FOUND:${taskId}`);
    if (task.chatSessionKey !== chatSessionKey) throw new Error("TASK_CHAT_MISMATCH");
    const { binding, context } = this.getBoundCanvas(chatSessionKey, requireOnline);
    if (binding.bindingRevision !== task.bindingRevision || binding.canvasSessionId !== task.canvasSessionId || context.projectId !== task.projectId) throw new Error("TASK_BINDING_STALE");
    return task;
  }

  getAgentTask(taskId: string) {
    const row = this.db.prepare("SELECT data FROM agent_task WHERE id = ?").get(taskId) as any;
    return row ? agentTaskSchema.parse(parse(row.data)) : null;
  }

  listCanvasTasks(canvasSessionId: string, includeTerminal = false) {
    const terminal = terminalTaskStatuses;
    return (this.db.prepare("SELECT data FROM agent_task WHERE json_extract(data, '$.canvasSessionId') = ? ORDER BY rowid DESC").all(canvasSessionId) as any[])
      .map((row) => agentTaskSchema.parse(parse(row.data)))
      .filter((task) => includeTerminal || !terminal.has(task.status));
  }

  listProjectTasks(projectId: string, includeTerminal = false) {
    const terminal = terminalTaskStatuses;
    return (this.db.prepare("SELECT data FROM agent_task WHERE project_id = ? ORDER BY rowid DESC").all(projectId) as any[])
      .map((row) => agentTaskSchema.parse(parse(row.data)))
      .filter((task) => includeTerminal || !terminal.has(task.status));
  }

  updateAgentTask(taskId: string, patch: Partial<AgentTask>) {
    const current = this.getAgentTask(taskId);
    if (!current) throw new Error(`AGENT_TASK_NOT_FOUND:${taskId}`);
    const unchanged = Object.entries(patch).every(([key, value]) => json((current as any)[key]) === json(value));
    if (unchanged) return current;
    if (patch.status && patch.status !== current.status && !taskTransitions[current.status].has(patch.status)) throw new Error(`TASK_TRANSITION_INVALID:${current.status}->${patch.status}`);
    const next = agentTaskSchema.parse({ ...current, ...patch, taskRevision: current.taskRevision + 1, taskId: current.taskId, projectId: current.projectId, updatedAt: now() });
    this.transaction(() => {
      this.db.prepare("UPDATE agent_task SET data = ? WHERE id = ?").run(json(next), taskId);
      this.appendProjectEvent({ projectId: next.projectId, canvasSessionId: next.canvasSessionId, taskId, kind: "task.updated", payload: next });
    });
    return next;
  }

  confirmAgentDispatch(taskId: string, dispatchKey: string) {
    const task = this.getAgentTask(taskId); if (!task) throw new Error(`AGENT_TASK_NOT_FOUND:${taskId}`);
    if (task.status === "dispatched" && task.dispatches.some((dispatch) => dispatch.dispatchKey === dispatchKey && dispatch.state === "accepted")) return task;
    if (task.status !== "prepared") throw new Error(terminalTaskStatuses.has(task.status) ? `TASK_TERMINAL:${task.status}` : `TASK_TRANSITION_INVALID:${task.status}->dispatched`);
    const dispatches = task.dispatches.map((dispatch) => dispatch.dispatchKey === dispatchKey && dispatch.state === "prepared" ? { ...dispatch, state: "accepted" as const, acceptedAt: now() } : dispatch);
    if (!dispatches.some((dispatch) => dispatch.dispatchKey === dispatchKey && dispatch.state === "accepted")) throw new Error("AGENT_DISPATCH_NOT_FOUND");
    return this.updateAgentTask(taskId, { status: "dispatched", dispatches, error: undefined });
  }

  failAgentDispatch(taskId: string, dispatchKey: string, input: { code: "AGENT_DISPATCH_REJECTED" | "DISPATCH_UNCONFIRMED"; message: string }) {
    const task = this.getAgentTask(taskId); if (!task) throw new Error(`AGENT_TASK_NOT_FOUND:${taskId}`);
    if (terminalTaskStatuses.has(task.status)) return task;
    if (task.status !== "prepared") throw new Error(`TASK_TRANSITION_INVALID:${task.status}->failed`);
    if (!task.dispatches.some((dispatch) => dispatch.dispatchKey === dispatchKey && dispatch.state === "prepared")) throw new Error("AGENT_DISPATCH_NOT_FOUND");
    const state = input.code === "DISPATCH_UNCONFIRMED" ? "unconfirmed" as const : "rejected" as const;
    const dispatches = task.dispatches.map((dispatch) => dispatch.dispatchKey === dispatchKey && dispatch.state === "prepared" ? { ...dispatch, state, error: input } : dispatch);
    return this.updateAgentTask(taskId, { status: "failed", dispatches, error: input });
  }

  beginAgentContinuation(input: { taskId: string; dispatchKey: string; expectedTaskRevision: number }) {
    const task = this.getAgentTask(input.taskId); if (!task) throw new Error(`AGENT_TASK_NOT_FOUND:${input.taskId}`);
    const duplicate = task.dispatches.find((dispatch) => dispatch.dispatchKey === input.dispatchKey); if (duplicate) return task;
    if (task.taskRevision !== input.expectedTaskRevision) throw new Error("TASK_REVISION_CONFLICT");
    if (task.status !== "ready_to_continue" || task.activeStage !== "layout") throw new Error(`TASK_TRANSITION_INVALID:${task.status}->prepared`);
    const record = { dispatchKey: input.dispatchKey, stage: "layout" as const, state: "prepared" as const, attemptedAt: now() };
    return this.updateAgentTask(task.taskId, { status: "prepared", dispatches: [...task.dispatches, record] });
  }

  submitChangeSet(changeSet: ChangeSet) {
    const validated = changeSetSchema.parse(changeSet);
    const project = this.getProject(validated.projectId);
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    const task = this.getAgentTask(validated.taskId);
    if (!task || task.projectId !== validated.projectId) throw new Error("AGENT_TASK_NOT_FOUND_OR_MISMATCH");
    if (task.status !== "running") throw new Error(terminalTaskStatuses.has(task.status) ? `TASK_TERMINAL:${task.status}` : `TASK_NOT_RUNNING:${task.status}`);
    if (project.graphRevision !== validated.baseGraphRevision) {
      this.updateAgentTask(task.taskId, { status: "stale", error: { code: "GRAPH_REVISION_CONFLICT", message: `Expected graph r${validated.baseGraphRevision}, current r${project.graphRevision}` } });
      throw new Error("GRAPH_REVISION_CONFLICT");
    }
    this.transaction(() => {
      this.db.prepare("INSERT INTO changeset(id, project_id, task_id, data) VALUES (?, ?, ?, ?)").run(validated.id, validated.projectId, validated.taskId, json(validated));
      this.updateAgentTask(validated.taskId, { status: "pending_review", results: { ...task.results, changeSetId: validated.id } });
    });
    return validated;
  }

  listChangeSets(projectId: string, status?: ChangeSet["status"]) {
    return this.db.prepare("SELECT data FROM changeset WHERE project_id = ? ORDER BY rowid DESC").all(projectId)
      .map((row: any) => changeSetSchema.parse(parse(row.data)))
      .filter((item) => !status || item.status === status);
  }

  getChangeSet(changeSetId: string) {
    const row = this.db.prepare("SELECT data FROM changeset WHERE id = ?").get(changeSetId) as any;
    return row ? changeSetSchema.parse(parse(row.data)) : null;
  }

  rejectChangeSet(changeSetId: string) {
    const current = this.getChangeSet(changeSetId);
    if (!current) throw new Error("CHANGESET_NOT_FOUND");
    if (current.status !== "pending") throw new Error(`CHANGESET_NOT_PENDING:${current.status}`);
    const rejected = { ...current, status: "rejected" as const, updatedAt: now() };
    this.transaction(() => {
      this.db.prepare("UPDATE changeset SET data = ? WHERE id = ?").run(json(rejected), changeSetId);
      this.updateAgentTask(current.taskId, { status: "completed" });
    });
    return rejected;
  }

  applyChangeSet(changeSetId: string) {
    const row = this.db.prepare("SELECT data FROM changeset WHERE id = ?").get(changeSetId) as any;
    if (!row) throw new Error("CHANGESET_NOT_FOUND");
    const changeSet = changeSetSchema.parse(parse(row.data));
    if (changeSet.status !== "pending") throw new Error(`CHANGESET_NOT_PENDING:${changeSet.status}`);
    const task = this.getAgentTask(changeSet.taskId);
    if (!task) throw new Error("AGENT_TASK_NOT_FOUND");
    const graph = this.getGraph(changeSet.projectId);
    if (graph.revision !== changeSet.baseGraphRevision) {
      this.updateAgentTask(changeSet.taskId, { status: "stale", error: { code: "GRAPH_REVISION_CONFLICT", message: `Expected graph r${changeSet.baseGraphRevision}, current r${graph.revision}` } });
      throw new Error("GRAPH_REVISION_CONFLICT");
    }
    for (const operation of changeSet.graphOperations) {
      if (operation.type === "add-node") this.assertContentAssets(changeSet.projectId, operation.node.content);
      if (operation.type === "set-node-content") this.assertContentAssets(changeSet.projectId, operation.content);
      if (operation.type === "attach-asset" || operation.type === "set-node-cover") {
        const assetId = operation.assetId;
        if (!assetId) continue;
        const asset = this.getAsset(assetId);
        if (!asset || asset.projectId !== changeSet.projectId) throw new Error(`ASSET_NOT_FOUND_OR_CROSS_PROJECT:${assetId}`);
      }
      if (operation.type === "update-node" && operation.patch.content) this.assertContentAssets(changeSet.projectId, nodeContentSchema.parse(operation.patch.content));
    }
    const nextGraph = changeSet.graphOperations.length ? applyGraphOperations(graph, changeSet.graphOperations) : graph;
    const byView = new Map<string, typeof changeSet.layoutOperations>();
    for (const operation of changeSet.layoutOperations) byView.set(operation.viewId, [...(byView.get(operation.viewId) ?? []), operation]);
    const addedNodes = nextGraph.nodes.filter((node) => !graph.nodes.some((current) => current.id === node.id));
    const context = this.getCanvasContext(task.canvasSessionId);
    if (addedNodes.length && context) {
      const activeLayout = this.getLayout(changeSet.projectId, context.viewId);
      if (!activeLayout) throw new Error(`LAYOUT_NOT_FOUND:${context.viewId}`);
      const existing = Object.values(activeLayout.nodes);
      const startX = existing.length ? Math.max(...existing.map((frame) => frame.x + frame.width)) + 72 : 0;
      const startY = existing.length ? Math.min(...existing.map((frame) => frame.y)) : 0;
      const placement = addedNodes.map((node, index) => ({
        type: "set-node-frame" as const, viewId: context.viewId, nodeId: node.id,
        frame: this.defaultNodeFrame(node, startX + (index % 3) * 300, startY + Math.floor(index / 3) * 190),
      }));
      byView.set(context.viewId, [...(byView.get(context.viewId) ?? []), ...placement]);
    }
    for (const [viewId] of byView) {
      const layout = this.getLayout(changeSet.projectId, viewId);
      if (!layout) throw new Error(`LAYOUT_NOT_FOUND:${viewId}`);
      const expected = changeSet.baseLayoutRevisions[viewId] ?? (context?.viewId === viewId ? task.baseLayoutRevision : undefined);
      if (expected === undefined || layout.layoutRevision !== expected) {
        this.updateAgentTask(changeSet.taskId, { status: "stale", error: { code: "LAYOUT_REVISION_CONFLICT", message: `Layout ${viewId} changed during review` } });
        throw new Error("LAYOUT_REVISION_CONFLICT");
      }
    }
    const applied = { ...changeSet, status: "applied" as const, updatedAt: now() };
    const layoutRevisions: Record<string, number> = {};
    this.transaction(() => {
      if (changeSet.graphOperations.length) this.replaceGraph(nextGraph, { taskId: task.taskId, canvasSessionId: task.canvasSessionId });
      for (const [viewId, operations] of byView) {
        const layout = structuredClone(this.getLayout(changeSet.projectId, viewId)!);
        for (const operation of operations) {
          if (operation.type !== "set-node-frame" || layout.nodes[operation.nodeId]) continue;
          if (!addedNodes.some((node) => node.id === operation.nodeId)) throw new Error(`LAYOUT_NODE_NOT_FOUND:${operation.nodeId}`);
          layout.nodes[operation.nodeId] = { nodeId: operation.nodeId, ...operation.frame, rotation: 0, zIndex: 0, pinned: false, hidden: false, collapsed: false };
        }
        const nextLayout = applyLayoutOperations(layout, operations);
        nextLayout.graphRevision = nextGraph.revision;
        this.saveLayout(nextLayout, true, { taskId: task.taskId, canvasSessionId: task.canvasSessionId, operations });
        layoutRevisions[viewId] = nextLayout.layoutRevision;
      }
      this.db.prepare("UPDATE changeset SET data = ? WHERE id = ?").run(json(applied), changeSetId);
      const mixed = task.intent === "develop_then_layout";
      this.updateAgentTask(changeSet.taskId, {
        status: mixed ? "ready_to_continue" : "completed",
        activeStage: mixed ? "layout" : task.activeStage,
        expectedGraphRevision: nextGraph.revision,
        results: { ...task.results, changeSetId },
      });
    });
    return { ...applied, graphRevision: nextGraph.revision, layoutRevisions, task: this.getAgentTask(changeSet.taskId) };
  }

  saveTaskAsset(taskId: string, fileName: string, data: Uint8Array) {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
    const target = join(this.dataDir, "assets", "tasks", taskId, safeName);
    mkdirSync(dirname(target), { recursive: true });
    if (!resolve(target).startsWith(resolve(this.dataDir))) throw new Error("UNSAFE_ASSET_PATH");
    writeFileSync(target, data);
    return { assetId: randomUUID(), path: target, resourceUri: `weaver://task-assets/${taskId}/${safeName}` };
  }

  publishArtifact(input: { projectId: string; type: string; title: string; content: unknown; sourceNodeIds: string[]; graphRevision: number }) {
    const project = this.getProject(input.projectId);
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    if (project.graphRevision !== input.graphRevision) throw new Error("GRAPH_REVISION_CONFLICT");
    const artifact = { id: randomUUID(), ...input, createdAt: now(), updatedAt: now() };
    this.db.prepare("INSERT INTO artifact(id, project_id, type, data) VALUES (?, ?, ?, ?)").run(artifact.id, artifact.projectId, artifact.type, json(artifact));
    return artifact;
  }

  getArtifact(artifactId: string) {
    const row = this.db.prepare("SELECT data FROM artifact WHERE id = ?").get(artifactId) as any;
    return row ? parse<any>(row.data) : null;
  }
}
