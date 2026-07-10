import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const roots: string[] = [];
const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

function metadata() {
  return { threadId: "view-tools-thread", "x-codex-turn-metadata": { thread_id: "view-tools-thread" } };
}

async function fixture() {
  const workspaceDir = mkdtempSync(join(tmpdir(), "weaver-view-tools-")); roots.push(workspaceDir);
  const transport = new StdioClientTransport({ command: "node", args: ["./scripts/start-mcp.mjs"], cwd: process.cwd(), stderr: "pipe" });
  const client = new Client({ name: "view-tools-test", version: "1.0.0" }); clients.push(client); await client.connect(transport);
  const created = await client.callTool({ name: "weaver_create_project", arguments: { workspaceDir, title: "Views", goal: "", scenePackId: "free-brainstorming" }, _meta: metadata() });
  if (created.isError) throw new Error(created.content.find((item: any) => item.type === "text")?.text ?? "create failed");
  return { workspaceDir, client, project: created.structuredContent as any };
}

describe("View Catalog MCP tools", () => {
  it("lists and renames saved Views through structured tools", async () => {
    const { workspaceDir, client, project } = await fixture();
    const listed = await client.callTool({ name: "weaver_list_project_views", arguments: { workspaceDir, projectId: project.id }, _meta: metadata() });
    expect(listed.isError).toBeFalsy();
    const views = (listed.structuredContent as any).items;
    expect(views).toHaveLength(1);
    const renamed = await client.callTool({ name: "weaver_rename_project_view", arguments: { workspaceDir, projectId: project.id, viewId: views[0].id, name: "My canvas", baseCatalogRevision: project.viewCatalogRevision }, _meta: metadata() });
    expect(renamed.isError).toBeFalsy();
    expect((renamed.structuredContent as any).view.name).toBe("My canvas");
  }, 15_000);

  it("protects the last active View from deletion", async () => {
    const { workspaceDir, client, project } = await fixture();
    const deleted = await client.callTool({ name: "weaver_trash_project_view", arguments: { workspaceDir, projectId: project.id, viewId: project.defaultViewId, baseCatalogRevision: project.viewCatalogRevision }, _meta: metadata() });
    expect(deleted.isError).toBe(true);
    expect((deleted.structuredContent as any).code).toBe("LAST_ACTIVE_VIEW");
  }, 15_000);
});
