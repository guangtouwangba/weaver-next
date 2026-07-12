import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { changeSetSchema } from "@weaver/contracts";
import { workspaceSchema } from "../shared/schemas.js";
import { previewChangeSet } from "../shared/catalog-reads.js";
import { rejectChangeSet } from "../shared/review-actions.js";
import { defineTool, result, withStore, type MutateWithStore } from "../shared/tool-runtime.js";
import { chatSessionKeyFromRequest } from "../thread-context.js";

export type ChangesetsToolsCtx = { mutateWithStore: MutateWithStore };

/** ChangeSets: submit/apply/list/get/preview/reject auditable graph+layout operation proposals. */
export function registerChangesetsTools(server: McpServer, ctx: ChangesetsToolsCtx) {
  const { mutateWithStore } = ctx;

  // `changeSet` is a typed object (not z.any()) so stdio hosts that only serialize
  // typed params — Claude Code included — send it as an object rather than a JSON
  // string. A string is still tolerated defensively for hosts that stringify.
  server.registerTool("weaver_submit_changeset", { title: "Submit Weaver ChangeSet", description: "Submit structured graph and layout operations for review. Agents cannot write the database directly.", inputSchema: { ...workspaceSchema.shape, changeSet: changeSetSchema }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, defineTool(async ({ workspaceDir, changeSet }, extra) => { const chatSessionKey = chatSessionKeyFromRequest(extra); return result(mutateWithStore(workspaceDir, (store) => { const validated = changeSetSchema.parse(typeof changeSet === "string" ? JSON.parse(changeSet) : changeSet); store.assertTaskChat(validated.taskId, chatSessionKey); return store.submitChangeSet(validated); }), "Submitted ChangeSet."); }));

  server.registerTool("weaver_apply_changeset", { title: "Apply Weaver ChangeSet", description: "Apply one reviewed ChangeSet with graph and per-view layout revision checks.", inputSchema: { ...workspaceSchema.shape, changeSetId: z.string() }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } }, defineTool(async ({ workspaceDir, changeSetId }, extra) => { const chatSessionKey = chatSessionKeyFromRequest(extra); return result(mutateWithStore(workspaceDir, (store) => { const item = store.getChangeSet(changeSetId); if (!item) throw new Error("CHANGESET_NOT_FOUND"); store.assertTaskChat(item.taskId, chatSessionKey); return store.applyChangeSet(changeSetId); }), "Applied ChangeSet."); }));

  // `weaver_list_changesets` and `weaver_get_changeset` were model-only and are now
  // folded into weaver_read_review(resource:"changeset.list" / "changeset.get").
  // Widget-only: the preview widget previews a ChangeSet here, so it stays REGISTERED
  // under this exact name with `_meta.ui.visibility=["app"]` (off the model surface).
  // The model previews it via weaver_read_review(resource:"changeset.preview"); both
  // call the same shared helper (see shared/catalog-reads.ts) so they never drift.
  server.registerTool("weaver_preview_changeset", { title: "Preview Weaver ChangeSet", description: "Return a review-oriented summary and current revision status for one pending ChangeSet.", inputSchema: { ...workspaceSchema.shape, changeSetId: z.string() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } } }, defineTool(async ({ workspaceDir, changeSetId }, extra) => {
    const chatSessionKey = chatSessionKeyFromRequest(extra);
    return result(withStore(workspaceDir, (store) => previewChangeSet(store, changeSetId, chatSessionKey)));
  }));
  // Widget-only: the preview widget's Reject button calls this by name, so it stays
  // REGISTERED under this exact name with `_meta.ui.visibility=["app"]` (off the model
  // surface). The model rejects a ChangeSet via weaver_review_action(resource:"changeset",
  // action:"reject"); both call the same shared helper (shared/review-actions.ts) so they
  // never drift.
  server.registerTool("weaver_reject_changeset", { title: "Reject Weaver ChangeSet", description: "Reject one pending proposal without changing graph or layout revisions.", inputSchema: { ...workspaceSchema.shape, changeSetId: z.string() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } } }, defineTool(async ({ workspaceDir, changeSetId }, extra) => { const chatSessionKey = chatSessionKeyFromRequest(extra); return result(mutateWithStore(workspaceDir, (store) => rejectChangeSet(store, changeSetId, chatSessionKey))); }));
}
