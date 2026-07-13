import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { getScenePack } from "@weaver/scene-packs";
import { WorkspaceStore } from "@weaver/storage";
import { createWeaverServer } from "../src/create-server.js";

const roots: string[] = [];
const servers: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
  delete process.env.WEAVER_HOST_KIND;
  delete process.env.WEAVER_CANVAS_SURFACE;
  delete process.env.WEAVER_CANVAS_FALLBACK_REASON;
});

function workspaceWithProject() {
  const root = mkdtempSync(join(tmpdir(), "weaver-open-")); roots.push(root); mkdirSync(root, { recursive: true });
  const store = new WorkspaceStore(root);
  const scene = getScenePack("free-brainstorming")!;
  const project = store.catalog.createProject({ title: "Open", goal: "", scenePack: scene });
  store.close();
  return { root, projectId: project.id };
}

describe("weaver_open_space localhost launch", () => {
  it.each([undefined, "inline"])("returns the canonical localhost launch regardless of legacy displayMode=%s", async (displayMode) => {
    process.env.WEAVER_HOST_KIND = "codex";
    const { root, projectId } = workspaceWithProject();
    const srv = await createWeaverServer(); servers.push(srv);
    const output = await srv.dispatch("weaver_open_space", { workspaceDir: root, projectId, ...(displayMode ? { displayMode } : {}) }) as any;

    expect(output.isError, JSON.stringify(output)).toBeFalsy();
    expect(output.structuredContent.launchUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/launch\//);
    expect(output.structuredContent.protocolVersion).toBe(1);
    expect(output.structuredContent.preferredDisplayMode).toBeUndefined();
  });

  it("keeps localhost as the default but can explicitly activate the audited native Widget rollback", async () => {
    process.env.WEAVER_HOST_KIND = "codex";
    process.env.WEAVER_CANVAS_SURFACE = "legacy-widget";
    process.env.WEAVER_CANVAS_FALLBACK_REASON = "P0_OPEN_FAILURE";
    const { root, projectId } = workspaceWithProject();
    const srv = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(srv);

    expect(srv.toolMeta("weaver_open_space")).toMatchObject({
      "openai/outputTemplate": "ui://widget/weaver/workspace.html",
      ui: { resourceUri: "ui://widget/weaver/workspace.html" },
    });
    const output = await srv.dispatch("weaver_open_space", { workspaceDir: root, projectId }) as any;

    expect(output.isError, JSON.stringify(output)).toBeFalsy();
    expect(output.structuredContent).toMatchObject({
      widget: "weaver-workspace",
      workspaceDir: root,
      projectId,
      rendering: "native-widget",
      chatBinding: { projectId, bindingRevision: 1 },
    });
    expect(output.structuredContent.launchUrl).toBeUndefined();
    const diagnostics = await srv.dispatch("weaver_get_diagnostics", { workspaceDir: root }) as any;
    expect(diagnostics.structuredContent.recent).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: "canvas.legacyFallbackUsed", code: "P0_OPEN_FAILURE", status: "active", actionKey: "legacy-widget" }),
    ]));
    expect(diagnostics.structuredContent.runtime).toEqual(expect.arrayContaining([
      expect.objectContaining({ component: "supervisor", event: "canvas.legacyFallbackUsed", code: "P0_OPEN_FAILURE", status: "active", actionKey: "legacy-widget" }),
    ]));
  });
});

describe("weaver_open_space under the Claude host", () => {
  it("does not persist preview capability metadata before a workspace is explicitly opened", async () => {
    process.env.WEAVER_HOST_KIND = "codex";
    const cacheDir = mkdtempSync(join(tmpdir(), "weaver-cache-")); roots.push(cacheDir);
    mkdirSync(join(cacheDir, ".weaver"));
    writeFileSync(join(cacheDir, ".weaver", "preview-target.json"), JSON.stringify({ workspaceDir: "/private/legacy" }));
    const srv = await createWeaverServer({ previewWorkspaceDir: cacheDir }); servers.push(srv);

    expect(() => readFileSync(join(cacheDir, ".weaver", "preview.json"), "utf8")).toThrow();
    expect(() => readFileSync(join(cacheDir, ".weaver", "preview-target.json"), "utf8")).toThrow();
  });

  it("returns a one-time localhost launch without legacy preview capability metadata", async () => {
    process.env.WEAVER_HOST_KIND = "claude";
    const { root, projectId } = workspaceWithProject();
    const srv = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(srv);
    const output = await srv.dispatch("weaver_open_space", { workspaceDir: root, projectId }) as any;

    expect(output.isError).toBeFalsy();
    expect(output.structuredContent.launchUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/launch\//);
    expect(output.structuredContent.projectId).toBe(projectId);
    expect(output.structuredContent.previewUrl).toBeUndefined();
    expect(output.structuredContent.previewToken).toBeUndefined();
    expect(output.structuredContent.chatBinding).toBeUndefined();
    expect(() => readFileSync(join(root, ".weaver", "preview.json"), "utf8")).toThrow();
  });

  it("does not advertise a full Canvas ui resource", async () => {
    process.env.WEAVER_HOST_KIND = "codex";
    const srv = await createWeaverServer(); servers.push(srv);
    const meta = srv.toolMeta("weaver_open_space") as any;
    expect(meta?.["openai/outputTemplate"]).toBeUndefined();
    expect(meta?.ui?.resourceUri).toBeUndefined();
    expect(meta?.["ui/resourceUri"]).toBeUndefined();
    expect(meta?.["openai/widgetAccessible"]).toBeUndefined();
  });

  it("pins the independent runtime to the requested workspace when MCP boots from a cache dir", async () => {
    process.env.WEAVER_HOST_KIND = "codex";
    // Boot the preview pinned to an empty "cache" dir (mirrors Codex running the
    // MCP from its plugin cache), then open a project in the real repo dir.
    const cacheDir = mkdtempSync(join(tmpdir(), "weaver-cache-")); roots.push(cacheDir);
    const { root, projectId } = workspaceWithProject();
    const srv = await createWeaverServer({ previewWorkspaceDir: cacheDir }); servers.push(srv);

    const opened = await srv.dispatch("weaver_open_space", { workspaceDir: root, projectId }) as any;
    const claimed = await fetch(opened.structuredContent.launchUrl, { redirect: "manual" });
    expect(claimed.status).toBe(303);
    const origin = new URL(opened.structuredContent.launchUrl).origin;
    const bootstrap = await (await fetch(`${origin}/api/bootstrap`, { headers: { cookie: claimed.headers.get("set-cookie")!.split(";")[0] } })).json();
    expect(bootstrap.projectId).toBe(projectId);
    expect(bootstrap.workspaceDir).toBeUndefined();
  });

  it("keeps the loopback preview routes inactive when the process is not the Claude host", async () => {
    const srv = await createWeaverServer(); servers.push(srv);
    // No preview host configured → /preview is not served.
    const response = await fetch(`${srv.eventHub.origin}/preview?token=anything`);
    expect(response.status).toBe(404);
  });
});
