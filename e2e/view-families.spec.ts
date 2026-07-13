import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

const nativeImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<any>;

test("all View families render through the canonical localhost Canvas", async ({ page }) => {
  const { WorkspaceWorker } = await nativeImport(pathToFileURL(resolve(process.cwd(), "packages/workspace-service/dist/index.js")).href);
  const { getScenePack } = await nativeImport(pathToFileURL(resolve(process.cwd(), "packages/scene-packs/dist/index.js")).href);
  const { getVisualTemplate } = await nativeImport(pathToFileURL(resolve(process.cwd(), "packages/visual-templates/dist/index.js")).href);
  const workspace = mkdtempSync(resolve(tmpdir(), "weaver-view-families-e2e-"));
  const worker = new WorkspaceWorker({ workspaceDir: workspace, buildId: "view-families-build" });
  const fixtures = [
    ["canvas", "free-brainstorming", "blank-canvas", "canvas", "canvas"],
    ["hierarchy", "problem-decomposition", "logic-tree", "tree", "tree"],
    ["relationship", "concept-learning", "concept-network", "graph", "graph"],
    ["flow", "process-design", "process-flow", "flow", "flow"],
    ["temporal", "event-timeline", "event-timeline", "timeline", "timeline"],
    ["board", "project-breakdown", "kanban-board", "board", "board"],
    ["matrix", "decision-comparison", "swot-matrix", "board", "matrix"],
    ["table", "decision-comparison", "comparison-table", "table", "table"],
  ] as const;
  const projects = fixtures.map(([family, sceneId, templateId]) => worker.store.catalog.createProjectFromTemplate({
    title: `${family} nightly fixture`,
    goal: `Render the ${family} family`,
    scenePack: getScenePack(sceneId)!,
    template: getVisualTemplate(templateId)!,
  }).project);
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));

  try {
    await worker.listen();
    for (const [index, [family, _sceneId, _templateId, viewType, projection]] of fixtures.entries()) {
      const project = projects[index];
      const launch = worker.createLaunch({ chatSessionKey: index.toString(16).repeat(64), projectId: project.id, requestedViewId: project.defaultViewId });
      await page.goto(launch.launchUrl, { waitUntil: "domcontentloaded" });
      const canvas = page.locator("section.canvas-wrap");
      await expect(canvas, `${family} Canvas did not render`).toHaveAttribute("data-view-type", viewType);
      await expect(canvas).toHaveAttribute("data-projection", projection);
      await expect(page.getByRole("toolbar", { name: "Canvas tools" })).toBeVisible();
      if (projection === "table") await expect(page.locator(".weaver-table-row").first()).toBeVisible();
      else await expect(page.locator(".weaver-aria-focus-layer button").first()).toHaveAttribute("aria-label", /.+: .+/);
      if (projection === "matrix") await expect(page.locator(".weaver-dom-group")).toHaveCount(4);
    }
    expect(errors).toEqual([]);
  } finally {
    await page.close().catch(() => undefined);
    await worker.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});
