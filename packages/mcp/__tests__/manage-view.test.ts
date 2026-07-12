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
  const root = mkdtempSync(join(tmpdir(), "weaver-manage-view-")); roots.push(root); mkdirSync(root, { recursive: true });
  return root;
}

// A known compatible scene-pack + template pairing (see create-project-unified.test.ts).
const SCENE_PACK_ID = "problem-decomposition";
const TEMPLATE_ID = "logic-tree";
const VERSION = "1.0.0";

async function newServer(root: string) {
  const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server); return server;
}

/** Create a template-seeded, chat-bound project; return the fields the view
 * lifecycle writes need (viewId, revisions, binding lease). */
async function createBoundProject(server: WeaverServer, root: string) {
  const res = await server.dispatch("weaver_create_project", {
    workspaceDir: root, title: "Decompose", goal: "Understand a problem", scenePackId: SCENE_PACK_ID,
    template: { templateId: TEMPLATE_ID, version: VERSION },
  }) as any;
  expect(res.isError).toBeFalsy();
  const projectId = res.structuredContent.project.id as string;
  const binding = res.structuredContent.binding as { leaseId: string; bindingRevision: number };
  const store = new WorkspaceStore(root);
  try {
    const project = store.getProject(projectId)!;
    return { projectId, defaultViewId: project.defaultViewId, viewCatalogRevision: project.viewCatalogRevision, graphRevision: project.graphRevision, binding };
  } finally { store.close(); }
}

