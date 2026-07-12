import type { WorkspaceStore } from "@weaver/storage";

/**
 * Resolve the exact Project/View/Canvas bound to a chat, with presence and the
 * independent graph/layout/binding revisions. Single source of truth shared by
 * `weaver_read_session(resource:"bound_canvas")` (widget-only) and `weaver_read_session`
 * (`bound_canvas`/`guard`) so the two never drift. Never guesses from focus or
 * recency; throws if the bound project or layout is missing.
 */
export function resolveBoundCanvas(store: WorkspaceStore, chatSessionKey: string) {
  const { binding, context } = store.sessions.boundCanvas(chatSessionKey, false);
  const project = store.catalog.getProject(context.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND");
  const layout = store.layoutReviews.get(context.projectId, context.viewId); if (!layout) throw new Error("LAYOUT_NOT_FOUND");
  const seenAt = Date.parse(context.presence?.lastSeenAt ?? context.updatedAt);
  return {
    projectId: context.projectId, viewId: context.viewId, canvasSessionId: context.canvasSessionId,
    bindingStatus: binding.status, online: Date.now() - seenAt <= 30_000, lastSeenAt: context.presence?.lastSeenAt ?? context.updatedAt,
    graphRevision: project.graphRevision, layoutRevision: layout.layoutRevision, bindingRevision: binding.bindingRevision,
  };
}
