import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getScenePack } from "@weaver/scene-packs";
import { builtinVisualTemplates } from "@weaver/visual-templates";
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

const syntheticChatSessionKey = () =>
  createHash("sha256").update(`weaver-launch:${process.cwd()}`).digest("hex");

/**
 * Seed one project with a saved view, an image asset, an artifact, plus a
 * pending ChangeSet and a layout run bound to a running chat task (so the
 * auth-guarded review reads resolve under the process-synthetic chat key the
 * dispatch harness supplies).
 */
async function seedCatalog(root: string) {
  const scene = getScenePack("free-brainstorming")!;
  const canvasSessionId = "session-canvas";
  const store = new WorkspaceStore(root);
  try {
    const project = store.createProject({ title: "Catalog", goal: "g", scenePack: scene });
    const node = store.createContentNode({ projectId: project.id, viewId: project.defaultViewId, type: "idea", title: "Alpha", content: { kind: "document", markdown: "Alpha body" } as any, x: 0, y: 0 });

    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer();
    const { asset } = await store.importImageAsset({ projectId: project.id, mimeType: "image/png", data: png });

    const chatSessionKey = syntheticChatSessionKey();
    const binding = store.openChatCanvasBinding({ chatSessionKey, projectId: project.id, viewId: project.defaultViewId });
    const timestamp = new Date().toISOString();
    store.syncCanvasContext({ version: 2, canvasSessionId, workspaceDir: root, projectId: project.id, scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: 0, viewId: project.defaultViewId, viewType: scene.defaultView, selectedNodeIds: [], selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, presence: { visible: true, focused: true, lastSeenAt: timestamp }, chatBinding: { leaseId: binding.leaseId, bindingRevision: binding.bindingRevision }, agentEligible: true, sequence: 1, updatedAt: timestamp }, chatSessionKey);
    const prepared = store.prepareAgentTask({ canvasSessionId, actionKey: "develop_selection", dispatchKey: "catalog-1", chatSessionKey });
    const taskId = prepared.taskId;
    store.confirmAgentDispatch(taskId, "catalog-1");
    store.updateAgentTask(taskId, { status: "running" });

    const graphRevision = store.getProject(project.id)!.graphRevision;
    const changeSet = store.submitChangeSet({ id: "cs-1", taskId, projectId: project.id, baseGraphRevision: graphRevision, baseLayoutRevisions: {}, graphOperations: [], layoutOperations: [], rationale: "r", riskLevel: "low", status: "pending", createdAt: timestamp, updatedAt: timestamp });
    const run = store.saveLayoutRun({ id: "run-1", projectId: project.id, viewId: project.defaultViewId, taskId, plan: { note: "plan" }, candidates: [] });
    const artifact = store.publishArtifact({ projectId: project.id, type: "summary", title: "Artifact", content: { text: "x" }, sourceNodeIds: [node.node.id], graphRevision });

    const template = builtinVisualTemplates[0];
    return { projectId: project.id, viewId: project.defaultViewId, assetId: asset.id, changeSetId: changeSet.id, layoutRunId: run.id, artifactId: artifact.id, templateId: template.id, templateVersion: template.version };
  } finally {
    store.close();
  }
}

