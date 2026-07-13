import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { canvasActionSchema, layoutOperationSchema } from "@weaver/contracts";
import { workspaceSchema } from "../shared/schemas.js";
import { track } from "../shared/workspace-registry.js";
import { defineTool, result } from "../shared/tool-runtime.js";
import { chatSessionKeyFromRequest } from "../thread-context.js";
import { widgetBuildId } from "../widget.js";
import { dispatchWorkspaceAgentOperation } from "../workspace-runtime.js";

export function registerCanvasActionTool(server: McpServer) {
  const shape = {
    ...workspaceSchema.shape,
    action: z.enum(["claim", "sync", "switch", "create_node", "update_node", "archive_node", "attach_asset", "enrich_link", "link_nodes", "layout_operations", "revert_layout"]),
    snapshot: z.unknown().optional(), projectId: z.string().optional(), viewId: z.string().optional(), nodeId: z.string().optional(), sourceNodeId: z.string().optional(), targetNodeId: z.string().optional(), edgeType: z.string().optional(), directed: z.boolean().optional(), assetId: z.string().optional(), role: z.enum(["embedded", "cover"]).optional(),
    leaseId: z.string().optional(), bindingRevision: z.number().int().positive().optional(), baseGraphRevision: z.number().int().nonnegative().optional(), baseLayoutRevision: z.number().int().nonnegative().optional(),
    semanticType: z.string().optional(), title: z.string().optional(), content: z.unknown().optional(), x: z.number().optional(), y: z.number().optional(), operations: z.array(layoutOperationSchema).optional(),
  } as const;
  server.registerTool("weaver_canvas_action", {
    title: "Canvas Action", description: "Claim/sync/switch the exact Canvas or apply direct user editing and manual layout intents.", inputSchema: shape,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } },
  }, defineTool(async (args, extra) => {
    canvasActionSchema.parse(args);
    const output = await dispatchWorkspaceAgentOperation({
      workspaceDir: args.workspaceDir,
      buildId: widgetBuildId(),
      chatSessionKey: chatSessionKeyFromRequest(extra),
      operation: "weaver_canvas_action",
      arguments: args,
    });
    if (args.projectId) track(args.workspaceDir, args.projectId);
    return result(output);
  }));
}
