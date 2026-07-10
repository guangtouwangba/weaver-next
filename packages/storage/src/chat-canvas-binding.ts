import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { canvasContextSnapshotSchema, chatCanvasBindingSchema, type AgentTask, type CanvasContextSnapshot, type ChatCanvasBinding } from "@weaver/contracts";
import { canvasOfflineAfterMs, json, now, parse, terminalTaskStatuses } from "./store-internal.js";
import { transaction } from "./migrations.js";
import { appendProjectEvent } from "./project-events.js";
import { getProjectView, putProjectView, saveCanvasViewState } from "./view-catalog.js";
import { listCanvasTasks, updateAgentTask } from "./agent-tasks.js";
import { getChangeSet } from "./changesets.js";

export function newLeaseId() { return randomBytes(32).toString("hex"); }

export function getChatCanvasBinding(db: DatabaseSync, chatSessionKey: string) {
  const row = db.prepare("SELECT data FROM chat_canvas_binding WHERE chat_session_key = ?").get(chatSessionKey) as any;
  return row ? chatCanvasBindingSchema.parse(parse(row.data)) : null;
}

export function saveChatCanvasBinding(db: DatabaseSync, binding: ChatCanvasBinding) {
  const validated = chatCanvasBindingSchema.parse(binding);
  db.prepare(`
    INSERT INTO chat_canvas_binding(chat_session_key, revision, data) VALUES (?, ?, ?)
    ON CONFLICT(chat_session_key) DO UPDATE SET revision=excluded.revision, data=excluded.data
  `).run(validated.chatSessionKey, validated.bindingRevision, json(validated));
  return validated;
}

export function rejectBindingWork(db: DatabaseSync, binding: ChatCanvasBinding) {
  if (!binding.canvasSessionId) return;
  const tasks = listCanvasTasks(db, binding.canvasSessionId, true).filter((task) => !terminalTaskStatuses.has(task.status));
  rejectTasks(db, tasks, "CHAT_CANVAS_REBOUND", "This Codex chat was rebound to another canvas");
}

export function rejectTasks(db: DatabaseSync, tasks: AgentTask[], code: string, message: string) {
  for (const task of tasks) {
    const changeSetId = task.results.changeSetId;
    if (changeSetId) {
      const changeSet = getChangeSet(db, changeSetId);
      if (changeSet?.status === "pending") {
        db.prepare("UPDATE changeset SET data = ? WHERE id = ?").run(json({ ...changeSet, status: "rejected", updatedAt: now() }), changeSetId);
      }
    }
    const layoutRunId = task.results.layoutRunId;
    if (layoutRunId) {
      const row = db.prepare("SELECT data FROM layout_run WHERE id = ?").get(layoutRunId) as any;
      if (row) {
        const run = parse<Record<string, any>>(row.data);
        if (run.status === "preview") db.prepare("UPDATE layout_run SET data = ? WHERE id = ?").run(json({ ...run, status: "rejected", updatedAt: now() }), layoutRunId);
      }
    }
    updateAgentTask(db, task.taskId, { status: "cancelled", error: { code, message } });
  }
}

export function openChatCanvasBinding(db: DatabaseSync, input: { chatSessionKey: string; projectId?: string; viewId?: string }) {
  return transaction(db, () => {
    if (input.projectId && input.viewId) {
      const target = getProjectView(db, input.projectId, input.viewId); if (!target || target.status !== "active") throw new Error("VIEW_NOT_FOUND");
    }
    const current = getChatCanvasBinding(db, input.chatSessionKey);
    const sameTarget = current?.projectId === input.projectId && current?.viewId === input.viewId;
    if (current && sameTarget && current.status === "opening") return current;
    if (current) rejectBindingWork(db, current);
    const binding = saveChatCanvasBinding(db, {
      chatSessionKey: input.chatSessionKey,
      bindingRevision: (current?.bindingRevision ?? 0) + 1,
      leaseId: newLeaseId(),
      projectId: input.projectId,
      viewId: input.viewId,
      status: "opening",
      lastSeenAt: now(),
    });
    if (current?.projectId) appendProjectEvent(db, {
      projectId: current.projectId,
      canvasSessionId: current.canvasSessionId,
      kind: "chat.binding.changed",
      payload: { bindingRevision: binding.bindingRevision, status: "detached" },
    });
    return binding;
  });
}

