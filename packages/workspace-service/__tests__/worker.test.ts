import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceWorker } from "../src/worker.js";
import { getScenePack } from "@weaver/scene-packs";

const roots: string[] = [];
afterEach(() => { roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })); delete process.env.WEAVER_BRIDGE_GRACE_MS; });

async function launchSession(worker: WorkspaceWorker, chat = "a".repeat(64), projectId?: string) {
  const claimed = await fetch(worker.createLaunch({ chatSessionKey: chat, projectId }).launchUrl, { redirect: "manual" });
  expect(claimed.status, JSON.stringify(worker.getDiagnostics())).toBe(303);
  return claimed.headers.get("set-cookie")!.split(";")[0];
}

async function browserHeaders(origin: string, cookie: string) {
  const bootstrap = await fetch(`${origin}/api/bootstrap`, { headers: { cookie } }).then((response) => response.json()) as { csrfToken: string };
  return { cookie, origin, "x-weaver-csrf": bootstrap.csrfToken };
}

async function statusWithHost(origin: string, host: string) {
  return await new Promise<number>((resolve, reject) => {
    const target = new URL("/healthz", origin);
    const request = httpRequest(target, { headers: { host } }, (response) => { response.resume(); resolve(response.statusCode ?? 0); });
    request.once("error", reject);
    request.end();
  });
}

