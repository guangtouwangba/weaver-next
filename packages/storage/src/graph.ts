import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { nodeContentSchema, nodeSchema, type NodeContent, type SpaceEdge, type SpaceNode } from "@weaver/contracts";
import { applyGraphOperations, type GraphSnapshot } from "@weaver/core";
import { json, now, parse } from "./store-internal.js";
import { transaction } from "./migrations.js";
import { appendProjectEvent } from "./project-events.js";
import { getProject } from "./projects.js";
import { getAsset } from "./assets.js";
import { getLayout, saveLayout } from "./layout-templates.js";

export function getGraph(db: DatabaseSync, projectId: string): GraphSnapshot {
  const project = getProject(db, projectId);
  if (!project) throw new Error(`PROJECT_NOT_FOUND:${projectId}`);
  const nodes = db.prepare("SELECT data FROM node WHERE project_id = ?").all(projectId).map((row: any) => nodeSchema.parse(parse(row.data)));
  const edges = db.prepare("SELECT data FROM edge WHERE project_id = ?").all(projectId).map((row: any) => parse<SpaceEdge>(row.data));
  return { projectId, revision: project.graphRevision, nodes, edges };
}

export function graphDelta(db: DatabaseSync, previous: GraphSnapshot, next: GraphSnapshot) {
  const beforeNodes = new Map(previous.nodes.map((node) => [node.id, node]));
  const beforeEdges = new Map(previous.edges.map((edge) => [edge.id, edge]));
  const summarize = (node: SpaceNode) => {
    const assetIds = node.content.kind === "image" ? [node.content.assetId]
      : node.content.kind === "document" ? [node.content.coverAssetId, ...node.content.embeddedAssetIds].filter(Boolean) as string[]
        : node.content.kind === "link" ? [node.content.imageAssetId].filter(Boolean) as string[]
          : [];
    return {
      ...node,
      content: node.content.kind === "document" ? { ...node.content, markdown: "" } : node.content,
      assets: assetIds.map((id) => getAsset(db, id)).filter(Boolean),
    };
  };
  return {
    fromRevision: previous.revision,
    toRevision: next.revision,
    addedNodes: next.nodes.filter((node) => !beforeNodes.has(node.id)).map(summarize),
    updatedNodes: next.nodes.filter((node) => beforeNodes.has(node.id) && json(beforeNodes.get(node.id)) !== json(node)).map(summarize),
    archivedNodeIds: next.nodes.filter((node) => node.archived && !beforeNodes.get(node.id)?.archived).map((node) => node.id),
    addedEdges: next.edges.filter((edge) => !beforeEdges.has(edge.id)),
    updatedEdges: next.edges.filter((edge) => beforeEdges.has(edge.id) && json(beforeEdges.get(edge.id)) !== json(edge)),
    archivedEdgeIds: next.edges.filter((edge) => edge.archived && !beforeEdges.get(edge.id)?.archived).map((edge) => edge.id),
  };
}

export function replaceGraph(db: DatabaseSync, snapshot: GraphSnapshot, eventContext: { taskId?: string; canvasSessionId?: string } = {}) {
  const project = getProject(db, snapshot.projectId);
  if (!project) throw new Error(`PROJECT_NOT_FOUND:${snapshot.projectId}`);
  const previous = getGraph(db, snapshot.projectId);
  transaction(db, () => {
    db.prepare("DELETE FROM node WHERE project_id = ?").run(snapshot.projectId);
    db.prepare("DELETE FROM edge WHERE project_id = ?").run(snapshot.projectId);
    const nodeInsert = db.prepare("INSERT INTO node(id, project_id, data) VALUES (?, ?, ?)");
    const edgeInsert = db.prepare("INSERT INTO edge(id, project_id, data) VALUES (?, ?, ?)");
    for (const node of snapshot.nodes) {
      const validated = nodeSchema.parse(node);
      nodeInsert.run(validated.id, snapshot.projectId, json(validated));
    }
    for (const edge of snapshot.edges) edgeInsert.run(edge.id, snapshot.projectId, json(edge));
    const nextProject = { ...project, graphRevision: snapshot.revision, updatedAt: now() };
    db.prepare("UPDATE project SET data = ? WHERE id = ?").run(json(nextProject), snapshot.projectId);
    if (snapshot.revision !== previous.revision) appendProjectEvent(db, {
      projectId: snapshot.projectId, taskId: eventContext.taskId, canvasSessionId: eventContext.canvasSessionId,
      kind: "graph.changed", graphRevision: snapshot.revision, payload: graphDelta(db, previous, snapshot),
    });
  });
}

export function createContentNode(db: DatabaseSync, input: { projectId: string; viewId: string; type: string; title: string; content: NodeContent; x: number; y: number }) {
  const graph = getGraph(db, input.projectId);
  const layout = getLayout(db, input.projectId, input.viewId);
  if (!layout) throw new Error(`LAYOUT_NOT_FOUND:${input.viewId}`);
  if (input.content.kind === "image") {
    const asset = getAsset(db, input.content.assetId);
    if (!asset || asset.projectId !== input.projectId) throw new Error("ASSET_NOT_FOUND_OR_CROSS_PROJECT");
  }
  const timestamp = now();
  const node = nodeSchema.parse({ id: randomUUID(), projectId: input.projectId, type: input.type, title: input.title, contentKind: input.content.kind, content: nodeContentSchema.parse(input.content), properties: {}, archived: false, createdAt: timestamp, updatedAt: timestamp });
  replaceGraph(db, applyGraphOperations(graph, [{ type: "add-node", node }]));
  const frame = defaultNodeFrame(db, node, input.x, input.y);
  const nextLayout = structuredClone(layout);
  nextLayout.nodes[node.id] = frame;
  nextLayout.graphRevision = graph.revision + 1;
  nextLayout.layoutRevision += 1;
  nextLayout.updatedAt = timestamp;
  saveLayout(db, nextLayout);
  return { node, project: getProject(db, input.projectId), layout: nextLayout };
}

