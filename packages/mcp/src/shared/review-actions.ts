import type { WorkspaceStore } from "@weaver/storage";

/**
 * Single source of truth for the REVIEW-DECISION write actions, shared by the
 * kept widget tools (`weaver_review_action(resource:"changeset",action:"reject")`, `weaver_review_action(resource:"layout_run",action:"apply")`,
 * `weaver_review_action(resource:"layout_run",action:"reject")`, `weaver_canvas_action(action:"revert_layout")` — all called by the preview
 * widget's Apply/Reject buttons) and the model-facing merged tool
 * (`weaver_review_action`), so the two surfaces never drift. Each helper
 * reproduces the exact store calls and chat-binding auth of the handler it
 * replaces. Note: applying a ChangeSet is DELIBERATELY absent here — that path
 * lives only in `weaver_review_action(resource:"changeset",action:"apply")` (critical) and must never be reachable
 * from `weaver_review_action`.
 */

/** weaver_review_action(resource:"changeset",action:"reject") core. Preserves the chat-binding auth of the old tool. */
export function rejectChangeSet(store: WorkspaceStore, changeSetId: string, chatSessionKey: string) {
  const item = store.graphChanges.get(changeSetId); if (!item) throw new Error("CHANGESET_NOT_FOUND");
  store.tasks.assertChat(item.taskId, chatSessionKey);
  return store.graphChanges.reject(changeSetId);
}

/** weaver_review_action(resource:"layout_run",action:"apply") core. Preserves the chat-binding auth of the old tool. */
export function applyLayoutCandidate(store: WorkspaceStore, layoutRunId: string, candidateId: string, chatSessionKey: string) {
  const run = store.layoutReviews.getRun(layoutRunId); if (!run) throw new Error("LAYOUT_RUN_NOT_FOUND");
  if (run.taskId) store.tasks.assertChat(run.taskId, chatSessionKey);
  return store.layoutReviews.applyCandidate(layoutRunId, candidateId);
}

/** weaver_review_action(resource:"layout_run",action:"reject") core. Preserves the chat-binding auth of the old tool. */
export function rejectLayoutRun(store: WorkspaceStore, layoutRunId: string, chatSessionKey: string) {
  const run = store.layoutReviews.getRun(layoutRunId); if (!run) throw new Error("LAYOUT_RUN_NOT_FOUND");
  if (run.taskId) store.tasks.assertChat(run.taskId, chatSessionKey);
  return store.layoutReviews.rejectRun(layoutRunId);
}

/** weaver_canvas_action(action:"revert_layout") core. No chat auth in the original (a pure per-view undo). */
export function revertLayout(store: WorkspaceStore, projectId: string, viewId: string) {
  return store.layoutReviews.revert(projectId, viewId);
}