describe("weaver_read_catalog", () => {
  it("lists projects, matching weaver_list_projects", async () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-read-catalog-")); roots.push(root); mkdirSync(root, { recursive: true });
    const { projectId } = await seedCatalog(root);
    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);

    const grouped = await server.dispatch("weaver_read_catalog", { workspaceDir: root, resource: "project.list" }) as any;
    const legacy = await server.dispatch("weaver_list_projects", { workspaceDir: root }) as any;
    expect(grouped.isError).toBeFalsy();
    expect(grouped.structuredContent).toEqual(legacy.structuredContent);
    expect(grouped.structuredContent.items.map((p: any) => p.id)).toContain(projectId);
  });

  it("lists and searches project views, matching the old view catalog reads", async () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-read-catalog-")); roots.push(root); mkdirSync(root, { recursive: true });
    const { projectId, viewId } = await seedCatalog(root);
    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);

    // view.list is reclassified (still registered), so compare grouped vs legacy.
    const list = await server.dispatch("weaver_read_catalog", { workspaceDir: root, resource: "view.list", projectId }) as any;
    const listLegacy = await server.dispatch("weaver_list_project_views", { workspaceDir: root, projectId }) as any;
    expect(list.isError).toBeFalsy();
    expect(list.structuredContent).toEqual(listLegacy.structuredContent);

    // view.search / view.get were model-only (removed) — assert directly.
    const search = await server.dispatch("weaver_read_catalog", { workspaceDir: root, resource: "view.search", projectId }) as any;
    expect(search.isError).toBeFalsy();
    expect(search.structuredContent.items.map((v: any) => v.id)).toContain(viewId);

    const get = await server.dispatch("weaver_read_catalog", { workspaceDir: root, resource: "view.get", projectId, viewId }) as any;
    expect(get.isError).toBeFalsy();
    expect(get.structuredContent.id).toBe(viewId);
    // The folded read must equal the matching entry the reclassified list produces (minus nodeCount, which list augments).
    const listedView = list.structuredContent.items.find((v: any) => v.id === viewId);
    const { nodeCount: _nc, ...listedCore } = listedView;
    expect(get.structuredContent).toMatchObject(listedCore);

    const missing = await server.dispatch("weaver_read_catalog", { workspaceDir: root, resource: "view.get", projectId }) as any;
    expect(missing.isError).toBe(true);
    expect(missing.structuredContent.code).toBe("CATALOG_RESOURCE_REQUIRES_viewId");

    const noProject = await server.dispatch("weaver_read_catalog", { workspaceDir: root, resource: "view.list" }) as any;
    expect(noProject.isError).toBe(true);
    expect(noProject.structuredContent.code).toBe("CATALOG_RESOURCE_REQUIRES_projectId");
  });

  it("reads visual templates, matching weaver_list/get_visual_template", async () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-read-catalog-")); roots.push(root); mkdirSync(root, { recursive: true });
    const { templateId, templateVersion } = await seedCatalog(root);
    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);

    // template.list is reclassified (still registered), so compare grouped vs legacy.
    const list = await server.dispatch("weaver_read_catalog", { workspaceDir: root, resource: "template.list" }) as any;
    const listLegacy = await server.dispatch("weaver_list_visual_templates", { workspaceDir: root }) as any;
    expect(list.isError).toBeFalsy();
    expect(list.structuredContent).toEqual(listLegacy.structuredContent);

    // template.get was model-only (removed) — assert directly against the listed entry.
    const get = await server.dispatch("weaver_read_catalog", { workspaceDir: root, resource: "template.get", templateId, version: templateVersion }) as any;
    expect(get.isError).toBeFalsy();
    expect(get.structuredContent.id).toBe(templateId);
    expect(get.structuredContent.version).toBe(templateVersion);
    expect(list.structuredContent.items).toContainEqual(get.structuredContent);

    const missing = await server.dispatch("weaver_read_catalog", { workspaceDir: root, resource: "template.get" }) as any;
    expect(missing.isError).toBe(true);
    expect(missing.structuredContent.code).toBe("CATALOG_RESOURCE_REQUIRES_templateId");
  });

  it("reads an artifact and asset metadata, matching the old tools", async () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-read-catalog-")); roots.push(root); mkdirSync(root, { recursive: true });
    const { projectId, assetId, artifactId } = await seedCatalog(root);
    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);

    // Both artifact.get and asset.metadata were model-only (removed) — assert directly.
    const artifact = await server.dispatch("weaver_read_catalog", { workspaceDir: root, resource: "artifact.get", artifactId }) as any;
    expect(artifact.isError).toBeFalsy();
    expect(artifact.structuredContent.id).toBe(artifactId);

    const asset = await server.dispatch("weaver_read_catalog", { workspaceDir: root, resource: "asset.metadata", projectId, assetId }) as any;
    expect(asset.isError).toBeFalsy();
    expect(asset.structuredContent.id).toBe(assetId);
    expect(asset.structuredContent.projectId).toBe(projectId);

    // Cross-project asset reads must still be rejected exactly as the old tool did.
    const crossProject = await server.dispatch("weaver_read_catalog", { workspaceDir: root, resource: "asset.metadata", projectId: "nope", assetId }) as any;
    expect(crossProject.isError).toBe(true);
    expect(crossProject.structuredContent.code).toBe("ASSET_NOT_FOUND_OR_CROSS_PROJECT");

    const missingArtifact = await server.dispatch("weaver_read_catalog", { workspaceDir: root, resource: "artifact.get" }) as any;
    expect(missingArtifact.isError).toBe(true);
    expect(missingArtifact.structuredContent.code).toBe("CATALOG_RESOURCE_REQUIRES_artifactId");

    const missingAsset = await server.dispatch("weaver_read_catalog", { workspaceDir: root, resource: "asset.metadata", projectId }) as any;
    expect(missingAsset.isError).toBe(true);
    expect(missingAsset.structuredContent.code).toBe("CATALOG_RESOURCE_REQUIRES_assetId");
  });

  it("enforces the view status enum (active/trashed) at the schema", async () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-read-catalog-")); roots.push(root); mkdirSync(root, { recursive: true });
    const { projectId } = await seedCatalog(root);
    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);

    // "pending" is a ChangeSet status, not a view status — must be rejected here.
    await expect(server.dispatch("weaver_read_catalog", { workspaceDir: root, resource: "view.list", projectId, status: "pending" })).rejects.toThrow();
    const ok = await server.dispatch("weaver_read_catalog", { workspaceDir: root, resource: "view.list", projectId, status: "active" }) as any;
    expect(ok.isError).toBeFalsy();
  });

  it("is model-facing while the reclassified widget catalog reads are not", async () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-read-catalog-")); roots.push(root); mkdirSync(root, { recursive: true });
    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);

    const diagnostics = await server.dispatch("weaver_get_diagnostics", {}) as any;
    const modelFacing: string[] = diagnostics.structuredContent.toolSurface.modelFacingNames;
    expect(modelFacing).toContain("weaver_read_catalog");
    // Reclassified widget reads are off the model surface but still registered.
    expect(modelFacing).not.toContain("weaver_list_projects");
    expect(modelFacing).not.toContain("weaver_list_project_views");
    expect(modelFacing).not.toContain("weaver_list_visual_templates");
    // Folded-away model-only catalog tools are gone from the surface entirely.
    expect(modelFacing).not.toContain("weaver_search_project_views");
    expect(modelFacing).not.toContain("weaver_get_project_view");
    expect(modelFacing).not.toContain("weaver_get_visual_template");
    expect(modelFacing).not.toContain("weaver_get_artifact");
    expect(modelFacing).not.toContain("weaver_get_asset_metadata");

    // The reclassified tools must remain registered under their exact names for the widget.
    expect(server.toolMeta("weaver_list_projects")).toBeTruthy();
    expect(server.toolMeta("weaver_list_project_views")).toBeTruthy();
    expect(server.toolMeta("weaver_list_visual_templates")).toBeTruthy();
  });
});