export function updateNodeContent(db: DatabaseSync, input: { projectId: string; nodeId: string; baseGraphRevision: number; title?: string; type?: string; content?: NodeContent }) {
  const graph = getGraph(db, input.projectId);
  if (graph.revision !== input.baseGraphRevision) throw new Error(`GRAPH_REVISION_CONFLICT:Expected ${input.baseGraphRevision}, current ${graph.revision}`);
  const current = graph.nodes.find((node) => node.id === input.nodeId);
  if (!current) throw new Error(`NODE_NOT_FOUND:${input.nodeId}`);
  const operations: Parameters<typeof applyGraphOperations>[1] = [];
  if (input.title !== undefined || input.type !== undefined) operations.push({ type: "update-node", nodeId: input.nodeId, patch: { title: input.title ?? current.title, type: input.type ?? current.type, updatedAt: now() } });
  if (input.content) {
    assertContentAssets(db, input.projectId, input.content);
    operations.push({ type: "set-node-content", nodeId: input.nodeId, content: nodeContentSchema.parse(input.content) });
  }
  if (!operations.length) return { node: current, project: getProject(db, input.projectId) };
  const next = applyGraphOperations(graph, operations);
  replaceGraph(db, next);
  return { node: next.nodes.find((node) => node.id === input.nodeId)!, project: getProject(db, input.projectId) };
}

export function archiveNode(db: DatabaseSync, input: { projectId: string; nodeId: string; baseGraphRevision: number }) {
  const graph = getGraph(db, input.projectId);
  if (graph.revision !== input.baseGraphRevision) throw new Error(`GRAPH_REVISION_CONFLICT:Expected ${input.baseGraphRevision}, current ${graph.revision}`);
  const current = graph.nodes.find((node) => node.id === input.nodeId);
  if (!current) throw new Error(`NODE_NOT_FOUND:${input.nodeId}`);
  // Soft-delete: archive the node and every edge that touches it in one revision.
  const operations: Parameters<typeof applyGraphOperations>[1] = [{ type: "archive-node", nodeId: input.nodeId }];
  for (const edge of graph.edges) {
    if (!edge.archived && (edge.sourceNodeId === input.nodeId || edge.targetNodeId === input.nodeId)) operations.push({ type: "archive-edge", edgeId: edge.id });
  }
  const next = applyGraphOperations(graph, operations);
  replaceGraph(db, next);
  return { node: next.nodes.find((node) => node.id === input.nodeId)!, project: getProject(db, input.projectId) };
}

export function attachAsset(db: DatabaseSync, input: { projectId: string; nodeId: string; assetId: string; role: "embedded" | "cover"; baseGraphRevision: number }) {
  const asset = getAsset(db, input.assetId);
  if (!asset || asset.projectId !== input.projectId) throw new Error("ASSET_NOT_FOUND_OR_CROSS_PROJECT");
  const graph = getGraph(db, input.projectId);
  if (graph.revision !== input.baseGraphRevision) throw new Error("GRAPH_REVISION_CONFLICT");
  const next = applyGraphOperations(graph, [{ type: "attach-asset", nodeId: input.nodeId, assetId: input.assetId, role: input.role }]);
  replaceGraph(db, next);
  return { node: next.nodes.find((node) => node.id === input.nodeId)!, project: getProject(db, input.projectId) };
}

export function assertContentAssets(db: DatabaseSync, projectId: string, content: NodeContent) {
  const ids = content.kind === "image" ? [content.assetId] : content.kind === "document" ? [content.coverAssetId, ...content.embeddedAssetIds].filter(Boolean) as string[] : content.kind === "link" ? [content.imageAssetId].filter(Boolean) as string[] : [];
  for (const id of ids) {
    const asset = getAsset(db, id);
    if (!asset || asset.projectId !== projectId) throw new Error(`ASSET_NOT_FOUND_OR_CROSS_PROJECT:${id}`);
  }
}

export function defaultNodeFrame(db: DatabaseSync, node: SpaceNode, x: number, y: number) {
  let width = 280; let height = 160;
  if (node.content.kind === "document" && node.content.mode === "note") { width = 220; height = 112; }
  if (node.content.kind === "link") { width = 300; height = 180; }
  if (node.content.kind === "chart") { const metric = node.content.chartType === "metric"; width = metric ? 240 : 320; height = metric ? 130 : 220; }
  if (node.content.kind === "image") {
    const asset = getAsset(db, node.content.assetId)!;
    width = Math.max(180, Math.min(360, asset.width));
    height = Math.max(120, Math.min(300, width * asset.height / asset.width));
  }
  return { nodeId: node.id, x, y, width, height, rotation: 0, zIndex: 0, pinned: false, hidden: false, collapsed: false };
}
