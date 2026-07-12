import { DatabaseSync } from "node:sqlite";

export const CURRENT_SCHEMA_VERSION = 7;

export function initializeSchema(db: DatabaseSync) {
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
    CREATE TABLE IF NOT EXISTS project_event (sequence INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, canvas_session_id TEXT, task_id TEXT, kind TEXT NOT NULL, graph_revision INTEGER, view_id TEXT, layout_revision INTEGER, payload TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS ix_project_event_project_sequence ON project_event(project_id, sequence);
    CREATE INDEX IF NOT EXISTS ix_project_event_session_sequence ON project_event(canvas_session_id, sequence);
    PRAGMA user_version = ${CURRENT_SCHEMA_VERSION};
  `);
}

export function transaction<T>(db: DatabaseSync, callback: () => T): T {
  if (db.isTransaction) return callback();
  db.exec("BEGIN IMMEDIATE");
  try { const value = callback(); db.exec("COMMIT"); return value; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}
