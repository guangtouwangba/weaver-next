import type { ProjectView, ViewType } from "@weaver/contracts";
import type { WorkspaceStore } from "@weaver/storage";
import { builtinVisualTemplates, getVisualTemplate } from "@weaver/visual-templates";

/**
 * Single source of truth for the catalog/browse reads, shared by the kept widget
 * tools (`weaver_read_catalog(resource:"project.list")`, `weaver_read_catalog(resource:"view.list")`,
 * `weaver_read_catalog(resource:"template.list")`, `weaver_review_action(resource:"layout_run",action:"preview")`,
 * `weaver_review_action(resource:"changeset",action:"preview")`) and the model-facing grouped tools
 * (`weaver_read_catalog`, `weaver_review_action`), so the two surfaces never drift.
 * Each helper reproduces the exact store calls, validation and payload shape of
 * the handler it replaces.
 */

// ── Catalog reads (project / view / template / artifact / asset) ─────────────

/** weaver_read_catalog(resource:"project.list") core. */
export function listProjects(store: WorkspaceStore) {
  return store.catalog.listProjects();
}

/** weaver_read_catalog(resource:"view.list") core. */
export function listProjectViews(store: WorkspaceStore, projectId: string, status?: ProjectView["status"]) {
  return store.catalog.listViews(projectId, status).map((view) => ({ ...view, nodeCount: Object.keys(store.layoutReviews.get(projectId, view.id)?.nodes ?? {}).length }));
}

/** weaver_search_project_views core. `query`/`status` default to preserve the old tool. */
export function searchProjectViews(store: WorkspaceStore, projectId: string, query = "", status: ProjectView["status"] = "active") {
  return store.catalog.searchViews(projectId, query, status).map((view) => ({ ...view, nodeCount: Object.keys(store.layoutReviews.get(projectId, view.id)?.nodes ?? {}).length }));
}

/** weaver_get_project_view core. */
export function getProjectView(store: WorkspaceStore, projectId: string, viewId: string) {
  const view = store.catalog.getView(projectId, viewId); if (!view) throw new Error("VIEW_NOT_FOUND");
  return view;
}

/** weaver_read_catalog(resource:"template.list") core (store-free). */
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
  const artifact = store.artifacts.get(artifactId); if (!artifact) throw new Error("ARTIFACT_NOT_FOUND");
  return artifact;
}

/** weaver_get_asset_metadata core. */
export function readAssetMetadata(store: WorkspaceStore, projectId: string, assetId: string) {
  const asset = store.assets.get(assetId); if (!asset || asset.projectId !== projectId) throw new Error("ASSET_NOT_FOUND_OR_CROSS_PROJECT");
  return asset;
}

// ── Review reads (changeset / layout) ────────────────────────────────────────

/** weaver_list_changesets core. */
export function listChangeSets(store: WorkspaceStore, projectId: string, status?: "pending" | "applied" | "rejected" | "reverted") {
  return store.graphChanges.list(projectId, status);
}

/** weaver_get_changeset core. Preserves the chat-binding auth of the old tool. */
export function readChangeSet(store: WorkspaceStore, changeSetId: string, chatSessionKey: string) {
  const value = store.graphChanges.get(changeSetId); if (!value) throw new Error("CHANGESET_NOT_FOUND");
  store.tasks.assertChat(value.taskId, chatSessionKey, false);
  return value;
}

/** weaver_review_action(resource:"changeset",action:"preview") core. Preserves the chat-binding auth of the old tool. */
export function previewChangeSet(store: WorkspaceStore, changeSetId: string, chatSessionKey: string) {
  const item = store.graphChanges.get(changeSetId); if (!item) throw new Error("CHANGESET_NOT_FOUND");
  store.tasks.assertChat(item.taskId, chatSessionKey, false);
  const project = store.catalog.getProject(item.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND");
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
  const layout = store.layoutReviews.get(projectId, viewId); if (!layout) throw new Error("LAYOUT_NOT_FOUND");
  return layout;
}

/** weaver_review_action(resource:"layout_run",action:"preview") core. Preserves the chat-binding auth of the old tool. */
export function readLayoutRun(store: WorkspaceStore, layoutRunId: string, chatSessionKey: string) {
  const item = store.layoutReviews.getRun(layoutRunId); if (!item) throw new Error("LAYOUT_RUN_NOT_FOUND");
  if (item.taskId) store.tasks.assertChat(item.taskId, chatSessionKey, false);
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
