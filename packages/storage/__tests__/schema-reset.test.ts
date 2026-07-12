import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION } from "../src/migrations.js";
import { prepareWorkspaceData, WorkspaceStore } from "../src/workspace-store.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("workspace schema reset", () => {
  it("backs up an incompatible .weaver directory before creating the current schema", () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-reset-")); roots.push(root);
    const oldDir = join(root, ".weaver"); mkdirSync(oldDir); writeFileSync(join(oldDir, "marker.txt"), "legacy");
    const oldDb = new DatabaseSync(join(oldDir, "weaver.sqlite")); oldDb.exec("CREATE TABLE legacy(value TEXT); PRAGMA user_version = 6;"); oldDb.close();
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
