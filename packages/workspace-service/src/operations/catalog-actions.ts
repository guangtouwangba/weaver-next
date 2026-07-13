import { catalogActionSchema } from "@weaver/contracts";
import { getScenePack } from "@weaver/scene-packs";
import type { WorkspaceStore } from "@weaver/storage";
import { getVisualTemplate } from "@weaver/visual-templates";
import type { WorkspacePrincipal } from "./catalog.js";

function required<T>(value: T | undefined, name: string): T {
  if (value === undefined || value === "") throw new Error(`INVALID_ARGS:${name} required`);
  return value;
}

function principalChatSessionKey(store: WorkspaceStore, principal: WorkspacePrincipal) {
  if (principal.kind === "chat") return principal.chatSessionKey;
  if (principal.kind === "browser") return store.browserSessions.get(principal.browserSessionId)?.pairedChatSessionKey;
  return undefined;
}

export function applyCatalogAction(store: WorkspaceStore, principal: WorkspacePrincipal, input: Record<string, unknown>) {
  const args = catalogActionSchema.parse({ ...input, workspaceDir: store.workspaceDir });
  const chatSessionKey = principalChatSessionKey(store, principal);
  if (args.action === "create_project") {
    const scene = getScenePack(required(args.scenePackId, "scenePackId"));
    if (!scene) throw new Error("CATALOG_INVALID:scene pack");
    return store.catalog.createSeededProject({ title: required(args.title, "title"), goal: args.goal ?? "", scenePack: scene, chatSessionKey });
  }
  if (args.action === "create_project_from_template") {
    const scene = getScenePack(required(args.scenePackId, "scenePackId"));
    const template = getVisualTemplate(required(args.templateId, "templateId"), args.version);
    if (!scene || !template) throw new Error("VISUAL_TEMPLATE_NOT_FOUND");
    return store.catalog.createProjectFromTemplate({ title: required(args.title, "title"), goal: args.goal ?? "", scenePack: scene, template, chatBinding: chatSessionKey ? { chatSessionKey } : undefined });
  }
  const projectId = required(args.projectId, "projectId");
  if (args.action === "create_view_from_template") {
    const template = getVisualTemplate(required(args.templateId, "templateId"), args.version);
    if (!template) throw new Error("VISUAL_TEMPLATE_NOT_FOUND");
    return store.catalog.createViewFromTemplate({ projectId, template, baseGraphRevision: required(args.baseGraphRevision, "baseGraphRevision"), viewName: args.viewName, chatBinding: chatSessionKey && args.leaseId && args.bindingRevision ? { chatSessionKey, leaseId: args.leaseId, bindingRevision: args.bindingRevision } : undefined });
  }
  const baseCatalogRevision = required(args.baseCatalogRevision, "baseCatalogRevision");
  if (args.action === "reorder_views") return store.catalog.reorderViews({ projectId, viewIds: required(args.viewIds, "viewIds"), baseCatalogRevision });
  const viewId = required(args.viewId, "viewId");
  switch (args.action) {
    case "duplicate_view": return store.catalog.duplicateView({ projectId, viewId, name: args.name, baseCatalogRevision });
    case "rename_view": return store.catalog.renameView({ projectId, viewId, name: required(args.name, "name"), baseCatalogRevision });
    case "pin_view": return store.catalog.pinView({ projectId, viewId, pinned: args.pinned ?? true, baseCatalogRevision });
    case "set_default_view": return store.catalog.setDefaultView({ projectId, viewId, baseCatalogRevision });
    case "trash_view": return store.catalog.trashView({ projectId, viewId, fallbackViewId: args.fallbackViewId, baseCatalogRevision });
    case "restore_view": return store.catalog.restoreView({ projectId, viewId, baseCatalogRevision });
    case "purge_view": return store.catalog.purgeView({ projectId, viewId, baseCatalogRevision });
    default: throw new Error("INVALID_ARGS:unsupported catalog action");
  }
}
