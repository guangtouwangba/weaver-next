import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { workspaceSchema } from "../shared/schemas.js";
import { workspaceByTask } from "../shared/workspace-registry.js";
import { defineTool, result } from "../shared/tool-runtime.js";
import { chatSessionKeyFromRequest } from "../thread-context.js";
import { widgetBuildId } from "../widget.js";
import { dispatchWorkspaceAgentOperation } from "../workspace-runtime.js";

export function registerReadSessionTool(server: McpServer) {
  server.registerTool("weaver_read_session", {
    title: "Read Session",
    description: "Read the current chat's session state: the bound canvas, a durable task, a canvas context snapshot, the resolved scene context, or a guard bundle (bound canvas + active task). Pick one via `resource`.",
    inputSchema: { ...workspaceSchema.shape, resource: z.enum(["bound_canvas", "task", "canvas_tasks", "canvas_context", "canvas_view_state", "resolved_context", "guard"]), taskId: z.string().optional(), canvasSessionId: z.string().optional(), viewId: z.string().optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, defineTool(async ({ workspaceDir, resource, taskId, canvasSessionId, viewId }, extra) => {
    const output = await dispatchWorkspaceAgentOperation({ workspaceDir, buildId: widgetBuildId(), chatSessionKey: chatSessionKeyFromRequest(extra), operation: "weaver_read_session", arguments: { resource, taskId, canvasSessionId, viewId } });
    if (resource === "task" && taskId) workspaceByTask.set(taskId, workspaceDir);
    if (resource === "guard") {
      const guarded = output as { task?: { taskId: string } | null };
      if (guarded.task) workspaceByTask.set(guarded.task.taskId, workspaceDir);
    }
    const count = resource === "resolved_context" ? (output as { nodes: unknown[] }).nodes.length : undefined;
    return result(output, count === undefined ? "OK" : `Resolved ${count} context nodes.`);
  }));
}
