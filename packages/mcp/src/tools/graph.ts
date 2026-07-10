import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SpaceNode } from "@weaver/contracts";
import type { WorkspaceStore } from "@weaver/storage";
import { projectSchema } from "../shared/schemas.js";
import { track } from "../shared/workspace-registry.js";
import { defineTool, result, withStore } from "../shared/tool-runtime.js";

function summarizeNode(store: WorkspaceStore, node: SpaceNode) {
  const content = node.content.kind === "document" ? { ...node.content, markdown: undefined } : node.content;
  const assetIds = node.content.kind === "image" ? [node.content.assetId]
    : node.content.kind === "document" ? [node.content.coverAssetId, ...node.content.embeddedAssetIds].filter(Boolean) as string[]
      : [node.content.imageAssetId].filter(Boolean) as string[];
  return { id: node.id, projectId: node.projectId, type: node.type, title: node.title, contentKind: node.contentKind, content, properties: node.properties, archived: node.archived, createdAt: node.createdAt, updatedAt: node.updatedAt, assets: assetIds.map((id) => store.getAsset(id)).filter(Boolean) };
}

/** Graph read/query: whole-graph summaries with one view layout, filtered queries, and full single-node content. */
export function registerGraphTools(server: McpServer) {
  server.registerTool("weaver_get_project_graph", {
    title: "Get Project Graph", description: "Read graph content and one independent view layout.", inputSchema: { ...projectSchema.shape, viewId: z.string().optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, defineTool(async ({ workspaceDir, projectId, viewId }) => { const output = withStore(workspaceDir, (store) => { const project = store.getProject(projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); const graph = store.getGraph(projectId); const layout = store.getLayout(projectId, viewId ?? project.defaultViewId); if (!layout) throw new Error("LAYOUT_NOT_FOUND"); return { project, nodes: graph.nodes.map((node) => summarizeNode(store, node)), edges: graph.edges, layout }; }); track(workspaceDir, projectId); return result(output, "Loaded graph summaries and layout. Use weaver_get_node_content for full Markdown."); }));

  server.registerTool("weaver_query_graph", {
    title: "Query Project Graph", description: "Filter semantic nodes and edges without loading the whole graph into model context.",
    inputSchema: { ...projectSchema.shape, nodeIds: z.array(z.string()).optional(), nodeTypes: z.array(z.string()).optional(), text: z.string().optional(), limit: z.number().int().min(1).max(200).default(50) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, defineTool(async ({ workspaceDir, projectId, nodeIds, nodeTypes, text, limit }) => { const output = withStore(workspaceDir, (store) => { const graph = store.getGraph(projectId); let nodes = graph.nodes.filter((node) => !node.archived); if (nodeIds?.length) nodes = nodes.filter((node) => nodeIds.includes(node.id)); if (nodeTypes?.length) nodes = nodes.filter((node) => nodeTypes.includes(node.type)); if (text) nodes = nodes.filter((node) => `${node.title}\n${node.body}`.toLowerCase().includes(text.toLowerCase())); nodes = nodes.slice(0, limit); const ids = new Set(nodes.map((node) => node.id)); const edges = graph.edges.filter((edge) => ids.has(edge.sourceNodeId) || ids.has(edge.targetNodeId)); return { revision: graph.revision, nodes: nodes.map((node) => summarizeNode(store, node)), edges }; }); return result(output); }));

  server.registerTool("weaver_get_node_content", {
    title: "Get Full Node Content", description: "Read the complete content of one Weaver node. Use this after graph discovery when full Markdown or media references are needed.",
    inputSchema: { ...projectSchema.shape, nodeId: z.string().min(1) }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, defineTool(async ({ workspaceDir, projectId, nodeId }) => { const output = withStore(workspaceDir, (store) => { const graph = store.getGraph(projectId); const node = graph.nodes.find((candidate) => candidate.id === nodeId); if (!node) throw new Error(`NODE_NOT_FOUND:${nodeId}`); return { graphRevision: graph.revision, node }; }); return result(output); }));
}
