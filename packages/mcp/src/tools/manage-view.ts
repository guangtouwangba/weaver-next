import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { catalogActionSchema } from "@weaver/contracts";
import { workspaceSchema } from "../shared/schemas.js";
import { defineTool, result } from "../shared/tool-runtime.js";
import { chatSessionKeyFromRequest } from "../thread-context.js";
import { widgetBuildId } from "../widget.js";
import { dispatchWorkspaceAgentOperation } from "../workspace-runtime.js";

export function registerManageViewTool(server: McpServer) {
  const shape = {
    ...workspaceSchema.shape,
    action: z.enum(["create_project", "create_project_from_template", "create_view_from_template", "duplicate_view", "rename_view", "pin_view", "reorder_views", "set_default_view", "trash_view", "restore_view", "purge_view"]),
    projectId: z.string().optional(), viewId: z.string().optional(), title: z.string().optional(), goal: z.string().optional(), scenePackId: z.string().optional(),
    templateId: z.string().optional(), version: z.string().optional(), name: z.string().optional(), viewName: z.string().optional(), pinned: z.boolean().optional(), viewIds: z.array(z.string()).optional(), fallbackViewId: z.string().optional(),
    baseGraphRevision: z.number().int().nonnegative().optional(), baseCatalogRevision: z.number().int().nonnegative().optional(), leaseId: z.string().optional(), bindingRevision: z.number().int().positive().optional(),
  } as const;
  server.registerTool("weaver_catalog_action", {
    title: "Catalog Action", description: "Create Projects and manage durable Views/Templates through one audited catalog action.", inputSchema: shape,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, defineTool(async (args, extra) => {
    catalogActionSchema.parse(args);
    const output = await dispatchWorkspaceAgentOperation({
      workspaceDir: args.workspaceDir,
      buildId: widgetBuildId(),
      chatSessionKey: chatSessionKeyFromRequest(extra),
      operation: "weaver_catalog_action",
      arguments: args,
    });
    return result(output);
  }));
}
