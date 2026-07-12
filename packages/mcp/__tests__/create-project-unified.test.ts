import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

function freshRoot() {
  const root = mkdtempSync(join(tmpdir(), "weaver-create-unified-")); roots.push(root); mkdirSync(root, { recursive: true });
  return root;
}

// A known compatible scene-pack + template pairing (see storage workspace-store tests).
const SCENE_PACK_ID = "problem-decomposition";
const TEMPLATE_ID = "logic-tree";
const VERSION = "1.0.0";

/** Stable subset of a project payload — drops per-workspace ids/timestamps. */
function stableProject(project: any) {
  return {
    scenePackId: project.scenePackId,
    scenePackVersion: project.scenePackVersion,
    createdFromTemplate: project.createdFromTemplate,
    automationLevel: project.automationLevel,
    starterNodeCount: (project.starterNodeIds ?? []).length,
  };
}

describe("weaver_create_project (unified template creation)", () => {
  it("with template: matches weaver_create_project_from_visual_template", async () => {
    // Unified tool with the optional template param.
    const rootA = freshRoot();
    const serverA = await createWeaverServer({ previewWorkspaceDir: rootA }); servers.push(serverA);
    const viaUnified = await serverA.dispatch("weaver_create_project", {
      workspaceDir: rootA, title: "Decompose", goal: "Understand a problem", scenePackId: SCENE_PACK_ID,
      template: { templateId: TEMPLATE_ID, version: VERSION },
    }) as any;
    expect(viaUnified.isError).toBeFalsy();

    // Old dedicated template tool, same inputs in an independent workspace.
    const rootB = freshRoot();
    const serverB = await createWeaverServer({ previewWorkspaceDir: rootB }); servers.push(serverB);
    const viaOld = await serverB.dispatch("weaver_create_project_from_visual_template", {
      workspaceDir: rootB, title: "Decompose", goal: "Understand a problem", scenePackId: SCENE_PACK_ID,
      templateId: TEMPLATE_ID, version: VERSION,
    }) as any;
    expect(viaOld.isError).toBeFalsy();

    // Same payload SHAPE (project + starter graph + themed view + binding).
    expect(Object.keys(viaUnified.structuredContent).sort()).toEqual(Object.keys(viaOld.structuredContent).sort());
    // Same starter graph (nodes + edges counts), and more than a lone root node.
    expect(viaUnified.structuredContent.graph.nodes.length).toBe(viaOld.structuredContent.graph.nodes.length);
    expect(viaUnified.structuredContent.graph.nodes.length).toBeGreaterThan(1);
    expect(viaUnified.structuredContent.graph.edges.length).toBe(viaOld.structuredContent.graph.edges.length);
    // Same themed default view.
    expect(viaUnified.structuredContent.layout.viewName).toBe(viaOld.structuredContent.layout.viewName);
    // Same stable project attributes + a chat binding on both.
    expect(stableProject(viaUnified.structuredContent.project)).toEqual(stableProject(viaOld.structuredContent.project));
    expect(viaUnified.structuredContent.binding).toBeTruthy();
    expect(viaOld.structuredContent.binding).toBeTruthy();
    expect(viaUnified.structuredContent.project.createdFromTemplate).toEqual({ id: TEMPLATE_ID, version: VERSION });
  });

  it("without template: creates a plain project with one root node (unchanged)", async () => {
    const root = freshRoot();
    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);
    const res = await server.dispatch("weaver_create_project", {
      workspaceDir: root, title: "Plain", goal: "", scenePackId: "free-brainstorming",
    }) as any;
    expect(res.isError).toBeFalsy();
    // Plain path returns the project fields flat (no nested graph/layout).
    expect(res.structuredContent.graph).toBeUndefined();
    expect(res.structuredContent.title).toBe("Plain");
    const store = new WorkspaceStore(root);
    try {
      const graph = store.getGraph(res.structuredContent.id);
      expect(graph.nodes.length).toBe(1);
    } finally {
      store.close();
    }
  });

  it("keeps create_project model-facing and reclassifies the template tool off the model surface (still registered)", async () => {
    const root = freshRoot();
    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);
    const diagnostics = await server.dispatch("weaver_get_diagnostics", {}) as any;
    const modelFacing: string[] = diagnostics.structuredContent.toolSurface.modelFacingNames;
    expect(modelFacing).toContain("weaver_create_project");
    expect(modelFacing).not.toContain("weaver_create_project_from_visual_template");
    // But the template tool stays registered under its exact name for the widget.
    expect(server.toolMeta("weaver_create_project_from_visual_template")).toBeTruthy();
  });
});
