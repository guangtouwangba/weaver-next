import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
  db.confirmAgentDispatch(task.taskId, dispatchKey);
  return db.updateAgentTask(task.taskId, { status: "running" });
}

function bindCanvas(db: WorkspaceStore, project: { id: string; defaultViewId: string; graphRevision: number }, scene: NonNullable<ReturnType<typeof getScenePack>>, canvasSessionId: string, options: { selectedNodeIds?: string[]; focused?: boolean; lastSeenAt?: string } = {}) {
  const chatSessionKey = createHash("sha256").update(`test-chat:${canvasSessionId}`).digest("hex");
  const binding = db.openChatCanvasBinding({ chatSessionKey, projectId: project.id, viewId: project.defaultViewId });
  const timestamp = options.lastSeenAt ?? new Date().toISOString();
  db.syncCanvasContext({ version: 2, canvasSessionId, workspaceDir: db.workspaceDir, projectId: project.id, scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: project.graphRevision, viewId: project.defaultViewId, viewType: scene.defaultView, selectedNodeIds: options.selectedNodeIds ?? [], selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, presence: { visible: true, focused: options.focused ?? true, lastSeenAt: timestamp }, chatBinding: { leaseId: binding.leaseId, bindingRevision: binding.bindingRevision }, agentEligible: true, sequence: 1, updatedAt: timestamp }, chatSessionKey);
  return chatSessionKey;
}