describe("weaver_manage_view", () => {
  it("open_or_create opens an independent stored view for a scene view type", async () => {
    const root = freshRoot();
    const server = await newServer(root);
    const project = await createBoundProject(server, root);

    // "flow" is a recommended (non-default) view for problem-decomposition,
    // exercising the defaultStrategyByView path the old get_or_create_view used.
    const res = await server.dispatch("weaver_manage_view", {
      workspaceDir: root, projectId: project.projectId, action: "open_or_create", viewType: "flow",
    }) as any;
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent.viewId).toBe("flow-default");
    expect(res.structuredContent.viewType).toBe("flow");
    // graphRevision is untouched by opening a view.
    const store = new WorkspaceStore(root);
    try { expect(store.getProject(project.projectId)!.graphRevision).toBe(project.graphRevision); } finally { store.close(); }
  });

  it("duplicate matches the still-registered weaver_duplicate_project_view", async () => {
    const rootA = freshRoot();
    const serverA = await newServer(rootA);
    const projectA = await createBoundProject(serverA, rootA);
    const viaManage = await serverA.dispatch("weaver_manage_view", {
      workspaceDir: rootA, projectId: projectA.projectId, action: "duplicate", viewId: projectA.defaultViewId,
      name: "Copy", baseCatalogRevision: projectA.viewCatalogRevision,
      leaseId: projectA.binding.leaseId, bindingRevision: projectA.binding.bindingRevision,
    }) as any;
    expect(viaManage.isError).toBeFalsy();

    const rootB = freshRoot();
    const serverB = await newServer(rootB);
    const projectB = await createBoundProject(serverB, rootB);
    const viaOld = await serverB.dispatch("weaver_duplicate_project_view", {
      workspaceDir: rootB, projectId: projectB.projectId, viewId: projectB.defaultViewId,
      name: "Copy", baseCatalogRevision: projectB.viewCatalogRevision,
      leaseId: projectB.binding.leaseId, bindingRevision: projectB.binding.bindingRevision,
    }) as any;
    expect(viaOld.isError).toBeFalsy();

    // Identical payload shape; both create a new independent view over the same graph.
    expect(Object.keys(viaManage.structuredContent).sort()).toEqual(Object.keys(viaOld.structuredContent).sort());
    expect(viaManage.structuredContent.view.id).not.toBe(projectA.defaultViewId);
    expect(viaManage.structuredContent.view.name).toBe("Copy");
    // The duplicate advanced the catalog revision and persisted a new view.
    const store = new WorkspaceStore(rootA);
    try { expect(store.getProject(projectA.projectId)!.viewCatalogRevision).toBe(projectA.viewCatalogRevision + 1); } finally { store.close(); }
  });

  it("create_from_template matches the still-registered weaver_create_view_from_visual_template", async () => {
    const rootA = freshRoot();
    const serverA = await newServer(rootA);
    const projectA = await createBoundProject(serverA, rootA);
    const viaManage = await serverA.dispatch("weaver_manage_view", {
      workspaceDir: rootA, projectId: projectA.projectId, action: "create_from_template",
      templateId: TEMPLATE_ID, version: VERSION, baseGraphRevision: projectA.graphRevision, viewName: "Second Tree",
    }) as any;
    expect(viaManage.isError).toBeFalsy();

    const rootB = freshRoot();
    const serverB = await newServer(rootB);
    const projectB = await createBoundProject(serverB, rootB);
    const viaOld = await serverB.dispatch("weaver_create_view_from_visual_template", {
      workspaceDir: rootB, projectId: projectB.projectId,
      templateId: TEMPLATE_ID, version: VERSION, baseGraphRevision: projectB.graphRevision, viewName: "Second Tree",
    }) as any;
    expect(viaOld.isError).toBeFalsy();

    expect(Object.keys(viaManage.structuredContent).sort()).toEqual(Object.keys(viaOld.structuredContent).sort());
    expect(viaManage.structuredContent.viewName).toBe(viaOld.structuredContent.viewName);
    expect(viaManage.structuredContent.viewType).toBe(viaOld.structuredContent.viewType);
    expect(viaManage.structuredContent.chatBinding).toBeTruthy();
  });

  it("returns typed errors for missing required params per action", async () => {
    const root = freshRoot();
    const server = await newServer(root);

    const noViewType = await server.dispatch("weaver_manage_view", { workspaceDir: root, projectId: "p", action: "open_or_create" }) as any;
    expect(noViewType.isError).toBe(true);
    expect(noViewType.structuredContent.code).toBe("MANAGE_VIEW_REQUIRES_viewType");

    const noViewId = await server.dispatch("weaver_manage_view", { workspaceDir: root, projectId: "p", action: "duplicate", baseCatalogRevision: 0 }) as any;
    expect(noViewId.isError).toBe(true);
    expect(noViewId.structuredContent.code).toBe("MANAGE_VIEW_REQUIRES_viewId");

    const noCatalogRev = await server.dispatch("weaver_manage_view", { workspaceDir: root, projectId: "p", action: "duplicate", viewId: "v" }) as any;
    expect(noCatalogRev.isError).toBe(true);
    expect(noCatalogRev.structuredContent.code).toBe("MANAGE_VIEW_REQUIRES_baseCatalogRevision");

    const noTemplate = await server.dispatch("weaver_manage_view", { workspaceDir: root, projectId: "p", action: "create_from_template", baseGraphRevision: 0 }) as any;
    expect(noTemplate.isError).toBe(true);
    expect(noTemplate.structuredContent.code).toBe("MANAGE_VIEW_REQUIRES_templateId");

    const noGraphRev = await server.dispatch("weaver_manage_view", { workspaceDir: root, projectId: "p", action: "create_from_template", templateId: TEMPLATE_ID }) as any;
    expect(noGraphRev.isError).toBe(true);
    expect(noGraphRev.structuredContent.code).toBe("MANAGE_VIEW_REQUIRES_baseGraphRevision");
  });

  it("is model-facing; the two widget writes are reclassified off-surface (still registered) and get_or_create_view is removed", async () => {
    const root = freshRoot();
    const server = await newServer(root);
    const diagnostics = await server.dispatch("weaver_get_diagnostics", {}) as any;
    const modelFacing: string[] = diagnostics.structuredContent.toolSurface.modelFacingNames;

    expect(modelFacing).toContain("weaver_manage_view");
    // The two widget-called writes are off the model surface now...
    expect(modelFacing).not.toContain("weaver_duplicate_project_view");
    expect(modelFacing).not.toContain("weaver_create_view_from_visual_template");
    // ...but stay registered under their exact names for the widget.
    expect(server.toolMeta("weaver_duplicate_project_view")).toBeTruthy();
    expect(server.toolMeta("weaver_create_view_from_visual_template")).toBeTruthy();
    // get_or_create_view (model-only, not widget-called) is fully removed.
    expect(modelFacing).not.toContain("weaver_get_or_create_view");
    expect(server.toolMeta("weaver_get_or_create_view")).toBeFalsy();

    // The 7 critical develop-loop tools are unaffected.
    const critical: Record<string, boolean> = diagnostics.structuredContent.toolSurface.criticalPresent;
    expect(Object.values(critical).every(Boolean)).toBe(true);
  });
});