export function switchChatCanvasBinding(db: DatabaseSync, input: { chatSessionKey: string; leaseId: string; bindingRevision: number; projectId: string; viewId: string }) {
  return transaction(db, () => {
    const current = getChatCanvasBinding(db, input.chatSessionKey);
    if (!current) throw new Error("NO_CANVAS_BOUND_TO_CHAT");
    if (current.leaseId !== input.leaseId || current.bindingRevision !== input.bindingRevision) throw new Error("CHAT_CANVAS_LEASE_STALE");
    const targetView = getProjectView(db, input.projectId, input.viewId); if (!targetView || targetView.status !== "active") throw new Error("VIEW_NOT_FOUND");
    if (current.projectId === input.projectId && current.viewId === input.viewId) return current;
    rejectBindingWork(db, current);
    const next = saveChatCanvasBinding(db, { ...current, projectId: input.projectId, viewId: input.viewId, canvasSessionId: undefined, bindingRevision: current.bindingRevision + 1, status: "opening", lastSeenAt: now() });
    if (current.projectId) appendProjectEvent(db, {
      projectId: current.projectId, canvasSessionId: current.canvasSessionId, kind: "chat.binding.changed",
      payload: { bindingRevision: next.bindingRevision, status: "detached" },
    });
    return next;
  });
}

export function validateBindingLease(db: DatabaseSync, input: { chatSessionKey: string; leaseId: string; bindingRevision: number }) {
  const binding = getChatCanvasBinding(db, input.chatSessionKey);
  if (!binding) throw new Error("NO_CANVAS_BOUND_TO_CHAT");
  if (binding.leaseId !== input.leaseId || binding.bindingRevision !== input.bindingRevision) throw new Error("CHAT_CANVAS_LEASE_STALE");
  return binding;
}

export function getBoundCanvas(db: DatabaseSync, chatSessionKey: string, requireOnline = false) {
  const binding = getChatCanvasBinding(db, chatSessionKey);
  if (!binding?.projectId || !binding.viewId) throw new Error("NO_CANVAS_BOUND_TO_CHAT");
  if (binding.status !== "active" || !binding.canvasSessionId) throw new Error("BOUND_CANVAS_NOT_READY");
  const view = getProjectView(db, binding.projectId, binding.viewId); if (!view || view.status !== "active") throw new Error("BOUND_CANVAS_NOT_READY");
  const context = getCanvasContext(db, binding.canvasSessionId);
  if (!context || !context.agentEligible) throw new Error("BOUND_CANVAS_NOT_READY");
  const seenAt = Date.parse(context.presence?.lastSeenAt ?? context.updatedAt);
  if (requireOnline && (!Number.isFinite(seenAt) || Date.now() - seenAt > canvasOfflineAfterMs)) throw new Error("BOUND_CANVAS_OFFLINE");
  return { binding, context };
}

export function syncCanvasContext(db: DatabaseSync, snapshot: CanvasContextSnapshot, chatSessionKey?: string) {
  const validated = canvasContextSnapshotSchema.parse(snapshot);
  transaction(db, () => {
    const existing = db.prepare("SELECT sequence FROM canvas_session WHERE id = ?").get(validated.canvasSessionId) as any;
    if (existing && Number(existing.sequence) >= validated.sequence) throw new Error("STALE_CANVAS_SEQUENCE");
    if (validated.agentEligible) {
      if (!chatSessionKey || !validated.chatBinding) throw new Error("CODEX_THREAD_CONTEXT_REQUIRED");
      const binding = validateBindingLease(db, { chatSessionKey, ...validated.chatBinding });
      if ((binding.projectId && binding.projectId !== validated.projectId) || (binding.viewId && binding.viewId !== validated.viewId)) throw new Error("CHAT_CANVAS_LEASE_STALE");
      saveChatCanvasBinding(db, {
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
    db.prepare("INSERT INTO canvas_session(id, project_id, sequence, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id, sequence=excluded.sequence, data=excluded.data").run(validated.canvasSessionId, validated.projectId, validated.sequence, json(validated));
    saveCanvasViewState(db, { canvasSessionId: validated.canvasSessionId, viewId: validated.viewId, viewport: validated.viewport, selectedNodeIds: validated.selectedNodeIds, focusedNodeId: validated.focusedNodeId, lastOpenedAt: validated.presence?.lastSeenAt ?? validated.updatedAt });
    const projectView = getProjectView(db, validated.projectId, validated.viewId);
    if (projectView?.status === "active") putProjectView(db, { ...projectView, lastOpenedAt: validated.presence?.lastSeenAt ?? validated.updatedAt });
  });
  return validated;
}

export function getCanvasContext(db: DatabaseSync, sessionId: string) {
  const row = db.prepare("SELECT data FROM canvas_session WHERE id = ?").get(sessionId) as any;
  return row ? canvasContextSnapshotSchema.parse(parse(row.data)) : null;
}
