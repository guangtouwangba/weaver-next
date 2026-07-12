import type { WorkspaceStore } from "@weaver/storage";

/**
 * Single source of truth for the REVIEW-DECISION write actions, shared by the
 * kept widget tools (`weaver_reject_changeset`, `weaver_apply_layout`,
 * `weaver_reject_layout`, `weaver_revert_layout` — all called by the preview
 * widget's Apply/Reject buttons) and the model-facing merged tool
 * (`weaver_review_action`), so the two surfaces never drift. Each helper
 * reproduces the exact store calls and chat-binding auth of the handler it
 * replaces. Note: applying a ChangeSet is DELIBERATELY absent here — that path
 * lives only in `weaver_apply_changeset` (critical) and must never be reachable
 * from `weaver_review_action`.
 */

/** weaver_reject_changeset core. Preserves the chat-binding auth of the old tool. */
export function rejectChangeSet(store: WorkspaceStore, changeSetId: string, chatSessionKey: string) {
  const item = store.getChangeSet(changeSetId); if (!item) throw new Error("CHANGESET_NOT_FOUND");
  store.assertTaskChat(item.taskId, chatSessionKey);
  return store.rejectChangeSet(changeSetId);
}

/** weaver_apply_layout core. Preserves the chat-binding auth of the old tool. */
export function applyLayoutCandidate(store: WorkspaceStore, layoutRunId: string, candidateId: string, chatSessionKey: string) {
  const run = store.getLayoutRun(layoutRunId); if (!run) throw new Error("LAYOUT_RUN_NOT_FOUND");
  if (run.taskId) store.assertTaskChat(run.taskId, chatSessionKey);
  return store.applyLayoutCandidate(layoutRunId, candidateId);
}

/** weaver_reject_layout core. Preserves the chat-binding auth of the old tool. */
export function rejectLayoutRun(store: WorkspaceStore, layoutRunId: string, chatSessionKey: string) {
  const run = store.getLayoutRun(layoutRunId); if (!run) throw new Error("LAYOUT_RUN_NOT_FOUND");
  if (run.taskId) store.assertTaskChat(run.taskId, chatSessionKey);
  return store.rejectLayoutRun(layoutRunId);
}

/** weaver_revert_layout core. No chat auth in the original (a pure per-view undo). */
export function revertLayout(store: WorkspaceStore, projectId: string, viewId: string) {
  return store.revertLayout(projectId, viewId);
}
