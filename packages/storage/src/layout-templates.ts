import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { edgeSchema, layoutDocumentSchema, nodeSchema, type LayoutCandidate, type LayoutDocument, type ScenePack, type SpaceProject, type VisualTemplate } from "@weaver/contracts";
import type { GraphSnapshot } from "@weaver/core";
import { defaultLayout, json, now, parse } from "./store-internal.js";
import { transaction } from "./migrations.js";
import { appendProjectEvent } from "./project-events.js";
import { createProject, getProject, writeProjectSnapshots } from "./projects.js";
import { defaultNodeFrame, getGraph, replaceGraph } from "./graph.js";
import { catalogViewFromLayout, getProjectView } from "./view-catalog.js";
import { getChatCanvasBinding, openChatCanvasBinding, switchChatCanvasBinding } from "./chat-canvas-binding.js";
import { getAgentTask, updateAgentTask } from "./agent-tasks.js";

export function getLayout(db: DatabaseSync, projectId: string, viewId: string) {
  const row = db.prepare("SELECT data FROM layout WHERE project_id = ? AND view_id = ?").get(projectId, viewId) as any;
  if (!row) return null;
  const raw = parse<any>(row.data); if (!raw.viewName) raw.viewName = raw.viewType;
  return layoutDocumentSchema.parse(raw);
}

export function listLayouts(db: DatabaseSync, projectId: string) {
  return db.prepare("SELECT data FROM layout WHERE project_id = ? ORDER BY view_id").all(projectId)
    .map((row: any) => { const raw = parse<any>(row.data); if (!raw.viewName) raw.viewName = raw.viewType; return layoutDocumentSchema.parse(raw); });
}

export function ensureView(db: DatabaseSync, input: { projectId: string; viewId: string; viewType: LayoutDocument["viewType"]; strategy: LayoutDocument["strategy"]; viewName?: string }) {
  const existing = getLayout(db, input.projectId, input.viewId);
  if (existing) {
    if (!getProjectView(db, input.projectId, input.viewId)) transaction(db, () => catalogViewFromLayout(db, existing));
    return existing;
  }
  const project = getProject(db, input.projectId);
  if (!project) throw new Error(`PROJECT_NOT_FOUND:${input.projectId}`);
  const graph = getGraph(db, input.projectId);
  const document = defaultLayout(project, input.viewId, input.viewType, input.strategy, input.viewName);
  document.graphRevision = graph.revision;
  graph.nodes.filter((node) => !node.archived).forEach((node, index) => {
    document.nodes[node.id] = {
      nodeId: node.id,
      x: (index % 4) * 292,
      y: Math.floor(index / 4) * 176,
      width: 220,
      height: 112,
      rotation: 0,
      zIndex: 0,
      pinned: false,
      hidden: false,
      collapsed: false,
    };
  });
  document.bounds = {
    x: 0,
    y: 0,
    width: graph.nodes.length ? Math.min(4, graph.nodes.length) * 292 - 72 : 0,
    height: graph.nodes.length ? Math.ceil(graph.nodes.length / 4) * 176 - 64 : 0,
  };
  transaction(db, () => { saveLayout(db, document, false); catalogViewFromLayout(db, document); });
  return document;
}

export function uniqueViewName(db: DatabaseSync, projectId: string, requested: string) {
  const names = new Set(listLayouts(db, projectId).map((layout) => layout.viewName));
  if (!names.has(requested)) return requested;
  let index = 2;
  while (names.has(`${requested} ${index}`)) index += 1;
  return `${requested} ${index}`;
}

