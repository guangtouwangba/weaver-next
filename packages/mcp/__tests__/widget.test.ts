import { describe, expect, it } from "vitest";
import { bundledWidgetHtml, inlineWidgetHtml, runtimeMode, shouldBlockWorkspaceBuildMismatch, widgetBuildId, widgetBundle, widgetResourceUri, workspaceWidgetBuildId } from "../src/widget.js";

describe("Widget runtime metadata", () => {
  it("embeds the same build id reported by the MCP server", () => {
    const buildId = widgetBuildId();
    expect(buildId).toMatch(/^[a-f0-9]{12}$/);
    const html = bundledWidgetHtml("http://127.0.0.1:1234/widget-assets/test/token/", widgetBundle());
    expect(html).toContain(`window.__weaverEmbeddedBuildId=${JSON.stringify(buildId)}`);
    expect(html.length).toBeLessThan(20_000);
    expect(html).toContain("http://127.0.0.1:1234/widget-assets/test/token/");
    expect(html).not.toContain("createRoot(");
    expect(workspaceWidgetBuildId(process.cwd())).toBe(buildId);
  });

  it("inlines Codex widget assets instead of depending on loopback URLs", () => {
    const html = inlineWidgetHtml(widgetBundle());
    expect(html).toContain(`window.__weaverEmbeddedBuildId=${JSON.stringify(widgetBuildId())}`);
    expect(html).toContain("createRoot(");
    expect(html).toContain("<style>");
    expect(html).not.toContain("http://127.0.0.1:");
    expect(html).not.toMatch(/(?:href|src)="\.\/[^\"]+\.(?:css|js)"/);
  });

  it("versions the Codex app resource URI by widget build", () => {
    expect(widgetResourceUri("abc123def456")).toBe("ui://widget/weaver/workspace-abc123def456.html");
    expect(widgetResourceUri("fedcba654321")).not.toBe(widgetResourceUri("abc123def456"));
  });

  it("defaults to installed runtime mode", () => {
    expect(runtimeMode()).toBe(process.env.WEAVER_RUNTIME_MODE === "development" ? "development" : "installed");
  });

  it("does not reject an installed plugin merely because the workspace has a newer development build", () => {
    expect(shouldBlockWorkspaceBuildMismatch("installed", "installed-build", "workspace-build")).toBe(false);
    expect(shouldBlockWorkspaceBuildMismatch("development", "installed-build", "workspace-build")).toBe(true);
    expect(shouldBlockWorkspaceBuildMismatch("development", "same-build", "same-build")).toBe(false);
  });
});
