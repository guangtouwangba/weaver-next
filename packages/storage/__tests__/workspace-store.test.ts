import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { getScenePack } from "@weaver/scene-packs";
import { getVisualTemplate } from "@weaver/visual-templates";
import { WorkspaceStore } from "../src/workspace-store.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function store() {
  const root = mkdtempSync(join(tmpdir(), "weaver-store-")); roots.push(root); mkdirSync(root, { recursive: true });
  return new WorkspaceStore(root);
}

function dispatchAndStart(db: WorkspaceStore, task: ReturnType<WorkspaceStore["prepareAgentTask"]>) {
  const dispatchKey = task.dispatches.at(-1)!.dispatchKey;
  db.tasks.confirmDispatch(task.taskId, dispatchKey);
  return db.tasks.update(task.taskId, { status: "running" });
}

function bindCanvas(db: WorkspaceStore, project: { id: string; defaultViewId: string; graphRevision: number }, scene: NonNullable<ReturnType<typeof getScenePack>>, canvasSessionId: string, options: { selectedNodeIds?: string[]; focused?: boolean; lastSeenAt?: string } = {}) {
  const chatSessionKey = createHash("sha256").update(`test-chat:${canvasSessionId}`).digest("hex");
  const binding = db.sessions.openBinding({ chatSessionKey, projectId: project.id, viewId: project.defaultViewId });
  const timestamp = options.lastSeenAt ?? new Date().toISOString();
  db.sessions.syncCanvas({ version: 2, canvasSessionId, workspaceDir: db.workspaceDir, projectId: project.id, scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: project.graphRevision, viewId: project.defaultViewId, viewType: scene.defaultView, selectedNodeIds: options.selectedNodeIds ?? [], selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, presence: { visible: true, focused: options.focused ?? true, lastSeenAt: timestamp }, chatBinding: { leaseId: binding.leaseId, bindingRevision: binding.bindingRevision }, agentEligible: true, sequence: 1, updatedAt: timestamp }, chatSessionKey);
  return chatSessionKey;
}

