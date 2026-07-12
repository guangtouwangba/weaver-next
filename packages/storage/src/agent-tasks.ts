import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { agentTaskSchema, type AgentTask } from "@weaver/contracts";
import { dispatchedTaskExpiryMs, json, now, parse, preparedTaskExpiryMs, runningTaskExpiryMs, taskTransitions, terminalTaskStatuses } from "./store-internal.js";
import { transaction } from "./migrations.js";
import { appendProjectEvent } from "./project-events.js";
import { getBoundCanvas, getCanvasContext } from "./chat-canvas-binding.js";
import { getLayout } from "./layout-templates.js";

/** Lazily fail tasks whose owner went silent: prepared never dispatched, dispatched
 * never started, running with no heartbeat (any updateAgentTask bumps updatedAt).
 * pending_review / ready_to_continue wait on the USER and are never reaped. */
export function reapExpiredCanvasTasks(db: DatabaseSync, canvasSessionId: string) {
  const reaped: AgentTask[] = [];
  for (const task of listCanvasTasks(db, canvasSessionId)) {
    const idleMs = Date.now() - Date.parse(task.updatedAt);
    if (task.status === "prepared" && idleMs > preparedTaskExpiryMs) {
      reaped.push(updateAgentTask(db, task.taskId, { status: "failed", error: { code: "PREPARED_TASK_EXPIRED", message: "Prepared task was not dispatched within two minutes" } }));
    } else if (task.status === "dispatched" && idleMs > dispatchedTaskExpiryMs) {
      reaped.push(updateAgentTask(db, task.taskId, { status: "failed", error: { code: "AGENT_DISPATCH_TIMEOUT", message: "No agent started this task within three minutes" } }));
    } else if (task.status === "running" && idleMs > runningTaskExpiryMs) {
      reaped.push(updateAgentTask(db, task.taskId, { status: "failed", error: { code: "AGENT_TASK_TIMEOUT", message: "Agent reported no progress for ten minutes; task reaped so the canvas is unblocked" } }));
    }
  }
  return reaped;
}

export function prepareAgentTask(db: DatabaseSync, input: { canvasSessionId: string; actionKey: string; userInstruction?: string; dispatchKey?: string; chatSessionKey?: string }) {
  const context = getCanvasContext(db, input.canvasSessionId);
  if (!context) throw new Error(`CANVAS_SESSION_NOT_FOUND:${input.canvasSessionId}`);
  if (!context.agentEligible || !context.chatBinding || !input.chatSessionKey) throw new Error("BROWSER_PREVIEW_AGENT_UNAVAILABLE");
  const { binding } = getBoundCanvas(db, input.chatSessionKey, true);
  if (binding.canvasSessionId !== context.canvasSessionId || binding.bindingRevision !== context.chatBinding.bindingRevision) throw new Error("CHAT_CANVAS_LEASE_STALE");
  const timestamp = now();
  const dispatchKey = input.dispatchKey ?? randomUUID();
  const existingTasks = listCanvasTasks(db, context.canvasSessionId, true);
  const duplicate = existingTasks.find((task) => task.dispatches.some((dispatch) => dispatch.dispatchKey === dispatchKey));
  if (duplicate) return duplicate;
  reapExpiredCanvasTasks(db, context.canvasSessionId);
  const [blocking] = listCanvasTasks(db, context.canvasSessionId);
  if (blocking) throw new Error(`ACTIVE_CANVAS_TASK_EXISTS:${blocking.taskId}`);
  const intent = ["develop_selection", "follow_up_ask", "layout_view", "develop_then_layout"].includes(input.actionKey) ? input.actionKey : "develop_selection";
  const task = agentTaskSchema.parse({
    taskId: randomUUID(), canvasSessionId: context.canvasSessionId, workspaceDir: context.workspaceDir, projectId: context.projectId, viewId: context.viewId,
    chatSessionKey: input.chatSessionKey, bindingRevision: binding.bindingRevision,
    actionKey: input.actionKey, selectedNodeIds: context.selectedNodeIds,
    anchorNodeId: context.focusedNodeId ?? context.selectedNodeIds[0],
    referencedNodeIds: context.selectedNodeIds.filter((nodeId) => nodeId !== (context.focusedNodeId ?? context.selectedNodeIds[0])),
    selectedEdgeIds: context.selectedEdgeIds,
    pinnedContextNodeIds: context.pinnedContextNodeIds, userInstruction: input.userInstruction, expectedGraphRevision: context.graphRevision,
    baseLayoutRevision: getLayout(db, context.projectId, context.viewId)?.layoutRevision ?? 0,
    contextResourceUri: `weaver://canvas-sessions/${context.canvasSessionId}/context`, attachmentResourceUris: [],
    intent, activeStage: intent === "layout_view" ? "layout" : "content", taskRevision: 0, results: {},
    dispatches: [{ dispatchKey, stage: intent === "layout_view" ? "layout" : "content", state: "prepared", attemptedAt: timestamp }],
    status: "prepared", createdAt: timestamp, updatedAt: timestamp,
  });
  transaction(db, () => {
    db.prepare("INSERT INTO agent_task(id, project_id, data) VALUES (?, ?, ?)").run(task.taskId, task.projectId, json(task));
    appendProjectEvent(db, { projectId: task.projectId, canvasSessionId: task.canvasSessionId, taskId: task.taskId, kind: "task.updated", payload: task });
  });
  return task;
}

