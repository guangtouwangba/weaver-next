import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { getScenePack } from "@weaver/scene-packs";
import { WorkspaceStore } from "@weaver/storage";
import { SseEventHub } from "../src/event-hub.js";

const roots: string[] = [];
const hubs: SseEventHub[] = [];
let prevRoot: string | undefined;
let prevMode: string | undefined;

afterEach(async () => {
  await Promise.all(hubs.splice(0).map((hub) => hub.close()));
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
  if (prevRoot === undefined) delete process.env.WEAVER_DEV_ROOT; else process.env.WEAVER_DEV_ROOT = prevRoot;
  if (prevMode === undefined) delete process.env.WEAVER_RUNTIME_MODE; else process.env.WEAVER_RUNTIME_MODE = prevMode;
});

function writeDist(root: string, jsName: string, jsBody: string) {
  const dist = join(root, "apps", "widget", "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), `<!doctype html><html><head></head><body><script src="./assets/${jsName}"></script></body></html>`);
  writeFileSync(join(dist, "assets", jsName), jsBody);
}

async function previewBundle(hub: SseEventHub) {
  const html = await (await fetch(`${hub.origin}/preview?token=${hub.previewToken}`)).text();
  const asset = html.match(/src="([^"]*assets\/[^"]+\.js)"/)?.[1];
  const buildId = html.match(/"buildId":"([^"]+)"/)?.[1];
  return { asset: asset!, buildId: buildId! };
}

describe("widget bundle serving survives a rebuild without an MCP restart", () => {
  it("pins /preview HTML and its assets to one buildId and picks up dev rebuilds", async () => {
    prevRoot = process.env.WEAVER_DEV_ROOT; prevMode = process.env.WEAVER_RUNTIME_MODE;
    const root = mkdtempSync(join(tmpdir(), "weaver-dist-")); roots.push(root);
    process.env.WEAVER_DEV_ROOT = root; process.env.WEAVER_RUNTIME_MODE = "development";
    writeDist(root, "index-aaa.js", "console.log('v1')");

    const hub = new SseEventHub(); hubs.push(hub); await hub.start();
    hub.configurePreview({ workspaceDir: root, chatSessionKey: "k", dispatch: async () => ({}), allowlist: new Set() });

    // v1: the asset the HTML references serves 200, and bootstrap agrees on the buildId.
    const v1 = await previewBundle(hub);
    expect((await fetch(v1.asset)).status).toBe(200);
    expect((await (await fetch(`${hub.origin}/api/bootstrap?token=${hub.previewToken}`)).json()).buildId).toBe(v1.buildId);

    // Rebuild: new filename + content => new buildId. Bump mtime so the dev path re-reads.
    writeDist(root, "index-bbb.js", "console.log('v2-changed')");
    const future = new Date(Date.now() + 5_000);
    utimesSync(join(root, "apps", "widget", "dist", "index.html"), future, future);

    const v2 = await previewBundle(hub);
    expect(v2.buildId).not.toBe(v1.buildId);              // dev picked up the rebuild, no restart
    expect(v2.asset).not.toBe(v1.asset);
    expect((await fetch(v2.asset)).status).toBe(200);      // new assets serve (no split-brain 404)
    expect((await fetch(v1.asset)).status).toBe(200);      // in-flight load of the old build still resolves
    expect((await (await fetch(`${hub.origin}/api/bootstrap?token=${hub.previewToken}`)).json()).buildId).toBe(v2.buildId);
  });

  it("pushes a widget.reload event to open streams when the dev bundle changes", async () => {
    prevRoot = process.env.WEAVER_DEV_ROOT; prevMode = process.env.WEAVER_RUNTIME_MODE;
    const root = mkdtempSync(join(tmpdir(), "weaver-reload-")); roots.push(root);
    process.env.WEAVER_DEV_ROOT = root; process.env.WEAVER_RUNTIME_MODE = "development";
    writeDist(root, "index-r1.js", "console.log('r1')");

    const scene = getScenePack("free-brainstorming")!;
    const store = new WorkspaceStore(root);
    const project = store.createProject({ title: "Reload", goal: "", scenePack: scene });
    const ts = new Date().toISOString();
    store.syncCanvasContext({ version: 2, canvasSessionId: "c1", workspaceDir: root, projectId: project.id, scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: 0, viewId: project.defaultViewId, viewType: scene.defaultView, selectedNodeIds: [], selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, presence: { visible: true, focused: true, lastSeenAt: ts }, agentEligible: false, sequence: 1, updatedAt: ts });
    store.close();

    const hub = new SseEventHub(); hubs.push(hub); await hub.start();
    const grant = hub.openStream({ workspaceDir: root, projectId: project.id, canvasSessionId: "c1" });
    const controller = new AbortController();
    const res = await fetch(grant.eventStreamUrl, { signal: controller.signal });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // Simulate a rebuild: new bundle content + bumped mtime triggers the dist watcher.
    setTimeout(() => {
      writeDist(root, "index-r2.js", "console.log('r2-changed')");
      const future = new Date(Date.now() + 5_000);
      utimesSync(join(root, "apps", "widget", "dist", "index.html"), future, future);
    }, 100);

    let buffer = "";
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline && !buffer.includes("event: widget.reload")) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }
    controller.abort();
    expect(buffer).toContain("event: widget.reload");
  });
});
