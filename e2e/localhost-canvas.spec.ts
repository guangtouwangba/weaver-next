import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const nativeImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<any>;

function unwrapMcp(result: { isError?: boolean; structuredContent?: any }) {
  if (result.isError) throw new Error(result.structuredContent?.code ?? result.structuredContent?.message ?? "MCP_TOOL_FAILED");
  const value = result.structuredContent;
  return value && Object.keys(value).length === 1 && Array.isArray(value.items) ? value.items : value;
}

test("canonical localhost Canvas loads, edits, persists and explicitly transfers one Project writer", async ({ page, browser }, testInfo) => {
  const { WorkspaceWorker } = await nativeImport(pathToFileURL(resolve(process.cwd(), "packages/workspace-service/dist/index.js")).href);
  const { getScenePack } = await nativeImport(pathToFileURL(resolve(process.cwd(), "packages/scene-packs/dist/index.js")).href);
  const workspace = mkdtempSync(resolve(tmpdir(), "weaver-localhost-e2e-"));
  const worker = new WorkspaceWorker({ workspaceDir: workspace, buildId: "e2e-build" });
  const project = worker.store.catalog.createProject({ title: "Localhost Canvas", goal: "Prove the canonical runtime", scenePack: getScenePack("free-brainstorming")! });
  for (const [index, title] of ["Alpha", "Beta"].entries()) worker.store.graphChanges.createNode({ projectId: project.id, viewId: project.defaultViewId, type: "idea", title, content: { kind: "document", mode: "note", markdown: title, excerpt: title, embeddedAssetIds: [] }, x: index * 320, y: index * 80 });
  const origin = await worker.listen();
  const errors: string[] = [];
  const rpcLog: string[] = [];
  const fullGraphReads: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", async (response) => { if (response.url().endsWith("/api/rpc")) rpcLog.push(`${response.status()}:${await response.text().catch(() => "")}`); });
  page.on("request", (request) => {
    if (!request.url().endsWith("/api/rpc")) return;
    const body = request.postDataJSON() as { operation?: string; arguments?: { resource?: string } } | null;
    if (body?.operation === "weaver_read_graph" && body.arguments?.resource === "full") fullGraphReads.push(request.url());
  });
  try {
    const launch = worker.createLaunch({ chatSessionKey: "a".repeat(64), projectId: project.id, requestedViewId: project.defaultViewId });
    await page.goto(launch.launchUrl, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(`${origin}/app/`);
    await expect(page.getByRole("toolbar", { name: "Canvas tools" })).toBeVisible();
    await page.waitForTimeout(1_000);
    expect(await page.locator(".canvas-access-blocker").count(), JSON.stringify({ diagnostics: worker.getDiagnostics(), rpcLog })).toBe(0);
    await expect(page.locator(".weaver-dom-node")).toHaveCount(2);

    await page.getByRole("button", { name: "Note" }).click();
    const undoPane = page.locator(".hybrid-canvas");
    const undoBox = await undoPane.boundingBox();
    if (!undoBox) throw new Error("Canvas has no bounds for undo proof");
    await page.mouse.click(undoBox.x + undoBox.width - 180, undoBox.y + undoBox.height - 180);
    await expect(page.locator(".weaver-dom-node")).toHaveCount(3);
    await page.getByRole("button", { name: /close/i }).click();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator(".weaver-dom-node")).toHaveCount(2);

    const before = await page.locator(".weaver-dom-node").count();
    await page.getByRole("button", { name: "Note" }).click();
    const pane = page.locator(".hybrid-canvas");
    const box = await pane.boundingBox();
    if (!box) throw new Error("Canvas has no bounds");
    await page.mouse.click(box.x + box.width - 140, box.y + box.height - 140);
    await expect(page.locator(".weaver-dom-node")).toHaveCount(before + 1);
    await page.getByRole("textbox", { name: "Title" }).fill("Edited local note");
    await page.getByRole("textbox", { name: "Start with a thought. Markdown is stored as the source of truth." }).fill("Local edit persisted through the workspace service.");
    await page.getByRole("button", { name: "Save now" }).click();
    await expect(page.locator(".weaver-dom-node").filter({ hasText: "Edited local note" })).toHaveCount(1);
    await page.getByRole("button", { name: /close/i }).click();

    const graphBeforeLink = worker.store.graphChanges.read(project.id);
    const alphaId = graphBeforeLink.nodes.find((node) => node.title === "Alpha")!.id;
    const betaId = graphBeforeLink.nodes.find((node) => node.title === "Beta")!.id;
    const linkResult = await page.evaluate(async ({ projectId, alphaId, betaId, baseGraphRevision }) => {
      const bootstrap = await fetch("/api/bootstrap").then((response) => response.json()) as { csrfToken: string };
      const response = await fetch("/api/rpc", { method: "POST", headers: { "content-type": "application/json", "x-weaver-csrf": bootstrap.csrfToken }, body: JSON.stringify({ operation: "weaver_canvas_action", arguments: { workspaceDir: "runtime", action: "link_nodes", mutationId: crypto.randomUUID(), projectId, sourceNodeId: alphaId, targetNodeId: betaId, edgeType: "association", baseGraphRevision } }) });
      return response.json();
    }, { projectId: project.id, alphaId, betaId, baseGraphRevision: graphBeforeLink.revision });
    expect(linkResult).toMatchObject({ ok: true, result: { created: true } });
    expect(worker.store.graphChanges.read(project.id).edges.filter((edge) => !edge.archived)).toHaveLength(1);

    const first = page.locator(".weaver-dom-node").filter({ hasText: "Alpha" });
    const firstBox = await first.boundingBox();
    if (!firstBox) throw new Error("Seed node has no bounds");
    const revision = page.locator(".revision-strip");
    const layoutBefore = Number((await revision.textContent())?.match(/L(\d+)/)?.[1] ?? 0);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(firstBox.x + firstBox.width / 2 + 80, firstBox.y + firstBox.height / 2 + 40, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => Number((await revision.textContent())?.match(/L(\d+)/)?.[1] ?? 0)).toBe(layoutBefore + 1);

    const readsBeforeGap = fullGraphReads.length;
    const gapRecoveryStartedAt = performance.now();
    const authoritativeRevision = worker.store.graphChanges.read(project.id).revision;
    worker.store.sessions.appendEvent({
      projectId: project.id,
      kind: "graph.changed",
      graphRevision: authoritativeRevision + 100,
      payload: {
        fromRevision: authoritativeRevision + 99,
        toRevision: authoritativeRevision + 100,
        addedNodes: [], updatedNodes: [], archivedNodeIds: [],
        addedEdges: [], updatedEdges: [], archivedEdgeIds: [],
      },
    });
    await expect.poll(() => fullGraphReads.length).toBeGreaterThan(readsBeforeGap);
    await expect(page.locator(".weaver-dom-node")).toHaveCount(3);
    await expect(revision).toContainText(`G${authoritativeRevision}`);
    const gapRecoveryMs = performance.now() - gapRecoveryStartedAt;
    expect(gapRecoveryMs).toBeLessThanOrEqual(5_000);
    console.log("Weaver SSE recovery SLO", { gapRecoveryMs });
    await testInfo.attach("sse-gap-slo.json", { body: JSON.stringify({ gapRecoveryMs }, null, 2), contentType: "application/json" });

    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    secondPage.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    secondPage.on("pageerror", (error) => errors.push(error.message));
    const secondLaunch = worker.createLaunch({ chatSessionKey: "b".repeat(64), projectId: project.id, requestedViewId: project.defaultViewId });
    await secondPage.goto(secondLaunch.launchUrl, { waitUntil: "domcontentloaded" });
    await expect(secondPage.getByRole("button", { name: "Take over" })).toBeVisible();
    await expect(secondPage.locator(".canvas-access-blocker")).toContainText("read-only");
    await secondPage.getByRole("button", { name: "Take over" }).click();
    await expect(secondPage.locator(".canvas-access-blocker")).toHaveCount(0);
    await expect(page.getByRole("alert")).toContainText("no longer bound", { timeout: 7_000 });
    await secondPage.reload({ waitUntil: "domcontentloaded" });
    await expect(secondPage.getByRole("toolbar", { name: "Canvas tools" })).toBeVisible();
    await expect(secondPage.locator(".weaver-dom-node")).toHaveCount(3);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("alert")).toContainText("no longer bound");
    await expect(page.locator(".weaver-dom-node")).toHaveCount(0);
    expect(worker.store.canvasMutations.get("missing")).toBeNull();
    const auditCount = worker.store.db.prepare("SELECT count(*) AS count FROM canvas_mutation").get() as { count: number };
    expect(auditCount.count).toBeGreaterThanOrEqual(4);
    const diagnostics = worker.getDiagnostics() as Array<{ event: string }>;
    expect(diagnostics.map((entry) => entry.event)).toEqual(expect.arrayContaining(["pairing.claimed", "bootstrap.ready", "rpc.completed"]));
    expect(JSON.stringify(diagnostics)).not.toContain(workspace);
    expect(JSON.stringify(diagnostics)).not.toContain("a".repeat(64));
    expect(errors).toEqual([]);
    await secondContext.close();
  } finally {
    await worker.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("Canvas keeps local editing when the Agent bridge disconnects and reconnects", async ({ page }) => {
  const { WorkspaceWorker } = await nativeImport(pathToFileURL(resolve(process.cwd(), "packages/workspace-service/dist/index.js")).href);
  const { getScenePack } = await nativeImport(pathToFileURL(resolve(process.cwd(), "packages/scene-packs/dist/index.js")).href);
  const workspace = mkdtempSync(resolve(tmpdir(), "weaver-bridge-e2e-"));
  process.env.WEAVER_BRIDGE_GRACE_MS = "100";
  const worker = new WorkspaceWorker({ workspaceDir: workspace, buildId: "bridge-e2e-build" });
  const project = worker.store.catalog.createProject({ title: "Bridge recovery", goal: "Keep local editing available", scenePack: getScenePack("free-brainstorming")! });
  const chatSessionKey = "d".repeat(64);
  try {
    await worker.listen();
    const launch = worker.createLaunch({ chatSessionKey, projectId: project.id, requestedViewId: project.defaultViewId });
    await page.goto(launch.launchUrl, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("toolbar", { name: "Canvas tools" })).toBeVisible();
    await expect(page.getByText("Local editing · Agent disconnected", { exact: true })).toBeVisible({ timeout: 7_000 });

    await page.getByRole("button", { name: "Note" }).click();
    const pane = page.locator(".hybrid-canvas");
    const box = await pane.boundingBox();
    if (!box) throw new Error("Canvas has no bounds while Agent is disconnected");
    await page.mouse.click(box.x + box.width - 140, box.y + box.height - 140);
    await expect(page.locator(".weaver-dom-node")).toHaveCount(1);
    const offlineGraphRevision = worker.store.graphChanges.read(project.id).revision;

    process.env.WEAVER_BRIDGE_GRACE_MS = "30000";
    worker.heartbeatBridge(chatSessionKey, "Codex");
    await expect(page.locator(".agent-connection-status")).toHaveText("Connected to this Codex session", { timeout: 7_000 });
    const bootstrap = await page.evaluate(async () => fetch("/api/bootstrap").then((response) => response.json()));
    expect(bootstrap).toMatchObject({ capabilities: { manualWrite: true, agentConnected: true, agentWrite: true, hostLabel: "Codex" } });

    const agentRead = worker.dispatchChatOperation(chatSessionKey, "weaver_read_graph", {
      resource: "full",
      projectId: project.id,
      viewId: project.defaultViewId,
    }) as { project: { graphRevision: number }; nodes: Array<{ id: string }> };
    expect(agentRead.project.graphRevision).toBe(offlineGraphRevision);
    expect(agentRead.nodes).toHaveLength(1);

    worker.dispatchChatOperation(chatSessionKey, "weaver_canvas_action", {
      action: "create_node",
      projectId: project.id,
      viewId: project.defaultViewId,
      semanticType: "idea",
      title: "Agent continued after reconnect",
      content: { kind: "document", mode: "note", markdown: "Agent used the latest offline revision.", excerpt: "Agent continued", embeddedAssetIds: [] },
      x: 320,
      y: 80,
    });
    await expect(page.locator(".weaver-dom-node")).toHaveCount(2);
    await expect(page.locator(".weaver-dom-node").filter({ hasText: "Agent continued after reconnect" })).toHaveCount(1);
  } finally {
    delete process.env.WEAVER_BRIDGE_GRACE_MS;
    await worker.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("supervisor keeps the Canvas origin alive across worker replacement", async ({ page }, testInfo) => {
  const { WorkspaceStore } = await nativeImport(pathToFileURL(resolve(process.cwd(), "packages/storage/dist/index.js")).href);
  const { getScenePack } = await nativeImport(pathToFileURL(resolve(process.cwd(), "packages/scene-packs/dist/index.js")).href);
  const { ensureWorkspaceSupervisor, sendRuntimeControl } = await nativeImport(pathToFileURL(resolve(process.cwd(), "packages/workspace-supervisor/dist/index.js")).href);
  const workspace = mkdtempSync(resolve(tmpdir(), "weaver-restart-e2e-"));
  const runtimeRoot = mkdtempSync(resolve(tmpdir(), "weaver-restart-runtime-"));
  const store = new WorkspaceStore(workspace);
  const project = store.catalog.createProject({ title: "Restart recovery", goal: "Keep the origin stable", scenePack: getScenePack("free-brainstorming")! });
  store.graphChanges.createNode({ projectId: project.id, viewId: project.defaultViewId, type: "idea", title: "Before restart", content: { kind: "document", mode: "note", markdown: "before", excerpt: "before", embeddedAssetIds: [] }, x: 0, y: 0 });
  store.close();
  const coldStartStartedAt = performance.now();
  const supervisor = await ensureWorkspaceSupervisor({ workspaceDir: workspace, runtimeRoot, buildId: "restart-build", workerEntry: resolve(process.cwd(), "packages/workspace-supervisor/dist/server.js") });
  const coldStartMs = performance.now() - coldStartStartedAt;
  expect(coldStartMs).toBeLessThanOrEqual(5_000);
  expect(supervisor.workerPidForTest()).not.toBe(process.pid);
  const errors: string[] = [];
  const streamLog: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (request.url().includes("/events?")) streamLog.push(`request:${request.url()}`); });
  page.on("response", (response) => { if (response.url().includes("/events?")) streamLog.push(`response:${response.status()}`); });
  page.on("requestfailed", (request) => { if (request.url().includes("/events?")) streamLog.push(`failed:${request.failure()?.errorText ?? "unknown"}`); });
  try {
    const origin = supervisor.origin;
    const launch = await supervisor.createLaunch({ chatSessionKey: "c".repeat(64), projectId: project.id, requestedViewId: project.defaultViewId });
    await page.goto(launch.launchUrl, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("toolbar", { name: "Canvas tools" })).toBeVisible();
    await expect(page.locator(".weaver-dom-node")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Live", exact: true }), JSON.stringify(streamLog)).toBeVisible({ timeout: 5_000 });

    const workerPid = supervisor.workerPidForTest();
    const restartStartedAt = performance.now();
    supervisor.killWorkerForTest();
    await expect.poll(() => supervisor.workerPidForTest()).not.toBe(workerPid);
    expect(supervisor.origin).toBe(origin);
    await expect.poll(async () => fetch(`${origin}/healthz`).then((response) => response.status)).toBe(200);
    await expect(page.getByRole("button", { name: "Live", exact: true }), JSON.stringify(streamLog)).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".weaver-dom-node")).toHaveCount(1);
    const restartRecoveryMs = performance.now() - restartStartedAt;
    expect(restartRecoveryMs).toBeLessThanOrEqual(5_000);
    console.log("Weaver supervisor SLO", { coldStartMs, restartRecoveryMs });
    await testInfo.attach("supervisor-slo.json", { body: JSON.stringify({ coldStartMs, restartRecoveryMs }, null, 2), contentType: "application/json" });
    await page.getByRole("button", { name: "Note" }).click();
    const pane = page.locator(".hybrid-canvas");
    const box = await pane.boundingBox();
    if (!box) throw new Error("Canvas has no bounds after restart");
    await page.mouse.click(box.x + box.width - 150, box.y + box.height - 130);
    await expect(page.locator(".weaver-dom-node")).toHaveCount(2);
    const diagnostics = await sendRuntimeControl(supervisor.controlSocketPath, { kind: "get_diagnostics", limit: 100 }) as Array<{ event: string }>;
    const diagnosticEvents = diagnostics.map((entry) => entry.event);
    expect(diagnosticEvents.filter((event) => event === "worker.starting")).toHaveLength(2);
    expect(diagnosticEvents.filter((event) => event === "worker.ready").length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(diagnostics)).not.toContain(workspace);
    expect(errors).toEqual([]);
  } finally {
    await page.close().catch(() => undefined);
    await supervisor.close();
    rmSync(workspace, { recursive: true, force: true });
    rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

for (const host of ["Codex", "Claude"] as const) {
  test(`${host} release-style MCP, supervisor and Browser converge on one bound Canvas`, async ({ page }) => {
    const workspace = mkdtempSync(resolve(tmpdir(), `weaver-${host.toLowerCase()}-bridge-e2e-`));
    const runtimeRoot = mkdtempSync(resolve(tmpdir(), `weaver-${host.toLowerCase()}-runtime-e2e-`));
    const script = host === "Codex" ? "scripts/start-mcp-dev.mjs" : "scripts/start-mcp-claude.mjs";
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [script],
      cwd: process.cwd(),
      stderr: "pipe",
      env: {
        ...process.env,
        VITEST: "1",
        WEAVER_CANVAS_SURFACE: "localhost",
        WEAVER_DISABLE_AUTO_OPEN: "1",
        WEAVER_NO_AUTO_OPEN: "1",
        WEAVER_RUNTIME_ROOT: runtimeRoot,
        WEAVER_RUNTIME_IDLE_MS: "60000",
      },
    });
    const client = new Client({ name: `weaver-${host.toLowerCase()}-e2e`, version: "0.1.0" });
    const threadId = `weaver-${host.toLowerCase()}-e2e-${process.pid}`;
    const _meta = { threadId, "x-codex-turn-metadata": { thread_id: threadId } };
    const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args, _meta }).then(unwrapMcp);
    const errors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await client.connect(transport);
      const created = await call("weaver_catalog_action", { workspaceDir: workspace, action: "create_project", title: `${host} bridge`, goal: "Prove the formal runtime route", scenePackId: "free-brainstorming" });
      const project = created.project as { id: string; defaultViewId: string };
      const opened = await call("weaver_open_space", { workspaceDir: workspace, projectId: project.id }) as { launchUrl: string };
      await page.goto(opened.launchUrl, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("toolbar", { name: "Canvas tools" })).toBeVisible();
      await expect(page.locator(".agent-connection-status")).toHaveText(`Connected to this ${host} session`, { timeout: 7_000 });
      await expect(page.locator(".weaver-dom-node")).toHaveCount(1);

      await page.getByRole("button", { name: "Note" }).click();
      const pane = page.locator(".hybrid-canvas");
      const box = await pane.boundingBox();
      if (!box) throw new Error("Canvas has no bounds through formal runtime route");
      await page.mouse.click(box.x + box.width - 140, box.y + box.height - 140);
      await expect(page.locator(".weaver-dom-node")).toHaveCount(2);

      await call("weaver_canvas_action", {
        workspaceDir: workspace,
        action: "create_node",
        projectId: project.id,
        viewId: project.defaultViewId,
        semanticType: "idea",
        title: `${host} Agent bridge write`,
        content: { kind: "document", mode: "note", markdown: "Written through MCP and supervisor.", excerpt: "Formal bridge", embeddedAssetIds: [] },
        x: 360,
        y: 80,
      });
      await expect(page.locator(".weaver-dom-node").filter({ hasText: `${host} Agent bridge write` })).toHaveCount(1);
      const graph = await call("weaver_read_graph", { workspaceDir: workspace, resource: "full", projectId: project.id, viewId: project.defaultViewId });
      expect(graph.nodes).toHaveLength(3);
      expect(errors).toEqual([]);
    } finally {
      await client.close().catch(() => undefined);
      rmSync(workspace, { recursive: true, force: true });
      rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });
}
