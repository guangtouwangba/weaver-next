import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";

const workspaceDir = mkdtempSync(join(tmpdir(), "weaver-host-smoke-workspace-"));
const runtimeRoot = mkdtempSync(join(tmpdir(), "weaver-host-smoke-runtime-"));
const pluginDir = resolve(process.env.WEAVER_SMOKE_PLUGIN_DIR ?? "plugins/weaver-next");
const mcpLauncher = process.env.WEAVER_SMOKE_MCP_LAUNCHER ?? "./scripts/start-mcp.mjs";
mkdirSync(workspaceDir, { recursive: true });

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [mcpLauncher],
  cwd: pluginDir,
  stderr: "pipe",
  env: { ...process.env, VITEST: "1", WEAVER_CANVAS_SURFACE: "localhost", WEAVER_DISABLE_AUTO_OPEN: "1", WEAVER_NO_AUTO_OPEN: "1", WEAVER_RUNTIME_ROOT: runtimeRoot, WEAVER_RUNTIME_IDLE_MS: "60000" },
});
const client = new Client({ name: "weaver-host-smoke", version: "0.1.0" });
const threadId = `weaver-host-smoke-${process.pid}`;
const _meta = { threadId, "x-codex-turn-metadata": { thread_id: threadId } };
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function unwrap(result) {
  if (result.isError) throw new Error(result.structuredContent?.code ?? result.structuredContent?.message ?? "MCP_TOOL_FAILED");
  const value = result.structuredContent;
  return value && Object.keys(value).length === 1 && Array.isArray(value.items) ? value.items : value;
}

const call = (name, args) => client.callTool({ name, arguments: args, _meta }).then(unwrap);
let browser;

try {
  await client.connect(transport);
  const created = await call("weaver_catalog_action", { workspaceDir, action: "create_project", title: "Host smoke", goal: "Verify Browser and bridge convergence", scenePackId: "free-brainstorming" });
  const project = created.project;
  const opened = await call("weaver_open_space", { workspaceDir, projectId: project.id });
  process.stdout.write(`WEAVER_HOST_SMOKE_LAUNCH=${JSON.stringify({ launchUrl: opened.launchUrl, expiresAt: opened.expiresAt, workspaceDir, projectId: project.id })}\n`);

  browser = await chromium.launch({ headless: process.env.WEAVER_SMOKE_HEADED !== "1" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const browserErrors = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto(opened.launchUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("toolbar", { name: "Canvas tools" }).waitFor({ state: "visible" });

  const deadline = Date.now() + 60_000;
  let bound;
  while (Date.now() < deadline) {
    try {
      bound = await call("weaver_read_session", { workspaceDir, resource: "bound_canvas" });
      if (bound.online && bound.projectId === project.id) break;
    } catch { /* Browser has not claimed the one-time launch yet */ }
    await sleep(250);
  }
  if (!bound?.online) throw new Error("HOST_SMOKE_CANVAS_NOT_CLAIMED");

  await call("weaver_canvas_action", { workspaceDir, action: "create_node", projectId: project.id, viewId: project.defaultViewId, semanticType: "idea", title: "Agent bridge write", content: { kind: "document", mode: "note", markdown: "Written through the release MCP bridge after the in-app Browser claimed the Canvas.", excerpt: "Release host smoke", embeddedAssetIds: [] }, x: 120, y: 80 });
  const graph = await call("weaver_read_graph", { workspaceDir, resource: "full", projectId: project.id, viewId: project.defaultViewId });
  if (!graph.nodes.some((node) => node.title === "Agent bridge write")) throw new Error("HOST_SMOKE_AGENT_WRITE_MISSING");
  await page.locator(".weaver-dom-node").filter({ hasText: "Agent bridge write" }).waitFor({ state: "visible" });
  if (browserErrors.length) throw new Error(`HOST_SMOKE_BROWSER_ERRORS:${JSON.stringify(browserErrors)}`);
  process.stdout.write(`WEAVER_HOST_SMOKE_RESULT=${JSON.stringify({ ok: true, launcher: mcpLauncher, projectId: project.id, graphRevision: graph.project.graphRevision, nodeCount: graph.nodes.length })}\n`);
} finally {
  await browser?.close().catch(() => undefined);
  await client.close().catch(() => undefined);
  rmSync(workspaceDir, { recursive: true, force: true });
  rmSync(runtimeRoot, { recursive: true, force: true });
}
