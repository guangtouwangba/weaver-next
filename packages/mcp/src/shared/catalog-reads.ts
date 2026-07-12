import type { ProjectView, ViewType } from "@weaver/contracts";
import type { WorkspaceStore } from "@weaver/storage";
import { builtinVisualTemplates, getVisualTemplate } from "@weaver/visual-templates";

/**
 * Single source of truth for the catalog/browse reads, shared by the kept widget
 * tools (`weaver_list_projects`, `weaver_list_project_views`,
 * `weaver_list_visual_templates`, `weaver_get_layout_run`,
 * `weaver_preview_changeset`) and the model-facing grouped tools
 * (`weaver_read_catalog`, `weaver_read_review`), so the two surfaces never drift.
 * Each helper reproduces the exact store calls, validation and payload shape of
 * the handler it replaces.
 */

// ── Catalog reads (project / view / template / artifact / asset) ─────────────

/** weaver_list_projects core. */
export function listProjects(store: WorkspaceStore) {
  return store.listProjects();
}

/** weaver_list_project_views core. */
export function listProjectViews(store: WorkspaceStore, projectId: string, status?: ProjectView["status"]) {
  return store.listProjectViews(projectId, status).map((view) => ({ ...view, nodeCount: Object.keys(store.getLayout(projectId, view.id)?.nodes ?? {}).length }));
}

/** weaver_search_project_views core. `query`/`status` default to preserve the old tool. */
export function searchProjectViews(store: WorkspaceStore, projectId: string, query = "", status: ProjectView["status"] = "active") {
  return store.searchProjectViews(projectId, query, status).map((view) => ({ ...view, nodeCount: Object.keys(store.getLayout(projectId, view.id)?.nodes ?? {}).length }));
}

/** weaver_get_project_view core. */
export function getProjectView(store: WorkspaceStore, projectId: string, viewId: string) {
  const view = store.getProjectView(projectId, viewId); if (!view) throw new Error("VIEW_NOT_FOUND");
  return view;
}

/** weaver_list_visual_templates core (store-free). */
export function listVisualTemplates(filter: { scenePackId?: string; family?: string; renderer?: ViewType } = {}) {
  return builtinVisualTemplates.filter((item) => (!filter.scenePackId || item.compatibleScenePackIds.includes(filter.scenePackId)) && (!filter.family || item.family === filter.family) && (!filter.renderer || item.renderer === filter.renderer));
}

/** weaver_get_visual_template core (store-free). `version` defaults to preserve the old tool. */
export function readVisualTemplate(templateId: string, version = "1.0.0") {
  const item = getVisualTemplate(templateId, version); if (!item) throw new Error("VISUAL_TEMPLATE_NOT_FOUND");
  return item;
}

/** weaver_get_artifact core. */
export function readArtifact(store: WorkspaceStore, artifactId: string) {
  const artifact = store.getArtifact(artifactId); if (!artifact) throw new Error("ARTIFACT_NOT_FOUND");
  return artifact;
}

/** weaver_get_asset_metadata core. */
export function readAssetMetadata(store: WorkspaceStore, projectId: string, assetId: string) {
  const asset = store.getAsset(assetId); if (!asset || asset.projectId !== projectId) throw new Error("ASSET_NOT_FOUND_OR_CROSS_PROJECT");
  return asset;
}

// ── Review reads (changeset / layout) ────────────────────────────────────────

/** weaver_list_changesets core. */
export function listChangeSets(store: WorkspaceStore, projectId: string, status?: "pending" | "applied" | "rejected" | "reverted") {
  return store.listChangeSets(projectId, status);
}

/** weaver_get_changeset core. Preserves the chat-binding auth of the old tool. */
export function readChangeSet(store: WorkspaceStore, changeSetId: string, chatSessionKey: string) {
  const value = store.getChangeSet(changeSetId); if (!value) throw new Error("CHANGESET_NOT_FOUND");
  store.assertTaskChat(value.taskId, chatSessionKey, false);
  return value;
}

/** weaver_preview_changeset core. Preserves the chat-binding auth of the old tool. */
export function previewChangeSet(store: WorkspaceStore, changeSetId: string, chatSessionKey: string) {
  const item = store.getChangeSet(changeSetId); if (!item) throw new Error("CHANGESET_NOT_FOUND");
  store.assertTaskChat(item.taskId, chatSessionKey, false);
  const project = store.getProject(item.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND");
  return {
    changeSet: item,
    stale: project.graphRevision !== item.baseGraphRevision,
    currentGraphRevision: project.graphRevision,
    summary: {
      addedNodes: item.graphOperations.filter((op) => op.type === "add-node").length,
      updatedNodes: item.graphOperations.filter((op) => ["update-node", "set-node-content", "attach-asset", "detach-asset", "set-node-cover"].includes(op.type)).length,
      archivedNodes: item.graphOperations.filter((op) => op.type === "archive-node").length,
      addedEdges: item.graphOperations.filter((op) => op.type === "add-edge").length,
      updatedEdges: item.graphOperations.filter((op) => op.type === "update-edge").length,
      archivedEdges: item.graphOperations.filter((op) => op.type === "archive-edge").length,
      layoutOperations: item.layoutOperations.length,
    },
  };
}

/** weaver_get_layout core. */
export function readLayout(store: WorkspaceStore, projectId: string, viewId: string) {
  const layout = store.getLayout(projectId, viewId); if (!layout) throw new Error("LAYOUT_NOT_FOUND");
  return layout;
}

/** weaver_get_layout_run core. Preserves the chat-binding auth of the old tool. */
export function readLayoutRun(store: WorkspaceStore, layoutRunId: string, chatSessionKey: string) {
  const item = store.getLayoutRun(layoutRunId); if (!item) throw new Error("LAYOUT_RUN_NOT_FOUND");
  if (item.taskId) store.assertTaskChat(item.taskId, chatSessionKey, false);
  return item;
}

/** weaver_get_layout_capabilities core (store-free). The exact static payload of the old tool. */
export function layoutCapabilities() {
  return {
    strategies: ["tree", "layered", "radial", "force", "cluster", "grid", "timeline", "swimlane", "hybrid"],
    recommendedStrategy: "cluster",
    honoredConstraints: {
      cluster: ["emphasis", "group", "direction", "separation", "spacing", "pin", "preserve-position"],
      layered: ["direction", "emphasis"], tree: ["direction"], radial: ["emphasis"], force: [], grid: [],
    },
    constraints: ["pin", "align", "distribute", "order", "rank", "group", "containment", "separation", "relative-position", "direction", "spacing", "avoid-overlap", "preserve-position", "edge-length", "edge-routing", "emphasis", "viewport-fit"],
    candidateCount: { min: 1, max: 5, default: 3 },
  };
}