describe("weaver_read_review", () => {
  it("lists changesets and reads one, matching the old changeset reads", async () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-read-review-")); roots.push(root); mkdirSync(root, { recursive: true });
    const { projectId, changeSetId } = await seedCatalog(root);
    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);

    // changeset.list / changeset.get were model-only (removed) — assert directly.
    const list = await server.dispatch("weaver_read_review", { workspaceDir: root, resource: "changeset.list", projectId }) as any;
    expect(list.isError).toBeFalsy();
    expect(list.structuredContent.items.map((c: any) => c.id)).toContain(changeSetId);

    const get = await server.dispatch("weaver_read_review", { workspaceDir: root, resource: "changeset.get", changeSetId }) as any;
    expect(get.isError).toBeFalsy();
    expect(get.structuredContent.id).toBe(changeSetId);
    expect(list.structuredContent.items).toContainEqual(get.structuredContent);

    // changeset.preview is reclassified (still registered), so compare grouped vs legacy.
    const preview = await server.dispatch("weaver_read_review", { workspaceDir: root, resource: "changeset.preview", changeSetId }) as any;
    const previewLegacy = await server.dispatch("weaver_preview_changeset", { workspaceDir: root, changeSetId }) as any;
    expect(preview.structuredContent).toEqual(previewLegacy.structuredContent);
    expect(preview.structuredContent).toHaveProperty("summary");

    const missing = await server.dispatch("weaver_read_review", { workspaceDir: root, resource: "changeset.get" }) as any;
    expect(missing.isError).toBe(true);
    expect(missing.structuredContent.code).toBe("REVIEW_RESOURCE_REQUIRES_changeSetId");

    const noProject = await server.dispatch("weaver_read_review", { workspaceDir: root, resource: "changeset.list" }) as any;
    expect(noProject.isError).toBe(true);
    expect(noProject.structuredContent.code).toBe("REVIEW_RESOURCE_REQUIRES_projectId");
  });

  it("reads layout, a layout run and layout capabilities, matching the old tools", async () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-read-review-")); roots.push(root); mkdirSync(root, { recursive: true });
    const { projectId, viewId, layoutRunId } = await seedCatalog(root);
    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);

    // layout.get / layout.capabilities were model-only (removed) — assert directly.
    const layout = await server.dispatch("weaver_read_review", { workspaceDir: root, resource: "layout.get", projectId, viewId }) as any;
    expect(layout.isError).toBeFalsy();
    expect(layout.structuredContent.viewId).toBe(viewId);
    expect(layout.structuredContent).toHaveProperty("layoutRevision");

    // layout.run is reclassified (still registered), so compare grouped vs legacy.
    const run = await server.dispatch("weaver_read_review", { workspaceDir: root, resource: "layout.run", layoutRunId }) as any;
    const runLegacy = await server.dispatch("weaver_get_layout_run", { workspaceDir: root, layoutRunId }) as any;
    expect(run.structuredContent).toEqual(runLegacy.structuredContent);
    expect(run.structuredContent.id).toBe(layoutRunId);

    const caps = await server.dispatch("weaver_read_review", { workspaceDir: root, resource: "layout.capabilities" }) as any;
    expect(caps.isError).toBeFalsy();
    expect(caps.structuredContent.recommendedStrategy).toBe("cluster");
    expect(caps.structuredContent.strategies).toHaveLength(9);
    expect(caps.structuredContent.candidateCount).toEqual({ min: 1, max: 5, default: 3 });

    const missingView = await server.dispatch("weaver_read_review", { workspaceDir: root, resource: "layout.get", projectId }) as any;
    expect(missingView.isError).toBe(true);
    expect(missingView.structuredContent.code).toBe("REVIEW_RESOURCE_REQUIRES_viewId");

    const missingRun = await server.dispatch("weaver_read_review", { workspaceDir: root, resource: "layout.run" }) as any;
    expect(missingRun.isError).toBe(true);
    expect(missingRun.structuredContent.code).toBe("REVIEW_RESOURCE_REQUIRES_layoutRunId");
  });

  it("enforces the changeset status enum at the schema", async () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-read-review-")); roots.push(root); mkdirSync(root, { recursive: true });
    const { projectId } = await seedCatalog(root);
    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);

    // "trashed" is a view status, not a ChangeSet status — must be rejected here.
    await expect(server.dispatch("weaver_read_review", { workspaceDir: root, resource: "changeset.list", projectId, status: "trashed" })).rejects.toThrow();
    const ok = await server.dispatch("weaver_read_review", { workspaceDir: root, resource: "changeset.list", projectId, status: "pending" }) as any;
    expect(ok.isError).toBeFalsy();
  });

  it("is model-facing while the reclassified widget review reads are not", async () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-read-review-")); roots.push(root); mkdirSync(root, { recursive: true });
    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);

    const diagnostics = await server.dispatch("weaver_get_diagnostics", {}) as any;
    const modelFacing: string[] = diagnostics.structuredContent.toolSurface.modelFacingNames;
    expect(modelFacing).toContain("weaver_read_review");
    // Reclassified widget reads are off the model surface but still registered.
    expect(modelFacing).not.toContain("weaver_get_layout_run");
    expect(modelFacing).not.toContain("weaver_preview_changeset");
    // Folded-away model-only review tools are gone from the surface entirely.
    expect(modelFacing).not.toContain("weaver_get_layout");
    expect(modelFacing).not.toContain("weaver_get_layout_capabilities");
    expect(modelFacing).not.toContain("weaver_list_changesets");
    expect(modelFacing).not.toContain("weaver_get_changeset");

    expect(server.toolMeta("weaver_get_layout_run")).toBeTruthy();
    expect(server.toolMeta("weaver_preview_changeset")).toBeTruthy();
  });
});
