import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceStore } from "../src/workspace-store.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const now = "2026-07-13T10:00:00.000Z";
const expiresAt = "2026-08-13T10:00:00.000Z";

function store() {
  const root = mkdtempSync(join(tmpdir(), "weaver-mutation-")); roots.push(root);
  const db = new WorkspaceStore(root);
  db.browserSessions.create({ id: "browser-1", credentialHash: "hash", now, expiresAt });
  db.browserSessions.claimWriter({ projectId: "project-1", browserSessionId: "browser-1", now });
  return db;
}

describe("canvas mutation audit", () => {
  it("persists the state result and audit record once for an idempotency key", () => {
    const db = store();
    const apply = vi.fn(() => ({ kind: "graph" as const, resultGraphRevision: 2, forwardOperations: [{ type: "add-node" }], inverseOperations: [{ type: "archive-node" }] }));
    const request = { mutationId: "mutation-1", projectId: "project-1", writerLeaseRevision: 1, baseGraphRevision: 1, operation: { action: "create_node" } };
    const first = db.canvasMutations.apply({ request, browserSessionId: "browser-1", createdAt: now }, apply);
    const repeated = db.canvasMutations.apply({ request, browserSessionId: "browser-1", createdAt: now }, apply);
    expect(repeated).toEqual(first);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(db.canvasMutations.get("mutation-1")).toEqual(first);
  });

  it("rejects a stale or foreign writer lease before invoking state changes", () => {
    const db = store();
    const apply = vi.fn();
    expect(() => db.canvasMutations.apply({
      request: { mutationId: "mutation-1", projectId: "project-1", writerLeaseRevision: 2, operation: { action: "create_node" } },
      browserSessionId: "browser-1", createdAt: now,
    }, apply)).toThrowError("PROJECT_WRITER_LEASE_STALE");
    expect(apply).not.toHaveBeenCalled();
  });

  it("only reverts when current revisions still match the audited result", () => {
    const db = store();
    const request = { mutationId: "mutation-1", projectId: "project-1", writerLeaseRevision: 1, baseGraphRevision: 1, operation: { action: "create_node" } };
    db.canvasMutations.apply({ request, browserSessionId: "browser-1", createdAt: now }, () => ({ kind: "graph", resultGraphRevision: 2, forwardOperations: [], inverseOperations: [] }));
    const inverse = vi.fn();
    expect(() => db.canvasMutations.revert({ id: "mutation-1", browserSessionId: "browser-1", currentGraphRevision: 3, revertedAt: now }, inverse)).toThrowError("UNDO_REVISION_CONFLICT");
    expect(inverse).not.toHaveBeenCalled();
    expect(db.canvasMutations.revert({ id: "mutation-1", browserSessionId: "browser-1", currentGraphRevision: 2, revertedAt: now }, inverse)).toMatchObject({ status: "reverted", revertedAt: now });
    expect(inverse).toHaveBeenCalledTimes(1);
  });
});
