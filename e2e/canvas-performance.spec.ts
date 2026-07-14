import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, test } from "@playwright/test";

const root = resolve(process.cwd());
const structured = (result: any) => { if (result.isError) throw new Error(result.content?.find((item: any) => item.type === "text")?.text ?? "MCP tool failed"); return result.structuredContent; };

type Metrics = { frames: number; fps: number; p95FrameMs: number; longTasks: number; maxLongTaskMs: number; reactCommits: number };

async function sample(page: import("@playwright/test").Page, kind: "pan" | "zoom" | "drag", durationMs = 10_000): Promise<Metrics> {
  return page.evaluate(async ({ kind, durationMs }) => {
    const canvas = document.querySelector<HTMLElement>(".hybrid-canvas"); if (!canvas) throw new Error("Hybrid canvas unavailable");
    // The renderer commits camera/LOD once 120 ms after an interaction settles.
    // Let the previous sample's post-interaction commit finish before measuring
    // this sample so it is not misattributed to the next gesture.
    await new Promise((resolveSettle) => setTimeout(resolveSettle, 180));
    // `renderCount` also changes when unrelated parent state (for example an
    // SSE/bootstrap update) re-renders CanvasStage. `renderTick` changes only
    // when the Canvas itself asks React to commit scene/camera presentation.
    const renderTick = Number(canvas.dataset.renderTick ?? 0);
    const frameTimes: number[] = []; const longTasks: number[] = [];
    const observer = typeof PerformanceObserver !== "undefined" ? new PerformanceObserver((list) => { for (const entry of list.getEntries()) longTasks.push(entry.duration); }) : null;
    try { observer?.observe({ entryTypes: ["longtask"] }); } catch { /* unsupported in this browser */ }
    const node = document.querySelector<HTMLElement>(".weaver-dom-node"); const nodeBox = node?.getBoundingClientRect();
    const start = performance.now(); let previous = start; let frame = 0;
    await new Promise<void>((resolveSample) => {
      const tick = (now: number) => {
        frameTimes.push(now - previous); previous = now; frame += 1;
        const wave = Math.sin(frame / 18);
        if (kind === "pan") canvas.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX: 1.8 + wave, deltaY: 0.8 }));
        if (kind === "zoom") canvas.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true, clientX: canvas.clientWidth / 2, clientY: canvas.clientHeight / 2, deltaY: wave * 0.55 }));
        if (kind === "drag" && nodeBox) canvas.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, pointerType: "mouse", buttons: 1, clientX: nodeBox.x + nodeBox.width / 2 + wave * 36, clientY: nodeBox.y + nodeBox.height / 2 + Math.cos(frame / 18) * 22 }));
        if (now - start >= durationMs) resolveSample(); else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    observer?.disconnect(); frameTimes.shift(); frameTimes.sort((a, b) => a - b);
    const median = frameTimes[Math.floor(frameTimes.length * 0.5)] ?? Number.POSITIVE_INFINITY;
    return { frames: frameTimes.length, fps: 1000 / median, p95FrameMs: frameTimes[Math.floor(frameTimes.length * 0.95)] ?? Number.POSITIVE_INFINITY, longTasks: longTasks.length, maxLongTaskMs: Math.max(0, ...longTasks), reactCommits: Number(canvas.dataset.renderTick ?? 0) - renderTick };
  }, { kind, durationMs });
}

test("500 nodes and 1000 edges meet the interaction frame budget", async ({ page }) => {
  test.setTimeout(120_000);
  const workspace = mkdtempSync(resolve(tmpdir(), "weaver-perf-e2e-")); const home = mkdtempSync(resolve(tmpdir(), "weaver-perf-home-"));
  const env = Object.fromEntries(Object.entries({ ...process.env, HOME: home, WEAVER_PREVIEW_INSTANCE_ID: `perf-${process.pid}-${Date.now()}`, WEAVER_DISABLE_AUTO_OPEN: "1", WEAVER_RUNTIME_IDLE_MS: "1000" }).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  const transport = new StdioClientTransport({ command: "node", args: ["./scripts/start-mcp-claude.mjs"], cwd: root, env, stderr: "pipe" });
  const client = new Client({ name: "weaver-canvas-performance", version: "0.1.0" }); const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); }); page.on("pageerror", (error) => errors.push(error.message));
  try {
    await client.connect(transport);
    const created = structured(await client.callTool({ name: "weaver_catalog_action", arguments: { workspaceDir: workspace, action: "create_project", title: "Renderer benchmark", goal: "Performance fixture", scenePackId: "entity-relationship" } }));
    const opened = structured(await client.callTool({ name: "weaver_open_space", arguments: { workspaceDir: workspace, projectId: created.project.id, displayMode: "fullscreen" } }));
    const url = new URL(opened.launchUrl); url.searchParams.set("demo", "1"); url.searchParams.set("benchmark", "1");
    await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Performance benchmark · 500 nodes · 1000 edges")).toBeVisible();
    await expect(page.locator(".weaver-gpu-canvas")).toHaveCount(1); await expect(page.locator(".webgl-error")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => performance.getEntriesByName("weaver:renderer-ready").at(-1)?.startTime ?? Number.POSITIVE_INFINITY)).toBeLessThan(1500);
    expect(await page.locator(".weaver-dom-node").count()).toBe(0);

    const pan = await sample(page, "pan"); const zoom = await sample(page, "zoom");
    await expect(page.locator(".hybrid-canvas")).toHaveAttribute("data-interacting", "false");
    await page.getByRole("button", { name: "Fit whole view" }).click();
    for (let index = 0; index < 13; index += 1) await page.getByRole("button", { name: "Zoom in" }).click();
    await expect.poll(async () => page.locator(".weaver-dom-node").count()).toBeGreaterThan(0);
    expect(await page.locator(".weaver-dom-node").count()).toBeLessThanOrEqual(100);
    const first = page.locator(".weaver-dom-node").first(); const box = await first.boundingBox(); if (!box) throw new Error("Benchmark node unavailable for drag");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.evaluate(() => new Promise<void>((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))));
    const drag = await sample(page, "drag"); await page.mouse.up();

    const gpu = await page.evaluate(() => { const gl = document.createElement("canvas").getContext("webgl"); if (!gl) return "unavailable"; const extension = gl.getExtension("WEBGL_debug_renderer_info"); return extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER)); });
    const softwareRenderer = /swiftshader|software/i.test(gpu);
    console.log("Weaver renderer metrics", { gpu, softwareRenderer, pan, zoom, drag });
    expect(pan.reactCommits).toBe(0);
    expect(zoom.reactCommits).toBe(0);
    for (const metrics of [pan, zoom, drag]) {
      expect(metrics.frames).toBeGreaterThan(0);
      expect(Number.isFinite(metrics.fps)).toBe(true);
      expect(Number.isFinite(metrics.p95FrameMs)).toBe(true);
      if (!softwareRenderer) { expect(metrics.maxLongTaskMs).toBeLessThanOrEqual(100); expect(metrics.fps).toBeGreaterThanOrEqual(55); expect(metrics.p95FrameMs).toBeLessThanOrEqual(25); expect(metrics.longTasks).toBeLessThanOrEqual(1); }
    }
    expect(errors).toEqual([]);
  } finally { await client.close().catch(() => {}); rmSync(workspace, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); }
});
