import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { reviewActionSchema } from "@weaver/contracts";
import { workspaceSchema } from "../shared/schemas.js";
import { previewChangeSet, readLayoutRun } from "../shared/catalog-reads.js";
import { applyLayoutCandidate, rejectChangeSet, rejectLayoutRun, revertLayout } from "../shared/review-actions.js";
import { defineTool, result, type MutateWithStore } from "../shared/tool-runtime.js";
import { chatSessionKeyFromRequest } from "../thread-context.js";

export type ReviewActionToolCtx = { mutateWithStore: MutateWithStore };

export function registerReviewActionTool(server: McpServer, { mutateWithStore }: ReviewActionToolCtx) {
  server.registerTool("weaver_review_action", {
    title: "Review Action", description: "Preview, apply, reject, or revert a pending ChangeSet or LayoutRun.",
    inputSchema: { ...workspaceSchema.shape, resource: z.enum(["changeset", "layout_run"]), action: z.enum(["preview", "apply", "reject", "revert"]), id: z.string().optional(), candidateId: z.string().optional(), projectId: z.string().optional(), viewId: z.string().optional() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }, _meta: { ui: { visibility: ["app", "model"] } },
  }, defineTool(async ({ workspaceDir, resource, action, id, candidateId, projectId, viewId }, extra) => {
    reviewActionSchema.parse({ workspaceDir, resource, action, id, candidateId, projectId, viewId });
    const chatSessionKey = chatSessionKeyFromRequest(extra); const need = (value: string | undefined, name: string) => { if (!value) throw new Error(`INVALID_ARGS:${name} required`); return value; };
    return result(mutateWithStore(workspaceDir, (store) => {
      if (resource === "changeset") {
        const changeSetId = need(id, "id");
        if (action === "preview") return previewChangeSet(store, changeSetId, chatSessionKey);
        if (action === "reject") return rejectChangeSet(store, changeSetId, chatSessionKey);
        if (action === "apply") { const item = store.graphChanges.get(changeSetId); if (!item) throw new Error("CHANGESET_NOT_FOUND"); store.tasks.assertChat(item.taskId, chatSessionKey); return store.graphChanges.apply(changeSetId); }
        // Undo an applied ChangeSet — direct-write mode's safety net. Authorized by
        // canvas control (not the dispatching session) so the user can always undo.
        const item = store.graphChanges.get(changeSetId); if (!item) throw new Error("CHANGESET_NOT_FOUND");
        store.tasks.assertCanvas(item.taskId, chatSessionKey);
        return store.graphChanges.revert(changeSetId);
      }
      if (action === "preview") return readLayoutRun(store, need(id, "id"), chatSessionKey);
      if (action === "apply") return applyLayoutCandidate(store, need(id, "id"), need(candidateId, "candidateId"), chatSessionKey);
      if (action === "reject") return rejectLayoutRun(store, need(id, "id"), chatSessionKey);
      return revertLayout(store, need(projectId, "projectId"), need(viewId, "viewId"));
    }));
  }));
}
