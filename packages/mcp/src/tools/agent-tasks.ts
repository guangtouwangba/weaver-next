import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { taskActionSchema } from "@weaver/contracts";
import { workspaceSchema } from "../shared/schemas.js";
import { workspaceByTask } from "../shared/workspace-registry.js";
import { defineTool, result, type MutateWithStore } from "../shared/tool-runtime.js";
import { chatSessionKeyFromRequest } from "../thread-context.js";

export type AgentTasksToolsCtx = { mutateWithStore: MutateWithStore };

export function registerAgentTasksTools(server: McpServer, { mutateWithStore }: AgentTasksToolsCtx) {
  server.registerTool("weaver_prepare_task", {
    title: "Prepare Task",
    description: "Capture the current online Canvas binding and dispatch one auditable AgentTask.",
    inputSchema: { ...workspaceSchema.shape, actionKey: z.string().min(1), userInstruction: z.string().optional(), dispatchKey: z.string().optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, defineTool(async ({ workspaceDir, actionKey, userInstruction, dispatchKey }, extra) => {
    const chatSessionKey = chatSessionKeyFromRequest(extra); const key = dispatchKey ?? randomUUID();
    const task = mutateWithStore(workspaceDir, (store) => {
      const prepared = store.tasks.prepareBound({ chatSessionKey, actionKey, userInstruction, dispatchKey: key });
      return store.tasks.confirmDispatch(prepared.taskId, key);
    });
    workspaceByTask.set(task.taskId, workspaceDir); return result(task, "Prepared and dispatched task from active canvas.");
  }));

  const shape = {
    ...workspaceSchema.shape,
    taskId: z.string().min(1),
    action: z.enum(["start", "progress", "continue", "complete", "fail", "cancel"]),
    note: z.string().max(280).optional(),
    message: z.string().optional(),
    dispatchKey: z.string().optional(),
    expectedTaskRevision: z.number().int().nonnegative().optional(),
  } as const;
  server.registerTool("weaver_task_action", {
    title: "Task Action", description: "Advance, heartbeat, continue, finish, fail, or cancel an auditable Weaver AgentTask.", inputSchema: shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, defineTool(async ({ workspaceDir, taskId, action, note, message, dispatchKey, expectedTaskRevision }, extra) => {
    taskActionSchema.parse({ workspaceDir, taskId, action, note, message, dispatchKey, expectedTaskRevision });
    const chatSessionKey = chatSessionKeyFromRequest(extra);
    return result(mutateWithStore(workspaceDir, (store) => {
      if (action === "cancel") {
        const task = store.tasks.assertCanvas(taskId, chatSessionKey);
        return ["completed", "stale", "failed", "cancelled"].includes(task.status) ? task : store.tasks.update(taskId, { status: "cancelled" });
      }
      store.tasks.assertChat(taskId, chatSessionKey, action !== "fail");
      if (action === "start") return store.tasks.update(taskId, { status: "running" });
      if (action === "progress") { if (!note) throw new Error("INVALID_ARGS:note required"); return store.tasks.progress(taskId, note); }
      if (action === "continue") {
        if (!dispatchKey || expectedTaskRevision === undefined) throw new Error("INVALID_ARGS:dispatchKey and expectedTaskRevision required");
        return store.tasks.continue({ taskId, dispatchKey, expectedTaskRevision });
      }
      if (action === "complete") return store.tasks.update(taskId, { status: "completed" });
      return store.tasks.update(taskId, { status: "failed", error: { code: "TASK_FAILED", message: message ?? "Task failed" } });
    }));
  }));
}
