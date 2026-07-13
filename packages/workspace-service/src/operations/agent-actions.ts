import { randomUUID } from "node:crypto";
import { changeSetSchema, taskActionSchema } from "@weaver/contracts";
import type { WorkspaceStore } from "@weaver/storage";
import type { WorkspacePrincipal } from "./catalog.js";

function chatKey(store: WorkspaceStore, principal: WorkspacePrincipal) {
  if (principal.kind === "chat") return principal.chatSessionKey;
  if (principal.kind === "local-read") throw new Error("CHAT_PRINCIPAL_REQUIRED");
  const key = store.browserSessions.get(principal.browserSessionId)?.pairedChatSessionKey;
  if (!key) throw new Error("AGENT_DISCONNECTED");
  return key;
}

export function prepareAgentTask(store: WorkspaceStore, principal: WorkspacePrincipal, args: Record<string, unknown>) {
  const actionKey = typeof args.actionKey === "string" ? args.actionKey : "";
  if (!actionKey) throw new Error("INVALID_ARGS:actionKey required");
  const dispatchKey = typeof args.dispatchKey === "string" ? args.dispatchKey : randomUUID();
  const prepared = store.tasks.prepareBound({ chatSessionKey: chatKey(store, principal), actionKey, userInstruction: typeof args.userInstruction === "string" ? args.userInstruction : undefined, dispatchKey });
  return store.tasks.confirmDispatch(prepared.taskId, dispatchKey);
}

export function applyTaskAction(store: WorkspaceStore, principal: WorkspacePrincipal, args: Record<string, unknown>) {
  const validated = taskActionSchema.parse({ ...args, workspaceDir: store.workspaceDir });
  const key = chatKey(store, principal);
  if (validated.action === "cancel") {
    const task = store.tasks.assertCanvas(validated.taskId, key);
    return ["completed", "stale", "failed", "cancelled"].includes(task.status) ? task : store.tasks.update(validated.taskId, { status: "cancelled" });
  }
  store.tasks.assertChat(validated.taskId, key, validated.action !== "fail");
  if (validated.action === "start") return store.tasks.update(validated.taskId, { status: "running" });
  if (validated.action === "progress") {
    if (!validated.note) throw new Error("INVALID_ARGS:note required");
    return store.tasks.progress(validated.taskId, validated.note);
  }
  if (validated.action === "continue") {
    if (!validated.dispatchKey || validated.expectedTaskRevision === undefined) throw new Error("INVALID_ARGS:dispatchKey and expectedTaskRevision required");
    return store.tasks.continue({ taskId: validated.taskId, dispatchKey: validated.dispatchKey, expectedTaskRevision: validated.expectedTaskRevision });
  }
  if (validated.action === "complete") return store.tasks.update(validated.taskId, { status: "completed" });
  return store.tasks.update(validated.taskId, { status: "failed", error: { code: "TASK_FAILED", message: validated.message ?? "Task failed" } });
}

export function submitChangeSet(store: WorkspaceStore, principal: WorkspacePrincipal, args: Record<string, unknown>) {
  const validated = changeSetSchema.parse(args.changeSet);
  store.tasks.assertChat(validated.taskId, chatKey(store, principal));
  return store.graphChanges.submit(validated);
}
