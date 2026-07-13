import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const nativeImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<any>;

function unwrapMcp(result: { isError?: boolean; structuredContent?: any; content?: Array<{ type?: string; text?: string }> }) {
  if (result.isError) throw new Error(result.content?.find((item) => item.type === "text")?.text ?? result.structuredContent?.code ?? "MCP_TOOL_FAILED");
  const value = result.structuredContent;
  return value && Object.keys(value).length === 1 && Array.isArray(value.items) ? value.items : value;
}

async function seedWorkspace(workspace: string, title: string) {
  const { WorkspaceStore } = await nativeImport(pathToFileURL(resolve(process.cwd(), "packages/storage/dist/index.js")).href);
  const { getScenePack } = await nativeImport(pathToFileURL(resolve(process.cwd(), "packages/scene-packs/dist/index.js")).href);
  const store = new WorkspaceStore(workspace);
  const project = store.catalog.createProject({ title, goal: `Keep ${title} isolated`, scenePack: getScenePack("free-brainstorming")! });
  store.graphChanges.createNode({
    projectId: project.id,
    viewId: project.defaultViewId,
    type: "idea",
    title,
    content: { kind: "document", mode: "note", markdown: title, excerpt: title, embeddedAssetIds: [] },
    x: 0,
    y: 0,
  });
  store.close();
  return project;
}

