import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { workspaceSchema } from "../shared/schemas.js";
import { parseRefined } from "../shared/refined-args.js";
import { createViewFromTemplate, duplicateView, openOrCreateView, type ManageViewType } from "../shared/manage-view.js";
import { defineTool, type MutateWithStore } from "../shared/tool-runtime.js";
import { chatSessionKeyFromRequest } from "../thread-context.js";

export type ManageViewToolCtx = { mutateWithStore: MutateWithStore };

/** The raw input shape the MCP SDK wraps in `z.object(...)` (registerTool needs a
 * ZodRawShape, not a refined schema). The per-action required-param validation
 * lives on `manageViewSchema` below and is re-run in the handler. */
const manageViewShape = {
  ...workspaceSchema.shape,
  projectId: z.string(),
  action: z.enum(["open_or_create", "duplicate", "create_from_template"]),
  // open_or_create:
  viewType: z.string().optional(),
  // duplicate:
  viewId: z.string().optional(),
  name: z.string().optional(),
  baseCatalogRevision: z.number().int().optional(),
  // create_from_template:
  templateId: z.string().optional(),
  version: z.string().optional(),
  baseGraphRevision: z.number().int().optional(),
  viewName: z.string().optional(),
  // binding (duplicate):
  leaseId: z.string().optional(),
  bindingRevision: z.number().int().optional(),
} as const;

/**
 * Per-action required params. The MCP SDK strips object-level superRefines from
 * the registered shape, so re-validate the refined schema in the handler (see
 * refined-args). Each branch mirrors the required inputs of the tool it replaces:
 * open_or_create ← weaver_get_or_create_view, duplicate ← weaver_duplicate_project_view,
 * create_from_template ← weaver_create_view_from_visual_template.
 */
const manageViewSchema = z.object(manageViewShape).superRefine((value, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (value.action === "open_or_create") {
    if (!value.viewType) fail("MANAGE_VIEW_REQUIRES_viewType");
  } else if (value.action === "duplicate") {
    if (!value.viewId) fail("MANAGE_VIEW_REQUIRES_viewId");
    if (value.baseCatalogRevision === undefined) fail("MANAGE_VIEW_REQUIRES_baseCatalogRevision");
  } else {
    // action === "create_from_template"
    if (!value.templateId) fail("MANAGE_VIEW_REQUIRES_templateId");
    if (value.baseGraphRevision === undefined) fail("MANAGE_VIEW_REQUIRES_baseGraphRevision");
  }
});

/**
 * One model-facing WRITE tool that merges the three VIEW-LIFECYCLE writes:
 * `weaver_get_or_create_view` (model-only, now removed), plus the two the widget
 * also calls by name — `weaver_duplicate_project_view` and
 * `weaver_create_view_from_visual_template`, which stay REGISTERED (app-only) for
 * the widget and delegate to the same shared/manage-view.ts helpers, so the two
 * surfaces never drift.
 */
export function registerManageViewTool(server: McpServer, ctx: ManageViewToolCtx) {
  const { mutateWithStore } = ctx;
  server.registerTool("weaver_manage_view", {
    title: "Manage View",
    description: "Open, duplicate or template a Project View. `action:\"open_or_create\"` + `viewType` opens the stored default projection for one of the seven view types (no graph change). `action:\"duplicate\"` + `viewId` + `baseCatalogRevision` makes an independent layout copy over the same graph. `action:\"create_from_template\"` + `templateId` (+`version`) + `baseGraphRevision` creates a new themed View from a compatible visual template without touching graphRevision or existing views.",
    inputSchema: manageViewShape,
    // idempotentHint:false — duplicate and create_from_template mint a NEW view on
    // every call (not idempotent). Only open_or_create is idempotent; a single
    // static hint cannot be true across the union, so use the conservative false
    // (C4 lesson: an honest annotation for a non-idempotent write union).
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, defineTool(async (rawArgs, extra) => {
    const args = parseRefined<z.infer<typeof manageViewSchema>>(manageViewSchema, rawArgs);
    const chatSessionKey = chatSessionKeyFromRequest(extra, false);
    switch (args.action) {
      case "open_or_create":
        return openOrCreateView({ workspaceDir: args.workspaceDir, projectId: args.projectId, viewType: args.viewType as ManageViewType });
      case "duplicate":
        return duplicateView(mutateWithStore, { workspaceDir: args.workspaceDir, projectId: args.projectId, viewId: args.viewId!, name: args.name, baseCatalogRevision: args.baseCatalogRevision!, leaseId: args.leaseId, bindingRevision: args.bindingRevision, chatSessionKey });
      case "create_from_template":
        return createViewFromTemplate(mutateWithStore, { workspaceDir: args.workspaceDir, projectId: args.projectId, templateId: args.templateId!, version: args.version ?? "1.0.0", baseGraphRevision: args.baseGraphRevision!, viewName: args.viewName, chatSessionKey });
    }
  }));
}
