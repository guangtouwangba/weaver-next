import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getScenePack } from "@weaver/scene-packs";
import { WorkspaceStore } from "@weaver/storage";
import { SseEventHub } from "../src/event-hub.js";

const roots: string[] = [];
const hubs: SseEventHub[] = [];
afterEach(async () => {
  await Promise.all(hubs.splice(0).map((hub) => hub.close()));
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "weaver-sse-"));
  roots.push(root); mkdirSync(root, { recursive: true });
  const store = new WorkspaceStore(root);
  const scene = getScenePack("free-brainstorming")!;
  const project = store.createProject({ title: "SSE", goal: "", scenePack: scene });
  const timestamp = new Date().toISOString();
  store.syncCanvasContext({ version: 1, canvasSessionId: "canvas-sse", workspaceDir: root, projectId: project.id, scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: 0, viewId: project.defaultViewId, viewType: scene.defaultView, selectedNodeIds: [], selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, presence: { visible: true, focused: true, lastSeenAt: timestamp }, sequence: 1, updatedAt: timestamp });
  return { root, store, project };
}

describe("SseEventHub", () => {
  it("binds to loopback and rejects an invalid token", async () => {
    const hub = new SseEventHub(); hubs.push(hub); await hub.start();
    expect(hub.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const response = await fetch(`${hub.origin}/events?token=invalid`);
    expect(response.status).toBe(401);
  });

  it("streams durable task events after the granted cursor", async () => {
    const { root, store, project } = fixture();
    const hub = new SseEventHub(); hubs.push(hub); await hub.start();
    const grant = hub.openStream({ workspaceDir: root, projectId: project.id, canvasSessionId: "canvas-sse" });
    const controller = new AbortController();
    const response = await fetch(grant.eventStreamUrl, { signal: controller.signal });
    expect(response.status).toBe(200);
    const task = store.prepareAgentTask({ canvasSessionId: "canvas-sse", actionKey: "develop_selection" });
    hub.notifyWorkspace(root);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    await Promise.race([
      (async () => {
        while (!text.includes(task.taskId)) {
          const chunk = await reader.read();
          if (chunk.done) break;
          text += decoder.decode(chunk.value, { stream: true });
        }
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("SSE event timeout")), 2_000)),
    ]);
    expect(text).toContain("event: task.updated");
    expect(text).toContain(task.taskId);
    controller.abort();
    store.close();
  });

  it("honors Last-Event-ID when reconnecting", async () => {
    const { root, store, project } = fixture();
    const hub = new SseEventHub(); hubs.push(hub); await hub.start();
    const grant = hub.openStream({ workspaceDir: root, projectId: project.id, canvasSessionId: "canvas-sse" });
    const first = store.prepareAgentTask({ canvasSessionId: "canvas-sse", actionKey: "develop_selection" });
    const firstSequence = store.getLatestEventSequence(project.id);
    const second = store.prepareAgentTask({ canvasSessionId: "canvas-sse", actionKey: "layout_view" });
    const controller = new AbortController();
    const response = await fetch(grant.eventStreamUrl, { headers: { "Last-Event-ID": String(firstSequence) }, signal: controller.signal });
    const reader = response.body!.getReader(); const decoder = new TextDecoder(); let text = "";
    await Promise.race([(async () => { while (!text.includes(second.taskId)) { const chunk = await reader.read(); if (chunk.done) break; text += decoder.decode(chunk.value, { stream: true }); } })(), new Promise((_, reject) => setTimeout(() => reject(new Error("SSE replay timeout")), 2_000))]);
    expect(text).toContain(second.taskId); expect(text).not.toContain(first.taskId);
    controller.abort(); store.close();
  });
});
