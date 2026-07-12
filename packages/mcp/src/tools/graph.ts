import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { projectSchema } from "../shared/schemas.js";
import { readNodeContent, readProjectGraph } from "../shared/graph-reads.js";
import { track } from "../shared/workspace-registry.js";
import { defineTool, result, withStore } from "../shared/tool-runtime.js";

/**
 * Widget-only graph reads. `weaver_get_project_graph` and `weaver_get_node_content`
 * stay REGISTERED under their exact names because the preview widget calls them,
 * but each declares `_meta.ui.visibility=["app"]` so it is off the model surface —
 * the model reads the graph via the grouped `weaver_read_graph`. Both call the same
 * shared helpers as `weaver_read_graph` (see shared/graph-reads.ts) so they never drift.
 * `weaver_query_graph` was model-only and is now folded into `weaver_read_graph`.
 */
export function registerGraphTools(server: McpServer) {
  server.registerTool("weaver_get_project_graph", {
    title: "Get Project Graph", description: "Read graph content and one independent view layout.", inputSchema: { ...projectSchema.shape, viewId: z.string().optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } },
  }, defineTool(async ({ workspaceDir, projectId, viewId }) => { const output = withStore(workspaceDir, (store) => readProjectGraph(store, projectId, viewId)); track(workspaceDir, projectId); return result(output, "Loaded graph summaries and layout. Use weaver_get_node_content for full Markdown."); }));

  server.registerTool("weaver_get_node_content", {
    title: "Get Full Node Content", description: "Read the complete content of one Weaver node. Use this after graph discovery when full Markdown or media references are needed.",
    inputSchema: { ...projectSchema.shape, nodeId: z.string().min(1) }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } },
  }, defineTool(async ({ workspaceDir, projectId, nodeId }) => { const output = withStore(workspaceDir, (store) => readNodeContent(store, projectId, nodeId)); return result(output); }));
}
