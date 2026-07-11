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
  const opened = structured(await client.callTool({
    name: "weaver_open_workspace_widget",
    arguments: { workspaceDir: root, displayMode: "fullscreen" },
  }));
  if (!opened?.previewUrl) throw new Error("Claude preview URL was not returned");

  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(opened.previewUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
  await page.locator("#root").waitFor({ state: "visible" });
  const projectChoice = page.getByText("机器人产业全景图（2026）", { exact: true });
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

  const newView = page.getByRole("button", { name: "New visual view" });
  await newView.click({ timeout: 5_000 });
  const gallery = page.getByRole("dialog", { name: "Visual Template Gallery" });
  await gallery.waitFor({ state: "visible", timeout: 5_000 });
  await page.screenshot({ path: resolve(output, "weaver-template-gallery.png"), fullPage: false });

  const templateCard = gallery.getByRole("button", { name: /概念关系网络/ });
  if (await templateCard.count()) {
    await templateCard.first().click({ timeout: 5_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: resolve(output, "weaver-template-detail.png"), fullPage: false });
  }
  await page.getByRole("button", { name: "Close template gallery" }).click({ timeout: 5_000 });

  const allViews = page.getByRole("button", { name: /All Views/ });
  await allViews.click({ timeout: 5_000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(output, "weaver-view-library.png"), fullPage: false });

  if (errors.length) throw new Error(`Browser console errors: ${errors.join(" | ")}`);
  console.log(`Captured README assets in ${output}`);
} finally {
  await browser?.close().catch(() => {});
  await client.close().catch(() => {});
}
