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

async function rpc(server: WeaverServer, name: string, args: Record<string, unknown>) {
  const response = await fetch(`${server.eventHub.origin}/mcp-rpc?token=${server.eventHub.previewToken}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, arguments: args }),
  });
  return { status: response.status, body: await response.json() as any };
}

describe("Claude agent loop — cross-transport identity convergence", () => {
  it("lets a browser (loopback RPC) claim the canvas that Claude (stdio dispatch) then writes to", async () => {
    process.env.WEAVER_HOST_KIND = "claude";
    const root = mkdtempSync(join(tmpdir(), "weaver-loop-")); roots.push(root); mkdirSync(root, { recursive: true });
    const scene = getScenePack("free-brainstorming")!;
    const store = new WorkspaceStore(root);
    const project = store.createProject({ title: "Loop", goal: "", scenePack: scene });
    store.close();

    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);

    // Claude (stdio side) opens the workspace, creating the binding under the synthetic key.
    const opened = await server.dispatch("weaver_open_workspace_widget", { workspaceDir: root, projectId: project.id }) as any;
    const lease = opened.structuredContent.chatBinding;
    expect(lease.projectId).toBe(project.id);

    // Browser (loopback RPC) claims the canvas as agent-eligible using that lease.
    const timestamp = new Date().toISOString();
    const snapshot = {
      version: 2, syncPurpose: "claim", canvasSessionId: "browser-canvas", workspaceDir: root, projectId: project.id,
      scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: 0, viewId: project.defaultViewId, viewType: scene.defaultView,
      selectedNodeIds: [], selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 },
      presence: { visible: true, focused: true, lastSeenAt: timestamp }, chatBinding: { leaseId: lease.leaseId, bindingRevision: lease.bindingRevision },
      agentEligible: true, sequence: 1, updatedAt: timestamp,
    };
    const claim = await rpc(server, "weaver_sync_canvas_context", { workspaceDir: root, snapshot });
    expect(claim.status).toBe(200);
    expect(claim.body.isError).toBeFalsy();
    expect(claim.body.structuredContent.bindingStatus).toBe("active");

    // A re-render/reload can replay a locally stale claim. The server owns the
    // monotonic sequence floor and returns the accepted value to the widget.
    const reclaimed = await rpc(server, "weaver_sync_canvas_context", { workspaceDir: root, snapshot });
    expect(reclaimed.status).toBe(200);
    expect(reclaimed.body.isError).toBeFalsy();
    expect(reclaimed.body.structuredContent.context.sequence).toBe(2);

    // Claude sees the online, agent-eligible canvas the browser is holding.
    const bound = await server.dispatch("weaver_get_bound_canvas", { workspaceDir: root }) as any;
    expect(bound.structuredContent).toMatchObject({ projectId: project.id, canvasSessionId: "browser-canvas", online: true });

    // Claude prepares (self-confirming dispatch), starts, submits and applies a ChangeSet.
    const prepared = await server.dispatch("weaver_prepare_task_from_active_canvas", { workspaceDir: root, actionKey: "develop_selection" }) as any;
    const taskId = prepared.structuredContent.taskId;
    await server.dispatch("weaver_start_agent_task", { workspaceDir: root, taskId });
    const changeSet = {
      id: "loop-cs", taskId, projectId: project.id, baseGraphRevision: 0, baseLayoutRevisions: {},
      graphOperations: [{ type: "add-node", node: { id: "loop-node", projectId: project.id, type: "idea", title: "From Claude", body: "", contentKind: "document", content: { kind: "document", mode: "note", markdown: "", excerpt: "", embeddedAssetIds: [] }, properties: {}, archived: false, createdAt: timestamp, updatedAt: timestamp } }],
      layoutOperations: [], rationale: "Add one idea", riskLevel: "low", status: "pending", createdAt: timestamp, updatedAt: timestamp,
    };
    const submitted = await server.dispatch("weaver_submit_changeset", { workspaceDir: root, changeSet }) as any;
    expect(submitted.isError).toBeFalsy();
    const applied = await server.dispatch("weaver_apply_changeset", { workspaceDir: root, changeSetId: "loop-cs" }) as any;
    expect(applied.structuredContent.graphRevision).toBe(1);

    // The write is visible in the shared store: the browser's project now has the new node + bumped revision.
    const verifyStore = new WorkspaceStore(root);
    try {
      expect(verifyStore.getProject(project.id)?.graphRevision).toBe(1);
      expect(verifyStore.getLayout(project.id, project.defaultViewId)?.nodes["loop-node"]).toBeTruthy();
    } finally {
      verifyStore.close();
    }
  });

  it("refuses an agent-eligible claim carrying a forged lease", async () => {
    process.env.WEAVER_HOST_KIND = "claude";
    const root = mkdtempSync(join(tmpdir(), "weaver-loop-")); roots.push(root); mkdirSync(root, { recursive: true });
    const scene = getScenePack("free-brainstorming")!;
    const store = new WorkspaceStore(root);
    const project = store.createProject({ title: "Forge", goal: "", scenePack: scene });
    store.close();
    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);
    await server.dispatch("weaver_open_workspace_widget", { workspaceDir: root, projectId: project.id });

    const timestamp = new Date().toISOString();
    const snapshot = {
      version: 2, syncPurpose: "claim", canvasSessionId: "rogue", workspaceDir: root, projectId: project.id,
      scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: 0, viewId: project.defaultViewId, viewType: scene.defaultView,
      selectedNodeIds: [], selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 },
      presence: { visible: true, focused: true, lastSeenAt: timestamp }, chatBinding: { leaseId: "f".repeat(64), bindingRevision: 999 },
      agentEligible: true, sequence: 1, updatedAt: timestamp,
    };
    const claim = await rpc(server, "weaver_sync_canvas_context", { workspaceDir: root, snapshot });
    expect(claim.body.isError).toBe(true);
    expect(claim.body.structuredContent.code).toBe("CHAT_CANVAS_LEASE_STALE");
  });
});