export function prepareAgentTaskFromBoundCanvas(db: DatabaseSync, input: { chatSessionKey: string; actionKey: string; userInstruction?: string; dispatchKey?: string }) {
  const { context } = getBoundCanvas(db, input.chatSessionKey, true);
  return prepareAgentTask(db, { canvasSessionId: context.canvasSessionId, actionKey: input.actionKey, userInstruction: input.userInstruction, dispatchKey: input.dispatchKey, chatSessionKey: input.chatSessionKey });
}

export function assertTaskChat(db: DatabaseSync, taskId: string, chatSessionKey: string, requireOnline = true) {
  const task = getAgentTask(db, taskId);
  if (!task) throw new Error(`AGENT_TASK_NOT_FOUND:${taskId}`);
  if (task.chatSessionKey !== chatSessionKey) throw new Error("TASK_CHAT_MISMATCH");
  const { binding, context } = getBoundCanvas(db, chatSessionKey, requireOnline);
  if (binding.bindingRevision !== task.bindingRevision || binding.canvasSessionId !== task.canvasSessionId || context.projectId !== task.projectId) throw new Error("TASK_BINDING_STALE");
  return task;
}

export function getAgentTask(db: DatabaseSync, taskId: string) {
  const row = db.prepare("SELECT data FROM agent_task WHERE id = ?").get(taskId) as any;
  return row ? agentTaskSchema.parse(parse(row.data)) : null;
}

export function listCanvasTasks(db: DatabaseSync, canvasSessionId: string, includeTerminal = false) {
  const terminal = terminalTaskStatuses;
  return (db.prepare("SELECT data FROM agent_task WHERE json_extract(data, '$.canvasSessionId') = ? ORDER BY rowid DESC").all(canvasSessionId) as any[])
    .map((row) => agentTaskSchema.parse(parse(row.data)))
    .filter((task) => includeTerminal || !terminal.has(task.status));
}

export function listProjectTasks(db: DatabaseSync, projectId: string, includeTerminal = false) {
  const terminal = terminalTaskStatuses;
  return (db.prepare("SELECT data FROM agent_task WHERE project_id = ? ORDER BY rowid DESC").all(projectId) as any[])
    .map((row) => agentTaskSchema.parse(parse(row.data)))
    .filter((task) => includeTerminal || !terminal.has(task.status));
}