export function templateLayout(db: DatabaseSync, input: { project: SpaceProject; template: VisualTemplate; viewId: string; viewName: string; graph: GraphSnapshot; layoutRevision: number }) {
  const { project, template, graph } = input;
  const document = defaultLayout(project, input.viewId, template.renderer, template.layoutPreset.strategy, input.viewName);
  document.graphRevision = graph.revision; document.layoutRevision = input.layoutRevision; document.templateRef = { id: template.id, version: template.version };
  document.projection = template.projection; document.theme = template.theme;
  document.config = { ...document.config, ...template.layoutPreset.config, direction: template.layoutPreset.direction ?? document.config.direction };
  const nodes = graph.nodes.filter((node) => !node.archived);
  const projection = template.projection;
  const statusValues = projection.kind === "board" ? projection.columnOrder : [];
  nodes.forEach((node, index) => {
    let x = (index % 4) * 300; let y = Math.floor(index / 4) * 180;
    if (projection.kind === "tree" || projection.kind === "flow") { x = (index % 4) * 310; y = Math.floor(index / 4) * 190; }
    if (projection.kind === "timeline") { const ordered = [...nodes].sort((a, b) => String(a.properties[projection.timeField] ?? "").localeCompare(String(b.properties[projection.timeField] ?? ""))); const order = ordered.findIndex((candidate) => candidate.id === node.id); x = order * 290; y = projection.groupField ? [...new Set(nodes.map((item) => String(item.properties[projection.groupField!] ?? "未分组")))].indexOf(String(node.properties[projection.groupField] ?? "未分组")) * 190 : 0; }
    if (projection.kind === "board") { const column = Math.max(0, statusValues.indexOf(String(node.properties[projection.columnField] ?? statusValues[0] ?? "未分组"))); const laneValues = projection.laneField ? [...new Set(nodes.map((item) => String(item.properties[projection.laneField!] ?? "未分组")))] : [""]; const lane = projection.laneField ? laneValues.indexOf(String(node.properties[projection.laneField] ?? "未分组")) : Math.floor(index / Math.max(statusValues.length, 1)); x = column * 320; y = lane * 210 + nodes.slice(0, index).filter((item) => String(item.properties[projection.columnField] ?? statusValues[0]) === String(node.properties[projection.columnField] ?? statusValues[0])).length * 140; }
    if (projection.kind === "matrix") { const rawX = Number(node.properties[projection.xField] ?? 50); const rawY = Number(node.properties[projection.yField] ?? 50); x = Math.max(0, Math.min(100, rawX)) * 8; y = (100 - Math.max(0, Math.min(100, rawY))) * 6; }
    if (projection.kind === "table") { x = 0; y = index * 132; }
    if (template.layoutPreset.strategy === "radial" && index > 0) { const angle = (index - 1) * Math.PI * 2 / Math.max(nodes.length - 1, 1); x = Math.cos(angle) * Math.max(280, nodes.length * 42); y = Math.sin(angle) * Math.max(240, nodes.length * 36); }
    document.nodes[node.id] = { ...defaultNodeFrame(db, node, x, y), rank: projection.kind === "tree" || projection.kind === "flow" ? Math.floor(index / 4) : undefined };
  });
  if (projection.kind === "board") {
    const columns = projection.columnOrder.length ? projection.columnOrder : [...new Set(nodes.map((node) => String(node.properties[projection.columnField] ?? "未分组")))];
    columns.forEach((label, index) => { document.groups[`column:${label}`] = { groupId: `column:${label}`, x: index * 320 - 24, y: -58, width: 292, height: Math.max(520, document.bounds.height + 120), direction: "vertical", padding: 24, collapsed: false }; });
  }
  if (projection.kind === "matrix") {
    projection.quadrantLabels.forEach((label, index) => { document.groups[`quadrant:${label}`] = { groupId: `quadrant:${label}`, x: index % 2 * 440 - 22, y: Math.floor(index / 2) * 330 - 42, width: 420, height: 310, padding: 22, collapsed: false }; });
  }
  for (const edge of graph.edges.filter((edge) => !edge.archived)) document.edges[edge.id] = { edgeId: edge.id, routing: template.theme.edgeStyles.default?.routing ?? "bezier", waypoints: [], hidden: false };
  const frames = Object.values(document.nodes);
  if (frames.length) { const minX = Math.min(...frames.map((item) => item.x)); const minY = Math.min(...frames.map((item) => item.y)); const maxX = Math.max(...frames.map((item) => item.x + item.width)); const maxY = Math.max(...frames.map((item) => item.y + item.height)); document.bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY }; }
  return layoutDocumentSchema.parse(document);
}

