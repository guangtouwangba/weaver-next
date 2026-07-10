import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { getScenePack } from "@weaver/scene-packs";
import { WorkspaceStore } from "../src/workspace-store.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function store() {
  const root = mkdtempSync(join(tmpdir(), "weaver-store-")); roots.push(root); mkdirSync(root, { recursive: true });
  return new WorkspaceStore(root);
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
    const snapshot = { version: 1 as const, canvasSessionId: "s", workspaceDir: db.workspaceDir, projectId: project.id, scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: 0, viewId: project.defaultViewId, viewType: scene.defaultView, selectedNodeIds: [], selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, sequence: 2, updatedAt: new Date().toISOString() };
    db.syncCanvasContext(snapshot);
    expect(() => db.syncCanvasContext({ ...snapshot, sequence: 1 })).toThrow("STALE_CANVAS_SEQUENCE");
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

  it("rejects agent content operations that reference unknown asset ids", () => {
    const db = store();
    const scene = getScenePack("free-brainstorming")!;
    const project = db.createProject({ title: "Guarded", goal: "", scenePack: scene });
    const timestamp = new Date().toISOString();
    db.db.prepare("INSERT INTO node(id, project_id, data) VALUES (?, ?, ?)").run("note", project.id, JSON.stringify({ id: "note", projectId: project.id, type: "idea", title: "Note", body: "", contentKind: "document", content: { kind: "document", mode: "note", markdown: "", excerpt: "", embeddedAssetIds: [] }, properties: {}, archived: false, createdAt: timestamp, updatedAt: timestamp }));
    db.syncCanvasContext({ version: 1, canvasSessionId: "unsafe-session", workspaceDir: db.workspaceDir, projectId: project.id, scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: 0, viewId: project.defaultViewId, viewType: scene.defaultView, selectedNodeIds: ["note"], selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, sequence: 1, updatedAt: timestamp });
    const task = db.prepareAgentTask({ canvasSessionId: "unsafe-session", actionKey: "develop_selection" });
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
    db.syncCanvasContext({ version: 1, canvasSessionId: "event-session", workspaceDir: db.workspaceDir, projectId: project.id, scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: 0, viewId: project.defaultViewId, viewType: scene.defaultView, selectedNodeIds: [], selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, presence: { visible: true, focused: true, lastSeenAt: timestamp }, sequence: 1, updatedAt: timestamp });
    const task = db.prepareAgentTask({ canvasSessionId: "event-session", actionKey: "develop_selection" });
    db.submitChangeSet({ id: "event-change", taskId: task.taskId, projectId: project.id, baseGraphRevision: 0, baseLayoutRevisions: {}, graphOperations: [], layoutOperations: [], rationale: "No-op review", riskLevel: "low", status: "pending", createdAt: timestamp, updatedAt: timestamp });
    const events = db.listProjectEvents(project.id);
    expect(events.map((event) => event.sequence)).toEqual([...events.map((event) => event.sequence)].sort((a, b) => a - b));
    expect(events.filter((event) => event.kind === "task.updated")).toHaveLength(2);
    expect(db.getAgentTask(task.taskId)).toMatchObject({ status: "pending_review", taskRevision: 1, results: { changeSetId: "event-change" } });
    db.close();
  });

  it("applies mixed content atomically, projects new nodes, and requests the layout stage", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.createProject({ title: "Mixed", goal: "", scenePack: scene });
    const timestamp = new Date().toISOString();
    db.syncCanvasContext({ version: 1, canvasSessionId: "mixed-session", workspaceDir: db.workspaceDir, projectId: project.id, scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: 0, viewId: project.defaultViewId, viewType: scene.defaultView, selectedNodeIds: [], selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, presence: { visible: true, focused: true, lastSeenAt: timestamp }, sequence: 1, updatedAt: timestamp });
    const task = db.prepareAgentTask({ canvasSessionId: "mixed-session", actionKey: "develop_then_layout" });
    db.submitChangeSet({ id: "mixed-change", taskId: task.taskId, projectId: project.id, baseGraphRevision: 0, baseLayoutRevisions: {}, graphOperations: [{ type: "add-node", node: { id: "agent-node", projectId: project.id, type: "idea", title: "Agent node", body: "", contentKind: "document", content: { kind: "document", mode: "note", markdown: "", excerpt: "", embeddedAssetIds: [] }, properties: {}, archived: false, createdAt: timestamp, updatedAt: timestamp } }], layoutOperations: [], rationale: "Add one idea", riskLevel: "low", status: "pending", createdAt: timestamp, updatedAt: timestamp });
    const applied = db.applyChangeSet("mixed-change");
    expect(applied.graphRevision).toBe(1);
    expect(db.getLayout(project.id, project.defaultViewId)?.nodes["agent-node"]).toBeTruthy();
    expect(db.getAgentTask(task.taskId)).toMatchObject({ status: "ready_to_continue", activeStage: "layout", expectedGraphRevision: 1 });
    expect(db.listProjectEvents(project.id).map((event) => event.kind)).toEqual(expect.arrayContaining(["graph.changed", "layout.changed", "task.updated"]));
    db.close();
  });

  it("resolves a uniquely focused recent canvas and rejects ambiguity", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.createProject({ title: "Presence", goal: "", scenePack: scene });
    const timestamp = new Date().toISOString();
    const snapshot = (canvasSessionId: string, focused: boolean, sequence: number) => ({ version: 1 as const, canvasSessionId, workspaceDir: db.workspaceDir, projectId: project.id, scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: 0, viewId: project.defaultViewId, viewType: scene.defaultView, selectedNodeIds: [], selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, presence: { visible: true, focused, lastSeenAt: timestamp }, sequence, updatedAt: timestamp });
    db.syncCanvasContext(snapshot("focused", true, 1)); db.syncCanvasContext(snapshot("background", false, 1));
    expect(db.resolveActiveCanvas().canvasSessionId).toBe("focused");
    db.syncCanvasContext(snapshot("also-focused", true, 1));
    expect(() => db.resolveActiveCanvas()).toThrow("AMBIGUOUS_ACTIVE_CANVAS");
    db.close();
  });
});
