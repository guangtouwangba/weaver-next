import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { workspaceSchema } from "../shared/schemas.js";
import { parseRefined } from "../shared/refined-args.js";
import { applyLayoutCandidate, rejectChangeSet, rejectLayoutRun, revertLayout } from "../shared/review-actions.js";
import { defineTool, result, type MutateWithStore } from "../shared/tool-runtime.js";
import { chatSessionKeyFromRequest } from "../thread-context.js";

export type ReviewActionToolCtx = { mutateWithStore: MutateWithStore };

/** The raw input shape the MCP SDK wraps in `z.object(...)` (registerTool needs a
 * ZodRawShape, not a refined schema). The cross-field validation lives on
 * `reviewActionSchema` below and is re-run in the handler. */
const reviewActionShape = {
  ...workspaceSchema.shape,
  resource: z.enum(["changeset", "layout_run"]),
  action: z.enum(["reject", "apply", "revert"]),
  id: z.string().optional(),          // changeSetId (reject) or layoutRunId (apply/reject); omit for revert
  candidateId: z.string().optional(), // layout_run + apply only
  projectId: z.string().optional(),   // layout_run + revert only
  viewId: z.string().optional(),      // layout_run + revert only
} as const;

/**
 * SECURITY-CRITICAL: `changeset + apply` is rejected here at parse time. Applying
 * a ChangeSet must only ever go through `weaver_apply_changeset`; this merged
 * tool exposes reject/apply/revert for the low-risk review decisions but never a
 * ChangeSet apply. Every other invalid resource/action pairing and every missing
 * per-combo required param is also a parse-time issue, so the handler receives a
 * fully validated argument set and the store is never touched on a bad call.
 */
const reviewActionSchema = z.object(reviewActionShape).superRefine((value, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (value.resource === "changeset") {
    if (value.action === "apply") { fail("CHANGESET_APPLY_FORBIDDEN"); return; }
    if (value.action !== "reject") { fail("REVIEW_ACTION_INVALID_COMBO"); return; }
    if (!value.id) fail("REVIEW_ACTION_REQUIRES_id");
    return;
  }
  // resource === "layout_run"
  if (value.action === "apply") {
    if (!value.id) fail("REVIEW_ACTION_REQUIRES_id");
    if (!value.candidateId) fail("REVIEW_ACTION_REQUIRES_candidateId");
  } else if (value.action === "reject") {
    if (!value.id) fail("REVIEW_ACTION_REQUIRES_id");
  } else {
    // action === "revert"
    if (!value.projectId) fail("REVIEW_ACTION_REQUIRES_projectId");
    if (!value.viewId) fail("REVIEW_ACTION_REQUIRES_viewId");
  }
});

/**
 * One model-facing WRITE tool that merges the four REVIEW-DECISION writes the
 * widget also calls by name: `weaver_reject_changeset`, `weaver_apply_layout`,
 * `weaver_reject_layout`, `weaver_revert_layout`. Those four stay REGISTERED
 * (app-only) for the widget's Apply/Reject buttons; the model uses this tool.
 * Both surfaces delegate to shared/review-actions.ts so they never drift.
 * `weaver_apply_changeset` (critical) is intentionally NOT reachable here.
 */
export function registerReviewActionTool(server: McpServer, ctx: ReviewActionToolCtx) {
  const { mutateWithStore } = ctx;
  server.registerTool("weaver_review_action", {
    title: "Review Action",
    description: "Act on a pending review item: reject a ChangeSet (`resource:\"changeset\", action:\"reject\", id`), or apply/reject/revert a layout (`resource:\"layout_run\"` with `action:\"apply\"` + `id` + `candidateId`, `action:\"reject\"` + `id`, or `action:\"revert\"` + `projectId` + `viewId`). Applying a ChangeSet is NOT available here — use weaver_apply_changeset for that.",
    inputSchema: reviewActionShape,
    // idempotentHint:false — layout apply throws LAYOUT_REVISION_CONFLICT on retry
    // and revert bumps layoutRevision every call (matching the old apply/revert
    // tools). A single static hint can't be true across the reject/apply/revert
    // union, so use the codebase convention of false for apply/revert writes.
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, defineTool(async (rawArgs, extra) => {
    // Parse-time refine: security (changeset+apply forbidden), combo validity and
    // per-combo required params. The MCP SDK strips object-level superRefines from
    // the registered shape, so re-validate the refined schema here (see refined-args).
    const { workspaceDir, resource, action, id, candidateId, projectId, viewId } =
      parseRefined<z.infer<typeof reviewActionSchema>>(reviewActionSchema, rawArgs);
    const chatSessionKey = chatSessionKeyFromRequest(extra);

    if (resource === "changeset") {
      // action === "reject" (changeset+apply is refined away above).
      return result(mutateWithStore(workspaceDir, (store) => rejectChangeSet(store, id!, chatSessionKey)));
    }
    // resource === "layout_run"
    switch (action) {
      case "apply":
        return result(mutateWithStore(workspaceDir, (store) => applyLayoutCandidate(store, id!, candidateId!, chatSessionKey)), "Applied layout candidate.");
      case "reject":
        return result(mutateWithStore(workspaceDir, (store) => rejectLayoutRun(store, id!, chatSessionKey)), "Rejected layout preview.");
      case "revert":
        return result(mutateWithStore(workspaceDir, (store) => revertLayout(store, projectId!, viewId!)), "Restored previous layout.");
    }
  }));
}
