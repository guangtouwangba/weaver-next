import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "docs", "assets");
mkdirSync(output, { recursive: true });

const transport = new StdioClientTransport({
  command: "node",
  args: ["./scripts/start-mcp-claude.mjs"],
  cwd: resolve(root, "plugins", "weaver-next"),
  stderr: "pipe",
});
const client = new Client({ name: "weaver-readme-capture", version: "0.1.0" });

function structured(result) {
  if (result.isError) throw new Error(result.content?.find((item) => item.type === "text")?.text ?? "MCP tool failed");
  return result.structuredContent;
}

let browser;
try {
  await client.connect(transport);
  const projectsResult = structured(await client.callTool({ name: "weaver_read_catalog", arguments: { workspaceDir: root, resource: "project.list" } }));
  const projects = Array.isArray(projectsResult?.items) ? projectsResult.items : [];
  const acceptanceProjectTitle = "机器人研究 · Codex Widget 验收";
  let project = projects.find((item) => item.title === acceptanceProjectTitle);
  if (!project) {
    const created = structured(await client.callTool({ name: "weaver_catalog_action", arguments: { workspaceDir: root, action: "create_project", title: acceptanceProjectTitle, goal: "梳理人形机器人技术栈、核心部件与具身智能关系", scenePackId: "entity-relationship" } }));
    project = created.project;
  }
  const currentGraph = structured(await client.callTool({ name: "weaver_read_graph", arguments: { workspaceDir: root, resource: "full", projectId: project.id, viewId: project.defaultViewId } }));
  const existingTitles = new Set((currentGraph.nodes ?? []).map((node) => node.title));
  const robotNodes = ["核心部件与供应链", "关节模组", "伺服系统", "减速器", "具身智能模型"];
  for (const [index, title] of robotNodes.entries()) {
    if (existingTitles.has(title) || (currentGraph.nodes?.length ?? 0) + index >= 6) continue;
    structured(await client.callTool({ name: "weaver_canvas_action", arguments: { workspaceDir: root, action: "create_node", projectId: project.id, viewId: project.defaultViewId, semanticType: "entity", title, content: { kind: "document", mode: "note", markdown: `# ${title}`, excerpt: `机器人研究：${title}`, embeddedAssetIds: [] }, x: (index % 3) * 320 - 320, y: Math.floor(index / 3) * 220 - 120 } }));
  }
  const opened = structured(await client.callTool({
    name: "weaver_open_space",
    arguments: { workspaceDir: root, projectId: project.id, displayMode: "fullscreen" },
  }));
  if (!opened?.previewUrl) throw new Error("Claude preview URL was not returned");

  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(opened.previewUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
  await page.locator("#root").waitFor({ state: "visible" });
  const projectChoice = page.getByText(project.title, { exact: true });
  if (await projectChoice.count()) {
    await projectChoice.first().click({ timeout: 5_000 });
    await projectChoice.first().waitFor({ state: "hidden", timeout: 5_000 });
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: resolve(output, "weaver-overview.png"), fullPage: false });

  const canvas = page.locator(".react-flow");
  if (await canvas.count()) {
    await canvas.screenshot({ path: resolve(output, "weaver-social-preview.png") });
  } else {
    await page.screenshot({ path: resolve(output, "weaver-social-preview.png"), fullPage: false });
  }

  const newView = page.getByRole("button", { name: /New visual view|新建视觉视图/ });
  await newView.click({ timeout: 5_000 });
  const gallery = page.getByRole("dialog", { name: /Visual Template Gallery|视觉模板库/ });
  await gallery.waitFor({ state: "visible", timeout: 5_000 });
  if (await gallery.locator(".template-card").count() === 0) throw new Error("Template catalog rendered no cards");
  await page.screenshot({ path: resolve(output, "weaver-template-gallery.png"), fullPage: false });

  const templateCard = gallery.getByRole("button", { name: /概念关系网络/ });
  if (await templateCard.count()) {
    await templateCard.first().click({ timeout: 5_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: resolve(output, "weaver-template-detail.png"), fullPage: false });
  }
  await page.getByRole("button", { name: /Close template gallery|关闭模板库/ }).click({ timeout: 5_000 });

  const allViews = page.getByRole("button", { name: /All Views|全部视图/ });
  await allViews.click({ timeout: 5_000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(output, "weaver-view-library.png"), fullPage: false });

  if (errors.length) throw new Error(`Browser console errors: ${errors.join(" | ")}`);

  const inline = await browser.newPage({ viewport: { width: 920, height: 430 }, deviceScaleFactor: 1 });
  const inlineErrors = [];
  inline.on("console", (message) => { if (message.type() === "error") inlineErrors.push(message.text()); });
  const separator = opened.previewUrl.includes("?") ? "&" : "?";
  await inline.goto(`${opened.previewUrl}${separator}demo=1&displayMode=inline`, { waitUntil: "domcontentloaded", timeout: 15_000 });
  const entry = inline.locator(".inline-entry");
  await entry.waitFor({ state: "visible", timeout: 5_000 });
  await inline.screenshot({ path: resolve(output, "weaver-inline-entry.png"), fullPage: false });
  await entry.getByRole("button", { name: /Open fullscreen|全屏打开/ }).click();
  await inline.locator(".weaver-shell[data-display-mode='fullscreen']").waitFor({ state: "visible", timeout: 5_000 });
  await inline.getByRole("button", { name: "EN" }).click();
  await inline.getByRole("button", { name: "Back to chat" }).waitFor({ state: "visible", timeout: 5_000 });
  await inline.reload({ waitUntil: "domcontentloaded" });
  await inline.getByRole("button", { name: "Open fullscreen" }).waitFor({ state: "visible", timeout: 5_000 });
  const overflow = await inline.locator(".inline-entry").evaluate((element) => element.scrollWidth - element.clientWidth);
  if (overflow > 1) throw new Error(`Inline card overflows by ${overflow}px`);
  if (inlineErrors.length) throw new Error(`Inline browser console errors: ${inlineErrors.join(" | ")}`);

  const narrow = await browser.newPage({ viewport: { width: 480, height: 430 }, deviceScaleFactor: 1 });
  await narrow.goto(`${opened.previewUrl}${separator}demo=1&displayMode=inline`, { waitUntil: "domcontentloaded", timeout: 15_000 });
  await narrow.locator(".inline-entry").waitFor({ state: "visible", timeout: 5_000 });
  const narrowOverflow = await narrow.locator(".inline-entry").evaluate((element) => element.scrollWidth - element.clientWidth);
  if (narrowOverflow > 1) throw new Error(`Narrow inline card overflows by ${narrowOverflow}px`);
  console.log(`Captured README assets in ${output}`);
} finally {
  await browser?.close().catch(() => {});
  await client.close().catch(() => {});
}
