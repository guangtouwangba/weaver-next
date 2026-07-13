import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

const nativeImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<any>;

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
