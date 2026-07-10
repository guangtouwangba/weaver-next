import { DatabaseSync } from "node:sqlite";
import { projectEventSchema, type ProjectEvent } from "@weaver/contracts";
import { json, now, parse } from "./store-internal.js";

export function appendProjectEvent(db: DatabaseSync, input: Omit<ProjectEvent, "sequence" | "createdAt"> & { createdAt?: string }) {
  const createdAt = input.createdAt ?? now();
  const result = db.prepare(`
    INSERT INTO project_event(project_id, canvas_session_id, task_id, kind, graph_revision, view_id, layout_revision, payload, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(input.projectId, input.canvasSessionId ?? null, input.taskId ?? null, input.kind, input.graphRevision ?? null, input.viewId ?? null, input.layoutRevision ?? null, json(input.payload), createdAt);
  return projectEventSchema.parse({ ...input, sequence: Number(result.lastInsertRowid), createdAt });
}

export function listProjectEvents(db: DatabaseSync, projectId: string, afterSequence = 0, limit = 500) {
  return (db.prepare(`
    SELECT sequence, project_id, canvas_session_id, task_id, kind, graph_revision, view_id, layout_revision, payload, created_at
    FROM project_event WHERE project_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT ?
  `).all(projectId, afterSequence, limit) as any[]).map((row) => projectEventSchema.parse({
    sequence: Number(row.sequence), projectId: row.project_id, canvasSessionId: row.canvas_session_id ?? undefined,
    taskId: row.task_id ?? undefined, kind: row.kind, graphRevision: row.graph_revision ?? undefined,
    viewId: row.view_id ?? undefined, layoutRevision: row.layout_revision ?? undefined,
    payload: parse(row.payload), createdAt: row.created_at,
  }));
}

export function getLatestEventSequence(db: DatabaseSync, projectId: string) {
  const row = db.prepare("SELECT MAX(sequence) AS sequence FROM project_event WHERE project_id = ?").get(projectId) as any;
  return Number(row?.sequence ?? 0);
}
