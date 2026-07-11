import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
});

function workspaceWithProject() {
  const root = mkdtempSync(join(tmpdir(), "weaver-open-")); roots.push(root); mkdirSync(root, { recursive: true });
  const store = new WorkspaceStore(root);
  const scene = getScenePack("free-brainstorming")!;
  const project = store.createProject({ title: "Open", goal: "", scenePack: scene });
  store.close();
  return { root, projectId: project.id };
}

describe("weaver_open_workspace_widget under the Claude host", () => {
  it("returns a tokenized preview URL and publishes preview.json", async () => {
    process.env.WEAVER_HOST_KIND = "claude";
    const { root, projectId } = workspaceWithProject();
    const srv = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(srv);
    const output = await srv.dispatch("weaver_open_workspace_widget", { workspaceDir: root, projectId }) as any;

    expect(output.isError).toBeFalsy();
    expect(output.structuredContent.previewUrl).toBe(srv.eventHub.previewUrl);
    expect(output.structuredContent.previewUrl).toContain(srv.eventHub.previewToken);
    expect(output.structuredContent.chatBinding.projectId).toBe(projectId);

    const preview = JSON.parse(readFileSync(join(root, ".weaver", "preview.json"), "utf8"));
    expect(preview.token).toBe(srv.eventHub.previewToken);
    expect(preview.url).toBe(srv.eventHub.previewUrl);
  });

  it("advertises the STABLE widget resource URI + widgetAccessible (the -32602/-32000 fix)", async () => {
    process.env.WEAVER_HOST_KIND = "codex";
    const srv = await createWeaverServer(); servers.push(srv);
    const meta = srv.toolMeta("weaver_open_workspace_widget") as any;
    // Codex reads this URI via resources/read to render the panel. It must be the
    // stable, un-versioned URI (always registered) — a build-versioned URI goes
    // stale after a rebuild and caused `-32602 Resource not found`.
    const STABLE = "ui://widget/weaver/workspace.html";
    expect(meta["openai/outputTemplate"]).toBe(STABLE);
    expect(meta.ui.resourceUri).toBe(STABLE);
    expect(meta["ui/resourceUri"]).toBe(STABLE);
    expect(meta["openai/widgetAccessible"]).toBe(true);
    expect(meta["openai/outputTemplate"]).not.toMatch(/workspace-[0-9a-f]{6,}\.html/);
  });

  it("retargets the preview to the agent's workspace when booted from a different (Codex cache) dir", async () => {
    process.env.WEAVER_HOST_KIND = "codex";
    // Boot the preview pinned to an empty "cache" dir (mirrors Codex running the
    // MCP from its plugin cache), then open a project in the real repo dir.
    const cacheDir = mkdtempSync(join(tmpdir(), "weaver-cache-")); roots.push(cacheDir);
    const { root, projectId } = workspaceWithProject();
    const srv = await createWeaverServer({ previewWorkspaceDir: cacheDir }); servers.push(srv);

    await srv.dispatch("weaver_open_workspace_widget", { workspaceDir: root, projectId });

    const token = srv.eventHub.previewToken;
    const bootstrap = await (await fetch(`${srv.eventHub.origin}/api/bootstrap`, { headers: { "x-weaver-preview-token": token } })).json();
    expect(bootstrap.workspaceDir).toBe(root);
    expect(bootstrap.chatBinding?.projectId).toBe(projectId);
    // preview.json now lives in the real repo, not the cache dir.
    expect(JSON.parse(readFileSync(join(root, ".weaver", "preview.json"), "utf8")).url).toBe(srv.eventHub.previewUrl);
  });

  it("keeps the loopback preview routes inactive when the process is not the Claude host", async () => {
    const srv = await createWeaverServer(); servers.push(srv);
    // No preview host configured → /preview is not served.
    const response = await fetch(`${srv.eventHub.origin}/preview?token=anything`);
    expect(response.status).toBe(404);
  });
});
