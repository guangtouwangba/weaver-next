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
  process.env.WEAVER_HOST_KIND = "claude";
});
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
  if (priorHostKind === undefined) delete process.env.WEAVER_HOST_KIND;
  else process.env.WEAVER_HOST_KIND = priorHostKind;
});

const syntheticChatSessionKey = () =>
  createHash("sha256").update(`weaver-launch:${process.cwd()}`).digest("hex");

/** Drive a fresh workspace to a running, chat-bound task on a bound canvas. */
function seedRunningTask(root: string) {
  const scene = getScenePack("free-brainstorming")!;
  const canvasSessionId = "session-canvas";
  const store = new WorkspaceStore(root);
  try {
    const project = store.catalog.createProject({ title: "Session", goal: "", scenePack: scene });
    const chatSessionKey = syntheticChatSessionKey();
    const binding = store.sessions.openBinding({ chatSessionKey, projectId: project.id, viewId: project.defaultViewId });
    const timestamp = new Date().toISOString();
    store.sessions.syncCanvas({ version: 2, canvasSessionId, workspaceDir: root, projectId: project.id, scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: 0, viewId: project.defaultViewId, viewType: scene.defaultView, selectedNodeIds: [], selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, presence: { visible: true, focused: true, lastSeenAt: timestamp }, chatBinding: { leaseId: binding.leaseId, bindingRevision: binding.bindingRevision }, agentEligible: true, sequence: 1, updatedAt: timestamp }, chatSessionKey);
    const prepared = store.tasks.prepare({ canvasSessionId, actionKey: "develop_selection", dispatchKey: "session-1", chatSessionKey });
    const taskId = prepared.taskId;
    store.tasks.confirmDispatch(taskId, "session-1");
    store.tasks.update(taskId, { status: "running" });
    return { taskId, canvasSessionId, projectId: project.id, viewId: project.defaultViewId };
  } finally {
    store.close();
  }
}

/** Seed a chat-bound running task under an ARBITRARY chatSessionKey (not the
 * process-synthetic one the dispatch harness resolves), to prove cross-chat auth. */
function seedTaskUnderChat(root: string, chatSessionKey: string, canvasSessionId: string) {
  const scene = getScenePack("free-brainstorming")!;
  const store = new WorkspaceStore(root);
  try {
    const project = store.catalog.createProject({ title: "Other", goal: "", scenePack: scene });
    const binding = store.sessions.openBinding({ chatSessionKey, projectId: project.id, viewId: project.defaultViewId });
    const timestamp = new Date().toISOString();
    store.sessions.syncCanvas({ version: 2, canvasSessionId, workspaceDir: root, projectId: project.id, scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: 0, viewId: project.defaultViewId, viewType: scene.defaultView, selectedNodeIds: [], selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, presence: { visible: true, focused: true, lastSeenAt: timestamp }, chatBinding: { leaseId: binding.leaseId, bindingRevision: binding.bindingRevision }, agentEligible: true, sequence: 1, updatedAt: timestamp }, chatSessionKey);
    const prepared = store.tasks.prepare({ canvasSessionId, actionKey: "develop_selection", dispatchKey: "other-1", chatSessionKey });
    store.tasks.confirmDispatch(prepared.taskId, "other-1");
    store.tasks.update(prepared.taskId, { status: "running" });
    return prepared.taskId;
  } finally {
    store.close();
  }
}