describe("workspace worker", () => {
  it("serves redacted health and a transport-independent project catalog read", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "weaver-worker-")); roots.push(workspaceDir);
    const worker = new WorkspaceWorker({ workspaceDir, buildId: "test-build" });
    const origin = await worker.listen();
    const cookie = await launchSession(worker);

    const health = await fetch(`${origin}/healthz`).then((response) => response.json());
    expect(health).toEqual({ ok: true, state: "ready", buildId: "test-build", protocolVersion: 1 });
    expect(JSON.stringify(health)).not.toContain(workspaceDir);

    const catalog = await fetch(`${origin}/api/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", ...await browserHeaders(origin, cookie) },
      body: JSON.stringify({ operation: "catalog.listProjects", arguments: {} }),
    }).then((response) => response.json());
    expect(catalog).toEqual({ ok: true, result: [] });
    await worker.close();
  });

  it("rejects unknown application operations", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "weaver-worker-")); roots.push(workspaceDir);
    const worker = new WorkspaceWorker({ workspaceDir, buildId: "test-build" });
    const origin = await worker.listen();
    const cookie = await launchSession(worker);
    const response = await fetch(`${origin}/api/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", ...await browserHeaders(origin, cookie) },
      body: JSON.stringify({ operation: "storage.rawSql", arguments: {} }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: { code: "OPERATION_NOT_FOUND" } });

    const privileged = await fetch(`${origin}/api/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", ...await browserHeaders(origin, cookie) },
      body: JSON.stringify({ operation: "bridge.openNativeBinding", arguments: {} }),
    });
    expect(privileged.status).toBe(400);
    expect(await privileged.json()).toEqual({ ok: false, error: { code: "CHAT_PRINCIPAL_REQUIRED" } });
    await worker.close();
  });

  it("never accepts Agent-only operations from browser RPC even when the browser is paired", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "weaver-worker-")); roots.push(workspaceDir);
    const worker = new WorkspaceWorker({ workspaceDir, buildId: "test-build" });
    const origin = await worker.listen();
    const cookie = await launchSession(worker);
    const headers = { "content-type": "application/json", ...await browserHeaders(origin, cookie) };

    for (const operation of ["weaver_prepare_task", "weaver_task_action", "weaver_submit_changeset", "weaver_recommend_layout", "weaver_publish_artifact"]) {
      const response = await fetch(`${origin}/api/rpc`, {
        method: "POST",
        headers,
        body: JSON.stringify({ operation, arguments: {} }),
      });
      expect(response.status, operation).toBe(400);
      expect(await response.json(), operation).toEqual({ ok: false, error: { code: "CHAT_PRINCIPAL_REQUIRED" } });
    }
    await worker.close();
  });

  it("requires the Project writer lease for browser catalog writes and audits the accepted mutation", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "weaver-worker-")); roots.push(workspaceDir);
    const worker = new WorkspaceWorker({ workspaceDir, buildId: "test-build" });
    const project = worker.store.catalog.createProject({ title: "Catalog", goal: "", scenePack: getScenePack("free-brainstorming")! });
    const origin = await worker.listen();
    const writerCookie = await launchSession(worker, "a".repeat(64), project.id);
    const readerCookie = await launchSession(worker, "b".repeat(64), project.id);
    const arguments_ = { action: "rename_view", projectId: project.id, viewId: project.defaultViewId, name: "Renamed", baseCatalogRevision: project.viewCatalogRevision };

    const rejected = await fetch(`${origin}/api/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", ...await browserHeaders(origin, readerCookie) },
      body: JSON.stringify({ operation: "weaver_catalog_action", arguments: arguments_ }),
    });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toEqual({ ok: false, error: { code: "PROJECT_WRITER_LEASE_STALE" } });

    const accepted = await fetch(`${origin}/api/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", ...await browserHeaders(origin, writerCookie) },
      body: JSON.stringify({ operation: "weaver_catalog_action", arguments: { ...arguments_, mutationId: "catalog-mutation-1" } }),
    });
    expect(accepted.status).toBe(200);
    expect(worker.store.catalog.getView(project.id, project.defaultViewId)?.name).toBe("Renamed");
    expect(worker.store.canvasMutations.get("catalog-mutation-1")).toMatchObject({ projectId: project.id, browserSessionId: writerCookie.slice("weaver_session=".length).split(".")[0], kind: "view", status: "applied" });
    await worker.close();
  });

  it("requires the writer lease and records an audit entry for browser asset imports", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "weaver-worker-")); roots.push(workspaceDir);
    const worker = new WorkspaceWorker({ workspaceDir, buildId: "test-build" });
    const project = worker.store.catalog.createProject({ title: "Assets", goal: "", scenePack: getScenePack("free-brainstorming")! });
    const origin = await worker.listen();
    const writerCookie = await launchSession(worker, "a".repeat(64), project.id);
    const readerCookie = await launchSession(worker, "b".repeat(64), project.id);
    const arguments_ = { source: "svg", projectId: project.id, svg: '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>', mutationId: "asset-mutation-1" };

    const rejected = await fetch(`${origin}/api/rpc`, { method: "POST", headers: { "content-type": "application/json", ...await browserHeaders(origin, readerCookie) }, body: JSON.stringify({ operation: "weaver_import_asset", arguments: arguments_ }) });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toEqual({ ok: false, error: { code: "PROJECT_WRITER_LEASE_STALE" } });

    const accepted = await fetch(`${origin}/api/rpc`, { method: "POST", headers: { "content-type": "application/json", ...await browserHeaders(origin, writerCookie) }, body: JSON.stringify({ operation: "weaver_import_asset", arguments: arguments_ }) });
    const acceptedBody = await accepted.json();
    expect(accepted.status, JSON.stringify(acceptedBody)).toBe(200);
    expect(worker.store.canvasMutations.get("asset-mutation-1")).toMatchObject({ projectId: project.id, kind: "graph", status: "applied" });
    await worker.close();
  });

  it("rejects unbound and cross-Project Chat writes while allowing the active bound Canvas", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "weaver-worker-")); roots.push(workspaceDir);
    const worker = new WorkspaceWorker({ workspaceDir, buildId: "test-build" });
    await worker.listen();
    const scene = getScenePack("free-brainstorming")!;
    const first = worker.store.catalog.createProject({ title: "First", goal: "", scenePack: scene });
    const second = worker.store.catalog.createProject({ title: "Second", goal: "", scenePack: scene });
    const chatSessionKey = "9".repeat(64);
    const binding = worker.store.sessions.openBinding({ chatSessionKey, projectId: first.id, viewId: first.defaultViewId });
    const timestamp = new Date().toISOString();
    worker.store.sessions.syncCanvas({ version: 2, syncPurpose: "claim", canvasSessionId: "bound-canvas", workspaceDir, projectId: first.id, scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: 0, viewId: first.defaultViewId, viewType: scene.defaultView, selectedNodeIds: [], selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, presence: { visible: true, focused: true, lastSeenAt: timestamp }, chatBinding: { leaseId: binding.leaseId, bindingRevision: binding.bindingRevision }, agentEligible: true, sequence: 1, updatedAt: timestamp }, chatSessionKey);
    const create = (projectId: string, viewId: string) => worker.dispatchChatOperation(chatSessionKey, "weaver_canvas_action", { action: "create_node", projectId, viewId, semanticType: "idea", title: "Agent note", content: { kind: "document", mode: "note", markdown: "agent", excerpt: "agent", embeddedAssetIds: [] } });

    await expect(create(second.id, second.defaultViewId)).rejects.toThrow("CHAT_CANVAS_TARGET_MISMATCH");
    await expect(worker.dispatchChatOperation("8".repeat(64), "weaver_canvas_action", { action: "create_node", projectId: first.id, viewId: first.defaultViewId, semanticType: "idea", title: "Unbound", content: { kind: "document", mode: "note", markdown: "", excerpt: "", embeddedAssetIds: [] } })).rejects.toThrow("NO_CANVAS_BOUND_TO_CHAT");
    await expect(create(first.id, first.defaultViewId)).resolves.toMatchObject({ node: { title: "Agent note" } });
    await worker.close();
  });

  it("rejects DNS rebinding hosts and browser POSTs without exact Origin and CSRF", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "weaver-worker-")); roots.push(workspaceDir);
    const worker = new WorkspaceWorker({ workspaceDir, buildId: "test-build" });
    const origin = await worker.listen();
    const cookie = await launchSession(worker);
    const body = JSON.stringify({ operation: "catalog.listProjects", arguments: {} });

    expect(await statusWithHost(origin, "attacker.invalid")).toBe(421);
    expect((await fetch(`${origin}/api/rpc`, { method: "POST", headers: { "content-type": "application/json", cookie }, body })).status).toBe(403);
    const valid = await browserHeaders(origin, cookie);
    expect((await fetch(`${origin}/api/rpc`, { method: "POST", headers: { "content-type": "application/json", ...valid, origin: "http://attacker.invalid" }, body })).status).toBe(403);
    expect((await fetch(`${origin}/api/rpc`, { method: "POST", headers: { "content-type": "application/json", ...valid, "x-weaver-csrf": "forged" }, body })).status).toBe(403);
    expect((await fetch(`${origin}/api/rpc`, { method: "POST", headers: { "content-type": "application/json", ...valid }, body })).status).toBe(200);
    await worker.close();
  });

  it("consumes a short-lived launch once and bootstraps an authenticated browser session", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "weaver-worker-")); roots.push(workspaceDir);
    const worker = new WorkspaceWorker({ workspaceDir, buildId: "test-build" });
    const origin = await worker.listen();
    const launch = worker.createLaunch({ chatSessionKey: "a".repeat(64), projectId: "project-1" });
    expect(launch.launchUrl.startsWith(`${origin}/launch/`)).toBe(true);

    const claimed = await fetch(launch.launchUrl, { redirect: "manual" });
    expect(claimed.status, JSON.stringify(worker.getDiagnostics())).toBe(303);
    expect(claimed.headers.get("location")).toBe("/app/");
    const cookie = claimed.headers.get("set-cookie");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).not.toContain("a".repeat(64));

    const bootstrapResponse = await fetch(`${origin}/api/bootstrap`, { headers: { cookie: cookie!.split(";")[0] } });
    expect(bootstrapResponse.status).toBe(200);
    const bootstrap = await bootstrapResponse.json();
    expect(bootstrap).toMatchObject({
      protocolVersion: 1,
      buildId: "test-build",
      projectId: "project-1",
      capabilities: { manualWrite: true, agentConnected: true, agentWrite: true, canTakeOver: false },
      writerLease: { projectId: "project-1", revision: 1, status: "active" },
    });
    expect(bootstrap.csrfToken).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(bootstrap)).not.toContain("a".repeat(64));

    expect((await fetch(launch.launchUrl, { redirect: "manual" })).status).toBe(410);
    await worker.close();
  });

  it("creates an unpaired local Browser Session that can edit manually but cannot invoke Agent work", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "weaver-worker-")); roots.push(workspaceDir);
    const worker = new WorkspaceWorker({ workspaceDir, buildId: "test-build" });
    const project = worker.store.catalog.createProject({ title: "Local only", goal: "", scenePack: getScenePack("free-brainstorming")! });
    const origin = await worker.listen();
    const launch = worker.createLocalLaunch({ projectId: project.id, requestedViewId: project.defaultViewId });
    const claimed = await fetch(launch.launchUrl, { redirect: "manual" });
    const cookie = claimed.headers.get("set-cookie")!.split(";")[0];
    const bootstrap = await fetch(`${origin}/api/bootstrap`, { headers: { cookie } }).then((response) => response.json());
    expect(bootstrap).toMatchObject({
      projectId: project.id,
      viewId: project.defaultViewId,
      capabilities: { manualWrite: true, agentConnected: false, agentWrite: false },
    });
    expect(bootstrap.chatBinding).toBeUndefined();

    const create = await fetch(`${origin}/api/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", ...await browserHeaders(origin, cookie) },
      body: JSON.stringify({ operation: "weaver_canvas_action", arguments: { action: "create_node", projectId: project.id, viewId: project.defaultViewId, semanticType: "idea", title: "Offline note", content: { kind: "document", mode: "note", markdown: "offline", excerpt: "offline", embeddedAssetIds: [] } } }),
    });
    expect(create.status).toBe(200);
    expect(worker.store.graphChanges.read(project.id).nodes.some((node) => node.title === "Offline note")).toBe(true);

    const agent = await fetch(`${origin}/api/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", ...await browserHeaders(origin, cookie) },
      body: JSON.stringify({ operation: "weaver_prepare_task", arguments: { actionKey: "develop_selection" } }),
    });
    expect(agent.status).toBe(400);
    expect(await agent.json()).toEqual({ ok: false, error: { code: "CHAT_PRINCIPAL_REQUIRED" } });
    await worker.close();
  });

  it("keeps manual editing while bridge presence expires and restores Agent capability on heartbeat", async () => {
    process.env.WEAVER_BRIDGE_GRACE_MS = "1000";
    const workspaceDir = mkdtempSync(join(tmpdir(), "weaver-worker-")); roots.push(workspaceDir);
    const worker = new WorkspaceWorker({ workspaceDir, buildId: "test-build" });
    const origin = await worker.listen();
    const chatSessionKey = "c".repeat(64);
    const cookie = await launchSession(worker, chatSessionKey, "project-1");
    worker.heartbeatBridge(chatSessionKey);
    expect(await fetch(`${origin}/api/bootstrap`, { headers: { cookie } }).then((response) => response.json())).toMatchObject({ capabilities: { manualWrite: true, agentConnected: true, agentWrite: true } });
    await new Promise((resolve) => setTimeout(resolve, 1_050));
    expect(await fetch(`${origin}/api/bootstrap`, { headers: { cookie } }).then((response) => response.json())).toMatchObject({ capabilities: { manualWrite: true, agentConnected: false, agentWrite: false, disconnectReason: "AGENT_DISCONNECTED" } });
    worker.heartbeatBridge(chatSessionKey, "Claude");
    expect(await fetch(`${origin}/api/bootstrap`, { headers: { cookie } }).then((response) => response.json())).toMatchObject({ capabilities: { manualWrite: true, agentConnected: true, agentWrite: true, hostLabel: "Claude" } });
    await worker.close();
  });

  it("rejects bootstrap without a valid browser credential", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "weaver-worker-")); roots.push(workspaceDir);
    const worker = new WorkspaceWorker({ workspaceDir, buildId: "test-build" });
    const origin = await worker.listen();
    expect((await fetch(`${origin}/api/bootstrap`)).status).toBe(401);
    expect((await fetch(`${origin}/api/bootstrap`, { headers: { cookie: "weaver_session=forged" } })).status).toBe(401);
    await worker.close();
  });

  it("expires a timed-out browser session and releases its Project writer lease", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "weaver-worker-")); roots.push(workspaceDir);
    const worker = new WorkspaceWorker({ workspaceDir, buildId: "test-build" });
    const origin = await worker.listen();
    const cookie = await launchSession(worker, "a".repeat(64), "project-1");
    const sessionId = cookie.slice("weaver_session=".length).split(".")[0]!;
    const session = worker.store.browserSessions.get(sessionId)!;
    worker.store.db.prepare("UPDATE browser_session SET data = ? WHERE id = ?").run(
      JSON.stringify({ ...session, expiresAt: new Date(Date.now() - 1_000).toISOString() }),
      sessionId,
    );

    expect((await fetch(`${origin}/api/bootstrap`, { headers: { cookie } })).status).toBe(401);
    expect(worker.store.browserSessions.get(sessionId)).toMatchObject({ status: "expired" });
    expect(worker.store.browserSessions.writer("project-1")).toMatchObject({ status: "released", revision: 2 });
    await worker.close();
  });

  it("rotates refresh credentials and expires the session on replay", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "weaver-worker-")); roots.push(workspaceDir);
    const worker = new WorkspaceWorker({ workspaceDir, buildId: "test-build" });
    const origin = await worker.listen();
    const original = await launchSession(worker);
    const refreshed = await fetch(`${origin}/api/session/refresh`, { method: "POST", headers: await browserHeaders(origin, original) });
    expect(refreshed.status).toBe(200);
    const rotated = refreshed.headers.get("set-cookie")!.split(";")[0];
    expect(rotated).not.toBe(original);
    expect((await fetch(`${origin}/api/bootstrap`, { headers: { cookie: rotated } })).status).toBe(200);

    expect((await fetch(`${origin}/api/bootstrap`, { headers: { cookie: original } })).status).toBe(401);
    expect((await fetch(`${origin}/api/bootstrap`, { headers: { cookie: rotated } })).status).toBe(401);
    await worker.close();
  });

  it("opens a duplicate Project session read-only until explicit takeover", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "weaver-worker-")); roots.push(workspaceDir);
    const worker = new WorkspaceWorker({ workspaceDir, buildId: "test-build" });
    const origin = await worker.listen();
    const first = await launchSession(worker, "a".repeat(64), "project-1");
    const second = await launchSession(worker, "b".repeat(64), "project-1");
    expect(await fetch(`${origin}/api/bootstrap`, { headers: { cookie: first } }).then((response) => response.json())).toMatchObject({ capabilities: { manualWrite: true } });
    expect(await fetch(`${origin}/api/bootstrap`, { headers: { cookie: second } }).then((response) => response.json())).toMatchObject({ capabilities: { manualWrite: false, canTakeOver: true } });

    const takeover = await fetch(`${origin}/api/session/takeover`, {
      method: "POST",
      headers: { "content-type": "application/json", ...await browserHeaders(origin, second) },
      body: JSON.stringify({ projectId: "project-1", confirm: true }),
    });
    expect(takeover.status).toBe(200);
    expect(await takeover.json()).toMatchObject({ projectId: "project-1", revision: 2, status: "active" });
    const detached = await fetch(`${origin}/api/bootstrap`, { headers: { cookie: first } });
    expect(detached.status).toBe(200);
    expect(await detached.json()).toMatchObject({ browserSession: { status: "detached" }, capabilities: { manualWrite: false, agentConnected: false, agentWrite: false, canTakeOver: false, disconnectReason: "SESSION_TAKEN_OVER" } });
    const detachedHeaders = await browserHeaders(origin, first);
    expect((await fetch(`${origin}/api/rpc`, { method: "POST", headers: { "content-type": "application/json", ...detachedHeaders }, body: JSON.stringify({ operation: "catalog.listProjects", arguments: {} }) })).status).toBe(401);
    expect(await fetch(`${origin}/api/bootstrap`, { headers: { cookie: second } }).then((response) => response.json())).toMatchObject({ capabilities: { manualWrite: true } });
    await worker.close();
  });

  it("applies, deduplicates, audits and undoes a manual node mutation", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "weaver-worker-")); roots.push(workspaceDir);
    const worker = new WorkspaceWorker({ workspaceDir, buildId: "test-build" });
    const project = worker.store.catalog.createProject({ title: "Manual", goal: "Edit locally", scenePack: getScenePack("free-brainstorming")! });
    const origin = await worker.listen();
    const cookie = await launchSession(worker, "a".repeat(64), project.id);
    const request = {
      mutationId: "mutation-1",
      projectId: project.id,
      viewId: project.defaultViewId,
      writerLeaseRevision: 1,
      baseGraphRevision: 0,
      baseLayoutRevision: 0,
      operation: { action: "create_node", semanticType: "idea", title: "Local idea", content: { kind: "document", mode: "note", markdown: "body", excerpt: "body", embeddedAssetIds: [] }, x: 120, y: 80 },
    };
    const headers = await browserHeaders(origin, cookie);
    const mutate = () => fetch(`${origin}/api/rpc`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ operation: "canvas.mutate", arguments: request }) });
    const first = await mutate();
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true, result: { mutation: { id: "mutation-1", kind: "mixed", resultGraphRevision: 1, resultLayoutRevision: 1, status: "applied" } } });
    expect((await mutate()).status).toBe(200);
    expect(worker.store.graphChanges.read(project.id).revision).toBe(1);
    expect(worker.store.graphChanges.read(project.id).nodes.filter((node) => !node.archived)).toHaveLength(1);

    const undo = await fetch(`${origin}/api/rpc`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ operation: "canvas.undo", arguments: { mutationId: "mutation-1" } }) });
    expect(undo.status).toBe(200);
    expect(await undo.json()).toMatchObject({ ok: true, result: { mutation: { status: "reverted" }, graph: { revision: 2 } } });
    expect(worker.store.graphChanges.read(project.id).nodes.filter((node) => !node.archived)).toHaveLength(0);
    await worker.close();
  });

  it("undoes audited node, layout and catalog mutations without rolling revisions backward", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "weaver-worker-")); roots.push(workspaceDir);
    const worker = new WorkspaceWorker({ workspaceDir, buildId: "test-build" });
    const project = worker.store.catalog.createProject({ title: "Undo", goal: "", scenePack: getScenePack("free-brainstorming")! });
    const created = worker.store.graphChanges.createNode({
      projectId: project.id,
      viewId: project.defaultViewId,
      type: "idea",
      title: "Before",
      content: { kind: "document", mode: "note", markdown: "before", excerpt: "before", embeddedAssetIds: [] },
      x: 10,
      y: 20,
    });
    const origin = await worker.listen();
    const cookie = await launchSession(worker, "a".repeat(64), project.id);
    const headers = { "content-type": "application/json", ...await browserHeaders(origin, cookie) };
    const rpc = (operation: string, arguments_: Record<string, unknown>) => fetch(`${origin}/api/rpc`, { method: "POST", headers, body: JSON.stringify({ operation, arguments: arguments_ }) });

    const update = await rpc("weaver_canvas_action", { action: "update_node", mutationId: "update-undo", projectId: project.id, nodeId: created.node.id, baseGraphRevision: 1, title: "After" });
    expect(update.status).toBe(200);
    expect(worker.store.graphChanges.read(project.id).nodes.find((node) => node.id === created.node.id)?.title).toBe("After");
    expect((await rpc("canvas.undo", { mutationId: "update-undo" })).status).toBe(200);
    expect(worker.store.graphChanges.read(project.id).revision).toBe(3);
    expect(worker.store.graphChanges.read(project.id).nodes.find((node) => node.id === created.node.id)?.title).toBe("Before");

    const beforeLayout = worker.store.layoutReviews.get(project.id, project.defaultViewId)!;
    const layout = await rpc("weaver_canvas_action", {
      action: "layout_operations",
      mutationId: "layout-undo",
      projectId: project.id,
      viewId: project.defaultViewId,
      baseLayoutRevision: beforeLayout.layoutRevision,
      operations: [{ type: "set-node-frame", viewId: project.defaultViewId, nodeId: created.node.id, frame: { x: 400, y: 500, width: 280, height: 160 } }],
    });
    expect(layout.status).toBe(200);
    expect(worker.store.layoutReviews.get(project.id, project.defaultViewId)?.nodes[created.node.id]?.x).toBe(400);
    expect((await rpc("canvas.undo", { mutationId: "layout-undo" })).status).toBe(200);
    expect(worker.store.layoutReviews.get(project.id, project.defaultViewId)?.nodes[created.node.id]?.x).toBe(10);

    const currentProject = worker.store.catalog.getProject(project.id)!;
    const rename = await rpc("weaver_catalog_action", { action: "rename_view", mutationId: "catalog-undo", projectId: project.id, viewId: project.defaultViewId, name: "After rename", baseCatalogRevision: currentProject.viewCatalogRevision });
    expect(rename.status).toBe(200);
    const renamedRevision = worker.store.catalog.getProject(project.id)!.viewCatalogRevision;
    expect((await rpc("canvas.undo", { mutationId: "catalog-undo" })).status).toBe(200);
    expect(worker.store.catalog.getView(project.id, project.defaultViewId)?.name).not.toBe("After rename");
    expect(worker.store.catalog.getProject(project.id)!.viewCatalogRevision).toBe(renamedRevision + 1);
    await worker.close();
  });

  it("serves the authenticated canonical Canvas shell without exposing workspace or chat identity", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "weaver-worker-")); roots.push(workspaceDir);
    const worker = new WorkspaceWorker({ workspaceDir, buildId: "test-build" });
    const origin = await worker.listen();
    const cookie = await launchSession(worker);
    expect((await fetch(`${origin}/app/`)).status).toBe(401);
    const response = await fetch(`${origin}/app/`, { headers: { cookie } });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("window.__weaverRuntime");
    expect(html).toContain('buildId:"test-build"');
    expect(html).toContain("protocolVersion:1");
    expect(html).not.toContain(workspaceDir);
    expect(html).not.toContain("a".repeat(64));
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    await worker.close();
  });
});
