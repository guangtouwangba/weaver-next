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
  delete process.env.WEAVER_HOST_KIND;
});

async function claudeCanvas() {
  process.env.WEAVER_HOST_KIND = "claude";
  const root = mkdtempSync(join(tmpdir(), "weaver-prompt-")); roots.push(root); mkdirSync(root, { recursive: true });
  const scene = getScenePack("free-brainstorming")!;
  const store = new WorkspaceStore(root);
  const project = store.createProject({ title: "Prompt", goal: "", scenePack: scene });
  store.close();
  const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);
  const opened = await server.dispatch("weaver_open_workspace_widget", { workspaceDir: root, projectId: project.id }) as any;
  const lease = opened.structuredContent.chatBinding;
  const ts = new Date().toISOString();
  await server.dispatch("weaver_sync_canvas_context", { workspaceDir: root, snapshot: { version: 2, syncPurpose: "claim", canvasSessionId: "browser", workspaceDir: root, projectId: project.id, scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: 0, viewId: project.defaultViewId, viewType: scene.defaultView, selectedNodeIds: ["node-a"], selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, presence: { visible: true, focused: true, lastSeenAt: ts }, chatBinding: { leaseId: lease.leaseId, bindingRevision: lease.bindingRevision }, agentEligible: true, sequence: 1, updatedAt: ts } });
  return { root, server, project };
}

describe("canvas prompts (canvas input -> terminal watch pickup)", () => {
  it("creates a dispatched task on submit and hands it to a waiting await immediately", async () => {
    const { root, server } = await claudeCanvas();
    const submitted = await server.dispatch("weaver_submit_canvas_prompt", { workspaceDir: root, instruction: "Compare these ideas", actionKey: "follow_up_ask" }) as any;
    expect(submitted.structuredContent).toMatchObject({ status: "dispatched", actionKey: "follow_up_ask" });
    const taskId = submitted.structuredContent.taskId;

    const picked = await server.dispatch("weaver_await_canvas_prompt", { workspaceDir: root, timeoutMs: 1000 }) as any;
    expect(picked.structuredContent.pending).toBe(true);
    expect(picked.structuredContent.task.taskId).toBe(taskId);
    expect(picked.structuredContent.task.userInstruction).toBe("Compare these ideas");
  });

  it("stops handing back a task once the agent starts it, and times out when nothing is pending", async () => {
    const { root, server } = await claudeCanvas();
    const submitted = await server.dispatch("weaver_submit_canvas_prompt", { workspaceDir: root, instruction: "Develop", actionKey: "develop_selection" }) as any;
    await server.dispatch("weaver_start_agent_task", { workspaceDir: root, taskId: submitted.structuredContent.taskId });
    const after = await server.dispatch("weaver_await_canvas_prompt", { workspaceDir: root, timeoutMs: 300 }) as any;
    expect(after.structuredContent.pending).toBe(false);
  });

  it("wakes a blocked await the instant a prompt is submitted", async () => {
    const { root, server } = await claudeCanvas();
    const awaiting = server.dispatch("weaver_await_canvas_prompt", { workspaceDir: root, timeoutMs: 5000 }) as Promise<any>;
    // Submit after the await is already blocking; it should return well before the 5s timeout.
    const submitted = await server.dispatch("weaver_submit_canvas_prompt", { workspaceDir: root, instruction: "Wake up", actionKey: "develop_selection" }) as any;
    const picked = await awaiting;
    expect(picked.structuredContent.pending).toBe(true);
    expect(picked.structuredContent.task.taskId).toBe(submitted.structuredContent.taskId);
  });
});