describe("weaver_read_session", () => {
  it("resolves bound_canvas from the chat binding", async () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-read-session-")); roots.push(root); mkdirSync(root, { recursive: true });
    const { canvasSessionId, projectId, viewId } = seedRunningTask(root);
    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);

    const bound = await server.dispatch("weaver_read_session", { workspaceDir: root, resource: "bound_canvas" }) as any;
    expect(bound.isError).toBeFalsy();
    expect(bound.structuredContent.projectId).toBe(projectId);
    expect(bound.structuredContent.viewId).toBe(viewId);
    expect(bound.structuredContent.canvasSessionId).toBe(canvasSessionId);
  });

  it("reads a chat-bound task by taskId", async () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-read-session-")); roots.push(root); mkdirSync(root, { recursive: true });
    const { taskId } = seedRunningTask(root);
    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);

    const task = await server.dispatch("weaver_read_session", { workspaceDir: root, resource: "task", taskId }) as any;
    expect(task.isError).toBeFalsy();
    expect(task.structuredContent.taskId).toBe(taskId);
    expect(task.structuredContent.status).toBe("running");

    const missing = await server.dispatch("weaver_read_session", { workspaceDir: root, resource: "task" }) as any;
    expect(missing.isError).toBe(true);
    expect(missing.structuredContent.code).toBe("INVALID_ARGS");
  });

  it("rejects a task belonging to a different chat binding", async () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-read-session-")); roots.push(root); mkdirSync(root, { recursive: true });
    // Task bound to a chat key the dispatch harness will NOT resolve (it always
    // resolves the process-synthetic key), so assertTaskChat must reject it —
    // proving the auth fold preserved chat-binding fidelity.
    const otherChatKey = createHash("sha256").update("weaver-other-chat").digest("hex");
    const taskId = seedTaskUnderChat(root, otherChatKey, "other-canvas");
    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);

    const rejected = await server.dispatch("weaver_read_session", { workspaceDir: root, resource: "task", taskId }) as any;
    expect(rejected.isError).toBe(true);
    expect(rejected.structuredContent.code).toBe("TASK_CHAT_MISMATCH");
  });

  it("reads the canvas_context snapshot", async () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-read-session-")); roots.push(root); mkdirSync(root, { recursive: true });
    const { canvasSessionId, projectId } = seedRunningTask(root);
    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);

    const context = await server.dispatch("weaver_read_session", { workspaceDir: root, resource: "canvas_context", canvasSessionId }) as any;
    expect(context.isError).toBeFalsy();
    expect(context.structuredContent.canvasSessionId).toBe(canvasSessionId);
    expect(context.structuredContent.projectId).toBe(projectId);

    const missing = await server.dispatch("weaver_read_session", { workspaceDir: root, resource: "canvas_context" }) as any;
    expect(missing.isError).toBe(true);
    expect(missing.structuredContent.code).toBe("INVALID_ARGS");
  });

  it("resolves the scene context for a canvas session", async () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-read-session-")); roots.push(root); mkdirSync(root, { recursive: true });
    const { canvasSessionId, projectId } = seedRunningTask(root);
    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);

    const resolved = await server.dispatch("weaver_read_session", { workspaceDir: root, resource: "resolved_context", canvasSessionId }) as any;
    expect(resolved.isError).toBeFalsy();
    expect(resolved.structuredContent.projectId).toBe(projectId);
    expect(resolved.structuredContent).toHaveProperty("nodeIds");
    expect(resolved.structuredContent).toHaveProperty("nodes");
    expect(resolved.structuredContent).toHaveProperty("policy");
    expect(resolved.structuredContent).toHaveProperty("graphRevision");

    const missing = await server.dispatch("weaver_read_session", { workspaceDir: root, resource: "resolved_context" }) as any;
    expect(missing.isError).toBe(true);
    expect(missing.structuredContent.code).toBe("INVALID_ARGS");
  });

  it("returns bound canvas and the active task together for guard", async () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-read-session-")); roots.push(root); mkdirSync(root, { recursive: true });
    const { taskId, projectId, canvasSessionId } = seedRunningTask(root);
    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);

    // Explicit taskId path.
    const guarded = await server.dispatch("weaver_read_session", { workspaceDir: root, resource: "guard", taskId }) as any;
    expect(guarded.isError).toBeFalsy();
    expect(guarded.structuredContent.boundCanvas.projectId).toBe(projectId);
    expect(guarded.structuredContent.boundCanvas.canvasSessionId).toBe(canvasSessionId);
    expect(guarded.structuredContent.task.taskId).toBe(taskId);

    // Active-task discovery path (no taskId supplied).
    const discovered = await server.dispatch("weaver_read_session", { workspaceDir: root, resource: "guard" }) as any;
    expect(discovered.isError).toBeFalsy();
    expect(discovered.structuredContent.task.taskId).toBe(taskId);
  });

  it("is model-facing while weaver_get_bound_canvas is not", async () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-read-session-")); roots.push(root); mkdirSync(root, { recursive: true });
    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);

    const diagnostics = await server.dispatch("weaver_get_diagnostics", {}) as any;
    const modelFacing: string[] = diagnostics.structuredContent.toolSurface.modelFacingNames;
    expect(modelFacing).toContain("weaver_read_session");
    expect(modelFacing).not.toContain("weaver_get_bound_canvas");
    // Folded-away tools are off the model surface entirely.
    expect(modelFacing).not.toContain("weaver_get_agent_task");
    expect(modelFacing).not.toContain("weaver_get_canvas_context");
    expect(modelFacing).not.toContain("weaver_resolve_context");
  });
});
