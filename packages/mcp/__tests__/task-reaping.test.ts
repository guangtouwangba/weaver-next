import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { getScenePack } from "@weaver/scene-packs";
import { WorkspaceStore } from "@weaver/storage";
import { createWeaverServer, type WeaverServer } from "../src/create-server.js";

const roots: string[] = [];
const servers: WeaverServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe("weaver_list_canvas_tasks reaping", () => {
  it("reaps an expired running task on recovery and returns an empty list", async () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-reap-")); roots.push(root); mkdirSync(root, { recursive: true });
    const scene = getScenePack("free-brainstorming")!;
    const canvasSessionId = "reap-canvas";

    // Drive the store directly to create + start a task, then age it into the past.
    const store = new WorkspaceStore(root);
    const project = store.createProject({ title: "Reap", goal: "", scenePack: scene });
    const chatSessionKey = createHash("sha256").update("reap-chat").digest("hex");
    const binding = store.openChatCanvasBinding({ chatSessionKey, projectId: project.id, viewId: project.defaultViewId });
    const timestamp = new Date().toISOString();
    store.syncCanvasContext({ version: 2, canvasSessionId, workspaceDir: root, projectId: project.id, scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: 0, viewId: project.defaultViewId, viewType: scene.defaultView, selectedNodeIds: [], selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, presence: { visible: true, focused: true, lastSeenAt: timestamp }, chatBinding: { leaseId: binding.leaseId, bindingRevision: binding.bindingRevision }, agentEligible: true, sequence: 1, updatedAt: timestamp }, chatSessionKey);
    const prepared = store.prepareAgentTask({ canvasSessionId, actionKey: "develop_selection", dispatchKey: "reap-1", chatSessionKey });
    const taskId = prepared.taskId;
    store.confirmAgentDispatch(taskId, "reap-1");
    store.updateAgentTask(taskId, { status: "running" });
    // Age the running task ~11 minutes into the past so the reaper considers it silent.
    store.db.prepare("UPDATE agent_task SET data = json_set(data, '$.updatedAt', ?) WHERE id = ?").run(new Date(Date.now() - 660_000).toISOString(), taskId);
    store.close();

    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);
    const listed = await server.dispatch("weaver_list_canvas_tasks", { workspaceDir: root, canvasSessionId }) as any;
    expect(listed.isError).toBeFalsy();
    expect(listed.structuredContent.items).toEqual([]);

    // The zombie is now durably failed with the running-timeout code.
    const verifyStore = new WorkspaceStore(root);
    try {
      const task = verifyStore.getAgentTask(taskId);
      expect(task?.status).toBe("failed");
      expect(task?.error?.code).toBe("AGENT_TASK_TIMEOUT");
    } finally {
      verifyStore.close();
    }
  });
});
