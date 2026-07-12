import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { layoutPlanSchema } from "@weaver/contracts";
import { getScenePack } from "@weaver/scene-packs";
import { WorkspaceStore } from "@weaver/storage";
import { createWeaverServer, type WeaverServer } from "../src/create-server.js";

const roots: string[] = [];
const servers: WeaverServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

const ts = "2026-07-12T00:00:00.000Z";
const node = (projectId: string, id: string, layer?: string) => ({ id, projectId, type: "idea", title: id, body: "", contentKind: "document" as const, content: { kind: "document" as const, mode: "note" as const, markdown: "", excerpt: "", embeddedAssetIds: [] }, properties: layer ? { layer } : {}, archived: false, createdAt: ts, updatedAt: ts });
const edge = (projectId: string, id: string, s: string, t: string) => ({ id, projectId, type: "relates-to", sourceNodeId: s, targetNodeId: t, directed: true, properties: {}, archived: false, createdAt: ts, updatedAt: ts });

async function setup(build: (store: WorkspaceStore, projectId: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "weaver-recommend-")); roots.push(root); mkdirSync(root, { recursive: true });
  const scene = getScenePack("free-brainstorming")!;
  const store = new WorkspaceStore(root);
  const project = store.createProject({ title: "Advice", goal: "", scenePack: scene });
  build(store, project.id);
  store.close();
  const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);
  return { root, server, project };
}

describe("weaver_recommend_layout", () => {
  it("recommends cluster for a layered graph and returns a runnable plan draft", async () => {
    const { root, server, project } = await setup((store, projectId) => {
      store.replaceGraph({ projectId, revision: 1, nodes: [node(projectId, "hub", "总览"), node(projectId, "a1", "赛道"), node(projectId, "a2", "赛道"), node(projectId, "b1", "产业链"), node(projectId, "b2", "产业链")], edges: [edge(projectId, "e1", "hub", "a1"), edge(projectId, "e2", "hub", "a2"), edge(projectId, "e3", "hub", "b1"), edge(projectId, "e4", "hub", "b2")] });
    });

    const res = await server.dispatch("weaver_recommend_layout", { workspaceDir: root, projectId: project.id }) as any;
    const payload = res.structuredContent;
    expect(payload.recommendedStrategy).toBe("cluster");
    expect(payload.signals).toMatchObject({ nodeCount: 5, edgeCount: 4 });
    expect(payload.signals.distinctLayers).toBeGreaterThanOrEqual(2);
    const labels = payload.clusterPreview.map((c: any) => c.label);
    expect(labels).toEqual(expect.arrayContaining(["赛道", "产业链"]));
    // The draft is a valid LayoutPlan and its base revisions match the live graph.
    const plan = layoutPlanSchema.parse(payload.suggestedPlan);
    expect(plan.strategy).toBe("cluster");
    expect(plan.baseGraphRevision).toBe(1);
    expect(plan.projectId).toBe(project.id);
  });

  it("recommends grid for an edgeless graph", async () => {
    const { root, server, project } = await setup((store, projectId) => {
      store.replaceGraph({ projectId, revision: 1, nodes: [node(projectId, "n1"), node(projectId, "n2"), node(projectId, "n3")], edges: [] });
    });

    const res = await server.dispatch("weaver_recommend_layout", { workspaceDir: root, projectId: project.id }) as any;
    expect(res.structuredContent.recommendedStrategy).toBe("grid");
    expect(res.structuredContent.signals.edgeCount).toBe(0);
  });
});