export function previewVisualTemplate(db: DatabaseSync, input: { projectId: string; template: VisualTemplate; baseGraphRevision: number; viewName?: string }) {
  const project = getProject(db, input.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND");
  const graph = getGraph(db, project.id); if (graph.revision !== input.baseGraphRevision) throw new Error("GRAPH_REVISION_CONFLICT");
  return templateLayout(db, { project, graph, template: input.template, viewId: `preview-${input.template.id}`, viewName: input.viewName ?? input.template.name, layoutRevision: 0 });
}

export function createViewFromVisualTemplate(db: DatabaseSync, input: { projectId: string; template: VisualTemplate; baseGraphRevision: number; viewName?: string; chatBinding?: { chatSessionKey: string; leaseId: string; bindingRevision: number } }) {
  const project = getProject(db, input.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND");
  const graph = getGraph(db, project.id); if (graph.revision !== input.baseGraphRevision) throw new Error("GRAPH_REVISION_CONFLICT");
  const viewName = uniqueViewName(db, project.id, input.viewName ?? input.template.name); const viewId = `${input.template.renderer}-${randomUUID().slice(0, 8)}`;
  const document = templateLayout(db, { project, graph, template: input.template, viewId, viewName, layoutRevision: 1 });
  transaction(db, () => {
    saveLayout(db, document, false);
    catalogViewFromLayout(db, document, "template");
    appendProjectEvent(db, { projectId: project.id, kind: "view.created", viewId, layoutRevision: 1, graphRevision: graph.revision, payload: { viewId, viewName, viewType: document.viewType, layoutRevision: 1, templateRef: document.templateRef } });
    if (input.chatBinding) switchChatCanvasBinding(db, { ...input.chatBinding, projectId: project.id, viewId });
  });
  return document;
}

export function createProjectFromVisualTemplate(db: DatabaseSync, dataDir: string, input: { title: string; goal: string; scenePack: ScenePack; template: VisualTemplate; automationLevel?: SpaceProject["automationLevel"]; chatBinding?: { chatSessionKey: string; leaseId?: string; bindingRevision?: number } }) {
  const binding = input.template.sceneBindings[input.scenePack.id]; if (!input.template.compatibleScenePackIds.includes(input.scenePack.id) || !binding) throw new Error("VISUAL_TEMPLATE_SCENE_INCOMPATIBLE");
  let project!: SpaceProject;
  transaction(db, () => {
    project = createProject(db, dataDir, { title: input.title, goal: input.goal, scenePack: input.scenePack, automationLevel: input.automationLevel, createdFromTemplate: { id: input.template.id, version: input.template.version }, writeSnapshots: false });
    const timestamp = now(); const ids = new Map(input.template.starterBlueprint.nodes.map((node) => [node.key, randomUUID()]));
    const nodes = input.template.starterBlueprint.nodes.map((item) => nodeSchema.parse({ id: ids.get(item.key), projectId: project.id, type: binding.nodeRoles[item.role] ?? input.scenePack.nodeTypes[0].key, title: item.title, body: "", contentKind: item.contentKind, content: { kind: "document", mode: "note", markdown: "", excerpt: "", embeddedAssetIds: [] }, properties: item.properties, archived: false, createdAt: timestamp, updatedAt: timestamp }));
    const edges = input.template.starterBlueprint.edges.map((item) => edgeSchema.parse({ id: randomUUID(), projectId: project.id, type: binding.edgeRoles[item.role] ?? input.scenePack.edgeTypes[0]?.key ?? "relation", sourceNodeId: ids.get(item.sourceKey), targetNodeId: ids.get(item.targetKey), directed: true, properties: {}, archived: false, createdAt: timestamp, updatedAt: timestamp }));
    replaceGraph(db, { projectId: project.id, revision: 1, nodes, edges });
    project = getProject(db, project.id)!;
    const layout = templateLayout(db, { project, graph: getGraph(db, project.id), template: input.template, viewId: project.defaultViewId, viewName: input.template.name, layoutRevision: 1 });
    saveLayout(db, layout, false);
    catalogViewFromLayout(db, layout, "template");
    if (input.chatBinding) {
      if (input.chatBinding.leaseId && input.chatBinding.bindingRevision) switchChatCanvasBinding(db, { chatSessionKey: input.chatBinding.chatSessionKey, leaseId: input.chatBinding.leaseId, bindingRevision: input.chatBinding.bindingRevision, projectId: project.id, viewId: project.defaultViewId });
      else openChatCanvasBinding(db, { chatSessionKey: input.chatBinding.chatSessionKey, projectId: project.id, viewId: project.defaultViewId });
    }
  });
  project = getProject(db, project.id)!;
  writeProjectSnapshots(dataDir, project, input.scenePack);
  return { project, graph: getGraph(db, project.id), layout: getLayout(db, project.id, project.defaultViewId)!, binding: input.chatBinding ? getChatCanvasBinding(db, input.chatBinding.chatSessionKey) : undefined };
}

export function saveLayout(db: DatabaseSync, document: LayoutDocument, archive = true, eventContext: { taskId?: string; canvasSessionId?: string; operations?: unknown[] } = {}) {
  const validated = layoutDocumentSchema.parse(document);
  const current = getLayout(db, document.projectId, document.viewId);
  transaction(db, () => {
    if (archive) {
    if (current) db.prepare("INSERT OR IGNORE INTO layout_history(project_id, view_id, revision, data) VALUES (?, ?, ?, ?)").run(current.projectId, current.viewId, current.layoutRevision, json(current));
    }
    db.prepare("INSERT INTO layout(project_id, view_id, revision, data) VALUES (?, ?, ?, ?) ON CONFLICT(project_id, view_id) DO UPDATE SET revision=excluded.revision, data=excluded.data").run(validated.projectId, validated.viewId, validated.layoutRevision, json(validated));
    if (!current || current.layoutRevision !== validated.layoutRevision) appendProjectEvent(db, {
      projectId: validated.projectId, taskId: eventContext.taskId, canvasSessionId: eventContext.canvasSessionId,
      kind: "layout.changed", viewId: validated.viewId, layoutRevision: validated.layoutRevision,
      payload: { viewId: validated.viewId, fromRevision: current?.layoutRevision ?? 0, toRevision: validated.layoutRevision, operations: eventContext.operations ?? [], document: eventContext.operations?.length ? undefined : validated },
    });
  });
  return validated;
}

export function saveLayoutRun(db: DatabaseSync, input: { id?: string; projectId: string; viewId: string; taskId?: string; plan: unknown; candidates: LayoutCandidate[] }) {
  const id = input.id ?? randomUUID();
  const { id: _requestedId, ...runInput } = input;
  const data = { id, ...runInput, status: "preview", createdAt: now() };
  db.prepare("INSERT INTO layout_run(id, project_id, view_id, data) VALUES (?, ?, ?, ?)").run(id, input.projectId, input.viewId, json(data));
  return data;
}

export function getLayoutRun(db: DatabaseSync, id: string) {
  const row = db.prepare("SELECT data FROM layout_run WHERE id = ?").get(id) as any;
  return row ? parse<any>(row.data) : null;
}

export function applyLayoutCandidate(db: DatabaseSync, runId: string, candidateId: string) {
  const run = getLayoutRun(db, runId);
  if (!run) throw new Error(`LAYOUT_RUN_NOT_FOUND:${runId}`);
  const candidate = run.candidates.find((item: LayoutCandidate) => item.id === candidateId);
  if (!candidate) throw new Error(`LAYOUT_CANDIDATE_NOT_FOUND:${candidateId}`);
  if (candidate.metrics.hardViolations.length) throw new Error(`LAYOUT_HARD_VIOLATION:${candidate.metrics.hardViolations.join(",")}`);
  const current = getLayout(db, run.projectId, run.viewId);
  if (!current) throw new Error("LAYOUT_NOT_FOUND");
  if (current.layoutRevision !== run.plan.baseLayoutRevision) {
    if (run.taskId) updateAgentTask(db, run.taskId, { status: "stale", error: { code: "LAYOUT_REVISION_CONFLICT", message: `Expected layout r${run.plan.baseLayoutRevision}, current r${current.layoutRevision}` } });
    throw new Error("LAYOUT_REVISION_CONFLICT");
  }
  const next = { ...candidate.document, layoutRevision: current.layoutRevision + 1, graphRevision: getProject(db, run.projectId)?.graphRevision ?? candidate.document.graphRevision, updatedAt: now() };
  const task = run.taskId ? getAgentTask(db, run.taskId) : null;
  transaction(db, () => {
    saveLayout(db, next, true, { taskId: run.taskId, canvasSessionId: task?.canvasSessionId, operations: candidate.operations });
    run.status = "applied"; run.appliedCandidateId = candidateId; run.updatedAt = now();
    db.prepare("UPDATE layout_run SET data = ? WHERE id = ?").run(json(run), runId);
    if (run.taskId && task) updateAgentTask(db, run.taskId, { status: "completed", results: { ...task.results, layoutRunId: runId } });
  });
  return next;
}

export function rejectLayoutRun(db: DatabaseSync, runId: string) {
  const run = getLayoutRun(db, runId);
  if (!run) throw new Error(`LAYOUT_RUN_NOT_FOUND:${runId}`);
  if (run.status !== "preview") throw new Error(`LAYOUT_RUN_NOT_PENDING:${run.status}`);
  const task = run.taskId ? getAgentTask(db, run.taskId) : null;
  transaction(db, () => {
    run.status = "rejected"; run.updatedAt = now();
    db.prepare("UPDATE layout_run SET data = ? WHERE id = ?").run(json(run), runId);
    if (task) updateAgentTask(db, task.taskId, { status: "completed", results: { ...task.results, layoutRunId: runId } });
  });
  return run;
}

export function revertLayout(db: DatabaseSync, projectId: string, viewId: string) {
  const current = getLayout(db, projectId, viewId);
  if (!current) throw new Error("LAYOUT_NOT_FOUND");
  const row = db.prepare("SELECT data FROM layout_history WHERE project_id = ? AND view_id = ? ORDER BY revision DESC LIMIT 1").get(projectId, viewId) as any;
  if (!row) throw new Error("LAYOUT_HISTORY_EMPTY");
  const previous = layoutDocumentSchema.parse(parse(row.data));
  const restored = { ...previous, layoutRevision: current.layoutRevision + 1, updatedAt: now() };
  saveLayout(db, restored);
  return restored;
}
