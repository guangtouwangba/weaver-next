import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getScenePack } from "@weaver/scene-packs";
import { WorkspaceStore } from "@weaver/storage";
import { createWeaverServer, type WeaverServer } from "../src/create-server.js";

const roots: string[] = [];
const servers: WeaverServer[] = [];
let priorHostKind: string | undefined;

beforeEach(() => {
  priorHostKind = process.env.WEAVER_HOST_KIND;
  process.env.WEAVER_HOST_KIND = "claude";
});
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
  if (priorHostKind === undefined) delete process.env.WEAVER_HOST_KIND;
  else process.env.WEAVER_HOST_KIND = priorHostKind;
});

/** Seed a project with two distinctly-typed content nodes for graph reads. */
function seedGraph(root: string) {
  const scene = getScenePack("free-brainstorming")!;
  const store = new WorkspaceStore(root);
  try {
    const project = store.createProject({ title: "Graph", goal: "", scenePack: scene });
    const alpha = store.createContentNode({ projectId: project.id, viewId: project.defaultViewId, type: "idea", title: "Alpha", content: { kind: "document", markdown: "Alpha body" } as any, x: 0, y: 0 });
    const beta = store.createContentNode({ projectId: project.id, viewId: project.defaultViewId, type: "question", title: "Beta", content: { kind: "document", markdown: "Beta body" } as any, x: 100, y: 100 });
    return { projectId: project.id, viewId: project.defaultViewId, alphaId: alpha.node.id, betaId: beta.node.id };
  } finally {
    store.close();
  }
}

describe("weaver_read_graph", () => {
  it("reads the project manifest, matching weaver_get_project_manifest", async () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-read-graph-")); roots.push(root); mkdirSync(root, { recursive: true });
    const { projectId } = seedGraph(root);
    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);

    const grouped = await server.dispatch("weaver_read_graph", { workspaceDir: root, resource: "manifest", projectId }) as any;
    const legacy = await server.dispatch("weaver_get_project_manifest", { workspaceDir: root, projectId }) as any;
    expect(grouped.isError).toBeFalsy();
    expect(grouped.structuredContent).toEqual(legacy.structuredContent);
    expect(grouped.structuredContent.project.id).toBe(projectId);

    const missing = await server.dispatch("weaver_read_graph", { workspaceDir: root, resource: "manifest" }) as any;
    expect(missing.isError).toBe(true);
    expect(missing.structuredContent.code).toBe("GRAPH_RESOURCE_REQUIRES_projectId");
  });

  it("reads the full graph + layout, matching weaver_get_project_graph", async () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-read-graph-")); roots.push(root); mkdirSync(root, { recursive: true });
    const { projectId, viewId } = seedGraph(root);
    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);

    const grouped = await server.dispatch("weaver_read_graph", { workspaceDir: root, resource: "full", projectId, viewId }) as any;
    const legacy = await server.dispatch("weaver_get_project_graph", { workspaceDir: root, projectId, viewId }) as any;
    expect(grouped.isError).toBeFalsy();
    expect(grouped.structuredContent).toEqual(legacy.structuredContent);
    expect(grouped.structuredContent.nodes).toHaveLength(2);
    expect(grouped.structuredContent).toHaveProperty("layout");
  });

  it("queries filtered nodes/edges, matching weaver_query_graph", async () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-read-graph-")); roots.push(root); mkdirSync(root, { recursive: true });
    const { projectId, alphaId } = seedGraph(root);
    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);

    const grouped = await server.dispatch("weaver_read_graph", { workspaceDir: root, resource: "query", projectId, nodeTypes: ["idea"] }) as any;
    expect(grouped.isError).toBeFalsy();
    expect(grouped.structuredContent.nodes.map((n: any) => n.id)).toEqual([alphaId]);

    const byText = await server.dispatch("weaver_read_graph", { workspaceDir: root, resource: "query", projectId, text: "beta" }) as any;
    expect(byText.structuredContent.nodes).toHaveLength(1);
    expect(byText.structuredContent.nodes[0].title).toBe("Beta");
    expect(byText.structuredContent).toHaveProperty("revision");
  });

  it("fetches a known set of nodes via the nodeIds filter", async () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-read-graph-")); roots.push(root); mkdirSync(root, { recursive: true });
    const { projectId, alphaId, betaId } = seedGraph(root);
    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);

    const both = await server.dispatch("weaver_read_graph", { workspaceDir: root, resource: "query", projectId, nodeIds: [alphaId, betaId] }) as any;
    expect(both.isError).toBeFalsy();
    expect(both.structuredContent.nodes.map((n: any) => n.id).sort()).toEqual([alphaId, betaId].sort());

    const one = await server.dispatch("weaver_read_graph", { workspaceDir: root, resource: "query", projectId, nodeIds: [betaId] }) as any;
    expect(one.structuredContent.nodes.map((n: any) => n.id)).toEqual([betaId]);
  });

  it("rejects a limit over the 200 cap at the schema", async () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-read-graph-")); roots.push(root); mkdirSync(root, { recursive: true });
    const { projectId } = seedGraph(root);
    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);

    await expect(server.dispatch("weaver_read_graph", { workspaceDir: root, resource: "query", projectId, limit: 100000 })).rejects.toThrow();
    // The cap boundary is accepted.
    const ok = await server.dispatch("weaver_read_graph", { workspaceDir: root, resource: "query", projectId, limit: 200 }) as any;
    expect(ok.isError).toBeFalsy();
  });

  it("reads full single-node content, matching weaver_get_node_content", async () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-read-graph-")); roots.push(root); mkdirSync(root, { recursive: true });
    const { projectId, alphaId } = seedGraph(root);
    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);

    const grouped = await server.dispatch("weaver_read_graph", { workspaceDir: root, resource: "node", projectId, nodeId: alphaId }) as any;
    const legacy = await server.dispatch("weaver_get_node_content", { workspaceDir: root, projectId, nodeId: alphaId }) as any;
    expect(grouped.isError).toBeFalsy();
    expect(grouped.structuredContent).toEqual(legacy.structuredContent);
    expect(grouped.structuredContent.node.id).toBe(alphaId);

    const missing = await server.dispatch("weaver_read_graph", { workspaceDir: root, resource: "node", projectId }) as any;
    expect(missing.isError).toBe(true);
    expect(missing.structuredContent.code).toBe("GRAPH_RESOURCE_REQUIRES_nodeId");
  });

  it("is model-facing while the widget-only graph reads are not", async () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-read-graph-")); roots.push(root); mkdirSync(root, { recursive: true });
    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);

    const diagnostics = await server.dispatch("weaver_get_diagnostics", {}) as any;
    const modelFacing: string[] = diagnostics.structuredContent.toolSurface.modelFacingNames;
    expect(modelFacing).toContain("weaver_read_graph");
    // Reclassified widget reads are off the model surface but still registered.
    expect(modelFacing).not.toContain("weaver_get_project_manifest");
    expect(modelFacing).not.toContain("weaver_get_project_graph");
    expect(modelFacing).not.toContain("weaver_get_node_content");
    // Folded-away model-only tool is gone from the surface entirely.
    expect(modelFacing).not.toContain("weaver_query_graph");

    // The reclassified tools must remain registered under their exact names for the widget.
    expect(server.toolMeta("weaver_get_project_manifest")).toBeTruthy();
    expect(server.toolMeta("weaver_get_project_graph")).toBeTruthy();
    expect(server.toolMeta("weaver_get_node_content")).toBeTruthy();
  });
});
