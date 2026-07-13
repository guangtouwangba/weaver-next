import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getScenePack } from "@weaver/scene-packs";
import { WorkspaceStore } from "@weaver/storage";
import { createWeaverServer, type WeaverServer } from "../src/create-server.js";

const roots: string[] = [];
const servers: WeaverServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  delete process.env.WEAVER_HOST_KIND;
  delete process.env.WEAVER_RUNTIME_ROOT;
  delete process.env.WEAVER_RUNTIME_IDLE_MS;
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe("MCP workspace-service read bridge", () => {
  it("returns the same Graph/Catalog operation results to Chat and browser principals", async () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-bridge-read-")); roots.push(root);
    const workspaceDir = join(root, "workspace");
    const runtimeRoot = join(root, "runtime");
    mkdirSync(workspaceDir);
    const store = new WorkspaceStore(workspaceDir);
    const scene = getScenePack("free-brainstorming")!;
    const project = store.catalog.createProject({ title: "Bridge reads", goal: "One operation authority", scenePack: scene });
    store.graphChanges.createNode({ projectId: project.id, viewId: project.defaultViewId, type: "idea", title: "Shared result", content: { kind: "document", mode: "note", markdown: "body", excerpt: "body", embeddedAssetIds: [] }, x: 0, y: 0 });
    store.close();

    process.env.WEAVER_HOST_KIND = "claude";
    process.env.WEAVER_RUNTIME_ROOT = runtimeRoot;
    process.env.WEAVER_RUNTIME_IDLE_MS = "1000";
    const server = await createWeaverServer({ previewWorkspaceDir: workspaceDir }); servers.push(server);

    const createdThroughBridge = await server.dispatch("weaver_catalog_action", { workspaceDir, action: "create_project", title: "Created through service", goal: "No MCP SQLite owner", scenePackId: "free-brainstorming" }) as any;
    expect(createdThroughBridge.isError).toBeFalsy();

    const opened = await server.dispatch("weaver_open_space", { workspaceDir, projectId: project.id }) as any;
    const launch = await fetch(opened.structuredContent.launchUrl, { redirect: "manual" });
    const cookie = launch.headers.get("set-cookie")!.split(";")[0];
    const origin = new URL(opened.structuredContent.launchUrl).origin;
    const bootstrap = await fetch(`${origin}/api/bootstrap`, { headers: { cookie } }).then((response) => response.json()) as { csrfToken: string; chatBinding: { leaseId: string; bindingRevision: number } };
    const browserCall = async (operation: string, args: Record<string, unknown>) => fetch(`${origin}/api/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin, "x-weaver-csrf": bootstrap.csrfToken },
      body: JSON.stringify({ operation, arguments: args }),
    }).then((response) => response.json()) as Promise<any>;
    const timestamp = new Date().toISOString();
    const claim = await browserCall("weaver_canvas_action", { action: "claim", snapshot: { version: 2, syncPurpose: "claim", canvasSessionId: "bridge-canvas", workspaceDir: "runtime", projectId: project.id, scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: 1, viewId: project.defaultViewId, viewType: scene.defaultView, selectedNodeIds: [], selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, presence: { visible: true, focused: true, lastSeenAt: timestamp }, chatBinding: bootstrap.chatBinding, agentEligible: true, sequence: 1, updatedAt: timestamp } });
    expect(claim).toMatchObject({ ok: true, result: { context: { canvasSessionId: "bridge-canvas" } } });

    const nodeThroughBridge = await server.dispatch("weaver_canvas_action", {
      workspaceDir, action: "create_node", projectId: project.id, viewId: project.defaultViewId,
      semanticType: "idea", title: "Created through Canvas bridge",
      content: { kind: "document", mode: "note", markdown: "service-owned", excerpt: "service-owned", embeddedAssetIds: [] }, x: 40, y: 80,
    }) as any;
    expect(nodeThroughBridge.isError).toBeFalsy();
    const chatCatalog = await server.dispatch("weaver_read_catalog", { workspaceDir, resource: "project.list" }) as any;
    const chatGraph = await server.dispatch("weaver_read_graph", { workspaceDir, resource: "full", projectId: project.id, viewId: project.defaultViewId }) as any;
    expect(chatCatalog.isError).toBeFalsy();
    expect(chatGraph.isError).toBeFalsy();

    const browserCatalog = await browserCall("weaver_read_catalog", { resource: "project.list" });
    const browserGraph = await browserCall("weaver_read_graph", { resource: "full", projectId: project.id, viewId: project.defaultViewId });

    expect(browserCatalog).toEqual({ ok: true, result: chatCatalog.structuredContent.items });
    expect(browserCatalog.result.map((item: { title: string }) => item.title)).toContain("Created through service");
    expect(browserGraph).toEqual({ ok: true, result: chatGraph.structuredContent });
    expect(browserGraph.result.nodes.map((node: { title: string }) => node.title)).toEqual(["Shared result", "Created through Canvas bridge"]);
  });
});
