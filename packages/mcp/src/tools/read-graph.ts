import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { workspaceSchema } from "../shared/schemas.js";
import { track } from "../shared/workspace-registry.js";
import { defineTool, result } from "../shared/tool-runtime.js";
import { chatSessionKeyFromRequest } from "../thread-context.js";
import { widgetBuildId } from "../widget.js";
import { dispatchWorkspaceAgentOperation } from "../workspace-runtime.js";

/**
 * One model-facing read tool that groups the four graph reads — the project
 * manifest (`manifest`), the whole-graph summary with one view layout (`full`),
 * a filtered node/edge query (`query`), and the full content of one node
 * (`node`). Each `resource` reuses the shared helper the kept widget tool calls,
 * so the model surface and the widget surface never drift. Pick one via `resource`.
 */
export function registerReadGraphTool(server: McpServer) {
  server.registerTool("weaver_read_graph", {
    title: "Read Graph",
    description: "Read a project's graph: the pinned scene manifest (`manifest`), the whole-graph summary + one view layout (`full`), a filtered node/edge query (`query`), or the full content of one node (`node`). Pick one via `resource`.",
    inputSchema: {
      ...workspaceSchema.shape,
      resource: z.enum(["manifest", "full", "query", "node"]),
      projectId: z.string().optional(),
      viewId: z.string().optional(),
      nodeId: z.string().optional(),
      nodeIds: z.array(z.string()).optional(),
      nodeTypes: z.array(z.string()).optional(),
      text: z.string().optional(),
      limit: z.number().int().positive().max(200).optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, defineTool(async ({ workspaceDir, resource, projectId, viewId, nodeId, nodeIds, nodeTypes, text, limit }, extra) => {
    if (!projectId) throw new Error("INVALID_ARGS:projectId required");
    const output = await dispatchWorkspaceAgentOperation({
      workspaceDir,
      buildId: widgetBuildId(),
      chatSessionKey: chatSessionKeyFromRequest(extra),
      operation: "weaver_read_graph",
      arguments: { resource, projectId, viewId, nodeId, nodeIds, nodeTypes, text, limit },
    });
    track(workspaceDir, projectId);
    switch (resource) {
      case "manifest": {
        return result(output);
      }
      case "full": {
        return result(output, "Loaded graph summaries and layout. Use weaver_read_graph(resource:\"node\") for full Markdown.");
      }
      case "query": {
        return result(output);
      }
      case "node": {
        if (!nodeId) throw new Error("INVALID_ARGS:nodeId required");
        return result(output);
      }
    }
  }));
}
