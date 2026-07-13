import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { reviewActionSchema } from "@weaver/contracts";
import { workspaceSchema } from "../shared/schemas.js";
import { defineTool, result } from "../shared/tool-runtime.js";
import { chatSessionKeyFromRequest } from "../thread-context.js";
import { widgetBuildId } from "../widget.js";
import { dispatchWorkspaceAgentOperation } from "../workspace-runtime.js";

export function registerReviewActionTool(server: McpServer) {
  server.registerTool("weaver_review_action", {
    title: "Review Action", description: "Preview, apply, reject, or revert a pending ChangeSet or LayoutRun.",
    inputSchema: { ...workspaceSchema.shape, resource: z.enum(["changeset", "layout_run"]), action: z.enum(["preview", "apply", "reject", "revert"]), id: z.string().optional(), candidateId: z.string().optional(), projectId: z.string().optional(), viewId: z.string().optional() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }, _meta: { ui: { visibility: ["app", "model"] } },
  }, defineTool(async (args, extra) => {
    reviewActionSchema.parse(args);
    const output = await dispatchWorkspaceAgentOperation({ workspaceDir: args.workspaceDir, buildId: widgetBuildId(), chatSessionKey: chatSessionKeyFromRequest(extra), operation: "weaver_review_action", arguments: args });
    return result(output);
  }));
}
