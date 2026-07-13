import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, test } from "@playwright/test";

const root = resolve(process.cwd());
const structured = (result: any) => { if (result.isError) throw new Error(result.content?.find((item: any) => item.type === "text")?.text ?? "MCP tool failed"); return result.structuredContent; };

test("real canvas supports toolbar, note creation and persistent multi-node movement", async ({ page }, testInfo) => {
  const workspace = mkdtempSync(resolve(tmpdir(), "weaver-canvas-e2e-")); const home = mkdtempSync(resolve(tmpdir(), "weaver-canvas-home-"));
  const env = Object.fromEntries(Object.entries({ ...process.env, HOME: home, WEAVER_PREVIEW_INSTANCE_ID: `e2e-${process.pid}-${Date.now()}`, WEAVER_DISABLE_AUTO_OPEN: "1", WEAVER_RUNTIME_IDLE_MS: "1000" }).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  const transport = new StdioClientTransport({ command: "node", args: ["./scripts/start-mcp-claude.mjs"], cwd: root, env, stderr: "pipe" });
  const client = new Client({ name: "weaver-canvas-e2e", version: "0.1.0" }); const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); }); page.on("pageerror", (error) => errors.push(error.message));
  try {
    await client.connect(transport);
    const created = structured(await client.callTool({ name: "weaver_catalog_action", arguments: { workspaceDir: workspace, action: "create_project", title: "Professional Canvas E2E", goal: "Exercise direct manipulation", scenePackId: "entity-relationship" } })); const project = created.project;
    const coldLaunchStartedAt = performance.now();
    const opened = structured(await client.callTool({ name: "weaver_open_space", arguments: { workspaceDir: workspace, projectId: project.id, displayMode: "fullscreen" } }));
    const coldLaunchMs = performance.now() - coldLaunchStartedAt;
    expect(coldLaunchMs).toBeLessThanOrEqual(5_000);
    const bootstrapStartedAt = performance.now();
    await page.goto(opened.launchUrl, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("toolbar", { name: "Canvas tools" })).toBeVisible();
    const bootstrapMs = performance.now() - bootstrapStartedAt;
    expect(bootstrapMs).toBeLessThanOrEqual(10_000);
    await expect.poll(async () => { const result: any = await client.callTool({ name: "weaver_read_session", arguments: { workspaceDir: workspace, resource: "bound_canvas" } }); return !result.isError && result.structuredContent?.online === true; }).toBe(true);
    const reuseLaunchStartedAt = performance.now();
    structured(await client.callTool({ name: "weaver_open_space", arguments: { workspaceDir: workspace, projectId: project.id, displayMode: "fullscreen" } }));
    const reuseLaunchMs = performance.now() - reuseLaunchStartedAt;
    expect(reuseLaunchMs).toBeLessThanOrEqual(2_000);
    console.log("Weaver runtime open SLO", { coldLaunchMs, reuseLaunchMs, bootstrapMs });
    await testInfo.attach("runtime-open-slo.json", { body: JSON.stringify({ coldLaunchMs, reuseLaunchMs, bootstrapMs }, null, 2), contentType: "application/json" });
    await expect(page.locator(".canvas-access-blocker")).toHaveCount(0); await expect(page.getByRole("button", { name: "Create", exact: true })).toHaveCount(0); await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("data-active", "true");
    for (const [index, title] of ["Alpha", "Beta", "Gamma"].entries()) structured(await client.callTool({ name: "weaver_canvas_action", arguments: { workspaceDir: workspace, action: "create_node", projectId: project.id, viewId: project.defaultViewId, semanticType: "entity", title, content: { kind: "document", mode: "note", markdown: title, excerpt: title, embeddedAssetIds: [] }, x: index * 300, y: index * 80 } }));
    await expect(page.locator(".weaver-dom-node")).toHaveCount(4);
    const zoomLevel = page.getByRole("status", { name: "Zoom level" }); const zoomBeforePinch = Number((await zoomLevel.textContent())?.replace("%", "") ?? 0);
    await page.locator(".hybrid-canvas").dispatchEvent("wheel", { deltaY: -2, deltaMode: 0, ctrlKey: true, clientX: 640, clientY: 360 });
    await expect.poll(async () => Number((await zoomLevel.textContent())?.replace("%", "") ?? 0)).toBeGreaterThanOrEqual(zoomBeforePinch + 3);
    const canvasNodes = page.locator(".weaver-dom-node"); const beforeNodes = await canvasNodes.count();
    const noteTool = page.getByRole("button", { name: "Note" }); await noteTool.click(); await expect(noteTool).toHaveAttribute("data-active", "true"); const pane = page.locator(".hybrid-canvas"); const paneBox = await pane.boundingBox(); if (!paneBox) throw new Error("Canvas pane has no bounds");
    await page.mouse.click(paneBox.x + paneBox.width - 120, paneBox.y + paneBox.height - 120); await expect(canvasNodes).toHaveCount(beforeNodes + 1); await expect(page.getByRole("complementary", { name: /article/i })).toBeVisible(); await page.getByRole("button", { name: /close/i }).click();
    await page.getByRole("button", { name: "Select", exact: true }).click(); const firstNode = page.locator(".weaver-dom-node").filter({ hasText: "Alpha" }); const secondNode = page.locator(".weaver-dom-node").filter({ hasText: "Beta" }); const first = await firstNode.boundingBox(); const second = await secondNode.boundingBox(); if (!first || !second) throw new Error("Seed node has no bounds");
    const revision = page.locator(".revision-strip"); const layoutBefore = Number((await revision.textContent())?.match(/L(\d+)/)?.[1] ?? 0);
    await page.mouse.move(Math.min(first.x, second.x) - 18, Math.min(first.y, second.y) - 18); await page.mouse.down(); await page.mouse.move(Math.max(first.x + first.width, second.x + second.width) + 18, Math.max(first.y + first.height, second.y + second.height) + 18, { steps: 12 }); await page.mouse.up(); await expect(firstNode.locator(".content-card")).toHaveAttribute("data-selected", "true"); await expect(secondNode.locator(".content-card")).toHaveAttribute("data-selected", "true");
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2); await page.mouse.down(); await page.mouse.move(first.x + first.width / 2 + 90, first.y + first.height / 2 + 50, { steps: 8 }); await page.mouse.up();
    await expect.poll(async () => Number((await revision.textContent())?.match(/L(\d+)/)?.[1] ?? 0)).toBe(layoutBefore + 1); await page.reload({ waitUntil: "domcontentloaded" }); await expect(page.getByRole("toolbar", { name: "Canvas tools" })).toBeVisible(); await expect(page.locator(".weaver-aria-focus-layer button").first()).toHaveAttribute("aria-label", /.+: .+/); expect(errors).toEqual([]);
  } finally { await client.close().catch(() => {}); rmSync(workspace, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); }
});
