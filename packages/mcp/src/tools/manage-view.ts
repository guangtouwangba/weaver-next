import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { catalogActionSchema } from "@weaver/contracts";
import { getScenePack } from "@weaver/scene-packs";
import { getVisualTemplate } from "@weaver/visual-templates";
import { workspaceSchema } from "../shared/schemas.js";
import { defineTool, result, type MutateWithStore } from "../shared/tool-runtime.js";
import { chatSessionKeyFromRequest } from "../thread-context.js";

export type ManageViewToolCtx = { mutateWithStore: MutateWithStore };

export function registerManageViewTool(server: McpServer, { mutateWithStore }: ManageViewToolCtx) {
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
    const chatSessionKey = chatSessionKeyFromRequest(extra, false);
    return result(mutateWithStore(args.workspaceDir, (store) => {
      const required = <T>(value: T | undefined, name: string): T => { if (value === undefined || value === "") throw new Error(`INVALID_ARGS:${name} required`); return value; };
      if (args.action === "create_project") {
        const scene = getScenePack(required(args.scenePackId, "scenePackId")); if (!scene) throw new Error("CATALOG_INVALID:scene pack");
        return store.catalog.createSeededProject({ title: required(args.title, "title"), goal: args.goal ?? "", scenePack: scene, chatSessionKey });
      }
      if (args.action === "create_project_from_template") {
        const scene = getScenePack(required(args.scenePackId, "scenePackId")); const template = getVisualTemplate(required(args.templateId, "templateId"), args.version);
        if (!scene || !template) throw new Error("VISUAL_TEMPLATE_NOT_FOUND");
        return store.catalog.createProjectFromTemplate({ title: required(args.title, "title"), goal: args.goal ?? "", scenePack: scene, template, chatBinding: chatSessionKey ? { chatSessionKey } : undefined });
      }
      const projectId = required(args.projectId, "projectId");
      if (args.action === "create_view_from_template") {
        const template = getVisualTemplate(required(args.templateId, "templateId"), args.version); if (!template) throw new Error("VISUAL_TEMPLATE_NOT_FOUND");
        return store.catalog.createViewFromTemplate({ projectId, template, baseGraphRevision: required(args.baseGraphRevision, "baseGraphRevision"), viewName: args.viewName, chatBinding: chatSessionKey && args.leaseId && args.bindingRevision ? { chatSessionKey, leaseId: args.leaseId, bindingRevision: args.bindingRevision } : undefined });
      }
      const base = required(args.baseCatalogRevision, "baseCatalogRevision");
      if (args.action === "reorder_views") return store.catalog.reorderViews({ projectId, viewIds: required(args.viewIds, "viewIds"), baseCatalogRevision: base });
      const viewId = required(args.viewId, "viewId");
      switch (args.action) {
        case "duplicate_view": return store.catalog.duplicateView({ projectId, viewId, name: args.name, baseCatalogRevision: base });
        case "rename_view": return store.catalog.renameView({ projectId, viewId, name: required(args.name, "name"), baseCatalogRevision: base });
        case "pin_view": return store.catalog.pinView({ projectId, viewId, pinned: args.pinned ?? true, baseCatalogRevision: base });
        case "set_default_view": return store.catalog.setDefaultView({ projectId, viewId, baseCatalogRevision: base });
        case "trash_view": return store.catalog.trashView({ projectId, viewId, fallbackViewId: args.fallbackViewId, baseCatalogRevision: base });
        case "restore_view": return store.catalog.restoreView({ projectId, viewId, baseCatalogRevision: base });
        case "purge_view": return store.catalog.purgeView({ projectId, viewId, baseCatalogRevision: base });
        default: throw new Error("INVALID_ARGS:unsupported catalog action");
      }
    }));
  }));
}
