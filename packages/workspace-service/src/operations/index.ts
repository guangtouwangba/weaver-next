import type { WorkspaceStore } from "@weaver/storage";
import { getProject, listProjects, type WorkspacePrincipal } from "./catalog.js";
import { applyManualCanvasMutation, undoManualCanvasMutation } from "./canvas.js";
import { compatReadCatalog, compatReadGraph, compatReadSession, compatSubscribeCanvas } from "./compat-reads.js";
import { compatCanvasAction } from "./compat-canvas.js";
import { applyCatalogAction } from "./catalog-actions.js";
import { applyTaskAction, prepareAgentTask, submitChangeSet } from "./agent-actions.js";
import { applyReviewAction, importAsset, publishArtifact, recommendLayout } from "./content-actions.js";
import { readWorkspaceResource } from "./resources.js";

export type ApplicationRequest = { operation: string; arguments: Record<string, unknown> };

export function dispatchApplicationOperation(store: WorkspaceStore, principal: WorkspacePrincipal, request: ApplicationRequest) {
  if (principal.kind === "browser" && new Set([
    "weaver_prepare_task",
    "weaver_task_action",
    "weaver_submit_changeset",
    "weaver_recommend_layout",
    "weaver_publish_artifact",
  ]).has(request.operation)) throw new Error("CHAT_PRINCIPAL_REQUIRED");
  switch (request.operation) {
    case "bridge.openNativeBinding": {
      if (principal.kind !== "chat") throw new Error("CHAT_PRINCIPAL_REQUIRED");
      return store.sessions.openBinding({
        chatSessionKey: principal.chatSessionKey,
        projectId: typeof request.arguments.projectId === "string" ? request.arguments.projectId : undefined,
        viewId: typeof request.arguments.viewId === "string" ? request.arguments.viewId : undefined,
      });
    }
    case "catalog.listProjects": return listProjects(store, principal);
    case "catalog.getProject": return getProject(store, principal, String(request.arguments.projectId ?? ""));
    case "canvas.mutate": return applyManualCanvasMutation(store, principal, request.arguments);
    case "canvas.undo": return undoManualCanvasMutation(store, principal, request.arguments);
    case "weaver_read_catalog": return compatReadCatalog(store, principal, request.arguments);
    case "weaver_read_graph": return compatReadGraph(store, principal, request.arguments);
    case "weaver_read_session": return compatReadSession(store, principal, request.arguments);
    case "weaver_canvas_action": return compatCanvasAction(store, principal, request.arguments);
    case "weaver_catalog_action": return applyCatalogAction(store, principal, request.arguments);
    case "weaver_prepare_task": return prepareAgentTask(store, principal, request.arguments);
    case "weaver_task_action": return applyTaskAction(store, principal, request.arguments);
    case "weaver_submit_changeset": return submitChangeSet(store, principal, request.arguments);
    case "weaver_recommend_layout": return recommendLayout(store, principal, request.arguments);
    case "weaver_review_action": return applyReviewAction(store, principal, request.arguments);
    case "weaver_import_asset": return importAsset(store, principal, request.arguments);
    case "weaver_publish_artifact": return publishArtifact(store, principal, request.arguments);
    case "resource.read": return readWorkspaceResource(store, request.arguments);
    case "weaver_subscribe_canvas": return compatSubscribeCanvas(store, principal, request.arguments);
    default: throw new Error("OPERATION_NOT_FOUND");
  }
}

export type { WorkspacePrincipal } from "./catalog.js";
