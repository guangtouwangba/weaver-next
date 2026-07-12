import { DatabaseSync } from "node:sqlite";
import { changeSetSchema, nodeContentSchema, type ChangeSet } from "@weaver/contracts";
import { applyGraphOperations, applyLayoutOperations } from "@weaver/core";
import { json, now, parse, terminalTaskStatuses } from "./store-internal.js";
import { transaction } from "./migrations.js";
import { getProject, patchProject } from "./projects.js";
import { getAgentTask, updateAgentTask } from "./agent-tasks.js";
import { assertContentAssets, defaultNodeFrame, getGraph, replaceGraph } from "./graph.js";
import { getAsset } from "./assets.js";
import { getCanvasContext } from "./chat-canvas-binding.js";
import { getLayout, saveLayout } from "./layout-templates.js";

export function submitChangeSet(db: DatabaseSync, changeSet: ChangeSet) {
  const validated = changeSetSchema.parse(changeSet);
  const project = getProject(db, validated.projectId);
  if (!project) throw new Error("PROJECT_NOT_FOUND");
  const task = getAgentTask(db, validated.taskId);
  if (!task || task.projectId !== validated.projectId) throw new Error("AGENT_TASK_NOT_FOUND_OR_MISMATCH");
  if (task.status !== "running") throw new Error(terminalTaskStatuses.has(task.status) ? `TASK_TERMINAL:${task.status}` : `TASK_NOT_RUNNING:${task.status}`);
  if (project.graphRevision !== validated.baseGraphRevision) {
    updateAgentTask(db, task.taskId, { status: "stale", error: { code: "GRAPH_REVISION_CONFLICT", message: `Expected graph r${validated.baseGraphRevision}, current r${project.graphRevision}` } });
    throw new Error("GRAPH_REVISION_CONFLICT");
  }
  transaction(db, () => {
    db.prepare("INSERT INTO changeset(id, project_id, task_id, data) VALUES (?, ?, ?, ?)").run(validated.id, validated.projectId, validated.taskId, json(validated));
    updateAgentTask(db, validated.taskId, { status: "pending_review", results: { ...task.results, changeSetId: validated.id } });
  });
  return validated;
}

export function listChangeSets(db: DatabaseSync, projectId: string, status?: ChangeSet["status"]) {
  return db.prepare("SELECT data FROM changeset WHERE project_id = ? ORDER BY rowid DESC").all(projectId)
    .map((row: any) => changeSetSchema.parse(parse(row.data)))
    .filter((item) => !status || item.status === status);
}

export function getChangeSet(db: DatabaseSync, changeSetId: string) {
  const row = db.prepare("SELECT data FROM changeset WHERE id = ?").get(changeSetId) as any;
  return row ? changeSetSchema.parse(parse(row.data)) : null;
}

export function rejectChangeSet(db: DatabaseSync, changeSetId: string) {
  const current = getChangeSet(db, changeSetId);
  if (!current) throw new Error("CHANGESET_NOT_FOUND");
  if (current.status !== "pending") throw new Error(`CHANGESET_NOT_PENDING:${current.status}`);
  const rejected = { ...current, status: "rejected" as const, updatedAt: now() };
  transaction(db, () => {
    db.prepare("UPDATE changeset SET data = ? WHERE id = ?").run(json(rejected), changeSetId);
    updateAgentTask(db, current.taskId, { status: "completed" });
  });
  return rejected;
}

