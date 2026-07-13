import { DatabaseSync } from "node:sqlite";

export const CURRENT_SCHEMA_VERSION = 8;
export const MIN_SUPPORTED_SCHEMA_VERSION = 6;

export type SchemaMigration = {
  from: number;
  to: number;
  apply(db: DatabaseSync): void;
  verify(db: DatabaseSync): void;
};

const V7_TABLES = [
  "project", "node", "edge", "layout", "layout_history", "layout_run", "project_view",
  "canvas_view_state", "canvas_session", "chat_canvas_binding", "agent_task", "changeset",
  "changeset_revert", "artifact", "asset", "project_event",
] as const;
const V8_TABLES = ["browser_session", "project_write_lease", "canvas_mutation"] as const;
const REQUIRED_TABLES = [...V7_TABLES, ...V8_TABLES] as const;

function ensureV7Objects(db: DatabaseSync) {
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
    CREATE TABLE IF NOT EXISTS changeset_revert (changeset_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS artifact (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS asset (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, sha256 TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(project_id, sha256));
    CREATE INDEX IF NOT EXISTS ix_asset_project ON asset(project_id);
    CREATE TABLE IF NOT EXISTS project_event (sequence INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, canvas_session_id TEXT, task_id TEXT, kind TEXT NOT NULL, graph_revision INTEGER, view_id TEXT, layout_revision INTEGER, payload TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS ix_project_event_project_sequence ON project_event(project_id, sequence);
    CREATE INDEX IF NOT EXISTS ix_project_event_session_sequence ON project_event(canvas_session_id, sequence);
  `);
}

function ensureV8Objects(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS browser_session (id TEXT PRIMARY KEY, status TEXT NOT NULL, credential_version INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS ix_browser_session_status ON browser_session(status);
    CREATE TABLE IF NOT EXISTS project_write_lease (project_id TEXT PRIMARY KEY, browser_session_id TEXT NOT NULL, revision INTEGER NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS ix_project_write_lease_session ON project_write_lease(browser_session_id, status);
    CREATE TABLE IF NOT EXISTS canvas_mutation (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, project_id TEXT NOT NULL, browser_session_id TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS ix_canvas_mutation_project_sequence ON canvas_mutation(project_id, sequence);
  `);
}

function ensureCurrentObjects(db: DatabaseSync) {
  ensureV7Objects(db);
  ensureV8Objects(db);
}

function verifyTables(db: DatabaseSync, required: readonly string[]) {
  const names = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name));
  const missing = required.filter((name) => !names.has(name));
  if (missing.length) throw new Error(`SCHEMA_VERIFY_MISSING_TABLES:${missing.join(",")}`);
}

function verifyV7Objects(db: DatabaseSync) { verifyTables(db, V7_TABLES); }
function verifyCurrentObjects(db: DatabaseSync) { verifyTables(db, REQUIRED_TABLES); }

export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [{
  from: 6,
  to: 7,
  apply: ensureV7Objects,
  verify: verifyV7Objects,
}, {
  from: 7,
  to: 8,
  apply: ensureV8Objects,
  verify: verifyCurrentObjects,
}];

export function canMigrateSchema(version: number): boolean {
  if (!Number.isInteger(version) || version < MIN_SUPPORTED_SCHEMA_VERSION || version > CURRENT_SCHEMA_VERSION) return false;
  let cursor = version;
  while (cursor < CURRENT_SCHEMA_VERSION) {
    const migration = SCHEMA_MIGRATIONS.find((candidate) => candidate.from === cursor);
    if (!migration || migration.to <= cursor) return false;
    cursor = migration.to;
  }
  return cursor === CURRENT_SCHEMA_VERSION;
}

export function migrateSchema(db: DatabaseSync, registry: readonly SchemaMigration[] = SCHEMA_MIGRATIONS) {
  const start = Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  if (start === CURRENT_SCHEMA_VERSION) { verifyCurrentObjects(db); return; }
  if (start > CURRENT_SCHEMA_VERSION) throw new Error(`SCHEMA_VERSION_NEWER_THAN_RUNTIME:${start}>${CURRENT_SCHEMA_VERSION}`);
  try {
    transaction(db, () => {
      let cursor = start;
      while (cursor < CURRENT_SCHEMA_VERSION) {
        const migration = registry.find((candidate) => candidate.from === cursor);
        if (!migration || migration.to <= cursor || migration.to > CURRENT_SCHEMA_VERSION) throw new Error(`SCHEMA_MIGRATION_PATH_MISSING:${cursor}`);
        migration.apply(db);
        db.exec(`PRAGMA user_version = ${migration.to}`);
        migration.verify(db);
        cursor = migration.to;
      }
      if (cursor !== CURRENT_SCHEMA_VERSION) throw new Error(`SCHEMA_MIGRATION_PATH_INCOMPLETE:${cursor}`);
      verifyCurrentObjects(db);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`SCHEMA_MIGRATION_FAILED:${start}->${CURRENT_SCHEMA_VERSION}:${message}`, { cause: error });
  }
}

export function initializeSchema(db: DatabaseSync) {
  ensureCurrentObjects(db);
  db.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`);
  verifyCurrentObjects(db);
}

export function transaction<T>(db: DatabaseSync, callback: () => T): T {
  if (db.isTransaction) return callback();
  db.exec("BEGIN IMMEDIATE");
  try { const value = callback(); db.exec("COMMIT"); return value; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}
