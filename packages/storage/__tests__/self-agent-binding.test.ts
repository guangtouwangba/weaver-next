import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getScenePack } from "@weaver/scene-packs";
import { WorkspaceStore } from "../src/workspace-store.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function store() {
  const root = mkdtempSync(join(tmpdir(), "weaver-self-agent-")); roots.push(root); mkdirSync(root, { recursive: true });
  return new WorkspaceStore(root);
}

// The shape produced by the MCP synthetic identity (packages/mcp/src/session-identity.ts).
// The storage layer must treat it exactly like a Codex-derived key — it is opaque.
function syntheticKey(processId: string) {
  return createHash("sha256").update(`claude-session:${processId}`).digest("hex");
}

function bindAgentEligible(db: WorkspaceStore, project: { id: string; defaultViewId: string; graphRevision: number }, scene: NonNullable<ReturnType<typeof getScenePack>>, canvasSessionId: string, chatSessionKey: string, selectedNodeIds: string[] = []) {
  const binding = db.sessions.openBinding({ chatSessionKey, projectId: project.id, viewId: project.defaultViewId });
  const timestamp = new Date().toISOString();
  db.sessions.syncCanvas({ version: 2, canvasSessionId, workspaceDir: db.workspaceDir, projectId: project.id, scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: project.graphRevision, viewId: project.defaultViewId, viewType: scene.defaultView, selectedNodeIds, selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, presence: { visible: true, focused: true, lastSeenAt: timestamp }, chatBinding: { leaseId: binding.leaseId, bindingRevision: binding.bindingRevision }, agentEligible: true, sequence: 1, updatedAt: timestamp }, chatSessionKey);
  return binding;
}

describe("self-agent binding (Claude-as-agent over a synthetic session key)", () => {
  it("runs the full audited loop and only bumps graphRevision on content apply", () => {
    const db = store();
    const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "Self agent", goal: "", scenePack: scene, automationLevel: "cautious" });
    const k = syntheticKey("proc-1");
    bindAgentEligible(db, project, scene, "self-canvas", k);

    // The browser is online and agent-eligible under the synthetic key.
    const bound = db.sessions.boundCanvas(k, true);
    expect(bound.context.canvasSessionId).toBe("self-canvas");
    expect(bound.binding.status).toBe("active");

    // Claude self-drives: prepare + confirm dispatch, then run.
    const task = db.tasks.prepare({ canvasSessionId: "self-canvas", actionKey: "develop_selection", dispatchKey: "d-1", chatSessionKey: k });
    db.tasks.confirmDispatch(task.taskId, "d-1");
    db.tasks.update(task.taskId, { status: "running" });

    const timestamp = new Date().toISOString();
    db.graphChanges.submit({ id: "cs-1", taskId: task.taskId, projectId: project.id, baseGraphRevision: 0, baseLayoutRevisions: {}, graphOperations: [{ type: "add-node", node: { id: "n1", projectId: project.id, type: "idea", title: "From Claude", contentKind: "document", content: { kind: "document", mode: "note", markdown: "", excerpt: "", embeddedAssetIds: [] }, properties: {}, archived: false, createdAt: timestamp, updatedAt: timestamp } }], layoutOperations: [], rationale: "Add one idea", riskLevel: "low", status: "pending", createdAt: timestamp, updatedAt: timestamp });
    const applied = db.graphChanges.apply("cs-1");

    // Content apply bumps graphRevision exactly once.
    expect(applied.graphRevision).toBe(1);
    expect(db.catalog.getProject(project.id)?.graphRevision).toBe(1);
    expect(db.layoutReviews.get(project.id, project.defaultViewId)?.nodes["n1"]).toBeTruthy();

    // A later viewport/selection sync must NOT bump graphRevision.
    const later = new Date().toISOString();
    db.sessions.syncCanvas({ version: 2, canvasSessionId: "self-canvas", workspaceDir: db.workspaceDir, projectId: project.id, scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: 1, viewId: project.defaultViewId, viewType: scene.defaultView, selectedNodeIds: ["n1"], selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 120, y: 40, zoom: 1.5 }, presence: { visible: true, focused: true, lastSeenAt: later }, syncPurpose: "state", sequence: 5, updatedAt: later }, k);
    expect(db.catalog.getProject(project.id)?.graphRevision).toBe(1);

    // Events are visible for SSE replay.
    const kinds = db.sessions.listEvents(project.id).map((event) => event.kind);
    expect(kinds).toEqual(expect.arrayContaining(["graph.changed", "task.updated"]));

    db.close();
  });

  it("isolates tasks by session key — a different key cannot claim the task", () => {
    const db = store();
    const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "Isolation", goal: "", scenePack: scene });
    const k = syntheticKey("proc-A");
    bindAgentEligible(db, project, scene, "iso-canvas", k);
    const task = db.tasks.prepare({ canvasSessionId: "iso-canvas", actionKey: "develop_selection", dispatchKey: "d-1", chatSessionKey: k });

    expect(db.tasks.assertChat(task.taskId, k).taskId).toBe(task.taskId);
    expect(() => db.tasks.assertChat(task.taskId, syntheticKey("proc-B"))).toThrow("TASK_CHAT_MISMATCH");
    db.close();
  });

  it("rejects the audited loop when the canvas is offline", () => {
    const db = store();
    const scene = getScenePack("free-brainstorming")!;
    const project = db.catalog.createProject({ title: "Offline", goal: "", scenePack: scene });
    const k = syntheticKey("proc-off");
    const binding = db.sessions.openBinding({ chatSessionKey: k, projectId: project.id, viewId: project.defaultViewId });
    const stale = new Date(Date.now() - 10 * 60_000).toISOString();
    db.sessions.syncCanvas({ version: 2, canvasSessionId: "off-canvas", workspaceDir: db.workspaceDir, projectId: project.id, scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: 0, viewId: project.defaultViewId, viewType: scene.defaultView, selectedNodeIds: [], selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, presence: { visible: false, focused: false, lastSeenAt: stale }, chatBinding: { leaseId: binding.leaseId, bindingRevision: binding.bindingRevision }, agentEligible: true, sequence: 1, updatedAt: stale }, k);
    expect(() => db.sessions.boundCanvas(k, true)).toThrow("BOUND_CANVAS_OFFLINE");
    db.close();
  });
});