describe("WorkspaceStore", () => {
  it("keeps graph and layout revisions independent", () => {
    const db = store();
    const scene = getScenePack("free-brainstorming")!;
    const project = db.createProject({ title: "Test", goal: "Map ideas", scenePack: scene });
    const layout = db.getLayout(project.id, project.defaultViewId)!;
    layout.layoutRevision += 1;
    db.saveLayout(layout);
    expect(db.getProject(project.id)?.graphRevision).toBe(0);
    expect(db.getLayout(project.id, project.defaultViewId)?.layoutRevision).toBe(1);
    db.close();
  });

  it("rejects an older canvas sequence", () => {
    const db = store();
    const scene = getScenePack("free-brainstorming")!;
    const project = db.createProject({ title: "Test", goal: "Map ideas", scenePack: scene });
    const snapshot = { version: 2 as const, canvasSessionId: "s", workspaceDir: db.workspaceDir, projectId: project.id, scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: 0, viewId: project.defaultViewId, viewType: scene.defaultView, selectedNodeIds: [], selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, agentEligible: false, sequence: 2, updatedAt: new Date().toISOString() };
    db.syncCanvasContext(snapshot);
    expect(() => db.syncCanvasContext({ ...snapshot, sequence: 1 })).toThrow("STALE_CANVAS_SEQUENCE");
    db.close();
  });

  it("atomically advances a stale explicit claim while still rejecting stale state", () => {
    const db = store();
    const scene = getScenePack("free-brainstorming")!;
    const project = db.createProject({ title: "Claim recovery", goal: "", scenePack: scene });
    const snapshot = { version: 2 as const, canvasSessionId: "recoverable", workspaceDir: db.workspaceDir, projectId: project.id, scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: 0, viewId: project.defaultViewId, viewType: scene.defaultView, selectedNodeIds: [], selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, agentEligible: false, sequence: 7, updatedAt: new Date().toISOString() };
    db.syncCanvasContext(snapshot);

    const claimed = db.syncCanvasContext({ ...snapshot, syncPurpose: "claim", sequence: 1 });

    expect(claimed.sequence).toBe(8);
    expect(db.getCanvasContext("recoverable")?.sequence).toBe(8);
    expect(() => db.syncCanvasContext({ ...snapshot, syncPurpose: "state", sequence: 2 })).toThrow("STALE_CANVAS_SEQUENCE");
    db.close();
  });

  it("claims a Canvas session without overwriting its saved viewport", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.createProject({ title: "Claim", goal: "", scenePack: scene });
    const chatSessionKey = createHash("sha256").update("claim-chat").digest("hex");
    const binding = db.openChatCanvasBinding({ chatSessionKey, projectId: project.id, viewId: project.defaultViewId });
    db.saveCanvasViewState({ canvasSessionId: "claim-session", viewId: project.defaultViewId, viewport: { x: 50, y: 60, zoom: .8 }, selectedNodeIds: ["kept"], lastOpenedAt: new Date().toISOString() });
    const timestamp = new Date().toISOString();
    const base = { version: 2 as const, canvasSessionId: "claim-session", workspaceDir: db.workspaceDir, projectId: project.id, scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: 0, viewId: project.defaultViewId, viewType: scene.defaultView, selectedNodeIds: [], selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], presence: { visible: true, focused: true, lastSeenAt: timestamp }, chatBinding: { leaseId: binding.leaseId, bindingRevision: binding.bindingRevision }, agentEligible: true, updatedAt: timestamp };
    db.syncCanvasContext({ ...base, syncPurpose: "claim", viewport: { x: 0, y: 0, zoom: 1 }, sequence: 1 }, chatSessionKey);
    expect(db.getCanvasViewState("claim-session", project.defaultViewId)).toMatchObject({ viewport: { x: 50, y: 60, zoom: .8 }, selectedNodeIds: ["kept"] });
    const later = new Date(Date.parse(timestamp) + 1).toISOString();
    db.syncCanvasContext({ ...base, syncPurpose: "state", viewport: { x: 10, y: 20, zoom: .7 }, selectedNodeIds: ["saved"], presence: { visible: true, focused: true, lastSeenAt: later }, updatedAt: later, sequence: 2 }, chatSessionKey);
    expect(db.getCanvasViewState("claim-session", project.defaultViewId)).toMatchObject({ viewport: { x: 10, y: 20, zoom: .7 }, selectedNodeIds: ["saved"] });
    db.close();
  });

  it("stores independent layouts for multiple views", () => {
    const db = store();
    const scene = getScenePack("free-brainstorming")!;
    const project = db.createProject({ title: "Test", goal: "Map ideas", scenePack: scene });
    const graphView = db.ensureView({ projectId: project.id, viewId: "graph-default", viewType: "graph", strategy: "force" });
    graphView.layoutRevision = 3;
    db.saveLayout(graphView);
    expect(db.getLayout(project.id, project.defaultViewId)?.layoutRevision).toBe(0);
    expect(db.getLayout(project.id, "graph-default")?.layoutRevision).toBe(3);
    expect(db.listLayouts(project.id)).toHaveLength(2);
    db.close();
  });

  it("seeds a connected graph view semantically instead of a flat grid", () => {
    const db = store();
    const scene = getScenePack("free-brainstorming")!;
    const project = db.createProject({ title: "Robot", goal: "", scenePack: scene });
    const ts = new Date().toISOString();
    const node = (id: string, layer: string) => ({ id, projectId: project.id, type: "idea", title: id, body: "", contentKind: "document" as const, content: { kind: "document" as const, mode: "note" as const, markdown: "", excerpt: "", embeddedAssetIds: [] }, properties: { layer }, archived: false, createdAt: ts, updatedAt: ts });
    const edge = (id: string, s: string, t: string) => ({ id, projectId: project.id, type: "relates-to", sourceNodeId: s, targetNodeId: t, directed: true, properties: {}, archived: false, createdAt: ts, updatedAt: ts });
    db.replaceGraph({ projectId: project.id, revision: 1, nodes: [node("hub", "总览"), node("a1", "赛道"), node("a2", "赛道"), node("b1", "产业链"), node("b2", "产业链")], edges: [edge("e1", "hub", "a1"), edge("e2", "hub", "a2"), edge("e3", "hub", "b1"), edge("e4", "hub", "b2")] });

    const view = db.ensureView({ projectId: project.id, viewId: "graph-fresh", viewType: "graph", strategy: "cluster" });
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
    const project = db.createProject({ title: "Sparse", goal: "", scenePack: scene });
    const ts = new Date().toISOString();
    const node = (id: string) => ({ id, projectId: project.id, type: "idea", title: id, body: "", contentKind: "document" as const, content: { kind: "document" as const, mode: "note" as const, markdown: "", excerpt: "", embeddedAssetIds: [] }, properties: {}, archived: false, createdAt: ts, updatedAt: ts });
    db.replaceGraph({ projectId: project.id, revision: 1, nodes: [node("n1"), node("n2"), node("n3"), node("n4"), node("n5")], edges: [] });

    const view = db.ensureView({ projectId: project.id, viewId: "graph-grid", viewType: "graph", strategy: "cluster" });
    expect(Object.keys(view.groups)).toHaveLength(0);
    expect(view.nodes.n2).toMatchObject({ x: 292, y: 0 });
    expect(view.nodes.n5).toMatchObject({ x: 0, y: 176 });
    db.close();
  });

  it("creates a project atomically from a visual template", () => {
    const db = store(); const scene = getScenePack("problem-decomposition")!; const template = getVisualTemplate("logic-tree")!;
    const chatSessionKey = createHash("sha256").update("template-chat").digest("hex");
    const created = db.createProjectFromVisualTemplate({ title: "Decompose", goal: "Understand a problem", scenePack: scene, template, chatBinding: { chatSessionKey } });
    expect(created.project).toMatchObject({ graphRevision: 1, createdFromTemplate: { id: "logic-tree", version: "1.0.0" } });
    expect(created.graph.nodes.length).toBeGreaterThan(1); expect(created.graph.edges.length).toBeGreaterThan(0);
    expect(created.layout).toMatchObject({ layoutRevision: 1, viewName: "逻辑拆解树", templateRef: { id: "logic-tree", version: "1.0.0" }, projection: { kind: "tree" } });
    expect(created.binding).toMatchObject({ projectId: created.project.id, viewId: created.project.defaultViewId, status: "opening" });
    db.close();
  });

  it("creates multiple same-type template views without changing graph", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!; const project = db.createProject({ title: "Views", goal: "", scenePack: scene });
    const template = getVisualTemplate("blank-canvas")!;
    const first = db.createViewFromVisualTemplate({ projectId: project.id, template, baseGraphRevision: 0, viewName: "Workshop" });
    const second = db.createViewFromVisualTemplate({ projectId: project.id, template, baseGraphRevision: 0, viewName: "Workshop" });
    expect(first.viewId).not.toBe(second.viewId); expect(second.viewName).toBe("Workshop 2"); expect(db.getProject(project.id)?.graphRevision).toBe(0);
    expect(db.listProjectEvents(project.id).some((event) => event.kind === "view.created")).toBe(true);
    expect(() => db.createViewFromVisualTemplate({ projectId: project.id, template, baseGraphRevision: 1 })).toThrow("GRAPH_REVISION_CONFLICT");
    db.close();
  });

  it("materializes matrix quadrants as view-only groups", () => {
    const db = store(); const scene = getScenePack("decision-comparison")!; const template = getVisualTemplate("swot-matrix")!;
    const created = db.createProjectFromVisualTemplate({ title: "SWOT", goal: "Compare a decision", scenePack: scene, template });
    expect(Object.keys(created.layout.groups)).toEqual(expect.arrayContaining(["quadrant:优势", "quadrant:劣势", "quadrant:机会", "quadrant:威胁"]));
    expect(created.layout.projection.kind).toBe("matrix"); expect(created.project.graphRevision).toBe(1);
    db.close();
  });

  it("migrates legacy body nodes into document content without changing graph revision", () => {
    const db = store();
    const scene = getScenePack("free-brainstorming")!;
    const project = db.createProject({ title: "Legacy", goal: "", scenePack: scene });
    const timestamp = new Date().toISOString();
    db.db.prepare("INSERT INTO node(id, project_id, data) VALUES (?, ?, ?)").run("legacy", project.id, JSON.stringify({ id: "legacy", projectId: project.id, type: "idea", title: "Old note", body: "# Kept markdown", properties: {}, archived: false, createdAt: timestamp, updatedAt: timestamp }));
    const workspaceDir = db.workspaceDir;
    db.close();
    const reopened = new WorkspaceStore(workspaceDir);
    const node = reopened.getGraph(project.id).nodes[0];
    expect(node.contentKind).toBe("document");
    expect(node.content).toMatchObject({ kind: "document", markdown: "# Kept markdown" });
    expect(reopened.getProject(project.id)?.graphRevision).toBe(0);
    reopened.close();
  });

  it("migrates legacy canvas contexts to unbound and cancels legacy active tasks", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.createProject({ title: "Legacy task", goal: "", scenePack: scene });
    const timestamp = new Date().toISOString();
    const legacyContext = { version: 1, canvasSessionId: "legacy-canvas", workspaceDir: db.workspaceDir, projectId: project.id, scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: 0, viewId: project.defaultViewId, viewType: scene.defaultView, selectedNodeIds: [], selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, sequence: 1, updatedAt: timestamp };
    const legacyTask = { taskId: "legacy-task", canvasSessionId: "legacy-canvas", workspaceDir: db.workspaceDir, projectId: project.id, actionKey: "develop_selection", selectedNodeIds: [], selectedEdgeIds: [], pinnedContextNodeIds: [], expectedGraphRevision: 0, contextResourceUri: "weaver://legacy", attachmentResourceUris: [], status: "running", createdAt: timestamp, updatedAt: timestamp };
    db.db.prepare("INSERT INTO canvas_session(id, project_id, sequence, data) VALUES (?, ?, ?, ?)").run("legacy-canvas", project.id, 1, JSON.stringify(legacyContext));
    db.db.prepare("INSERT INTO agent_task(id, project_id, data) VALUES (?, ?, ?)").run("legacy-task", project.id, JSON.stringify(legacyTask));
    const workspaceDir = db.workspaceDir; db.close();
    const reopened = new WorkspaceStore(workspaceDir);
    expect(reopened.getCanvasContext("legacy-canvas")).toMatchObject({ version: 2, agentEligible: false });
    expect(reopened.getAgentTask("legacy-task")).toMatchObject({ chatSessionKey: "legacy-unbound", bindingRevision: 0, status: "cancelled", error: { code: "LEGACY_TASK_UNBOUND" } });
    reopened.close();
  });

  it("deduplicates image bytes and keeps content and layout revisions independent", async () => {
    const db = store();
    const scene = getScenePack("free-brainstorming")!;
    const project = db.createProject({ title: "Media", goal: "", scenePack: scene });
    const png = await sharp({ create: { width: 120, height: 80, channels: 4, background: "#315cf6" } }).png().toBuffer();
    const first = await db.importImageAsset({ projectId: project.id, mimeType: "image/png", data: png });
    const second = await db.importImageAsset({ projectId: project.id, mimeType: "image/png", data: png });
    expect(second.asset.id).toBe(first.asset.id);
    expect(second.deduplicated).toBe(true);
    expect(db.getProject(project.id)?.graphRevision).toBe(0);
    const created = db.createContentNode({ projectId: project.id, viewId: project.defaultViewId, type: "idea", title: "Reference image", content: { kind: "image", assetId: first.asset.id, alt: "Blue", caption: "" }, x: 40, y: 60 });
    expect(created.project?.graphRevision).toBe(1);
    expect(created.layout.layoutRevision).toBe(1);
    const updated = db.updateNodeContent({ projectId: project.id, nodeId: created.node.id, baseGraphRevision: 1, title: "Updated image" });
    expect(updated.project?.graphRevision).toBe(2);
    expect(db.getLayout(project.id, project.defaultViewId)?.layoutRevision).toBe(1);
    db.close();
  });

  it("archives a node so a reload no longer resurrects it", async () => {
    const db = store();
    const scene = getScenePack("free-brainstorming")!;
    const project = db.createProject({ title: "Delete", goal: "", scenePack: scene });
    const png = await sharp({ create: { width: 60, height: 40, channels: 4, background: "#315cf6" } }).png().toBuffer();
    const asset = await db.importImageAsset({ projectId: project.id, mimeType: "image/png", data: png });
    const keep = db.createContentNode({ projectId: project.id, viewId: project.defaultViewId, type: "idea", title: "Keep", content: { kind: "image", assetId: asset.asset.id, alt: "", caption: "" }, x: 0, y: 0 });
    const remove = db.createContentNode({ projectId: project.id, viewId: project.defaultViewId, type: "idea", title: "Remove", content: { kind: "image", assetId: asset.asset.id, alt: "", caption: "" }, x: 100, y: 0 });
    const rev = db.getProject(project.id)!.graphRevision;
    const res = db.archiveNode({ projectId: project.id, nodeId: remove.node.id, baseGraphRevision: rev });
    expect(res.project?.graphRevision).toBe(rev + 1);
    const nodes = db.getGraph(project.id).nodes;
    expect(nodes.find((node) => node.id === remove.node.id)?.archived).toBe(true);
    expect(nodes.find((node) => node.id === keep.node.id)?.archived).toBe(false);
    expect(() => db.archiveNode({ projectId: project.id, nodeId: remove.node.id, baseGraphRevision: rev })).toThrow("GRAPH_REVISION_CONFLICT");
    expect(() => db.archiveNode({ projectId: project.id, nodeId: "nope", baseGraphRevision: rev + 1 })).toThrow("NODE_NOT_FOUND");
    db.close();
  });

  it("rejects agent content operations that reference unknown asset ids", () => {
    const db = store();
    const scene = getScenePack("free-brainstorming")!;
    const project = db.createProject({ title: "Guarded", goal: "", scenePack: scene });
    const timestamp = new Date().toISOString();
    db.db.prepare("INSERT INTO node(id, project_id, data) VALUES (?, ?, ?)").run("note", project.id, JSON.stringify({ id: "note", projectId: project.id, type: "idea", title: "Note", body: "", contentKind: "document", content: { kind: "document", mode: "note", markdown: "", excerpt: "", embeddedAssetIds: [] }, properties: {}, archived: false, createdAt: timestamp, updatedAt: timestamp }));
    const chatSessionKey = bindCanvas(db, project, scene, "unsafe-session", { selectedNodeIds: ["note"] });
    const task = db.prepareAgentTask({ canvasSessionId: "unsafe-session", actionKey: "develop_selection", chatSessionKey });
    dispatchAndStart(db, task);
    db.submitChangeSet({ id: "unsafe", taskId: task.taskId, projectId: project.id, baseGraphRevision: 0, baseLayoutRevisions: {}, graphOperations: [{ type: "set-node-content", nodeId: "note", content: { kind: "image", assetId: "/tmp/not-an-asset", alt: "", caption: "" } }], layoutOperations: [], rationale: "Try bypass", riskLevel: "high", status: "pending", createdAt: timestamp, updatedAt: timestamp });
    expect(() => db.applyChangeSet("unsafe")).toThrow("ASSET_NOT_FOUND_OR_CROSS_PROJECT");
    expect(db.getProject(project.id)?.graphRevision).toBe(0);
    db.close();
  });

  it("persists task and graph events with monotonic cursors", () => {
    const db = store();
    const scene = getScenePack("free-brainstorming")!;
    const project = db.createProject({ title: "Events", goal: "", scenePack: scene });
    const timestamp = new Date().toISOString();
    const chatSessionKey = bindCanvas(db, project, scene, "event-session");
    const task = db.prepareAgentTask({ canvasSessionId: "event-session", actionKey: "develop_selection", chatSessionKey });
    dispatchAndStart(db, task);
    db.submitChangeSet({ id: "event-change", taskId: task.taskId, projectId: project.id, baseGraphRevision: 0, baseLayoutRevisions: {}, graphOperations: [], layoutOperations: [], rationale: "No-op review", riskLevel: "low", status: "pending", createdAt: timestamp, updatedAt: timestamp });
    const events = db.listProjectEvents(project.id);
    expect(events.map((event) => event.sequence)).toEqual([...events.map((event) => event.sequence)].sort((a, b) => a - b));
    expect(events.filter((event) => event.kind === "task.updated")).toHaveLength(4);
    expect(db.getAgentTask(task.taskId)).toMatchObject({ status: "pending_review", taskRevision: 3, results: { changeSetId: "event-change" } });
    db.close();
  });

  it("applies mixed content atomically, projects new nodes, and requests the layout stage", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.createProject({ title: "Mixed", goal: "", scenePack: scene });
    const timestamp = new Date().toISOString();
    const chatSessionKey = bindCanvas(db, project, scene, "mixed-session");
    const task = db.prepareAgentTask({ canvasSessionId: "mixed-session", actionKey: "develop_then_layout", chatSessionKey });
    dispatchAndStart(db, task);
    db.submitChangeSet({ id: "mixed-change", taskId: task.taskId, projectId: project.id, baseGraphRevision: 0, baseLayoutRevisions: {}, graphOperations: [{ type: "add-node", node: { id: "agent-node", projectId: project.id, type: "idea", title: "Agent node", body: "", contentKind: "document", content: { kind: "document", mode: "note", markdown: "", excerpt: "", embeddedAssetIds: [] }, properties: {}, archived: false, createdAt: timestamp, updatedAt: timestamp } }], layoutOperations: [], rationale: "Add one idea", riskLevel: "low", status: "pending", createdAt: timestamp, updatedAt: timestamp });
    const applied = db.applyChangeSet("mixed-change");
    expect(applied.graphRevision).toBe(1);
    expect(db.getLayout(project.id, project.defaultViewId)?.nodes["agent-node"]).toBeTruthy();
    expect(db.getAgentTask(task.taskId)).toMatchObject({ status: "ready_to_continue", activeStage: "layout", expectedGraphRevision: 1 });
    expect(db.listProjectEvents(project.id).map((event) => event.kind)).toEqual(expect.arrayContaining(["graph.changed", "layout.changed", "task.updated"]));
    db.close();
  });

  it("serializes active canvas tasks and validates dispatch transitions", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.createProject({ title: "Dispatch", goal: "", scenePack: scene });
    const timestamp = new Date().toISOString();
    const chatSessionKey = bindCanvas(db, project, scene, "dispatch-session");
    const first = db.prepareAgentTask({ canvasSessionId: "dispatch-session", actionKey: "develop_selection", dispatchKey: "dispatch-1", chatSessionKey });
    expect(db.prepareAgentTask({ canvasSessionId: "dispatch-session", actionKey: "develop_selection", dispatchKey: "dispatch-1", chatSessionKey }).taskId).toBe(first.taskId);
    expect(() => db.prepareAgentTask({ canvasSessionId: "dispatch-session", actionKey: "layout_view", dispatchKey: "dispatch-2", chatSessionKey })).toThrow(`ACTIVE_CANVAS_TASK_EXISTS:${first.taskId}`);
    expect(() => db.updateAgentTask(first.taskId, { status: "running" })).toThrow("TASK_TRANSITION_INVALID:prepared->running");
    const dispatched = db.confirmAgentDispatch(first.taskId, "dispatch-1");
    expect(dispatched).toMatchObject({ status: "dispatched", dispatches: [{ state: "accepted" }] });
    expect(db.confirmAgentDispatch(first.taskId, "dispatch-1")).toMatchObject({ status: "dispatched" });
    db.updateAgentTask(first.taskId, { status: "cancelled" });
    expect(() => db.updateAgentTask(first.taskId, { status: "running" })).toThrow("TASK_TRANSITION_INVALID:cancelled->running");
    expect(() => db.submitChangeSet({ id: "late-write", taskId: first.taskId, projectId: project.id, baseGraphRevision: 0, baseLayoutRevisions: {}, graphOperations: [], layoutOperations: [], rationale: "Too late", riskLevel: "low", status: "pending", createdAt: timestamp, updatedAt: timestamp })).toThrow("TASK_TERMINAL:cancelled");
    db.close();
  });

  it("expires an abandoned prepared task before accepting a replacement", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.createProject({ title: "Expiry", goal: "", scenePack: scene }); const timestamp = new Date().toISOString();
    const chatSessionKey = bindCanvas(db, project, scene, "expiry-session");
    const abandoned = db.prepareAgentTask({ canvasSessionId: "expiry-session", actionKey: "develop_selection", dispatchKey: "abandoned", chatSessionKey });
    db.db.prepare("UPDATE agent_task SET data = json_set(data, '$.updatedAt', ?) WHERE id = ?").run(new Date(Date.now() - 121_000).toISOString(), abandoned.taskId);
    const replacement = db.prepareAgentTask({ canvasSessionId: "expiry-session", actionKey: "layout_view", dispatchKey: "replacement", chatSessionKey });
    expect(replacement.taskId).not.toBe(abandoned.taskId);
    expect(db.getAgentTask(abandoned.taskId)).toMatchObject({ status: "failed", error: { code: "PREPARED_TASK_EXPIRED" } });
    db.close();
  });

  it("claims a mixed-task continuation once", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.createProject({ title: "Continuation", goal: "", scenePack: scene });
    const timestamp = new Date().toISOString();
    const chatSessionKey = bindCanvas(db, project, scene, "continuation-session");
    const task = db.prepareAgentTask({ canvasSessionId: "continuation-session", actionKey: "develop_then_layout", dispatchKey: "content-dispatch", chatSessionKey }); dispatchAndStart(db, task);
    db.submitChangeSet({ id: "continue-change", taskId: task.taskId, projectId: project.id, baseGraphRevision: 0, baseLayoutRevisions: {}, graphOperations: [], layoutOperations: [], rationale: "Review", riskLevel: "low", status: "pending", createdAt: timestamp, updatedAt: timestamp });
    db.applyChangeSet("continue-change");
    const ready = db.getAgentTask(task.taskId)!;
    const claimed = db.beginAgentContinuation({ taskId: task.taskId, dispatchKey: "layout-dispatch", expectedTaskRevision: ready.taskRevision });
    expect(claimed).toMatchObject({ status: "prepared", activeStage: "layout" });
    expect(db.beginAgentContinuation({ taskId: task.taskId, dispatchKey: "layout-dispatch", expectedTaskRevision: ready.taskRevision }).taskRevision).toBe(claimed.taskRevision);
    expect(() => db.beginAgentContinuation({ taskId: task.taskId, dispatchKey: "other", expectedTaskRevision: ready.taskRevision })).toThrow("TASK_REVISION_CONFLICT");
    db.close();
  });

  it("isolates two Codex chats that open the same project", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.createProject({ title: "Shared graph", goal: "", scenePack: scene });
    const firstChat = bindCanvas(db, project, scene, "chat-a-canvas");
    const secondChat = bindCanvas(db, project, scene, "chat-b-canvas");
    const firstTask = db.prepareAgentTask({ canvasSessionId: "chat-a-canvas", actionKey: "develop_selection", chatSessionKey: firstChat });
    const secondTask = db.prepareAgentTask({ canvasSessionId: "chat-b-canvas", actionKey: "layout_view", chatSessionKey: secondChat });
    expect(firstTask.canvasSessionId).not.toBe(secondTask.canvasSessionId);
    expect(firstTask.chatSessionKey).not.toBe(secondTask.chatSessionKey);
    expect(() => db.assertTaskChat(firstTask.taskId, secondChat)).toThrow("TASK_CHAT_MISMATCH");
    expect(db.assertTaskChat(secondTask.taskId, secondChat).taskId).toBe(secondTask.taskId);
    db.close();
  });

  it("invalidates the old lease and pending task when a chat switches canvas", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const firstProject = db.createProject({ title: "First", goal: "", scenePack: scene });
    const secondProject = db.createProject({ title: "Second", goal: "", scenePack: scene });
    const chatSessionKey = bindCanvas(db, firstProject, scene, "rebound-canvas");
    const task = db.prepareAgentTask({ canvasSessionId: "rebound-canvas", actionKey: "develop_selection", chatSessionKey });
    dispatchAndStart(db, task);
    const current = db.getChatCanvasBinding(chatSessionKey)!;
    const switched = db.switchChatCanvasBinding({ chatSessionKey, leaseId: current.leaseId, bindingRevision: current.bindingRevision, projectId: secondProject.id, viewId: secondProject.defaultViewId });
    expect(switched).toMatchObject({ status: "opening", bindingRevision: current.bindingRevision + 1, projectId: secondProject.id });
    expect(db.getAgentTask(task.taskId)).toMatchObject({ status: "cancelled", error: { code: "CHAT_CANVAS_REBOUND" } });
    expect(() => db.switchChatCanvasBinding({ chatSessionKey, leaseId: current.leaseId, bindingRevision: current.bindingRevision, projectId: firstProject.id, viewId: firstProject.defaultViewId })).toThrow("CHAT_CANVAS_LEASE_STALE");
    expect(db.listProjectEvents(firstProject.id).some((event) => event.kind === "chat.binding.changed")).toBe(true);
    db.close();
  });

  it("fails closed for offline and browser-preview canvases", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.createProject({ title: "Presence", goal: "", scenePack: scene });
    const offlineChat = bindCanvas(db, project, scene, "offline-canvas", { lastSeenAt: new Date(Date.now() - 31_000).toISOString() });
    expect(() => db.getBoundCanvas(offlineChat, true)).toThrow("BOUND_CANVAS_OFFLINE");
    const timestamp = new Date().toISOString();
    db.syncCanvasContext({ version: 2, canvasSessionId: "browser-canvas", workspaceDir: db.workspaceDir, projectId: project.id, scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: 0, viewId: project.defaultViewId, viewType: scene.defaultView, selectedNodeIds: [], selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, agentEligible: false, sequence: 1, updatedAt: timestamp });
    expect(() => db.prepareAgentTask({ canvasSessionId: "browser-canvas", actionKey: "develop_selection", chatSessionKey: offlineChat })).toThrow("BROWSER_PREVIEW_AGENT_UNAVAILABLE");
    db.close();
  });

  it("keeps one online Canvas active and permits takeover after it goes offline", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.createProject({ title: "Single Canvas", goal: "", scenePack: scene });
    const chatSessionKey = createHash("sha256").update("single-canvas-chat").digest("hex");
    const binding = db.openChatCanvasBinding({ chatSessionKey, projectId: project.id, viewId: project.defaultViewId });
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
    db.syncCanvasContext(snapshot("canvas-a", 1, now), chatSessionKey);
    expect(() => db.syncCanvasContext(snapshot("canvas-b", 1, now), chatSessionKey)).toThrow("CANVAS_ALREADY_ACTIVE");
    expect(db.getChatCanvasBinding(chatSessionKey)).toMatchObject({ canvasSessionId: "canvas-a", status: "active" });

    const old = new Date(Date.now() - 31_000).toISOString();
    db.db.prepare("UPDATE canvas_session SET data = json_set(data, '$.presence.lastSeenAt', ?, '$.updatedAt', ?) WHERE id = ?").run(old, old, "canvas-a");
    db.syncCanvasContext(snapshot("canvas-b", 2, new Date().toISOString()), chatSessionKey);
    expect(db.getChatCanvasBinding(chatSessionKey)).toMatchObject({ canvasSessionId: "canvas-b", status: "active" });
    expect(db.listProjectEvents(project.id).some((event) => event.kind === "chat.binding.changed" && event.canvasSessionId === "canvas-a")).toBe(true);
    db.close();
  });

  it("lets an explicit claim take over an online Canvas (page refresh reclaims instantly)", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.createProject({ title: "Refresh reclaim", goal: "", scenePack: scene });
    const chatSessionKey = createHash("sha256").update("refresh-reclaim-chat").digest("hex");
    const binding = db.openChatCanvasBinding({ chatSessionKey, projectId: project.id, viewId: project.defaultViewId });
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
    db.syncCanvasContext(snapshot("canvas-old", 1, "claim", now), chatSessionKey);
    // The old session is still "online" (heartbeat just now), but a fresh page
    // load issues a `claim` and must take over rather than throw.
    db.syncCanvasContext(snapshot("canvas-new", 1, "claim", new Date().toISOString()), chatSessionKey);
    expect(db.getChatCanvasBinding(chatSessionKey)).toMatchObject({ canvasSessionId: "canvas-new", status: "active" });
    expect(db.listProjectEvents(project.id).some((event) => event.kind === "chat.binding.changed" && event.canvasSessionId === "canvas-old")).toBe(true);
    db.close();
  });

  it("opens the same active Project/View without rotating its lease", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.createProject({ title: "Idempotent open", goal: "", scenePack: scene });
    const chatSessionKey = bindCanvas(db, project, scene, "idempotent-canvas");
    const before = db.getChatCanvasBinding(chatSessionKey)!;
    const reopened = db.openChatCanvasBinding({ chatSessionKey, projectId: project.id, viewId: project.defaultViewId });
    expect(reopened).toEqual(before);
    expect(db.openChatCanvasBinding({ chatSessionKey })).toEqual(before);
    db.close();
  });

  it("creates one catalog entry for every persisted layout", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.createProject({ title: "Catalog", goal: "", scenePack: scene });
    db.ensureView({ projectId: project.id, viewId: "graph-default", viewType: "graph", strategy: "force" });
    const views = (db as any).listProjectViews(project.id);
    expect(views.map((view: any) => view.id)).toEqual(expect.arrayContaining([project.defaultViewId, "graph-default"]));
    expect(views.find((view: any) => view.id === project.defaultViewId)).toMatchObject({ status: "active", pinned: true });
    expect((db.getProject(project.id) as any).viewCatalogRevision).toBeGreaterThan(0);
    db.close();
  });

  it("records template metadata in the View catalog", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.createProject({ title: "Templates", goal: "", scenePack: scene });
    const template = getVisualTemplate("blank-canvas")!;
    const layout = db.createViewFromVisualTemplate({ projectId: project.id, template, baseGraphRevision: 0, viewName: "Workshop" });
    expect((db as any).getProjectView(project.id, layout.viewId)).toMatchObject({ id: layout.viewId, name: "Workshop", templateRef: { id: "blank-canvas", version: "1.0.0" }, createdBy: "template" });
    db.close();
  });

  it("renames and pins Views without changing graph or layout revisions", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.createProject({ title: "Metadata", goal: "", scenePack: scene });
    const graphView = db.ensureView({ projectId: project.id, viewId: "graph-default", viewType: "graph", strategy: "force" });
    const beforeCatalogRevision = Number((db.getProject(project.id) as any).viewCatalogRevision);
    const renamed = (db as any).renameProjectView({ projectId: project.id, viewId: graphView.viewId, name: "关系网络", baseCatalogRevision: beforeCatalogRevision });
    const pinned = (db as any).pinProjectView({ projectId: project.id, viewId: graphView.viewId, pinned: true, baseCatalogRevision: renamed.project.viewCatalogRevision });
    expect(pinned.view).toMatchObject({ name: "关系网络", pinned: true });
    expect(db.getProject(project.id)?.graphRevision).toBe(0);
    expect(db.getLayout(project.id, graphView.viewId)?.layoutRevision).toBe(0);
    expect(pinned.project.viewCatalogRevision).toBe(beforeCatalogRevision + 2);
    db.close();
  });

  it("moves a current default View to trash and atomically falls back", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.createProject({ title: "Trash", goal: "", scenePack: scene });
    const fallback = db.ensureView({ projectId: project.id, viewId: "graph-default", viewType: "graph", strategy: "force" });
    const chatSessionKey = bindCanvas(db, db.getProject(project.id)!, scene, "trash-canvas");
    const task = db.prepareAgentTask({ canvasSessionId: "trash-canvas", actionKey: "develop_selection", chatSessionKey }); dispatchAndStart(db, task);
    const before = db.getProject(project.id)!; const layoutRevision = db.getLayout(project.id, project.defaultViewId)!.layoutRevision;
    const trashed = (db as any).trashProjectView({ projectId: project.id, viewId: project.defaultViewId, fallbackViewId: fallback.viewId, baseCatalogRevision: (before as any).viewCatalogRevision });
    expect(trashed.view).toMatchObject({ status: "trashed" });
    expect(trashed.project.defaultViewId).toBe(fallback.viewId);
    expect(db.getChatCanvasBinding(chatSessionKey)).toMatchObject({ viewId: fallback.viewId, status: "opening" });
    expect(db.getAgentTask(task.taskId)).toMatchObject({ status: "cancelled", error: { code: "VIEW_TRASHED" } });
    expect(db.getLayout(project.id, project.defaultViewId)?.layoutRevision).toBe(layoutRevision);
    expect(db.getProject(project.id)?.graphRevision).toBe(0);
    db.close();
  });

  it("protects the last active View and supports restore then permanent purge", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.createProject({ title: "Recovery", goal: "", scenePack: scene });
    expect(() => (db as any).trashProjectView({ projectId: project.id, viewId: project.defaultViewId, baseCatalogRevision: (db.getProject(project.id) as any).viewCatalogRevision })).toThrow("LAST_ACTIVE_VIEW");
    const second = db.ensureView({ projectId: project.id, viewId: "graph-default", viewType: "graph", strategy: "force" });
    let revision = (db.getProject(project.id) as any).viewCatalogRevision;
    (db as any).trashProjectView({ projectId: project.id, viewId: second.viewId, baseCatalogRevision: revision });
    revision = (db.getProject(project.id) as any).viewCatalogRevision;
    expect((db as any).restoreProjectView({ projectId: project.id, viewId: second.viewId, baseCatalogRevision: revision }).view.status).toBe("active");
    revision = (db.getProject(project.id) as any).viewCatalogRevision;
    (db as any).trashProjectView({ projectId: project.id, viewId: second.viewId, baseCatalogRevision: revision });
    revision = (db.getProject(project.id) as any).viewCatalogRevision;
    (db as any).purgeProjectView({ projectId: project.id, viewId: second.viewId, baseCatalogRevision: revision });
    expect((db as any).getProjectView(project.id, second.viewId)).toBeNull();
    expect(db.getLayout(project.id, second.viewId)).toBeNull();
    db.close();
  });

  it("duplicates a View and persists independent per-session View state", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.createProject({ title: "Duplicate", goal: "", scenePack: scene });
    const source = db.getLayout(project.id, project.defaultViewId)!; source.nodes.example = { nodeId: "example", x: 120, y: 80, width: 220, height: 112, rotation: 0, zIndex: 0, pinned: false, hidden: false, collapsed: false }; db.saveLayout(source);
    const duplicated = (db as any).duplicateProjectView({ projectId: project.id, viewId: project.defaultViewId, name: "Canvas for presentation", baseCatalogRevision: (db.getProject(project.id) as any).viewCatalogRevision });
    expect(duplicated.view).toMatchObject({ name: "Canvas for presentation", pinned: false });
    expect(duplicated.layout.viewId).not.toBe(project.defaultViewId);
    expect(duplicated.layout.nodes.example).toMatchObject({ x: 120, y: 80 });
    const state = { canvasSessionId: "state-session", viewId: duplicated.view.id, viewport: { x: 40, y: 50, zoom: 1.4 }, selectedNodeIds: ["example"], focusedNodeId: "example", lastOpenedAt: new Date().toISOString() };
    (db as any).saveCanvasViewState(state);
    expect((db as any).getCanvasViewState("state-session", duplicated.view.id)).toMatchObject({ viewport: state.viewport, selectedNodeIds: ["example"] });
    db.close();
  });

  it("purges recycle-bin Views after their retention deadline", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.createProject({ title: "Retention", goal: "", scenePack: scene });
    const second = db.ensureView({ projectId: project.id, viewId: "graph-default", viewType: "graph", strategy: "force" });
    (db as any).trashProjectView({ projectId: project.id, viewId: second.viewId, baseCatalogRevision: (db.getProject(project.id) as any).viewCatalogRevision });
    const expired = { ...(db as any).getProjectView(project.id, second.viewId), purgeAfter: new Date(Date.now() - 1_000).toISOString() };
    db.db.prepare("UPDATE project_view SET data = ? WHERE id = ?").run(JSON.stringify(expired), second.viewId);
    const workspaceDir = db.workspaceDir; db.close();
    const reopened = new WorkspaceStore(workspaceDir);
    expect((reopened as any).getProjectView(project.id, second.viewId)).toBeNull();
    expect(reopened.getLayout(project.id, second.viewId)).toBeNull();
    reopened.close();
  });

});
