import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getScenePack } from "@weaver/scene-packs";
import { WorkspaceStore } from "@weaver/storage";
import { createWeaverServer, type WeaverServer } from "../src/create-server.js";

const roots: string[] = [];
const servers: WeaverServer[] = [];
let priorHostKind: string | undefined;

beforeEach(() => {
  priorHostKind = process.env.WEAVER_HOST_KIND;
  // A defined host kind makes this a preview host, so the agent (stdio dispatch)
  // derives the deterministic process-synthetic chat session key that the
  // canvas binding below is opened under — assertTaskChat then converges.
  process.env.WEAVER_HOST_KIND = "claude";
});
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
  if (priorHostKind === undefined) delete process.env.WEAVER_HOST_KIND;
  else process.env.WEAVER_HOST_KIND = priorHostKind;
});

// The synthetic key both the binding and the tool derive from the launch cwd.
const syntheticChatSessionKey = () =>
  createHash("sha256").update(`weaver-launch:${process.cwd()}`).digest("hex");

/** Drive a fresh workspace to a running, chat-bound task and return its id. */
function seedRunningTask(root: string) {
  const scene = getScenePack("free-brainstorming")!;
  const canvasSessionId = "progress-canvas";
  const store = new WorkspaceStore(root);
  try {
    const project = store.createProject({ title: "Progress", goal: "", scenePack: scene });
    const chatSessionKey = syntheticChatSessionKey();
    const binding = store.openChatCanvasBinding({ chatSessionKey, projectId: project.id, viewId: project.defaultViewId });
    const timestamp = new Date().toISOString();
    store.syncCanvasContext({ version: 2, canvasSessionId, workspaceDir: root, projectId: project.id, scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: 0, viewId: project.defaultViewId, viewType: scene.defaultView, selectedNodeIds: [], selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, presence: { visible: true, focused: true, lastSeenAt: timestamp }, chatBinding: { leaseId: binding.leaseId, bindingRevision: binding.bindingRevision }, agentEligible: true, sequence: 1, updatedAt: timestamp }, chatSessionKey);
    const prepared = store.prepareAgentTask({ canvasSessionId, actionKey: "develop_selection", dispatchKey: "progress-1", chatSessionKey });
    const taskId = prepared.taskId;
    store.confirmAgentDispatch(taskId, "progress-1");
    store.updateAgentTask(taskId, { status: "running" });
    return taskId;
  } finally {
    store.close();
  }
}

describe("weaver_report_task_progress", () => {
  it("persists a one-line progress note on a running task", async () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-progress-")); roots.push(root); mkdirSync(root, { recursive: true });
    const taskId = seedRunningTask(root);

    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);
    const note = "已写入 12/32 个节点…";
    const reported = await server.dispatch("weaver_report_task_progress", { workspaceDir: root, taskId, note }) as any;
    expect(reported.isError).toBeFalsy();
    expect(reported.structuredContent.progressNote).toBe(note);

    // Durably persisted for the busy pill / reaper heartbeat.
    const verifyStore = new WorkspaceStore(root);
    try {
      expect(verifyStore.getAgentTask(taskId)?.progressNote).toBe(note);
    } finally {
      verifyStore.close();
    }
  });

  it("rejects a progress note on a non-running task", async () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-progress-")); roots.push(root); mkdirSync(root, { recursive: true });
    const taskId = seedRunningTask(root);

    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);
    await server.dispatch("weaver_complete_agent_task", { workspaceDir: root, taskId });

    const reported = await server.dispatch("weaver_report_task_progress", { workspaceDir: root, taskId, note: "too late" }) as any;
    expect(reported.isError).toBe(true);
    expect(reported.structuredContent.code).toBe("TASK_TERMINAL");
  });
});
