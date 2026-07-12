import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readNodeContent, readProjectGraph, readProjectManifest, queryGraph } from "../shared/graph-reads.js";
import { workspaceSchema } from "../shared/schemas.js";
import { track } from "../shared/workspace-registry.js";
import { defineTool, result, withStore } from "../shared/tool-runtime.js";

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
  }, defineTool(async ({ workspaceDir, resource, projectId, viewId, nodeId, nodeIds, nodeTypes, text, limit }) => {
    if (!projectId) throw new Error("GRAPH_RESOURCE_REQUIRES_projectId");
    switch (resource) {
      case "manifest": {
        // weaver_get_project_manifest
        const output = withStore(workspaceDir, (store) => readProjectManifest(store, projectId));
        track(workspaceDir, projectId);
        return result(output);
      }
      case "full": {
        // weaver_get_project_graph
        const output = withStore(workspaceDir, (store) => readProjectGraph(store, projectId, viewId));
        track(workspaceDir, projectId);
        return result(output, "Loaded graph summaries and layout. Use weaver_read_graph(resource:\"node\") for full Markdown.");
      }
      case "query": {
        // weaver_query_graph
        const output = withStore(workspaceDir, (store) => queryGraph(store, projectId, { nodeIds, nodeTypes, text, limit }));
        return result(output);
      }
      case "node": {
        // weaver_get_node_content
        if (!nodeId) throw new Error("GRAPH_RESOURCE_REQUIRES_nodeId");
        const output = withStore(workspaceDir, (store) => readNodeContent(store, projectId, nodeId));
        return result(output);
      }
    }
  }));
}
