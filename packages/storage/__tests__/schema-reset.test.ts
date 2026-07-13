import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, migrateSchema, type SchemaMigration } from "../src/migrations.js";
import { prepareWorkspaceData, WorkspaceStore } from "../src/workspace-store.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("workspace schema migration", () => {
  it("backs up and upgrades a supported schema in place without losing business data", () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-migrate-")); roots.push(root);
    const oldDir = join(root, ".weaver"); mkdirSync(oldDir); writeFileSync(join(oldDir, "marker.txt"), "preserve-me");
    const oldDb = new DatabaseSync(join(oldDir, "weaver.sqlite"));
    oldDb.exec(`
      CREATE TABLE project (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      INSERT INTO project(id, data) VALUES ('project-v6', '{"title":"Existing project"}');
      PRAGMA user_version = 6;
    `);
    oldDb.close();

    const store = new WorkspaceStore(root);
    const backup = store.schemaMigrationBackupName!;
    expect(store.schemaResetBackupName).toBeUndefined();
    expect(backup).toMatch(/^\.weaver-backup-/);
    expect(readFileSync(join(root, ".weaver", "marker.txt"), "utf8")).toBe("preserve-me");
    expect(readFileSync(join(root, backup, "marker.txt"), "utf8")).toBe("preserve-me");
    expect(store.db.prepare("SELECT data FROM project WHERE id = ?").get("project-v6")).toEqual({ data: '{"title":"Existing project"}' });
    expect((store.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(CURRENT_SCHEMA_VERSION);
    store.close();
  });

  it("upgrades the immediately previous v7 schema fixture without changing Project data", () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-migrate-v7-")); roots.push(root);
    const current = new WorkspaceStore(root);
    current.db.prepare("INSERT INTO project(id, data) VALUES (?, ?)").run("project-v7", '{"title":"Version seven"}');
    current.close();
    const oldDb = new DatabaseSync(join(root, ".weaver", "weaver.sqlite"));
    oldDb.exec(`
      DROP TABLE canvas_mutation;
      DROP TABLE project_write_lease;
      DROP TABLE browser_session;
      PRAGMA user_version = 7;
    `);
    oldDb.close();

    const migrated = new WorkspaceStore(root);
    expect(migrated.schemaMigrationBackupName).toMatch(/^\.weaver-backup-/);
    expect(migrated.db.prepare("SELECT data FROM project WHERE id = ?").get("project-v7")).toEqual({ data: '{"title":"Version seven"}' });
    expect((migrated.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'browser_session'").get()).toEqual({ name: "browser_session" });
    migrated.close();
  });

  it("rolls back every migration write when a supported migration fails", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE project (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      INSERT INTO project(id, data) VALUES ('before', '{}');
      PRAGMA user_version = 6;
    `);
    const failing: SchemaMigration = {
      from: 6,
      to: 7,
      apply(database) {
        database.prepare("INSERT INTO project(id, data) VALUES (?, ?)").run("partial", "{}");
        throw new Error("injected migration failure");
      },
      verify() {},
    };

    expect(() => migrateSchema(db, [failing])).toThrowError(/SCHEMA_MIGRATION_FAILED/);
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(6);
    expect(db.prepare("SELECT id FROM project ORDER BY id").all()).toEqual([{ id: "before" }]);
    db.close();
  });

  it("backs up an incompatible .weaver directory before creating the current schema", () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-reset-")); roots.push(root);
    const oldDir = join(root, ".weaver"); mkdirSync(oldDir); writeFileSync(join(oldDir, "marker.txt"), "legacy");
    const oldDb = new DatabaseSync(join(oldDir, "weaver.sqlite")); oldDb.exec("CREATE TABLE legacy(value TEXT); PRAGMA user_version = 1;"); oldDb.close();
    const store = new WorkspaceStore(root); const backup = store.schemaResetBackupName!;
    expect(backup).toMatch(/^\.weaver-backup-/); expect(readFileSync(join(root, backup, "marker.txt"), "utf8")).toBe("legacy");
    expect((store.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(CURRENT_SCHEMA_VERSION); store.close();
  });

  it("does not reset a current schema", () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-current-")); roots.push(root);
    const first = new WorkspaceStore(root); first.close(); const reopened = new WorkspaceStore(root);
    expect(reopened.schemaResetBackupName).toBeUndefined(); reopened.close();
  });

  it("adds a suffix when the timestamped backup name already exists", () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-collision-")); roots.push(root);
    const timestamp = new Date("2026-07-12T08:00:00.000Z");
    const oldDir = join(root, ".weaver"); mkdirSync(oldDir); const oldDb = new DatabaseSync(join(oldDir, "weaver.sqlite")); oldDb.exec("PRAGMA user_version = 1;"); oldDb.close();
    mkdirSync(join(root, ".weaver-backup-20260712T080000Z"));
    const prepared = prepareWorkspaceData(root, timestamp);
    expect(prepared.schemaResetBackupName).toBe(".weaver-backup-20260712T080000Z-2");
  });
});