describe("WorkspaceStore", () => {
  it("keeps graph and layout revisions independent", () => {
    const db = store();
    const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "Test", goal: "Map ideas", scenePack: scene });
    const layout = db.layoutReviews.get(project.id, project.defaultViewId)!;
    layout.layoutRevision += 1;
    db.layoutReviews.save(layout);
    expect(db.catalog.getProject(project.id)?.graphRevision).toBe(0);
    expect(db.layoutReviews.get(project.id, project.defaultViewId)?.layoutRevision).toBe(1);
    db.close();
  });

  it("rejects an older canvas sequence", () => {
    const db = store();
    const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "Test", goal: "Map ideas", scenePack: scene });
    const snapshot = { version: 2 as const, canvasSessionId: "s", workspaceDir: db.workspaceDir, projectId: project.id, scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: 0, viewId: project.defaultViewId, viewType: scene.defaultView, selectedNodeIds: [], selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, agentEligible: false, sequence: 2, updatedAt: new Date().toISOString() };
    db.sessions.syncCanvas(snapshot);
    expect(() => db.sessions.syncCanvas({ ...snapshot, sequence: 1 })).toThrow("STALE_CANVAS_SEQUENCE");
    db.close();
  });

  it("atomically advances a stale explicit claim while still rejecting stale state", () => {
    const db = store();
    const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "Claim recovery", goal: "", scenePack: scene });
    const snapshot = { version: 2 as const, canvasSessionId: "recoverable", workspaceDir: db.workspaceDir, projectId: project.id, scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: 0, viewId: project.defaultViewId, viewType: scene.defaultView, selectedNodeIds: [], selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, agentEligible: false, sequence: 7, updatedAt: new Date().toISOString() };
    db.sessions.syncCanvas(snapshot);

    const claimed = db.sessions.syncCanvas({ ...snapshot, syncPurpose: "claim", sequence: 1 });

    expect(claimed.sequence).toBe(8);
    expect(db.sessions.canvasContext("recoverable")?.sequence).toBe(8);
    expect(() => db.sessions.syncCanvas({ ...snapshot, syncPurpose: "state", sequence: 2 })).toThrow("STALE_CANVAS_SEQUENCE");
    db.close();
  });

  it("claims a Canvas session without overwriting its saved viewport", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "Claim", goal: "", scenePack: scene });
    const chatSessionKey = createHash("sha256").update("claim-chat").digest("hex");
    const binding = db.sessions.openBinding({ chatSessionKey, projectId: project.id, viewId: project.defaultViewId });
    db.catalog.saveCanvasState({ canvasSessionId: "claim-session", viewId: project.defaultViewId, viewport: { x: 50, y: 60, zoom: .8 }, selectedNodeIds: ["kept"], lastOpenedAt: new Date().toISOString() });
    const timestamp = new Date().toISOString();
    const base = { version: 2 as const, canvasSessionId: "claim-session", workspaceDir: db.workspaceDir, projectId: project.id, scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: 0, viewId: project.defaultViewId, viewType: scene.defaultView, selectedNodeIds: [], selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], presence: { visible: true, focused: true, lastSeenAt: timestamp }, chatBinding: { leaseId: binding.leaseId, bindingRevision: binding.bindingRevision }, agentEligible: true, updatedAt: timestamp };
    db.sessions.syncCanvas({ ...base, syncPurpose: "claim", viewport: { x: 0, y: 0, zoom: 1 }, sequence: 1 }, chatSessionKey);
    expect(db.catalog.canvasState("claim-session", project.defaultViewId)).toMatchObject({ viewport: { x: 50, y: 60, zoom: .8 }, selectedNodeIds: ["kept"] });
    const later = new Date(Date.parse(timestamp) + 1).toISOString();
    db.sessions.syncCanvas({ ...base, syncPurpose: "state", viewport: { x: 10, y: 20, zoom: .7 }, selectedNodeIds: ["saved"], presence: { visible: true, focused: true, lastSeenAt: later }, updatedAt: later, sequence: 2 }, chatSessionKey);
    expect(db.catalog.canvasState("claim-session", project.defaultViewId)).toMatchObject({ viewport: { x: 10, y: 20, zoom: .7 }, selectedNodeIds: ["saved"] });
    db.close();
  });

  it("stores independent layouts for multiple views", () => {
    const db = store();
    const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "Test", goal: "Map ideas", scenePack: scene });
    const graphView = db.layoutReviews.ensureView({ projectId: project.id, viewId: "graph-default", viewType: "graph", strategy: "force" });
    graphView.layoutRevision = 3;
    db.layoutReviews.save(graphView);
    expect(db.layoutReviews.get(project.id, project.defaultViewId)?.layoutRevision).toBe(0);
    expect(db.layoutReviews.get(project.id, "graph-default")?.layoutRevision).toBe(3);
    expect(db.layoutReviews.list(project.id)).toHaveLength(2);
    db.close();
  });

  it("seeds a connected graph view semantically instead of a flat grid", () => {
    const db = store();
    const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "Robot", goal: "", scenePack: scene });
    const ts = new Date().toISOString();
    const node = (id: string, layer: string) => ({ id, projectId: project.id, type: "idea", title: id, contentKind: "document" as const, content: { kind: "document" as const, mode: "note" as const, markdown: "", excerpt: "", embeddedAssetIds: [] }, properties: { layer }, archived: false, createdAt: ts, updatedAt: ts });
    const edge = (id: string, s: string, t: string) => ({ id, projectId: project.id, type: "relates-to", sourceNodeId: s, targetNodeId: t, directed: true, properties: {}, archived: false, createdAt: ts, updatedAt: ts });
    db.graphChanges.replace({ projectId: project.id, revision: 1, nodes: [node("hub", "总览"), node("a1", "赛道"), node("a2", "赛道"), node("b1", "产业链"), node("b2", "产业链")], edges: [edge("e1", "hub", "a1"), edge("e2", "hub", "a2"), edge("e3", "hub", "b1"), edge("e4", "hub", "b2")] });

    const view = db.layoutReviews.ensureView({ projectId: project.id, viewId: "graph-fresh", viewType: "graph", strategy: "cluster" });
    // Semantic seed: labeled group boxes, not the plain 4-col grid.
    expect(Object.keys(view.groups).length).toBeGreaterThan(0);
    expect(view.nodes.hub.width).toBe(340); // hub enlarged
    const frames = Object.values(view.nodes);
    let overlaps = 0;
    for (let i = 0; i < frames.length; i += 1) for (let j = i + 1; j < frames.length; j += 1) { const a = frames[i]; const b = frames[j]; const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x); const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y); if (w > 0.001 && h > 0.001) overlaps += 1; }
    expect(overlaps).toBe(0);
    db.close();
  });

  it("keeps an edgeless graph view on the flat grid", () => {
    const db = store();
    const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "Sparse", goal: "", scenePack: scene });
    const ts = new Date().toISOString();
    const node = (id: string) => ({ id, projectId: project.id, type: "idea", title: id, contentKind: "document" as const, content: { kind: "document" as const, mode: "note" as const, markdown: "", excerpt: "", embeddedAssetIds: [] }, properties: {}, archived: false, createdAt: ts, updatedAt: ts });
    db.graphChanges.replace({ projectId: project.id, revision: 1, nodes: [node("n1"), node("n2"), node("n3"), node("n4"), node("n5")], edges: [] });

    const view = db.layoutReviews.ensureView({ projectId: project.id, viewId: "graph-grid", viewType: "graph", strategy: "cluster" });
    expect(Object.keys(view.groups)).toHaveLength(0);
    expect(view.nodes.n2).toMatchObject({ x: 292, y: 0 });
    expect(view.nodes.n5).toMatchObject({ x: 0, y: 176 });
    db.close();
  });

  it("stores a chart content node and sizes it as a hero card", () => {
    const db = store();
    const scene = getScenePack("entity-relationship")!;
    const project = db.catalog.createProject({ title: "Invest", goal: "", scenePack: scene });
    const line = db.graphChanges.createNode({ projectId: project.id, viewId: project.defaultViewId, type: "entity", title: "市场规模", content: { kind: "chart", chartType: "line", title: "市场规模", series: [{ name: "规模", points: [{ label: "2020", value: 120 }, { label: "2021", value: 180 }] }], sourceNote: "券商研报", asOf: "2026Q2" } as any, x: 0, y: 0 });
    const stored = db.graphChanges.read(project.id).nodes.find((node) => node.id === line.node.id)!;
    expect(stored.contentKind).toBe("chart");
    expect(stored.content.kind === "chart" && stored.content.chartType).toBe("line");
    expect(db.layoutReviews.get(project.id, project.defaultViewId)!.nodes[line.node.id]).toMatchObject({ width: 320, height: 220 });

    const metric = db.graphChanges.createNode({ projectId: project.id, viewId: project.defaultViewId, type: "entity", title: "增速", content: { kind: "chart", chartType: "metric", title: "增速", metric: { value: 24, unit: "%", delta: 3.1, deltaLabel: "同比" } } as any, x: 400, y: 0 });
    expect(db.layoutReviews.get(project.id, project.defaultViewId)!.nodes[metric.node.id]).toMatchObject({ width: 240, height: 130 });
    db.close();
  });

  it("links two nodes with a typed reference edge and de-duplicates", () => {
    const db = store();
    const scene = getScenePack("entity-relationship")!;
    const project = db.catalog.createProject({ title: "Refs", goal: "", scenePack: scene });
    const doc = () => ({ kind: "document", mode: "note", markdown: "", excerpt: "", embeddedAssetIds: [] } as const);
    const a = db.graphChanges.createNode({ projectId: project.id, viewId: project.defaultViewId, type: "entity", title: "A", content: doc(), x: 0, y: 0 });
    const b = db.graphChanges.createNode({ projectId: project.id, viewId: project.defaultViewId, type: "entity", title: "B", content: doc(), x: 300, y: 0 });
    const base = db.graphChanges.read(project.id).revision;

    const linked = db.graphChanges.linkNodes({ projectId: project.id, sourceNodeId: a.node.id, targetNodeId: b.node.id, type: "reference", baseGraphRevision: base });
    expect(linked.created).toBe(true);
    const afterGraph = db.graphChanges.read(project.id);
    expect(afterGraph.revision).toBe(base + 1);
    expect(afterGraph.edges.filter((edge) => !edge.archived)).toHaveLength(1);
    expect(afterGraph.edges[0]).toMatchObject({ type: "reference", sourceNodeId: a.node.id, targetNodeId: b.node.id });

    // Same ordered pair + type is idempotent: returns the existing edge, no new revision.
    const again = db.graphChanges.linkNodes({ projectId: project.id, sourceNodeId: a.node.id, targetNodeId: b.node.id, type: "reference", baseGraphRevision: afterGraph.revision });
    expect(again.created).toBe(false);
    expect(again.edge.id).toBe(linked.edge.id);
    expect(db.graphChanges.read(project.id).edges.filter((edge) => !edge.archived)).toHaveLength(1);

    expect(() => db.graphChanges.linkNodes({ projectId: project.id, sourceNodeId: a.node.id, targetNodeId: a.node.id, type: "reference", baseGraphRevision: db.graphChanges.read(project.id).revision })).toThrow(/EDGE_SELF_LINK/);
    expect(() => db.graphChanges.linkNodes({ projectId: project.id, sourceNodeId: a.node.id, targetNodeId: b.node.id, type: "reference", baseGraphRevision: 0 })).toThrow(/GRAPH_REVISION_CONFLICT/);
    db.close();
  });

  it("creates a project atomically from a visual template", () => {
    const db = store(); const scene = getScenePack("problem-decomposition")!; const template = getVisualTemplate("logic-tree")!;
    const chatSessionKey = createHash("sha256").update("template-chat").digest("hex");
    const created = db.catalog.createProjectFromTemplate({ title: "Decompose", goal: "Understand a problem", scenePack: scene, template, chatBinding: { chatSessionKey } });
    expect(created.project).toMatchObject({ graphRevision: 1, createdFromTemplate: { id: "logic-tree", version: "1.0.0" } });
    expect(created.graph.nodes.length).toBeGreaterThan(1); expect(created.graph.edges.length).toBeGreaterThan(0);
    expect(created.layout).toMatchObject({ layoutRevision: 1, viewName: "逻辑拆解树", templateRef: { id: "logic-tree", version: "1.0.0" }, projection: { kind: "tree" } });
    expect(created.binding).toMatchObject({ projectId: created.project.id, viewId: created.project.defaultViewId, status: "opening" });
    db.close();
  });

  it("archives pristine starter placeholders when real content lands, keeping user-edited ones", () => {
    const db = store(); const scene = getScenePack("problem-decomposition")!; const template = getVisualTemplate("logic-tree")!;
    const created = db.catalog.createProjectFromTemplate({ title: "Starter swap", goal: "", scenePack: scene, template });
    let project = created.project;
    const [editedId, ...pristineIds] = project.starterNodeIds;
    db.graphChanges.updateNode({ projectId: project.id, nodeId: editedId, baseGraphRevision: project.graphRevision, content: { kind: "document", mode: "note", markdown: "用户手写的内容", excerpt: "", embeddedAssetIds: [] } });
    project = db.catalog.getProject(project.id)!;
    const chatSessionKey = bindCanvas(db, project, scene, "starter-session");
    const task = db.tasks.prepare({ canvasSessionId: "starter-session", actionKey: "develop_selection", chatSessionKey });
    dispatchAndStart(db, task);
    const timestamp = new Date().toISOString();
    db.graphChanges.submit({ id: "starter-change", taskId: task.taskId, projectId: project.id, baseGraphRevision: project.graphRevision, baseLayoutRevisions: {}, graphOperations: [{ type: "add-node", node: { id: "real-node", projectId: project.id, type: scene.nodeTypes[0].key, title: "真实节点", contentKind: "document", content: { kind: "document", mode: "note", markdown: "", excerpt: "", embeddedAssetIds: [] }, properties: {}, archived: false, createdAt: timestamp, updatedAt: timestamp } }], layoutOperations: [], rationale: "First real content", riskLevel: "low", status: "pending", createdAt: timestamp, updatedAt: timestamp });
    // Direct-write default: submit auto-applied the ChangeSet.
    const graph = db.graphChanges.read(project.id);
    for (const id of pristineIds) expect(graph.nodes.find((node) => node.id === id)?.archived).toBe(true);
    expect(graph.nodes.find((node) => node.id === editedId)?.archived).toBe(false);
    expect(graph.nodes.find((node) => node.id === "real-node")?.archived).toBe(false);
    expect(graph.edges.filter((edge) => !edge.archived).every((edge) => !pristineIds.includes(edge.sourceNodeId) && !pristineIds.includes(edge.targetNodeId))).toBe(true);
    expect(db.catalog.getProject(project.id)?.starterNodeIds).toEqual([]);
    db.close();
  });

  it("creates multiple same-type template views without changing graph", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!; const project = db.catalog.createProject({ title: "Views", goal: "", scenePack: scene });
    const template = getVisualTemplate("blank-canvas")!;
    const first = db.catalog.createViewFromTemplate({ projectId: project.id, template, baseGraphRevision: 0, viewName: "Workshop" });
    const second = db.catalog.createViewFromTemplate({ projectId: project.id, template, baseGraphRevision: 0, viewName: "Workshop" });
    expect(first.viewId).not.toBe(second.viewId); expect(second.viewName).toBe("Workshop 2"); expect(db.catalog.getProject(project.id)?.graphRevision).toBe(0);
    expect(db.sessions.listEvents(project.id).some((event) => event.kind === "view.created")).toBe(true);
    expect(() => db.catalog.createViewFromTemplate({ projectId: project.id, template, baseGraphRevision: 1 })).toThrow("GRAPH_REVISION_CONFLICT");
    db.close();
  });

  it("materializes matrix quadrants as view-only groups", () => {
    const db = store(); const scene = getScenePack("decision-comparison")!; const template = getVisualTemplate("swot-matrix")!;
    const created = db.catalog.createProjectFromTemplate({ title: "SWOT", goal: "Compare a decision", scenePack: scene, template });
    expect(Object.keys(created.layout.groups)).toEqual(expect.arrayContaining(["quadrant:优势", "quadrant:劣势", "quadrant:机会", "quadrant:威胁"]));
    expect(created.layout.projection.kind).toBe("matrix"); expect(created.project.graphRevision).toBe(1);
    db.close();
  });

  it("deduplicates image bytes and keeps content and layout revisions independent", async () => {
    const db = store();
    const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "Media", goal: "", scenePack: scene });
    const png = await sharp({ create: { width: 120, height: 80, channels: 4, background: "#315cf6" } }).png().toBuffer();
    const first = await db.assets.importImage({ projectId: project.id, mimeType: "image/png", data: png });
    const second = await db.assets.importImage({ projectId: project.id, mimeType: "image/png", data: png });
    expect(second.asset.id).toBe(first.asset.id);
    expect(second.deduplicated).toBe(true);
    expect(db.catalog.getProject(project.id)?.graphRevision).toBe(0);
    const created = db.graphChanges.createNode({ projectId: project.id, viewId: project.defaultViewId, type: "idea", title: "Reference image", content: { kind: "image", assetId: first.asset.id, alt: "Blue", caption: "" }, x: 40, y: 60 });
    expect(created.project?.graphRevision).toBe(1);
    expect(created.layout.layoutRevision).toBe(1);
    const updated = db.graphChanges.updateNode({ projectId: project.id, nodeId: created.node.id, baseGraphRevision: 1, title: "Updated image" });
    expect(updated.project?.graphRevision).toBe(2);
    expect(db.layoutReviews.get(project.id, project.defaultViewId)?.layoutRevision).toBe(1);
    db.close();
  });

  it("archives a node so a reload no longer resurrects it", async () => {
    const db = store();
    const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "Delete", goal: "", scenePack: scene });
    const png = await sharp({ create: { width: 60, height: 40, channels: 4, background: "#315cf6" } }).png().toBuffer();
    const asset = await db.assets.importImage({ projectId: project.id, mimeType: "image/png", data: png });
    const keep = db.graphChanges.createNode({ projectId: project.id, viewId: project.defaultViewId, type: "idea", title: "Keep", content: { kind: "image", assetId: asset.asset.id, alt: "", caption: "" }, x: 0, y: 0 });
    const remove = db.graphChanges.createNode({ projectId: project.id, viewId: project.defaultViewId, type: "idea", title: "Remove", content: { kind: "image", assetId: asset.asset.id, alt: "", caption: "" }, x: 100, y: 0 });
    const rev = db.catalog.getProject(project.id)!.graphRevision;
    const res = db.graphChanges.archiveNode({ projectId: project.id, nodeId: remove.node.id, baseGraphRevision: rev });
    expect(res.project?.graphRevision).toBe(rev + 1);
    const nodes = db.graphChanges.read(project.id).nodes;
    expect(nodes.find((node) => node.id === remove.node.id)?.archived).toBe(true);
    expect(nodes.find((node) => node.id === keep.node.id)?.archived).toBe(false);
    expect(() => db.graphChanges.archiveNode({ projectId: project.id, nodeId: remove.node.id, baseGraphRevision: rev })).toThrow("GRAPH_REVISION_CONFLICT");
    expect(() => db.graphChanges.archiveNode({ projectId: project.id, nodeId: "nope", baseGraphRevision: rev + 1 })).toThrow("NODE_NOT_FOUND");
    db.close();
  });

  it("places a skill-generated image as an image node via a ChangeSet", async () => {
    const db = store();
    const scene = getScenePack("entity-relationship")!;
    const project = db.catalog.createProject({ title: "Imagegen", goal: "", scenePack: scene });
    const png = await sharp({ create: { width: 4, height: 3, channels: 3, background: { r: 20, g: 40, b: 80 } } }).png().toBuffer();
    const asset = await db.assets.importImage({ projectId: project.id, mimeType: "image/png", data: png });

    const chatSessionKey = bindCanvas(db, project, scene, "imagegen-session");
    const task = db.tasks.prepare({ canvasSessionId: "imagegen-session", actionKey: "develop_selection", chatSessionKey });
    dispatchAndStart(db, task);
    const ts = new Date().toISOString();
    db.graphChanges.submit({ id: "cs-img", taskId: task.taskId, projectId: project.id, baseGraphRevision: 0, baseLayoutRevisions: {}, graphOperations: [{ type: "add-node", node: { id: "chart-cover", projectId: project.id, type: "entity", title: "赛道信息图", contentKind: "image", content: { kind: "image", assetId: asset.asset.id, alt: "赛道信息图", caption: "券商研报 · 2026Q2" }, properties: {}, archived: false, createdAt: ts, updatedAt: ts } }], layoutOperations: [], rationale: "Place generated infographic", riskLevel: "low", status: "pending", createdAt: ts, updatedAt: ts });
    // Direct-write default: submit already auto-applied the ChangeSet.
    const node = db.graphChanges.read(project.id).nodes.find((n) => n.id === "chart-cover")!;
    expect(node.contentKind).toBe("image");
    expect(node.content.kind === "image" && node.content.assetId).toBe(asset.asset.id);
    db.close();
  });

  it("direct-writes a submitted ChangeSet and reverts it losslessly", () => {
    const db = store();
    const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "Direct", goal: "", scenePack: scene });
    const chatSessionKey = bindCanvas(db, project, scene, "direct-session");
    const task = db.tasks.prepare({ canvasSessionId: "direct-session", actionKey: "develop_selection", chatSessionKey });
    dispatchAndStart(db, task);
    const ts = new Date().toISOString();
    const submitted = db.graphChanges.submit({ id: "cs-direct", taskId: task.taskId, projectId: project.id, baseGraphRevision: 0, baseLayoutRevisions: {}, graphOperations: [{ type: "add-node", node: { id: "auto-node", projectId: project.id, type: "idea", title: "直写节点", contentKind: "document", content: { kind: "document", mode: "note", markdown: "", excerpt: "", embeddedAssetIds: [] }, properties: {}, archived: false, createdAt: ts, updatedAt: ts } }], layoutOperations: [], rationale: "direct write", riskLevel: "low", status: "pending", createdAt: ts, updatedAt: ts });

    // No review gate: the submit itself applied, task completed, node live.
    expect(submitted).toMatchObject({ status: "applied", autoApplied: true, graphRevision: 1 });
    expect(db.tasks.get(task.taskId)?.status).toBe("completed");
    expect(db.graphChanges.read(project.id).nodes.some((n) => n.id === "auto-node")).toBe(true);

    // The safety net: revert restores the pre-apply graph as a FORWARD revision.
    const reverted = db.graphChanges.revert("cs-direct");
    expect(reverted.status).toBe("reverted");
    expect(reverted.graphRevision).toBe(2);
    expect(db.graphChanges.read(project.id).nodes.some((n) => n.id === "auto-node")).toBe(false);
    expect(db.graphChanges.get("cs-direct")?.status).toBe("reverted");
    // Double revert is refused.
    expect(() => db.graphChanges.revert("cs-direct")).toThrow("CHANGESET_NOT_APPLIED");
    db.close();
  });

  it("reaps a running task past its max lifetime even while it keeps heartbeating", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const base = new Date("2026-07-12T00:00:00.000Z").getTime();
      vi.setSystemTime(base);
      const db = store();
      const scene = getScenePack("free-brainstorming")!;
      const project = db.catalog.createProject({ title: "Stuck", goal: "", scenePack: scene });
      const chatSessionKey = bindCanvas(db, project, scene, "stuck-session");
      const task = db.tasks.prepare({ canvasSessionId: "stuck-session", actionKey: "develop_selection", chatSessionKey });
      dispatchAndStart(db, task);

      // 31 minutes later the agent is still heartbeating (idle clock reset), but past
      // the 30-minute hard cap — it must be reaped so the canvas is unblocked.
      vi.setSystemTime(base + 31 * 60_000);
      db.tasks.progress(task.taskId, "正在核验连接能力");
      const reaped = db.tasks.reapCanvas("stuck-session");

      expect(reaped.map((t) => t.taskId)).toContain(task.taskId);
      expect(db.tasks.get(task.taskId)?.status).toBe("failed");
      expect(db.tasks.get(task.taskId)?.error?.code).toBe("AGENT_TASK_MAX_LIFETIME");
      db.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets the bound canvas cancel a task a different chat session dispatched", () => {
    const db = store();
    const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "Cancel", goal: "", scenePack: scene });
    const agentKey = bindCanvas(db, project, scene, "canvas-x");
    const task = db.tasks.prepare({ canvasSessionId: "canvas-x", actionKey: "develop_selection", chatSessionKey: agentKey });
    dispatchAndStart(db, task);

    // The widget is a different chat session that rebinds the SAME canvas.
    const widgetKey = createHash("sha256").update("widget-chat").digest("hex");
    const binding = db.sessions.openBinding({ chatSessionKey: widgetKey, projectId: project.id, viewId: project.defaultViewId });
    const ts = new Date().toISOString();
    db.sessions.syncCanvas({ version: 2, canvasSessionId: "canvas-x", workspaceDir: db.workspaceDir, projectId: project.id, scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: 0, viewId: project.defaultViewId, viewType: scene.defaultView, selectedNodeIds: [], selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, presence: { visible: true, focused: true, lastSeenAt: ts }, chatBinding: { leaseId: binding.leaseId, bindingRevision: binding.bindingRevision }, agentEligible: true, sequence: 2, updatedAt: ts }, widgetKey);

    // The old strict check rejects the widget; the canvas-ownership check allows it.
    expect(() => db.tasks.assertChat(task.taskId, widgetKey, false)).toThrow("TASK_CHAT_MISMATCH");
    expect(db.tasks.assertCanvas(task.taskId, widgetKey).taskId).toBe(task.taskId);
    db.close();
  });

  it("rejects agent content operations that reference unknown asset ids", () => {
    const db = store();
    const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "Guarded", goal: "", scenePack: scene });
    const timestamp = new Date().toISOString();
    db.db.prepare("INSERT INTO node(id, project_id, data) VALUES (?, ?, ?)").run("note", project.id, JSON.stringify({ id: "note", projectId: project.id, type: "idea", title: "Note", contentKind: "document", content: { kind: "document", mode: "note", markdown: "", excerpt: "", embeddedAssetIds: [] }, properties: {}, archived: false, createdAt: timestamp, updatedAt: timestamp }));
    const chatSessionKey = bindCanvas(db, project, scene, "unsafe-session", { selectedNodeIds: ["note"] });
    const task = db.tasks.prepare({ canvasSessionId: "unsafe-session", actionKey: "develop_selection", chatSessionKey });
    dispatchAndStart(db, task);
    // Direct-write: the asset guard now fires at submit time (auto-apply).
    expect(() => db.graphChanges.submit({ id: "unsafe", taskId: task.taskId, projectId: project.id, baseGraphRevision: 0, baseLayoutRevisions: {}, graphOperations: [{ type: "set-node-content", nodeId: "note", content: { kind: "image", assetId: "/tmp/not-an-asset", alt: "", caption: "" } }], layoutOperations: [], rationale: "Try bypass", riskLevel: "high", status: "pending", createdAt: timestamp, updatedAt: timestamp })).toThrow("ASSET_NOT_FOUND_OR_CROSS_PROJECT");
    expect(db.catalog.getProject(project.id)?.graphRevision).toBe(0);
    db.close();
  });

  it("persists task and graph events with monotonic cursors", () => {
    const db = store();
    const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "Events", goal: "", scenePack: scene, automationLevel: "cautious" });
    const timestamp = new Date().toISOString();
    const chatSessionKey = bindCanvas(db, project, scene, "event-session");
    const task = db.tasks.prepare({ canvasSessionId: "event-session", actionKey: "develop_selection", chatSessionKey });
    dispatchAndStart(db, task);
    db.graphChanges.submit({ id: "event-change", taskId: task.taskId, projectId: project.id, baseGraphRevision: 0, baseLayoutRevisions: {}, graphOperations: [], layoutOperations: [], rationale: "No-op review", riskLevel: "low", status: "pending", createdAt: timestamp, updatedAt: timestamp });
    const events = db.sessions.listEvents(project.id);
    expect(events.map((event) => event.sequence)).toEqual([...events.map((event) => event.sequence)].sort((a, b) => a - b));
    expect(events.filter((event) => event.kind === "task.updated")).toHaveLength(4);
    expect(db.tasks.get(task.taskId)).toMatchObject({ status: "pending_review", taskRevision: 3, results: { changeSetId: "event-change" } });
    db.close();
  });

  it("applies mixed content atomically, projects new nodes, and requests the layout stage", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "Mixed", goal: "", scenePack: scene });
    const timestamp = new Date().toISOString();
    const chatSessionKey = bindCanvas(db, project, scene, "mixed-session");
    const task = db.tasks.prepare({ canvasSessionId: "mixed-session", actionKey: "develop_then_layout", chatSessionKey });
    dispatchAndStart(db, task);
    const applied = db.graphChanges.submit({ id: "mixed-change", taskId: task.taskId, projectId: project.id, baseGraphRevision: 0, baseLayoutRevisions: {}, graphOperations: [{ type: "add-node", node: { id: "agent-node", projectId: project.id, type: "idea", title: "Agent node", contentKind: "document", content: { kind: "document", mode: "note", markdown: "", excerpt: "", embeddedAssetIds: [] }, properties: {}, archived: false, createdAt: timestamp, updatedAt: timestamp } }], layoutOperations: [], rationale: "Add one idea", riskLevel: "low", status: "pending", createdAt: timestamp, updatedAt: timestamp }) as ReturnType<typeof db.graphChanges.apply> & { autoApplied?: boolean };
    expect(applied.graphRevision).toBe(1);
    expect(db.layoutReviews.get(project.id, project.defaultViewId)?.nodes["agent-node"]).toBeTruthy();
    expect(db.tasks.get(task.taskId)).toMatchObject({ status: "ready_to_continue", activeStage: "layout", expectedGraphRevision: 1 });
    expect(db.sessions.listEvents(project.id).map((event) => event.kind)).toEqual(expect.arrayContaining(["graph.changed", "layout.changed", "task.updated"]));
    db.close();
  });

  it("serializes active canvas tasks and validates dispatch transitions", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "Dispatch", goal: "", scenePack: scene });
    const timestamp = new Date().toISOString();
    const chatSessionKey = bindCanvas(db, project, scene, "dispatch-session");
    const first = db.tasks.prepare({ canvasSessionId: "dispatch-session", actionKey: "develop_selection", dispatchKey: "dispatch-1", chatSessionKey });
    expect(db.tasks.prepare({ canvasSessionId: "dispatch-session", actionKey: "develop_selection", dispatchKey: "dispatch-1", chatSessionKey }).taskId).toBe(first.taskId);
    expect(() => db.tasks.prepare({ canvasSessionId: "dispatch-session", actionKey: "layout_view", dispatchKey: "dispatch-2", chatSessionKey })).toThrow(`ACTIVE_CANVAS_TASK_EXISTS:${first.taskId}`);
    expect(() => db.tasks.update(first.taskId, { status: "running" })).toThrow("TASK_TRANSITION_INVALID:prepared->running");
    const dispatched = db.tasks.confirmDispatch(first.taskId, "dispatch-1");
    expect(dispatched).toMatchObject({ status: "dispatched", dispatches: [{ state: "accepted" }] });
    expect(db.tasks.confirmDispatch(first.taskId, "dispatch-1")).toMatchObject({ status: "dispatched" });
    db.tasks.update(first.taskId, { status: "cancelled" });
    expect(() => db.tasks.update(first.taskId, { status: "running" })).toThrow("TASK_TRANSITION_INVALID:cancelled->running");
    expect(() => db.graphChanges.submit({ id: "late-write", taskId: first.taskId, projectId: project.id, baseGraphRevision: 0, baseLayoutRevisions: {}, graphOperations: [], layoutOperations: [], rationale: "Too late", riskLevel: "low", status: "pending", createdAt: timestamp, updatedAt: timestamp })).toThrow("TASK_TERMINAL:cancelled");
    db.close();
  });

  it("expires an abandoned prepared task before accepting a replacement", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "Expiry", goal: "", scenePack: scene }); const timestamp = new Date().toISOString();
    const chatSessionKey = bindCanvas(db, project, scene, "expiry-session");
    const abandoned = db.tasks.prepare({ canvasSessionId: "expiry-session", actionKey: "develop_selection", dispatchKey: "abandoned", chatSessionKey });
    db.db.prepare("UPDATE agent_task SET data = json_set(data, '$.updatedAt', ?) WHERE id = ?").run(new Date(Date.now() - 121_000).toISOString(), abandoned.taskId);
    const replacement = db.tasks.prepare({ canvasSessionId: "expiry-session", actionKey: "layout_view", dispatchKey: "replacement", chatSessionKey });
    expect(replacement.taskId).not.toBe(abandoned.taskId);
    expect(db.tasks.get(abandoned.taskId)).toMatchObject({ status: "failed", error: { code: "PREPARED_TASK_EXPIRED" } });
    db.close();
  });

  it("reaps a silent running task so the canvas is unblocked", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "Reap", goal: "", scenePack: scene });
    const chatSessionKey = bindCanvas(db, project, scene, "reap-session");
    const zombie = db.tasks.prepare({ canvasSessionId: "reap-session", actionKey: "develop_selection", dispatchKey: "zombie", chatSessionKey });
    dispatchAndStart(db, zombie);
    db.db.prepare("UPDATE agent_task SET data = json_set(data, '$.updatedAt', ?) WHERE id = ?").run(new Date(Date.now() - 601_000).toISOString(), zombie.taskId);
    const reaped = db.tasks.reapCanvas("reap-session");
    expect(reaped).toHaveLength(1);
    expect(db.tasks.get(zombie.taskId)).toMatchObject({ status: "failed", error: { code: "AGENT_TASK_TIMEOUT" } });
    expect(db.tasks.listCanvas("reap-session")).toHaveLength(0);
    const replacement = db.tasks.prepare({ canvasSessionId: "reap-session", actionKey: "develop_selection", dispatchKey: "fresh", chatSessionKey });
    expect(replacement.taskId).not.toBe(zombie.taskId);
    db.close();
  });

  it("reaps a dispatched task no agent ever started, but never review states", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "ReapDispatch", goal: "", scenePack: scene });
    const chatSessionKey = bindCanvas(db, project, scene, "reap-dispatch-session");
    const task = db.tasks.prepare({ canvasSessionId: "reap-dispatch-session", actionKey: "develop_selection", dispatchKey: "d1", chatSessionKey });
    db.tasks.confirmDispatch(task.taskId, "d1");
    db.db.prepare("UPDATE agent_task SET data = json_set(data, '$.updatedAt', ?) WHERE id = ?").run(new Date(Date.now() - 181_000).toISOString(), task.taskId);
    db.tasks.reapCanvas("reap-dispatch-session");
    expect(db.tasks.get(task.taskId)).toMatchObject({ status: "failed", error: { code: "AGENT_DISPATCH_TIMEOUT" } });

    const second = db.tasks.prepare({ canvasSessionId: "reap-dispatch-session", actionKey: "develop_selection", dispatchKey: "d2", chatSessionKey });
    dispatchAndStart(db, second);
    db.tasks.update(second.taskId, { status: "pending_review" });
    db.db.prepare("UPDATE agent_task SET data = json_set(data, '$.updatedAt', ?) WHERE id = ?").run(new Date(Date.now() - 3_600_000).toISOString(), second.taskId);
    expect(db.tasks.reapCanvas("reap-dispatch-session")).toHaveLength(0);
    expect(db.tasks.get(second.taskId)?.status).toBe("pending_review");
    db.close();
  });

  it("records progress notes only while running", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "Progress", goal: "", scenePack: scene });
    const chatSessionKey = bindCanvas(db, project, scene, "progress-session");
    const task = db.tasks.prepare({ canvasSessionId: "progress-session", actionKey: "develop_selection", chatSessionKey });
    expect(() => db.tasks.progress(task.taskId, "太早了")).toThrow("TASK_NOT_RUNNING:prepared");
    dispatchAndStart(db, task);
    const updated = db.tasks.progress(task.taskId, "已写入 12/32 个节点…");
    expect(updated.progressNote).toBe("已写入 12/32 个节点…");
    expect(updated.taskRevision).toBeGreaterThan(task.taskRevision);
    db.close();
  });

  it("bumps the heartbeat even when the note repeats", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "Progress", goal: "", scenePack: scene });
    const chatSessionKey = bindCanvas(db, project, scene, "progress-session-2");
    const task = db.tasks.prepare({ canvasSessionId: "progress-session-2", actionKey: "develop_selection", chatSessionKey });
    dispatchAndStart(db, task);
    const first = db.tasks.progress(task.taskId, "waiting on tool call");
    const second = db.tasks.progress(task.taskId, "waiting on tool call");
    // taskRevision is the definitive heartbeat proof: without force the repeated note would
    // short-circuit to a no-op and keep the same revision. updatedAt can tie in the same ms.
    expect(second.taskRevision).toBeGreaterThan(first.taskRevision);
    db.close();
  });

  it("claims a mixed-task continuation once", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "Continuation", goal: "", scenePack: scene });
    const timestamp = new Date().toISOString();
    const chatSessionKey = bindCanvas(db, project, scene, "continuation-session");
    const task = db.tasks.prepare({ canvasSessionId: "continuation-session", actionKey: "develop_then_layout", dispatchKey: "content-dispatch", chatSessionKey }); dispatchAndStart(db, task);
    db.graphChanges.submit({ id: "continue-change", taskId: task.taskId, projectId: project.id, baseGraphRevision: 0, baseLayoutRevisions: {}, graphOperations: [], layoutOperations: [], rationale: "Review", riskLevel: "low", status: "pending", createdAt: timestamp, updatedAt: timestamp });
    // Direct-write default: submit auto-applied the ChangeSet.
    const ready = db.tasks.get(task.taskId)!;
    const claimed = db.tasks.continue({ taskId: task.taskId, dispatchKey: "layout-dispatch", expectedTaskRevision: ready.taskRevision });
    expect(claimed).toMatchObject({ status: "prepared", activeStage: "layout" });
    expect(db.tasks.continue({ taskId: task.taskId, dispatchKey: "layout-dispatch", expectedTaskRevision: ready.taskRevision }).taskRevision).toBe(claimed.taskRevision);
    expect(() => db.tasks.continue({ taskId: task.taskId, dispatchKey: "other", expectedTaskRevision: ready.taskRevision })).toThrow("TASK_REVISION_CONFLICT");
    db.close();
  });

  it("isolates two Codex chats that open the same project", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "Shared graph", goal: "", scenePack: scene });
    const firstChat = bindCanvas(db, project, scene, "chat-a-canvas");
    const secondChat = bindCanvas(db, project, scene, "chat-b-canvas");
    const firstTask = db.tasks.prepare({ canvasSessionId: "chat-a-canvas", actionKey: "develop_selection", chatSessionKey: firstChat });
    const secondTask = db.tasks.prepare({ canvasSessionId: "chat-b-canvas", actionKey: "layout_view", chatSessionKey: secondChat });
    expect(firstTask.canvasSessionId).not.toBe(secondTask.canvasSessionId);
    expect(firstTask.chatSessionKey).not.toBe(secondTask.chatSessionKey);
    expect(() => db.tasks.assertChat(firstTask.taskId, secondChat)).toThrow("TASK_CHAT_MISMATCH");
    expect(db.tasks.assertChat(secondTask.taskId, secondChat).taskId).toBe(secondTask.taskId);
    db.close();
  });

  it("invalidates the old lease and pending task when a chat switches canvas", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const firstProject = db.catalog.createProject({ title: "First", goal: "", scenePack: scene });
    const secondProject = db.catalog.createProject({ title: "Second", goal: "", scenePack: scene });
    const chatSessionKey = bindCanvas(db, firstProject, scene, "rebound-canvas");
    const task = db.tasks.prepare({ canvasSessionId: "rebound-canvas", actionKey: "develop_selection", chatSessionKey });
    dispatchAndStart(db, task);
    const current = db.sessions.getBinding(chatSessionKey)!;
    const switched = db.sessions.switchBinding({ chatSessionKey, leaseId: current.leaseId, bindingRevision: current.bindingRevision, projectId: secondProject.id, viewId: secondProject.defaultViewId });
    expect(switched).toMatchObject({ status: "opening", bindingRevision: current.bindingRevision + 1, projectId: secondProject.id });
    expect(db.tasks.get(task.taskId)).toMatchObject({ status: "cancelled", error: { code: "CHAT_CANVAS_REBOUND" } });
    expect(() => db.sessions.switchBinding({ chatSessionKey, leaseId: current.leaseId, bindingRevision: current.bindingRevision, projectId: firstProject.id, viewId: firstProject.defaultViewId })).toThrow("CHAT_CANVAS_LEASE_STALE");
    expect(db.sessions.listEvents(firstProject.id).some((event) => event.kind === "chat.binding.changed")).toBe(true);
    db.close();
  });

  it("fails closed for offline and browser-preview canvases", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "Presence", goal: "", scenePack: scene });
    const offlineChat = bindCanvas(db, project, scene, "offline-canvas", { lastSeenAt: new Date(Date.now() - 31_000).toISOString() });
    expect(() => db.sessions.boundCanvas(offlineChat, true)).toThrow("BOUND_CANVAS_OFFLINE");
    const timestamp = new Date().toISOString();
    db.sessions.syncCanvas({ version: 2, canvasSessionId: "browser-canvas", workspaceDir: db.workspaceDir, projectId: project.id, scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: 0, viewId: project.defaultViewId, viewType: scene.defaultView, selectedNodeIds: [], selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, agentEligible: false, sequence: 1, updatedAt: timestamp });
    expect(() => db.tasks.prepare({ canvasSessionId: "browser-canvas", actionKey: "develop_selection", chatSessionKey: offlineChat })).toThrow("BROWSER_PREVIEW_AGENT_UNAVAILABLE");
    db.close();
  });

  it("keeps one online Canvas active and permits takeover after it goes offline", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "Single Canvas", goal: "", scenePack: scene });
    const chatSessionKey = createHash("sha256").update("single-canvas-chat").digest("hex");
    const binding = db.sessions.openBinding({ chatSessionKey, projectId: project.id, viewId: project.defaultViewId });
    const snapshot = (canvasSessionId: string, sequence: number, timestamp: string) => ({
      version: 2 as const, canvasSessionId, workspaceDir: db.workspaceDir, projectId: project.id,
      scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: project.graphRevision,
      viewId: project.defaultViewId, viewType: scene.defaultView, selectedNodeIds: [], selectedEdgeIds: [],
      selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 },
      presence: { visible: true, focused: true, lastSeenAt: timestamp },
      chatBinding: { leaseId: binding.leaseId, bindingRevision: binding.bindingRevision },
      agentEligible: true, sequence, updatedAt: timestamp,
    });
    const now = new Date().toISOString();
    db.sessions.syncCanvas(snapshot("canvas-a", 1, now), chatSessionKey);
    expect(() => db.sessions.syncCanvas(snapshot("canvas-b", 1, now), chatSessionKey)).toThrow("CANVAS_ALREADY_ACTIVE");
    expect(db.sessions.getBinding(chatSessionKey)).toMatchObject({ canvasSessionId: "canvas-a", status: "active" });

    const old = new Date(Date.now() - 31_000).toISOString();
    db.db.prepare("UPDATE canvas_session SET data = json_set(data, '$.presence.lastSeenAt', ?, '$.updatedAt', ?) WHERE id = ?").run(old, old, "canvas-a");
    db.sessions.syncCanvas(snapshot("canvas-b", 2, new Date().toISOString()), chatSessionKey);
    expect(db.sessions.getBinding(chatSessionKey)).toMatchObject({ canvasSessionId: "canvas-b", status: "active" });
    expect(db.sessions.listEvents(project.id).some((event) => event.kind === "chat.binding.changed" && event.canvasSessionId === "canvas-a")).toBe(true);
    db.close();
  });

  it("lets an explicit claim take over an online Canvas (page refresh reclaims instantly)", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "Refresh reclaim", goal: "", scenePack: scene });
    const chatSessionKey = createHash("sha256").update("refresh-reclaim-chat").digest("hex");
    const binding = db.sessions.openBinding({ chatSessionKey, projectId: project.id, viewId: project.defaultViewId });
    const snapshot = (canvasSessionId: string, sequence: number, syncPurpose: "claim" | "state", timestamp: string) => ({
      version: 2 as const, canvasSessionId, workspaceDir: db.workspaceDir, projectId: project.id,
      scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: project.graphRevision,
      viewId: project.defaultViewId, viewType: scene.defaultView, selectedNodeIds: [], selectedEdgeIds: [],
      selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 },
      presence: { visible: true, focused: true, lastSeenAt: timestamp },
      chatBinding: { leaseId: binding.leaseId, bindingRevision: binding.bindingRevision },
      agentEligible: true, sequence, syncPurpose, updatedAt: timestamp,
    });
    const now = new Date().toISOString();
    db.sessions.syncCanvas(snapshot("canvas-old", 1, "claim", now), chatSessionKey);
    // The old session is still "online" (heartbeat just now), but a fresh page
    // load issues a `claim` and must take over rather than throw.
    db.sessions.syncCanvas(snapshot("canvas-new", 1, "claim", new Date().toISOString()), chatSessionKey);
    expect(db.sessions.getBinding(chatSessionKey)).toMatchObject({ canvasSessionId: "canvas-new", status: "active" });
    expect(db.sessions.listEvents(project.id).some((event) => event.kind === "chat.binding.changed" && event.canvasSessionId === "canvas-old")).toBe(true);
    db.close();
  });

  it("opens the same active Project/View without rotating its lease", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "Idempotent open", goal: "", scenePack: scene });
    const chatSessionKey = bindCanvas(db, project, scene, "idempotent-canvas");
    const before = db.sessions.getBinding(chatSessionKey)!;
    const reopened = db.sessions.openBinding({ chatSessionKey, projectId: project.id, viewId: project.defaultViewId });
    expect(reopened).toEqual(before);
    expect(db.sessions.openBinding({ chatSessionKey })).toEqual(before);
    db.close();
  });

  it("creates one catalog entry for every persisted layout", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "Catalog", goal: "", scenePack: scene });
    db.layoutReviews.ensureView({ projectId: project.id, viewId: "graph-default", viewType: "graph", strategy: "force" });
    const views = (db as any).catalog.listViews(project.id);
    expect(views.map((view: any) => view.id)).toEqual(expect.arrayContaining([project.defaultViewId, "graph-default"]));
    expect(views.find((view: any) => view.id === project.defaultViewId)).toMatchObject({ status: "active", pinned: true });
    expect((db.catalog.getProject(project.id) as any).viewCatalogRevision).toBeGreaterThan(0);
    db.close();
  });

  it("records template metadata in the View catalog", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "Templates", goal: "", scenePack: scene });
    const template = getVisualTemplate("blank-canvas")!;
    const layout = db.catalog.createViewFromTemplate({ projectId: project.id, template, baseGraphRevision: 0, viewName: "Workshop" });
    expect((db as any).catalog.getView(project.id, layout.viewId)).toMatchObject({ id: layout.viewId, name: "Workshop", templateRef: { id: "blank-canvas", version: "1.0.0" }, createdBy: "template" });
    db.close();
  });

  it("renames and pins Views without changing graph or layout revisions", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "Metadata", goal: "", scenePack: scene });
    const graphView = db.layoutReviews.ensureView({ projectId: project.id, viewId: "graph-default", viewType: "graph", strategy: "force" });
    const beforeCatalogRevision = Number((db.catalog.getProject(project.id) as any).viewCatalogRevision);
    const renamed = (db as any).catalog.renameView({ projectId: project.id, viewId: graphView.viewId, name: "关系网络", baseCatalogRevision: beforeCatalogRevision });
    const pinned = (db as any).catalog.pinView({ projectId: project.id, viewId: graphView.viewId, pinned: true, baseCatalogRevision: renamed.project.viewCatalogRevision });
    expect(pinned.view).toMatchObject({ name: "关系网络", pinned: true });
    expect(db.catalog.getProject(project.id)?.graphRevision).toBe(0);
    expect(db.layoutReviews.get(project.id, graphView.viewId)?.layoutRevision).toBe(0);
    expect(pinned.project.viewCatalogRevision).toBe(beforeCatalogRevision + 2);
    db.close();
  });

  it("moves a current default View to trash and atomically falls back", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "Trash", goal: "", scenePack: scene });
    const fallback = db.layoutReviews.ensureView({ projectId: project.id, viewId: "graph-default", viewType: "graph", strategy: "force" });
    const chatSessionKey = bindCanvas(db, db.catalog.getProject(project.id)!, scene, "trash-canvas");
    const task = db.tasks.prepare({ canvasSessionId: "trash-canvas", actionKey: "develop_selection", chatSessionKey }); dispatchAndStart(db, task);
    const before = db.catalog.getProject(project.id)!; const layoutRevision = db.layoutReviews.get(project.id, project.defaultViewId)!.layoutRevision;
    const trashed = (db as any).catalog.trashView({ projectId: project.id, viewId: project.defaultViewId, fallbackViewId: fallback.viewId, baseCatalogRevision: (before as any).viewCatalogRevision });
    expect(trashed.view).toMatchObject({ status: "trashed" });
    expect(trashed.project.defaultViewId).toBe(fallback.viewId);
    expect(db.sessions.getBinding(chatSessionKey)).toMatchObject({ viewId: fallback.viewId, status: "opening" });
    expect(db.tasks.get(task.taskId)).toMatchObject({ status: "cancelled", error: { code: "VIEW_TRASHED" } });
    expect(db.layoutReviews.get(project.id, project.defaultViewId)?.layoutRevision).toBe(layoutRevision);
    expect(db.catalog.getProject(project.id)?.graphRevision).toBe(0);
    db.close();
  });

  it("protects the last active View and supports restore then permanent purge", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "Recovery", goal: "", scenePack: scene });
    expect(() => (db as any).catalog.trashView({ projectId: project.id, viewId: project.defaultViewId, baseCatalogRevision: (db.catalog.getProject(project.id) as any).viewCatalogRevision })).toThrow("LAST_ACTIVE_VIEW");
    const second = db.layoutReviews.ensureView({ projectId: project.id, viewId: "graph-default", viewType: "graph", strategy: "force" });
    let revision = (db.catalog.getProject(project.id) as any).viewCatalogRevision;
    (db as any).catalog.trashView({ projectId: project.id, viewId: second.viewId, baseCatalogRevision: revision });
    revision = (db.catalog.getProject(project.id) as any).viewCatalogRevision;
    expect((db as any).catalog.restoreView({ projectId: project.id, viewId: second.viewId, baseCatalogRevision: revision }).view.status).toBe("active");
    revision = (db.catalog.getProject(project.id) as any).viewCatalogRevision;
    (db as any).catalog.trashView({ projectId: project.id, viewId: second.viewId, baseCatalogRevision: revision });
    revision = (db.catalog.getProject(project.id) as any).viewCatalogRevision;
    (db as any).catalog.purgeView({ projectId: project.id, viewId: second.viewId, baseCatalogRevision: revision });
    expect((db as any).catalog.getView(project.id, second.viewId)).toBeNull();
    expect(db.layoutReviews.get(project.id, second.viewId)).toBeNull();
    db.close();
  });

  it("duplicates a View and persists independent per-session View state", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "Duplicate", goal: "", scenePack: scene });
    const source = db.layoutReviews.get(project.id, project.defaultViewId)!; source.nodes.example = { nodeId: "example", x: 120, y: 80, width: 220, height: 112, rotation: 0, zIndex: 0, pinned: false, hidden: false, collapsed: false }; db.layoutReviews.save(source);
    const duplicated = (db as any).catalog.duplicateView({ projectId: project.id, viewId: project.defaultViewId, name: "Canvas for presentation", baseCatalogRevision: (db.catalog.getProject(project.id) as any).viewCatalogRevision });
    expect(duplicated.view).toMatchObject({ name: "Canvas for presentation", pinned: false });
    expect(duplicated.layout.viewId).not.toBe(project.defaultViewId);
    expect(duplicated.layout.nodes.example).toMatchObject({ x: 120, y: 80 });
    const state = { canvasSessionId: "state-session", viewId: duplicated.view.id, viewport: { x: 40, y: 50, zoom: 1.4 }, selectedNodeIds: ["example"], focusedNodeId: "example", lastOpenedAt: new Date().toISOString() };
    (db as any).catalog.saveCanvasState(state);
    expect((db as any).catalog.canvasState("state-session", duplicated.view.id)).toMatchObject({ viewport: state.viewport, selectedNodeIds: ["example"] });
    db.close();
  });

  it("purges recycle-bin Views after their retention deadline", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "Retention", goal: "", scenePack: scene });
    const second = db.layoutReviews.ensureView({ projectId: project.id, viewId: "graph-default", viewType: "graph", strategy: "force" });
    (db as any).catalog.trashView({ projectId: project.id, viewId: second.viewId, baseCatalogRevision: (db.catalog.getProject(project.id) as any).viewCatalogRevision });
    const expired = { ...(db as any).catalog.getView(project.id, second.viewId), purgeAfter: new Date(Date.now() - 1_000).toISOString() };
    db.db.prepare("UPDATE project_view SET data = ? WHERE id = ?").run(JSON.stringify(expired), second.viewId);
    const workspaceDir = db.workspaceDir; db.close();
    const reopened = new WorkspaceStore(workspaceDir);
    expect((reopened as any).catalog.getView(project.id, second.viewId)).toBeNull();
    expect(reopened.layoutReviews.get(project.id, second.viewId)).toBeNull();
    reopened.close();
  });

  it("records template starter node ids on the project", () => {
    const db = store(); const scene = getScenePack("problem-decomposition")!; const template = getVisualTemplate("logic-tree")!;
    const created = db.catalog.createProjectFromTemplate({ title: "Seeded", goal: "", scenePack: scene, template });
    expect(created.project.starterNodeIds).toHaveLength(template.starterBlueprint.nodes.length);
    expect(new Set(created.graph.nodes.map((node) => node.id))).toEqual(new Set(created.project.starterNodeIds));
    db.close();
  });

});
