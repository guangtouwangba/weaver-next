import { expect, test } from "@playwright/test";
import { inlineWidgetHtml, widgetBundle } from "../packages/mcp/src/widget";

test("Codex inline Widget keeps the application bundle inside its module script", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://weaver.test/", (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: inlineWidgetHtml(widgetBundle()) }));
  await page.goto("https://weaver.test/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#root")).not.toBeEmpty();
  await expect(page.locator("body")).not.toContainText("[tiptap error]");
  expect((await page.locator("body").innerText()).length).toBeLessThan(20_000);
  // This isolated page intentionally has no Apps-SDK host transport.
  expect(errors.filter((message) => message !== "Not connected")).toEqual([]);
});

test("Codex reopen uses the display-mode request result without waiting for another host notification", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const html = inlineWidgetHtml(widgetBundle());
  await page.route("https://codex.test/", (route) => route.fulfill({
    contentType: "text/html; charset=utf-8",
    body: '<iframe id="widget" style="width:1200px;height:800px"></iframe>',
  }));
  await page.goto("https://codex.test/");
  await page.evaluate((source) => {
    const iframe = document.querySelector<HTMLIFrameElement>("#widget")!;
    window.addEventListener("message", (event) => {
      const message = event.data as { id?: number; method?: string };
      if (message.method === "ui/initialize") {
        event.source?.postMessage({ jsonrpc: "2.0", id: message.id, result: {
          protocolVersion: "2026-01-26",
          hostInfo: { name: "diagnostic-host", version: "1" },
          hostCapabilities: {},
          hostContext: { displayMode: "fullscreen", availableDisplayModes: ["inline", "fullscreen"] },
        } }, { targetOrigin: "*" });
      } else if (message.method === "ui/request-display-mode") {
        event.source?.postMessage({ jsonrpc: "2.0", id: message.id, result: { mode: "fullscreen" } }, { targetOrigin: "*" });
      }
    });
    iframe.srcdoc = source;
  }, html);

  const frame = page.frameLocator("#widget");
  await expect(frame.locator(".weaver-shell")).toBeVisible();
  await page.locator("#widget").evaluate((iframe: HTMLIFrameElement) => {
    iframe.contentWindow?.postMessage({ jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { displayMode: "inline" } }, "*");
  });
  const reopen = frame.getByRole("button", { name: /重新打开 Weaver|Reopen Weaver/ });
  await expect(reopen).toBeVisible();
  await reopen.click();
  await expect(frame.locator('.weaver-shell[data-display-mode="fullscreen"]')).toBeVisible();
  await expect(reopen).not.toBeVisible();
  expect(errors).toEqual([]);
});
