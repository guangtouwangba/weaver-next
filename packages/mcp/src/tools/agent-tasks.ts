import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { taskActionSchema } from "@weaver/contracts";
import { workspaceSchema } from "../shared/schemas.js";
import { workspaceByTask } from "../shared/workspace-registry.js";
import { defineTool, result } from "../shared/tool-runtime.js";
import { chatSessionKeyFromRequest } from "../thread-context.js";
import { widgetBuildId } from "../widget.js";
import { dispatchWorkspaceAgentOperation } from "../workspace-runtime.js";

const dispatch = (workspaceDir: string, chatSessionKey: string, operation: string, arguments_: Record<string, unknown>) => dispatchWorkspaceAgentOperation({ workspaceDir, buildId: widgetBuildId(), chatSessionKey, operation, arguments: arguments_ });

export function registerAgentTasksTools(server: McpServer) {
  server.registerTool("weaver_prepare_task", {
    title: "Prepare Task", description: "Capture the current online Canvas binding and dispatch one auditable AgentTask.",
    inputSchema: { ...workspaceSchema.shape, actionKey: z.string().min(1), userInstruction: z.string().optional(), dispatchKey: z.string().optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, defineTool(async ({ workspaceDir, actionKey, userInstruction, dispatchKey }, extra) => {
    const task = await dispatch(workspaceDir, chatSessionKeyFromRequest(extra), "weaver_prepare_task", { actionKey, userInstruction, dispatchKey }) as { taskId: string };
    workspaceByTask.set(task.taskId, workspaceDir);
    return result(task, "Prepared and dispatched task from active canvas.");
  }));

  const shape = { ...workspaceSchema.shape, taskId: z.string().min(1), action: z.enum(["start", "progress", "continue", "complete", "fail", "cancel"]), note: z.string().max(280).optional(), message: z.string().optional(), dispatchKey: z.string().optional(), expectedTaskRevision: z.number().int().nonnegative().optional() } as const;
  server.registerTool("weaver_task_action", {
    title: "Task Action", description: "Advance, heartbeat, continue, finish, fail, or cancel an auditable Weaver AgentTask.", inputSchema: shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, defineTool(async ({ workspaceDir, taskId, action, note, message, dispatchKey, expectedTaskRevision }, extra) => {
    const args = { workspaceDir, taskId, action, note, message, dispatchKey, expectedTaskRevision };
    taskActionSchema.parse(args);
    workspaceByTask.set(taskId, workspaceDir);
    return result(await dispatch(workspaceDir, chatSessionKeyFromRequest(extra), "weaver_task_action", args));
  }));
}
