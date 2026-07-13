import { getScenePack } from "@weaver/scene-packs";
import type { WorkspaceStore } from "@weaver/storage";

function required(args: Record<string, unknown>, name: string) {
  const value = args[name];
  if (typeof value !== "string" || !value) throw new Error(`INVALID_ARGS:${name} required`);
  return value;
}

export function readWorkspaceResource(store: WorkspaceStore, args: Record<string, unknown>) {
  if (args.resource === "agent_task") {
    const task = store.tasks.get(required(args, "taskId"));
    if (!task) throw new Error("AGENT_TASK_NOT_FOUND");
    return task;
  }
  const projectId = required(args, "projectId");
  if (args.resource === "project_views") return store.catalog.listViews(projectId);
  if (args.resource === "view_projection") {
    const layout = store.layoutReviews.get(projectId, required(args, "viewId"));
    if (!layout) throw new Error("LAYOUT_NOT_FOUND");
    return { viewId: layout.viewId, viewName: layout.viewName, viewType: layout.viewType, templateRef: layout.templateRef, projection: layout.projection, theme: layout.theme };
  }
  if (args.resource === "project_manifest") {
    const project = store.catalog.getProject(projectId);
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    return { project, scenePack: getScenePack(project.scenePackId, project.scenePackVersion) };
  }
  if (args.resource === "node_content") {
    const node = store.graphChanges.read(projectId).nodes.find((candidate) => candidate.id === required(args, "nodeId"));
    if (!node) throw new Error("NODE_NOT_FOUND");
    return node;
  }
  if (args.resource === "image_asset" || args.resource === "image_thumbnail") {
    const item = store.assets.read(required(args, "assetId"), args.resource === "image_thumbnail");
    if (item.asset.projectId !== projectId) throw new Error("ASSET_NOT_FOUND_OR_CROSS_PROJECT");
    return { mimeType: args.resource === "image_thumbnail" ? "image/webp" : item.asset.mimeType, base64: Buffer.from(item.data).toString("base64") };
  }
  throw new Error("OPERATION_NOT_FOUND");
}
