import type { SpaceNode } from "@weaver/contracts";
import type { WorkspaceStore } from "@weaver/storage";
import { getScenePack } from "@weaver/scene-packs";

/**
 * Single source of truth for the four graph reads, shared by the kept widget
 * tools (`weaver_get_project_manifest`, `weaver_get_project_graph`,
 * `weaver_get_node_content`) and the model-facing `weaver_read_graph`, so the
 * two surfaces never drift. Each helper reproduces the exact store calls and
 * payload shape of the handler it replaces.
 */

export function summarizeNode(store: WorkspaceStore, node: SpaceNode) {
  const content = node.content.kind === "document" ? { ...node.content, markdown: undefined } : node.content;
  const assetIds = node.content.kind === "image" ? [node.content.assetId]
    : node.content.kind === "document" ? [node.content.coverAssetId, ...node.content.embeddedAssetIds].filter(Boolean) as string[]
      : node.content.kind === "link" ? [node.content.imageAssetId].filter(Boolean) as string[]
        : [];
  return { id: node.id, projectId: node.projectId, type: node.type, title: node.title, contentKind: node.contentKind, content, properties: node.properties, archived: node.archived, createdAt: node.createdAt, updatedAt: node.updatedAt, assets: assetIds.map((id) => store.getAsset(id)).filter(Boolean) };
}

/** weaver_get_project_manifest core. */
export function readProjectManifest(store: WorkspaceStore, projectId: string) {
  const project = store.getProject(projectId); if (!project) throw new Error("PROJECT_NOT_FOUND");
  const scenePack = getScenePack(project.scenePackId, project.scenePackVersion);
  return { project, scenePack, views: store.listProjectViews(projectId, "active").map((view) => ({ ...view, viewId: view.id, viewName: view.name, layoutRevision: store.getLayout(projectId, view.id)?.layoutRevision ?? 0 })) };
}

/** weaver_get_project_graph core. */
export function readProjectGraph(store: WorkspaceStore, projectId: string, viewId?: string) {
  const project = store.getProject(projectId); if (!project) throw new Error("PROJECT_NOT_FOUND");
  const graph = store.getGraph(projectId);
  const layout = store.getLayout(projectId, viewId ?? project.defaultViewId); if (!layout) throw new Error("LAYOUT_NOT_FOUND");
  const nodes = graph.nodes.filter((node) => !node.archived);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => !edge.archived && nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId));
  return { project, nodes: nodes.map((node) => summarizeNode(store, node)), edges, layout };
}

/** weaver_query_graph core. `limit` defaults to 50 to preserve the old tool. */
export function queryGraph(store: WorkspaceStore, projectId: string, filter: { nodeIds?: string[]; nodeTypes?: string[]; text?: string; limit?: number }) {
  const graph = store.getGraph(projectId);
  let nodes = graph.nodes.filter((node) => !node.archived);
  if (filter.nodeIds?.length) nodes = nodes.filter((node) => filter.nodeIds!.includes(node.id));
  if (filter.nodeTypes?.length) nodes = nodes.filter((node) => filter.nodeTypes!.includes(node.type));
  if (filter.text) nodes = nodes.filter((node) => `${node.title}\n${node.body}`.toLowerCase().includes(filter.text!.toLowerCase()));
  nodes = nodes.slice(0, filter.limit ?? 50);
  const ids = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => ids.has(edge.sourceNodeId) || ids.has(edge.targetNodeId));
  return { revision: graph.revision, nodes: nodes.map((node) => summarizeNode(store, node)), edges };
}

/** weaver_get_node_content core. */
export function readNodeContent(store: WorkspaceStore, projectId: string, nodeId: string) {
  const graph = store.getGraph(projectId);
  const node = graph.nodes.find((candidate) => candidate.id === nodeId); if (!node) throw new Error(`NODE_NOT_FOUND:${nodeId}`);
  return { graphRevision: graph.revision, node };
}