export function applyChangeSet(db: DatabaseSync, changeSetId: string) {
  const row = db.prepare("SELECT data FROM changeset WHERE id = ?").get(changeSetId) as any;
  if (!row) throw new Error("CHANGESET_NOT_FOUND");
  const changeSet = changeSetSchema.parse(parse(row.data));
  if (changeSet.status !== "pending") throw new Error(`CHANGESET_NOT_PENDING:${changeSet.status}`);
  const task = getAgentTask(db, changeSet.taskId);
  if (!task) throw new Error("AGENT_TASK_NOT_FOUND");
  const graph = getGraph(db, changeSet.projectId);
  if (graph.revision !== changeSet.baseGraphRevision) {
    updateAgentTask(db, changeSet.taskId, { status: "stale", error: { code: "GRAPH_REVISION_CONFLICT", message: `Expected graph r${changeSet.baseGraphRevision}, current r${graph.revision}` } });
    throw new Error("GRAPH_REVISION_CONFLICT");
  }
  for (const operation of changeSet.graphOperations) {
    if (operation.type === "add-node") assertContentAssets(db, changeSet.projectId, operation.node.content);
    if (operation.type === "set-node-content") assertContentAssets(db, changeSet.projectId, operation.content);
    if (operation.type === "attach-asset" || operation.type === "set-node-cover") {
      const assetId = operation.assetId;
      if (!assetId) continue;
      const asset = getAsset(db, assetId);
      if (!asset || asset.projectId !== changeSet.projectId) throw new Error(`ASSET_NOT_FOUND_OR_CROSS_PROJECT:${assetId}`);
    }
    if (operation.type === "update-node" && operation.patch.content) assertContentAssets(db, changeSet.projectId, nodeContentSchema.parse(operation.patch.content));
  }
  const nextGraph = changeSet.graphOperations.length ? applyGraphOperations(graph, changeSet.graphOperations) : graph;
  const byView = new Map<string, typeof changeSet.layoutOperations>();
  for (const operation of changeSet.layoutOperations) byView.set(operation.viewId, [...(byView.get(operation.viewId) ?? []), operation]);
  const addedNodes = nextGraph.nodes.filter((node) => !graph.nodes.some((current) => current.id === node.id));
  const context = getCanvasContext(db, task.canvasSessionId);
  if (addedNodes.length && context) {
    const activeLayout = getLayout(db, changeSet.projectId, context.viewId);
    if (!activeLayout) throw new Error(`LAYOUT_NOT_FOUND:${context.viewId}`);
    const existing = Object.values(activeLayout.nodes);
    const startX = existing.length ? Math.max(...existing.map((frame) => frame.x + frame.width)) + 72 : 0;
    const startY = existing.length ? Math.min(...existing.map((frame) => frame.y)) : 0;
    const placement = addedNodes.map((node, index) => ({
      type: "set-node-frame" as const, viewId: context.viewId, nodeId: node.id,
      frame: defaultNodeFrame(db, node, startX + (index % 3) * 300, startY + Math.floor(index / 3) * 190),
    }));
    byView.set(context.viewId, [...(byView.get(context.viewId) ?? []), ...placement]);
  }
  for (const [viewId] of byView) {
    const layout = getLayout(db, changeSet.projectId, viewId);
    if (!layout) throw new Error(`LAYOUT_NOT_FOUND:${viewId}`);
    const expected = changeSet.baseLayoutRevisions[viewId] ?? (context?.viewId === viewId ? task.baseLayoutRevision : undefined);
    if (expected === undefined || layout.layoutRevision !== expected) {
      updateAgentTask(db, changeSet.taskId, { status: "stale", error: { code: "LAYOUT_REVISION_CONFLICT", message: `Layout ${viewId} changed during review` } });
      throw new Error("LAYOUT_REVISION_CONFLICT");
    }
  }
  const starterProject = getProject(db, changeSet.projectId)!;
  const starterIds = new Set(starterProject.starterNodeIds);
  let finalGraph = nextGraph;
  if (addedNodes.length && starterIds.size) {
    // First real content: retire template placeholders the user never touched.
    const touched = new Set(changeSet.graphOperations.flatMap((operation) => "nodeId" in operation ? [operation.nodeId as string] : []));
    const timestamp = now();
    const pristine = (node: (typeof nextGraph.nodes)[number]) =>
      starterIds.has(node.id) && !touched.has(node.id) && !node.archived &&
      node.content.kind === "document" && node.content.markdown === "";
    const retiredIds = new Set(nextGraph.nodes.filter(pristine).map((node) => node.id));
    if (retiredIds.size) finalGraph = {
      ...nextGraph,
      nodes: nextGraph.nodes.map((node) => retiredIds.has(node.id) ? { ...node, archived: true, updatedAt: timestamp } : node),
      edges: nextGraph.edges.map((edge) => retiredIds.has(edge.sourceNodeId) || retiredIds.has(edge.targetNodeId) ? { ...edge, archived: true, updatedAt: timestamp } : edge),
    };
  }
  const applied = { ...changeSet, status: "applied" as const, updatedAt: now() };
  const layoutRevisions: Record<string, number> = {};
  transaction(db, () => {
    if (changeSet.graphOperations.length) replaceGraph(db, finalGraph, { taskId: task.taskId, canvasSessionId: task.canvasSessionId });
    if (addedNodes.length && starterIds.size) patchProject(db, changeSet.projectId, { starterNodeIds: [] });
    for (const [viewId, operations] of byView) {
      const layout = structuredClone(getLayout(db, changeSet.projectId, viewId)!);
      for (const operation of operations) {
        if (operation.type !== "set-node-frame" || layout.nodes[operation.nodeId]) continue;
        if (!addedNodes.some((node) => node.id === operation.nodeId)) throw new Error(`LAYOUT_NODE_NOT_FOUND:${operation.nodeId}`);
        layout.nodes[operation.nodeId] = { nodeId: operation.nodeId, ...operation.frame, rotation: 0, zIndex: 0, pinned: false, hidden: false, collapsed: false };
      }
      const nextLayout = applyLayoutOperations(layout, operations);
      nextLayout.graphRevision = finalGraph.revision;
      saveLayout(db, nextLayout, true, { taskId: task.taskId, canvasSessionId: task.canvasSessionId, operations });
      layoutRevisions[viewId] = nextLayout.layoutRevision;
    }
    db.prepare("UPDATE changeset SET data = ? WHERE id = ?").run(json(applied), changeSetId);
    const mixed = task.intent === "develop_then_layout";
    updateAgentTask(db, changeSet.taskId, {
      status: mixed ? "ready_to_continue" : "completed",
      activeStage: mixed ? "layout" : task.activeStage,
      expectedGraphRevision: finalGraph.revision,
      results: { ...task.results, changeSetId },
    });
  });
  return { ...applied, graphRevision: finalGraph.revision, layoutRevisions, task: getAgentTask(db, changeSet.taskId) };
}
