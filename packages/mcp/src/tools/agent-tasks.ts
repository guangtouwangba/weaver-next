import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { projectSchema, workspaceSchema } from "../shared/schemas.js";
import { workspaceByTask } from "../shared/workspace-registry.js";
import { defineTool, result, withStore, type MutateWithStore } from "../shared/tool-runtime.js";
import { chatSessionKeyFromRequest } from "../thread-context.js";

export type AgentTasksToolsCtx = { mutateWithStore: MutateWithStore };

/** Agent task lifecycle: prepare/confirm/fail dispatch, continuation, run/complete/cancel, and read/list. */
export function registerAgentTasksTools(server: McpServer, ctx: AgentTasksToolsCtx) {
  const { mutateWithStore } = ctx;

  server.registerTool("weaver_prepare_agent_task", {
    title: "Prepare Agent Task", description: "Atomically capture the latest canvas state into a durable task before the widget sends a follow-up message.",
    inputSchema: { ...workspaceSchema.shape, canvasSessionId: z.string(), actionKey: z.string(), userInstruction: z.string().optional(), dispatchKey: z.string().min(1) }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, defineTool(async ({ workspaceDir, canvasSessionId, actionKey, userInstruction, dispatchKey }, extra) => {
    const chatSessionKey = chatSessionKeyFromRequest(extra);
    const task = mutateWithStore(workspaceDir, (store) => store.prepareAgentTask({ canvasSessionId, actionKey, userInstruction, dispatchKey, chatSessionKey }));
    workspaceByTask.set(task.taskId, workspaceDir); return result(task, "Prepared agent task.");
  }));

  server.registerTool("weaver_prepare_task_from_active_canvas", {
    title: "Prepare Task From Active Canvas",
    description: "Create a durable Weaver task only from the exact Canvas bound to the current Codex chat.",
    inputSchema: { ...workspaceSchema.shape, actionKey: z.enum(["develop_selection", "follow_up_ask", "layout_view", "develop_then_layout"]), userInstruction: z.string().optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, defineTool(async ({ workspaceDir, actionKey, userInstruction }, extra) => {
    const chatSessionKey = chatSessionKeyFromRequest(extra);
    const dispatchKey = `chat-${randomUUID()}`;
    const task = mutateWithStore(workspaceDir, (store) => {
      const { context } = store.getBoundCanvas(chatSessionKey, true);
      const continuation = store.listCanvasTasks(context.canvasSessionId).find((candidate) => candidate.status === "ready_to_continue" && candidate.activeStage === "layout");
      if (continuation && ["layout_view", "develop_then_layout"].includes(actionKey)) {
        store.assertTaskChat(continuation.taskId, chatSessionKey);
        const prepared = store.beginAgentContinuation({ taskId: continuation.taskId, dispatchKey, expectedTaskRevision: continuation.taskRevision });
        const updated = userInstruction ? store.updateAgentTask(prepared.taskId, { userInstruction }) : prepared;
        return store.confirmAgentDispatch(updated.taskId, dispatchKey);
      }
      const prepared = store.prepareAgentTaskFromBoundCanvas({ chatSessionKey, actionKey, userInstruction, dispatchKey });
      return store.confirmAgentDispatch(prepared.taskId, dispatchKey);
    });
    workspaceByTask.set(task.taskId, workspaceDir);
    return result(task, "Prepared and dispatched task from active canvas.");
  }));

  server.registerTool("weaver_confirm_agent_dispatch", { title: "Confirm Agent Dispatch", description: "Confirm that the Codex host accepted the visible task message.", inputSchema: { ...workspaceSchema.shape, taskId: z.string(), dispatchKey: z.string().min(1) }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } } }, defineTool(async ({ workspaceDir, taskId, dispatchKey }, extra) => { const chatSessionKey = chatSessionKeyFromRequest(extra); const task = mutateWithStore(workspaceDir, (store) => { store.assertTaskChat(taskId, chatSessionKey); return store.confirmAgentDispatch(taskId, dispatchKey); }); workspaceByTask.set(task.taskId, workspaceDir); return result(task); }));

  server.registerTool("weaver_fail_agent_dispatch", { title: "Fail Agent Dispatch", description: "Record a rejected or unconfirmed Codex host dispatch without retrying it.", inputSchema: { ...workspaceSchema.shape, taskId: z.string(), dispatchKey: z.string().min(1), code: z.enum(["AGENT_DISPATCH_REJECTED", "DISPATCH_UNCONFIRMED"]), message: z.string().min(1) }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } } }, defineTool(async ({ workspaceDir, taskId, dispatchKey, code, message }, extra) => { const chatSessionKey = chatSessionKeyFromRequest(extra); return result(mutateWithStore(workspaceDir, (store) => { store.assertTaskChat(taskId, chatSessionKey); return store.failAgentDispatch(taskId, dispatchKey, { code, message }); })); }));

  server.registerTool("weaver_begin_agent_continuation", { title: "Begin Agent Continuation", description: "Atomically claim the layout dispatch for a reviewed mixed task.", inputSchema: { ...workspaceSchema.shape, taskId: z.string(), dispatchKey: z.string().min(1), expectedTaskRevision: z.number().int().nonnegative() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } } }, defineTool(async ({ workspaceDir, taskId, dispatchKey, expectedTaskRevision }, extra) => { const chatSessionKey = chatSessionKeyFromRequest(extra); return result(mutateWithStore(workspaceDir, (store) => { store.assertTaskChat(taskId, chatSessionKey); return store.beginAgentContinuation({ taskId, dispatchKey, expectedTaskRevision }); })); }));

  server.registerTool("weaver_mark_task_dispatched", { title: "Mark Task Dispatched", description: "Compatibility entry point for confirming the latest prepared dispatch.", inputSchema: { ...workspaceSchema.shape, taskId: z.string() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, defineTool(async ({ workspaceDir, taskId }, extra) => { const chatSessionKey = chatSessionKeyFromRequest(extra); return result(mutateWithStore(workspaceDir, (store) => { const task = store.assertTaskChat(taskId, chatSessionKey); const dispatch = [...task.dispatches].reverse().find((item) => item.state === "prepared"); if (!dispatch) throw new Error("AGENT_DISPATCH_NOT_FOUND"); return store.confirmAgentDispatch(taskId, dispatch.dispatchKey); })); }));

  for (const [name, status] of [["weaver_start_agent_task", "running"], ["weaver_complete_agent_task", "completed"]] as const) {
    server.registerTool(name, { title: name.replaceAll("_", " "), description: `Set a durable Weaver agent task to ${status}.`, inputSchema: { ...workspaceSchema.shape, taskId: z.string() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, defineTool(async ({ workspaceDir, taskId }, extra) => { const chatSessionKey = chatSessionKeyFromRequest(extra); return result(mutateWithStore(workspaceDir, (store) => { store.assertTaskChat(taskId, chatSessionKey); return store.updateAgentTask(taskId, { status }); })); }));
  }

  server.registerTool("weaver_cancel_agent_task", { title: "Cancel Agent Task", description: "Cooperatively cancel a non-terminal task so later agent writes are rejected.", inputSchema: { ...workspaceSchema.shape, taskId: z.string() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } } }, defineTool(async ({ workspaceDir, taskId }, extra) => { const chatSessionKey = chatSessionKeyFromRequest(extra); return result(mutateWithStore(workspaceDir, (store) => { const task = store.assertTaskChat(taskId, chatSessionKey, false); if (["completed", "stale", "failed", "cancelled"].includes(task.status)) return task; return store.updateAgentTask(taskId, { status: "cancelled" }); })); }));

  server.registerTool("weaver_get_agent_task", { title: "Get Agent Task", description: "Read a durable task only when it belongs to the current Codex chat binding.", inputSchema: { ...workspaceSchema.shape, taskId: z.string() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, defineTool(async ({ workspaceDir, taskId }, extra) => { const chatSessionKey = chatSessionKeyFromRequest(extra); const task = withStore(workspaceDir, (store) => store.assertTaskChat(taskId, chatSessionKey, false)); workspaceByTask.set(taskId, workspaceDir); return result(task); }));
  server.registerTool("weaver_list_canvas_tasks", { title: "List Canvas Tasks", description: "Widget-only recovery of non-terminal tasks associated with one canvas session. Reaps expired tasks first.", inputSchema: { ...workspaceSchema.shape, canvasSessionId: z.string() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } } }, defineTool(async ({ workspaceDir, canvasSessionId }) => result(mutateWithStore(workspaceDir, (store) => { store.reapExpiredCanvasTasks(canvasSessionId); return store.listCanvasTasks(canvasSessionId); }))));
  server.registerTool("weaver_list_project_tasks", { title: "List Project Tasks", description: "Widget-only recovery of non-terminal tasks for a reopened project canvas.", inputSchema: projectSchema.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } } }, defineTool(async ({ workspaceDir, projectId }) => result(withStore(workspaceDir, (store) => store.listProjectTasks(projectId)))));
}