export function updateAgentTask(db: DatabaseSync, taskId: string, patch: Partial<AgentTask>) {
  const current = getAgentTask(db, taskId);
  if (!current) throw new Error(`AGENT_TASK_NOT_FOUND:${taskId}`);
  const unchanged = Object.entries(patch).every(([key, value]) => json((current as any)[key]) === json(value));
  if (unchanged) return current;
  if (patch.status && patch.status !== current.status && !taskTransitions[current.status].has(patch.status)) throw new Error(`TASK_TRANSITION_INVALID:${current.status}->${patch.status}`);
  const next = agentTaskSchema.parse({ ...current, ...patch, taskRevision: current.taskRevision + 1, taskId: current.taskId, projectId: current.projectId, updatedAt: now() });
  transaction(db, () => {
    db.prepare("UPDATE agent_task SET data = ? WHERE id = ?").run(json(next), taskId);
    appendProjectEvent(db, { projectId: next.projectId, canvasSessionId: next.canvasSessionId, taskId, kind: "task.updated", payload: next });
  });
  return next;
}

export function confirmAgentDispatch(db: DatabaseSync, taskId: string, dispatchKey: string) {
  const task = getAgentTask(db, taskId); if (!task) throw new Error(`AGENT_TASK_NOT_FOUND:${taskId}`);
  if (task.status === "dispatched" && task.dispatches.some((dispatch) => dispatch.dispatchKey === dispatchKey && dispatch.state === "accepted")) return task;
  if (task.status !== "prepared") throw new Error(terminalTaskStatuses.has(task.status) ? `TASK_TERMINAL:${task.status}` : `TASK_TRANSITION_INVALID:${task.status}->dispatched`);
  const dispatches = task.dispatches.map((dispatch) => dispatch.dispatchKey === dispatchKey && dispatch.state === "prepared" ? { ...dispatch, state: "accepted" as const, acceptedAt: now() } : dispatch);
  if (!dispatches.some((dispatch) => dispatch.dispatchKey === dispatchKey && dispatch.state === "accepted")) throw new Error("AGENT_DISPATCH_NOT_FOUND");
  return updateAgentTask(db, taskId, { status: "dispatched", dispatches, error: undefined });
}

export function failAgentDispatch(db: DatabaseSync, taskId: string, dispatchKey: string, input: { code: "AGENT_DISPATCH_REJECTED" | "DISPATCH_UNCONFIRMED"; message: string }) {
  const task = getAgentTask(db, taskId); if (!task) throw new Error(`AGENT_TASK_NOT_FOUND:${taskId}`);
  if (terminalTaskStatuses.has(task.status)) return task;
  if (task.status !== "prepared") throw new Error(`TASK_TRANSITION_INVALID:${task.status}->failed`);
  if (!task.dispatches.some((dispatch) => dispatch.dispatchKey === dispatchKey && dispatch.state === "prepared")) throw new Error("AGENT_DISPATCH_NOT_FOUND");
  const state = input.code === "DISPATCH_UNCONFIRMED" ? "unconfirmed" as const : "rejected" as const;
  const dispatches = task.dispatches.map((dispatch) => dispatch.dispatchKey === dispatchKey && dispatch.state === "prepared" ? { ...dispatch, state, error: input } : dispatch);
  return updateAgentTask(db, taskId, { status: "failed", dispatches, error: input });
}

export function beginAgentContinuation(db: DatabaseSync, input: { taskId: string; dispatchKey: string; expectedTaskRevision: number }) {
  const task = getAgentTask(db, input.taskId); if (!task) throw new Error(`AGENT_TASK_NOT_FOUND:${input.taskId}`);
  const duplicate = task.dispatches.find((dispatch) => dispatch.dispatchKey === input.dispatchKey); if (duplicate) return task;
  if (task.taskRevision !== input.expectedTaskRevision) throw new Error("TASK_REVISION_CONFLICT");
  if (task.status !== "ready_to_continue" || task.activeStage !== "layout") throw new Error(`TASK_TRANSITION_INVALID:${task.status}->prepared`);
  const record = { dispatchKey: input.dispatchKey, stage: "layout" as const, state: "prepared" as const, attemptedAt: now() };
  return updateAgentTask(db, task.taskId, { status: "prepared", dispatches: [...task.dispatches, record] });
}
