import { DatabaseSync } from "node:sqlite";
import { canvasMutationRecordSchema, canvasMutationRequestSchema, type CanvasMutationRecord, type CanvasMutationRequest } from "@weaver/contracts";
import { getProjectWriteLease } from "./browser-sessions.js";
import { transaction } from "./migrations.js";
import { json, parse } from "./store-internal.js";

type MutationResult = Pick<CanvasMutationRecord, "kind" | "resultGraphRevision" | "resultLayoutRevision" | "forwardOperations" | "inverseOperations">;

export function getCanvasMutation(db: DatabaseSync, id: string): CanvasMutationRecord | null {
  const row = db.prepare("SELECT data FROM canvas_mutation WHERE id = ?").get(id) as { data: string } | undefined;
  return row ? canvasMutationRecordSchema.parse(parse(row.data)) : null;
}

function saveCanvasMutation(db: DatabaseSync, record: CanvasMutationRecord) {
  const validated = canvasMutationRecordSchema.parse(record);
  db.prepare(`
    INSERT INTO canvas_mutation(id, project_id, browser_session_id, status, data) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET status=excluded.status, data=excluded.data
  `).run(validated.id, validated.projectId, validated.browserSessionId, validated.status, json(validated));
  return validated;
}

function assertWriter(db: DatabaseSync, projectId: string, browserSessionId: string, revision?: number) {
  const lease = getProjectWriteLease(db, projectId);
  if (!lease || lease.status !== "active" || lease.browserSessionId !== browserSessionId || (revision !== undefined && lease.revision !== revision)) {
    throw new Error("PROJECT_WRITER_LEASE_STALE");
  }
  return lease;
}

export function applyCanvasMutation(
  db: DatabaseSync,
  input: { request: CanvasMutationRequest; browserSessionId: string; createdAt: string },
  applyState: () => MutationResult,
) {
  const request = canvasMutationRequestSchema.parse(input.request);
  return transaction(db, () => {
    const existing = getCanvasMutation(db, request.mutationId);
    if (existing) {
      if (existing.projectId !== request.projectId || existing.browserSessionId !== input.browserSessionId) throw new Error("MUTATION_ID_CONFLICT");
      return existing;
    }
    assertWriter(db, request.projectId, input.browserSessionId, request.writerLeaseRevision);
    const result = applyState();
    return saveCanvasMutation(db, {
      id: request.mutationId,
      projectId: request.projectId,
      viewId: request.viewId,
      browserSessionId: input.browserSessionId,
      kind: result.kind,
      baseGraphRevision: request.baseGraphRevision,
      resultGraphRevision: result.resultGraphRevision,
      baseLayoutRevision: request.baseLayoutRevision,
      resultLayoutRevision: result.resultLayoutRevision,
      forwardOperations: result.forwardOperations,
      inverseOperations: result.inverseOperations,
      status: "applied",
      createdAt: input.createdAt,
    });
  });
}

export function revertCanvasMutation(
  db: DatabaseSync,
  input: { id: string; browserSessionId: string; currentGraphRevision?: number; currentLayoutRevision?: number; revertedAt: string },
  applyInverse: (record: CanvasMutationRecord) => void,
) {
  return transaction(db, () => {
    const record = getCanvasMutation(db, input.id);
    if (!record) throw new Error("CANVAS_MUTATION_NOT_FOUND");
    if (record.status === "reverted") return record;
    assertWriter(db, record.projectId, input.browserSessionId);
    if ((record.resultGraphRevision !== undefined && record.resultGraphRevision !== input.currentGraphRevision)
      || (record.resultLayoutRevision !== undefined && record.resultLayoutRevision !== input.currentLayoutRevision)) throw new Error("UNDO_REVISION_CONFLICT");
    applyInverse(record);
    return saveCanvasMutation(db, { ...record, status: "reverted", revertedAt: input.revertedAt });
  });
}
