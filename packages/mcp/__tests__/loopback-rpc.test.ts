import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { getScenePack } from "@weaver/scene-packs";
import { WorkspaceStore } from "@weaver/storage";
import { SseEventHub } from "../src/event-hub.js";
import { widgetBuildId } from "../src/widget.js";

const roots: string[] = [];
const hubs: SseEventHub[] = [];
afterEach(async () => {
  await Promise.all(hubs.splice(0).map((hub) => hub.close()));
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

function chatKey(id: string) { return createHash("sha256").update(`claude-session:${id}`).digest("hex"); }

async function previewHub(options: { dispatch?: (name: string, args: Record<string, unknown>) => Promise<unknown> } = {}) {
  const root = mkdtempSync(join(tmpdir(), "weaver-rpc-")); roots.push(root); mkdirSync(root, { recursive: true });
  const store = new WorkspaceStore(root);
  const scene = getScenePack("free-brainstorming")!;
  const project = store.createProject({ title: "RPC", goal: "", scenePack: scene });
  const key = chatKey("proc-rpc");
  const binding = store.openChatCanvasBinding({ chatSessionKey: key, projectId: project.id, viewId: project.defaultViewId });
  store.close();
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const dispatch = options.dispatch ?? (async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { content: [{ type: "text", text: "OK" }], structuredContent: { ok: true, echoWorkspace: args.workspaceDir } }; });
  const hub = new SseEventHub(); hubs.push(hub); await hub.start();
  hub.configurePreview({ workspaceDir: root, chatSessionKey: key, dispatch, allowlist: new Set(["weaver_list_projects", "weaver_sync_canvas_context"]) });
  hub.writePreviewFile();
  return { root, hub, project, binding, key, calls };
}

describe("loopback preview RPC", () => {
  it("rejects preview routes without the capability token", async () => {
    const { hub } = await previewHub();
    expect((await fetch(`${hub.origin}/api/bootstrap`)).status).toBe(401);
    expect((await fetch(`${hub.origin}/preview`)).status).toBe(401);
    const rpc = await fetch(`${hub.origin}/mcp-rpc`, { method: "POST", body: JSON.stringify({ name: "weaver_list_projects" }) });
    expect(rpc.status).toBe(401);
  });

  it("dispatches an allowlisted tool and pins the workspace", async () => {
    const { hub, root, calls } = await previewHub();
    const response = await fetch(`${hub.origin}/mcp-rpc?token=${hub.previewToken}`, { method: "POST", body: JSON.stringify({ name: "weaver_list_projects", arguments: {} }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.structuredContent).toMatchObject({ ok: true, echoWorkspace: root });
    expect(calls[0]).toMatchObject({ name: "weaver_list_projects", args: { workspaceDir: root } });
  });

  it("rejects tools outside the allowlist", async () => {
    const { hub } = await previewHub();
    const response = await fetch(`${hub.origin}/mcp-rpc?token=${hub.previewToken}`, { method: "POST", body: JSON.stringify({ name: "weaver_open_workspace_widget", arguments: {} }) });
    expect(response.status).toBe(403);
    expect((await response.json()).structuredContent.code).toBe("TOOL_NOT_ALLOWED");
  });

  it("rejects a workspaceDir that is not the pinned workspace", async () => {
    const { hub } = await previewHub();
    const response = await fetch(`${hub.origin}/mcp-rpc?token=${hub.previewToken}`, { method: "POST", body: JSON.stringify({ name: "weaver_list_projects", arguments: { workspaceDir: "/evil/path" } }) });
    expect(response.status).toBe(403);
    expect((await response.json()).structuredContent.code).toBe("WORKSPACE_SCOPE_VIOLATION");
  });

  it("serves bootstrap with the live chat binding and current build id", async () => {
    const { hub, root, project, binding } = await previewHub();
    const response = await fetch(`${hub.origin}/api/bootstrap`, { headers: { "x-weaver-preview-token": hub.previewToken } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ host: "claude", workspaceDir: root, buildId: widgetBuildId() });
    expect(body.chatBinding).toMatchObject({ leaseId: binding.leaseId, bindingRevision: binding.bindingRevision, projectId: project.id, viewId: project.defaultViewId });
  });

  it("serves the preview HTML with an injected bootstrap and a strict CSP", async () => {
    const { hub } = await previewHub();
    const response = await fetch(`${hub.origin}/preview?token=${hub.previewToken}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("content-security-policy")).toContain(hub.origin);
    const html = await response.text();
    expect(html).toContain("window.__weaverPreview");
    expect(html).toContain(hub.previewToken);
    expect(html).toContain('"host":"claude"');
  });

  it("publishes preview.json as an owner-only capability file matching the build id", async () => {
    const { hub, root } = await previewHub();
    const file = join(root, ".weaver", "preview.json");
    const meta = statSync(file);
    expect(meta.mode & 0o777).toBe(0o600);
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    expect(parsed).toMatchObject({ token: hub.previewToken, origin: hub.origin, buildId: widgetBuildId() });
    expect(parsed.url).toBe(hub.previewUrl);
  });
});
