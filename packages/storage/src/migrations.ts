import { DatabaseSync } from "node:sqlite";
import { agentTaskSchema, canvasContextSnapshotSchema, layoutDocumentSchema, nodeSchema, projectViewSchema } from "@weaver/contracts";
import { friendlyViewName, json, now, parse, terminalTaskStatuses } from "./store-internal.js";
import { getProject } from "./projects.js";
import { purgeProjectView, putProjectView } from "./view-catalog.js";

export function migrate(db: DatabaseSync) {
  db.exec(`
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

export function transaction<T>(db: DatabaseSync, callback: () => T): T {
  if (db.isTransaction) return callback();
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = callback();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function migrateLegacyNodes(db: DatabaseSync) {
  const rows = db.prepare("SELECT id, data FROM node").all() as Array<{ id: string; data: string }>;
  const update = db.prepare("UPDATE node SET data = ? WHERE id = ?");
  for (const row of rows) {
    const raw = parse<Record<string, unknown>>(row.data);
    if (raw.content && raw.contentKind) continue;
    update.run(json(nodeSchema.parse(raw)), row.id);
  }
}

export function migrateProjectViewPrimaryKey(db: DatabaseSync) {
  const columns = db.prepare("PRAGMA table_info(project_view)").all() as Array<{ name: string; pk: number }>;
  const primaryKey = columns.filter((column) => column.pk > 0).sort((left, right) => left.pk - right.pk).map((column) => column.name);
  if (primaryKey.join(",") === "project_id,id") return;
  transaction(db, () => {
    db.exec(`
      ALTER TABLE project_view RENAME TO project_view_legacy_pk;
      CREATE TABLE project_view (id TEXT NOT NULL, project_id TEXT NOT NULL, status TEXT NOT NULL, pinned_order INTEGER, data TEXT NOT NULL, PRIMARY KEY(project_id, id));
      INSERT OR REPLACE INTO project_view(id, project_id, status, pinned_order, data) SELECT id, project_id, status, pinned_order, data FROM project_view_legacy_pk;
      DROP TABLE project_view_legacy_pk;
      CREATE INDEX IF NOT EXISTS ix_project_view_project_status ON project_view(project_id, status);
    `);
  });
}

export function migrateLegacyCanvasContexts(db: DatabaseSync) {
  const rows = db.prepare("SELECT id, data FROM canvas_session").all() as Array<{ id: string; data: string }>;
  const update = db.prepare("UPDATE canvas_session SET data = ? WHERE id = ?");
  for (const row of rows) {
    const raw = parse<Record<string, unknown>>(row.data);
    if (raw.version === 2) continue;
    update.run(json(canvasContextSnapshotSchema.parse({ ...raw, version: 2, chatBinding: undefined, agentEligible: false })), row.id);
  }
}

export function migrateLegacyAgentTasks(db: DatabaseSync) {
  const rows = db.prepare("SELECT id, data FROM agent_task").all() as Array<{ id: string; data: string }>;
  const update = db.prepare("UPDATE agent_task SET data = ? WHERE id = ?");
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

export function migrateLegacyProjectViews(db: DatabaseSync) {
  const layoutRows = db.prepare("SELECT project_id, view_id, data FROM layout").all() as Array<{ project_id: string; view_id: string; data: string }>;
  const insert = db.prepare("INSERT OR IGNORE INTO project_view(id, project_id, status, pinned_order, data) VALUES (?, ?, ?, ?, ?)");
  const touchedProjects = new Set<string>();
  for (const row of layoutRows) {
    const layout = layoutDocumentSchema.parse({ ...parse<any>(row.data), viewName: parse<any>(row.data).viewName ?? parse<any>(row.data).viewType });
    const project = getProject(db, row.project_id); if (!project) continue;
    const timestamp = layout.updatedAt ?? now();
    const view = projectViewSchema.parse({ id: row.view_id, projectId: row.project_id, name: friendlyViewName(layout), viewType: layout.viewType, templateRef: layout.templateRef, status: "active", pinned: row.view_id === project.defaultViewId, pinnedOrder: row.view_id === project.defaultViewId ? 0 : undefined, createdBy: layout.templateRef ? "template" : "user", createdAt: timestamp, updatedAt: timestamp, lastOpenedAt: timestamp });
    insert.run(view.id, view.projectId, view.status, view.pinnedOrder ?? null, json(view));
    touchedProjects.add(view.projectId);
  }
  for (const projectId of touchedProjects) {
    const project = getProject(db, projectId); if (!project || project.viewCatalogRevision > 0) continue;
    db.prepare("UPDATE project SET data = ? WHERE id = ?").run(json({ ...project, viewCatalogRevision: 1 }), projectId);
  }
  const existingViews = db.prepare("SELECT project_id, id, data FROM project_view").all() as Array<{ project_id: string; id: string; data: string }>;
  for (const row of existingViews) {
    const view = projectViewSchema.parse(parse(row.data));
    if (view.name !== view.viewType) continue;
    putProjectView(db, { ...view, name: `${view.viewType[0].toUpperCase()}${view.viewType.slice(1)}` });
  }
}

export function purgeExpiredProjectViews(db: DatabaseSync) {
  const rows = db.prepare("SELECT data FROM project_view WHERE status = 'trashed'").all() as any[];
  for (const row of rows) {
    const view = projectViewSchema.parse(parse(row.data));
    if (!view.purgeAfter || Date.parse(view.purgeAfter) > Date.now()) continue;
    const project = getProject(db, view.projectId); if (!project) continue;
    purgeProjectView(db, { projectId: view.projectId, viewId: view.id, baseCatalogRevision: project.viewCatalogRevision });
  }
}
