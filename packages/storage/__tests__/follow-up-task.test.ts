import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getScenePack } from "@weaver/scene-packs";
import { WorkspaceStore } from "../src/workspace-store.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("follow-up tasks", () => {
  it("captures one branch anchor and keeps the other selected nodes as explicit references", () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-follow-up-")); roots.push(root);
    const db = new WorkspaceStore(root);
    const scene = getScenePack("free-brainstorming")!;
    const project = db.createProject({ title: "Follow up", goal: "", scenePack: scene });
    const chatSessionKey = createHash("sha256").update("follow-up-chat").digest("hex");
    const binding = db.openChatCanvasBinding({ chatSessionKey, projectId: project.id, viewId: project.defaultViewId });
    const timestamp = new Date().toISOString();
    db.syncCanvasContext({ version: 2, canvasSessionId: "follow-up-canvas", workspaceDir: root, projectId: project.id, scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: 0, viewId: project.defaultViewId, viewType: scene.defaultView, focusedNodeId: "node-b", selectedNodeIds: ["node-a", "node-b", "node-c"], selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, presence: { visible: true, focused: true, lastSeenAt: timestamp }, chatBinding: { leaseId: binding.leaseId, bindingRevision: binding.bindingRevision }, agentEligible: true, sequence: 1, updatedAt: timestamp }, chatSessionKey);
    const task = db.prepareAgentTask({ canvasSessionId: "follow-up-canvas", actionKey: "follow_up_ask", userInstruction: "Compare these ideas", dispatchKey: "follow-up-1", chatSessionKey });
    expect(task).toMatchObject({ intent: "follow_up_ask", anchorNodeId: "node-b", referencedNodeIds: ["node-a", "node-c"], selectedNodeIds: ["node-a", "node-b", "node-c"] });
    expect(project.graphRevision).toBe(0);
    expect(db.getLayout(project.id, project.defaultViewId)?.layoutRevision).toBe(0);
    db.close();
  });
});