test("Canvas survives four consecutive worker crashes without changing origin or losing data", async ({ page }) => {
  const { ensureWorkspaceSupervisor, sendRuntimeControl } = await nativeImport(pathToFileURL(resolve(process.cwd(), "packages/workspace-supervisor/dist/index.js")).href);
  const workspace = mkdtempSync(resolve(tmpdir(), "weaver-crash-loop-e2e-"));
  const runtimeRoot = mkdtempSync(resolve(tmpdir(), "weaver-crash-loop-runtime-"));
  const project = await seedWorkspace(workspace, "Survives crash loop");
  const supervisor = await ensureWorkspaceSupervisor({ workspaceDir: workspace, runtimeRoot, buildId: "crash-loop-build", workerEntry: resolve(process.cwd(), "packages/workspace-supervisor/dist/server.js") });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  try {
    const origin = supervisor.origin;
    const launch = await supervisor.createLaunch({ chatSessionKey: "e".repeat(64), projectId: project.id, requestedViewId: project.defaultViewId });
    await page.goto(launch.launchUrl, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Live", exact: true })).toBeVisible();
    await expect(page.locator(".weaver-dom-node").filter({ hasText: "Survives crash loop" })).toHaveCount(1);

    for (let cycle = 1; cycle <= 4; cycle += 1) {
      const previousPid = supervisor.workerPidForTest();
      supervisor.killWorkerForTest();
      await expect.poll(() => supervisor.workerPidForTest(), { timeout: 7_000, message: `worker did not recover after crash ${cycle}` }).not.toBe(previousPid);
      await expect.poll(async () => fetch(`${origin}/healthz`).then((response) => response.status).catch(() => 0), { timeout: 7_000 }).toBe(200);
      expect(supervisor.origin).toBe(origin);
      await expect(page.getByRole("button", { name: "Live", exact: true })).toBeVisible({ timeout: 7_000 });
      await expect(page.locator(".weaver-dom-node").filter({ hasText: "Survives crash loop" })).toHaveCount(1);
    }

    const diagnostics = await sendRuntimeControl(supervisor.controlSocketPath, { kind: "get_diagnostics", limit: 200 }) as Array<{ component: string; event: string }>;
    expect(diagnostics.filter((entry) => entry.component === "supervisor" && entry.event === "worker.crashed")).toHaveLength(4);
    expect(diagnostics.filter((entry) => entry.component === "supervisor" && entry.event === "worker.ready")).toHaveLength(5);
    expect(errors).toEqual([]);
  } finally {
    await page.close().catch(() => undefined);
    await supervisor.close();
    rmSync(workspace, { recursive: true, force: true });
    rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test("two workspaces run concurrently with distinct origins and isolated state", async ({ browser }) => {
  const { ensureWorkspaceSupervisor } = await nativeImport(pathToFileURL(resolve(process.cwd(), "packages/workspace-supervisor/dist/index.js")).href);
  const runtimeRoot = mkdtempSync(resolve(tmpdir(), "weaver-parallel-runtime-"));
  const firstWorkspace = mkdtempSync(resolve(tmpdir(), "weaver-workspace-a-"));
  const secondWorkspace = mkdtempSync(resolve(tmpdir(), "weaver-workspace-b-"));
  const firstProject = await seedWorkspace(firstWorkspace, "Workspace Alpha only");
  const secondProject = await seedWorkspace(secondWorkspace, "Workspace Beta only");
  const [first, second] = await Promise.all([
    ensureWorkspaceSupervisor({ workspaceDir: firstWorkspace, runtimeRoot, buildId: "parallel-build", workerEntry: resolve(process.cwd(), "packages/workspace-supervisor/dist/server.js") }),
    ensureWorkspaceSupervisor({ workspaceDir: secondWorkspace, runtimeRoot, buildId: "parallel-build", workerEntry: resolve(process.cwd(), "packages/workspace-supervisor/dist/server.js") }),
  ]);
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  const secondPage = await secondContext.newPage();
  const errors: string[] = [];
  for (const page of [firstPage, secondPage]) page.on("pageerror", (error) => errors.push(error.message));

  try {
    expect(first.origin).not.toBe(second.origin);
    const [firstLaunch, secondLaunch] = await Promise.all([
      first.createLaunch({ chatSessionKey: "a".repeat(64), projectId: firstProject.id, requestedViewId: firstProject.defaultViewId }),
      second.createLaunch({ chatSessionKey: "b".repeat(64), projectId: secondProject.id, requestedViewId: secondProject.defaultViewId }),
    ]);
    await Promise.all([
      firstPage.goto(firstLaunch.launchUrl, { waitUntil: "domcontentloaded" }),
      secondPage.goto(secondLaunch.launchUrl, { waitUntil: "domcontentloaded" }),
    ]);
    await expect(firstPage.locator(".weaver-dom-node").filter({ hasText: "Workspace Alpha only" })).toHaveCount(1);
    await expect(firstPage.getByText("Workspace Beta only")).toHaveCount(0);
    await expect(secondPage.locator(".weaver-dom-node").filter({ hasText: "Workspace Beta only" })).toHaveCount(1);
    await expect(secondPage.getByText("Workspace Alpha only")).toHaveCount(0);

    await firstPage.getByRole("button", { name: "Note" }).click();
    const canvas = firstPage.locator(".hybrid-canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("First workspace Canvas has no bounds");
    await firstPage.mouse.click(box.x + box.width - 140, box.y + box.height - 140);
    await expect(firstPage.locator(".weaver-dom-node")).toHaveCount(2);
    await expect(secondPage.locator(".weaver-dom-node")).toHaveCount(1);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all([firstContext.close(), secondContext.close()]);
    await Promise.all([first.close(), second.close()]);
    rmSync(firstWorkspace, { recursive: true, force: true });
    rmSync(secondWorkspace, { recursive: true, force: true });
    rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test("packaged runtime survives a cold-start collision and deletion of the original plugin cache", async ({ page }) => {
  const { sendRuntimeControl, runtimeControlSocketPath, workspaceKey } = await nativeImport(pathToFileURL(resolve(process.cwd(), "packages/workspace-supervisor/dist/index.js")).href);
  const root = mkdtempSync(resolve(tmpdir(), "weaver-immutable-runtime-e2e-"));
  const workspace = resolve(root, "workspace");
  const runtimeRoot = resolve(root, "runtime-root");
  const pluginDir = resolve(root, "plugin-cache", "weaver-next");
  mkdirSync(workspace, { recursive: true });
  cpSync(resolve(process.cwd(), "plugins/weaver-next"), pluginDir, { recursive: true });
  const clients: Client[] = [];
  let supervisorPid: number | undefined;
  try {
    const makeClient = async (suffix: string) => {
      const transport = new StdioClientTransport({ command: process.execPath, args: ["./scripts/start-mcp.mjs"], cwd: pluginDir, stderr: "pipe", env: { ...process.env, WEAVER_RUNTIME_ROOT: runtimeRoot, WEAVER_RUNTIME_IDLE_MS: "60000" } });
      const client = new Client({ name: `runtime-collision-${suffix}`, version: "0.1.0" });
      await client.connect(transport); clients.push(client);
      const threadId = `runtime-collision-${suffix}-${process.pid}`;
      const meta = { threadId, "x-codex-turn-metadata": { thread_id: threadId } };
      return { client, call: (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args, _meta: meta }).then(unwrapMcp) };
    };
    const [first, second] = await Promise.all([makeClient("a"), makeClient("b")]);
    const [createdA, createdB] = await Promise.all([
      first.call("weaver_catalog_action", { workspaceDir: workspace, action: "create_project", title: "Collision A", goal: "", scenePackId: "free-brainstorming" }),
      second.call("weaver_catalog_action", { workspaceDir: workspace, action: "create_project", title: "Collision B", goal: "", scenePackId: "free-brainstorming" }),
    ]);
    const key = workspaceKey(workspace);
    const descriptor = JSON.parse(readFileSync(resolve(runtimeRoot, "workspaces", key, "runtime.json"), "utf8")) as { supervisorPid: number; port: number };
    supervisorPid = descriptor.supervisorPid;
    const socketPath = runtimeControlSocketPath(runtimeRoot, key);
    const diagnostics = await sendRuntimeControl(socketPath, { kind: "get_diagnostics", limit: 100 }) as Array<{ event: string; workerPid?: number }>;
    const workerPid = diagnostics.filter((entry) => entry.event === "worker.ready").at(-1)?.workerPid;
    expect(workerPid).toBeTruthy();
    const projects = await first.call("weaver_read_catalog", { workspaceDir: workspace, resource: "project.list" }) as Array<{ id: string; title: string }>;
    expect(projects.map((project) => project.title)).toEqual(expect.arrayContaining(["Collision A", "Collision B"]));

    rmSync(resolve(root, "plugin-cache"), { recursive: true, force: true });
    process.kill(workerPid!, "SIGKILL");
    const origin = `http://127.0.0.1:${descriptor.port}`;
    await expect.poll(async () => {
      try {
        const entries = await sendRuntimeControl(socketPath, { kind: "get_diagnostics", limit: 100 }) as Array<{ event: string; workerPid?: number }>;
        return entries.filter((entry) => entry.event === "worker.ready").at(-1)?.workerPid;
      } catch { return undefined; }
    }, { timeout: 7_000 }).not.toBe(workerPid);
    await expect.poll(async () => fetch(`${origin}/healthz`).then((response) => response.status).catch(() => 0), { timeout: 7_000 }).toBe(200);
    const afterRestart = await first.call("weaver_read_catalog", { workspaceDir: workspace, resource: "project.list" }) as Array<{ id: string; title: string }>;
    expect(afterRestart.map((project) => project.title)).toEqual(expect.arrayContaining(["Collision A", "Collision B"]));

    const opened = await first.call("weaver_open_space", { workspaceDir: workspace, projectId: (createdA as { project: { id: string } }).project.id }) as { launchUrl: string };
    await page.goto(opened.launchUrl, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("toolbar", { name: "Canvas tools" })).toBeVisible();
    await expect(page.locator(".weaver-dom-node")).toHaveCount(1);
    expect((createdB as { project: { id: string } }).project.id).not.toBe((createdA as { project: { id: string } }).project.id);
  } finally {
    await Promise.all(clients.map((client) => client.close().catch(() => undefined)));
    if (supervisorPid) { try { process.kill(supervisorPid, "SIGTERM"); } catch { /* already stopped */ } }
    rmSync(root, { recursive: true, force: true });
  }
});
