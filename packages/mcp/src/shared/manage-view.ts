import { getScenePack } from "@weaver/scene-packs";
import { getVisualTemplate, validateVisualTemplateForProject } from "@weaver/visual-templates";
import type { LayoutDocument } from "@weaver/contracts";
import type { WorkspaceStore } from "@weaver/storage";
import { track } from "./workspace-registry.js";
import { result, withStore, type MutateWithStore } from "./tool-runtime.js";

/**
 * Single source of truth for the three VIEW-LIFECYCLE writes, shared by the
 * model-facing merged tool `weaver_manage_view` and the two still-registered
 * widget tools (`weaver_duplicate_project_view`,
 * `weaver_create_view_from_visual_template`, both app-only), so the surfaces
 * never drift. Each helper reproduces the exact store calls, auth/lease guard,
 * revision checks and result payload of the handler it replaces
 * (`weaver_get_or_create_view` — model-only, now removed — plus the two above).
 */

const defaultStrategyByView = {
  canvas: "hybrid", tree: "tree", graph: "force", board: "swimlane", timeline: "timeline", flow: "layered", table: "grid",
} as const;

export type ManageViewType = keyof typeof defaultStrategyByView;

/** The chat-lease guard the View-catalog mutations run inside `mutateWithStore`.
 * Shared here so `weaver_duplicate_project_view` (widget) and the other View
 * catalog mutations use one definition. No chatSessionKey ⇒ no guard (Codex chat
 * without a bound canvas is allowed for reads-only paths that reach here). */
export function assertViewMutationContext(store: WorkspaceStore, projectId: string, chatSessionKey?: string, lease?: { leaseId?: string; bindingRevision?: number }) {
  if (!chatSessionKey) return;
  const binding = store.getChatCanvasBinding(chatSessionKey);
  if (!binding || binding.projectId !== projectId) throw new Error("NO_CANVAS_BOUND_TO_CHAT");
  if (lease?.leaseId && (binding.leaseId !== lease.leaseId || binding.bindingRevision !== lease.bindingRevision)) throw new Error("CHAT_CANVAS_LEASE_STALE");
}

/** weaver_get_or_create_view core. Uses `withStore` (no workspace event) + `track`,
 * with no chat-lease guard — preserved exactly from the original handler. */
export function openOrCreateView(args: { workspaceDir: string; projectId: string; viewType: ManageViewType }) {
  const output = withStore(args.workspaceDir, (store) => {
    const project = store.getProject(args.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND");
    const scene = getScenePack(project.scenePackId, project.scenePackVersion); if (!scene) throw new Error("SCENE_PACK_NOT_FOUND");
    if (!scene.recommendedViews.includes(args.viewType)) throw new Error(`VIEW_NOT_RECOMMENDED:${args.viewType}`);
    const strategy = (scene.defaultView === args.viewType ? scene.defaultStrategy : defaultStrategyByView[args.viewType]) as LayoutDocument["strategy"];
    return store.ensureView({ projectId: args.projectId, viewId: `${args.viewType}-default`, viewType: args.viewType, strategy });
  });
  track(args.workspaceDir, args.projectId);
  return result(output, `Opened ${args.viewType} view.`);
}

/** weaver_duplicate_project_view core. Runs the chat-lease guard inside the same
 * `mutateWithStore` transaction as the store call, exactly as the original. */
export function duplicateView(mutateWithStore: MutateWithStore, args: { workspaceDir: string; projectId: string; viewId: string; name?: string; baseCatalogRevision: number; leaseId?: string; bindingRevision?: number; chatSessionKey?: string }) {
  return result(mutateWithStore(args.workspaceDir, (store) => {
    assertViewMutationContext(store, args.projectId, args.chatSessionKey, { leaseId: args.leaseId, bindingRevision: args.bindingRevision });
    return store.duplicateProjectView({ projectId: args.projectId, viewId: args.viewId, name: args.name, baseCatalogRevision: args.baseCatalogRevision });
  }));
}

/** weaver_create_view_from_visual_template core. Preserves the template lookup,
 * scene-compatibility + data-readiness checks, chat-binding validation and
 * payload shape of the original handler verbatim. */
export function createViewFromTemplate(mutateWithStore: MutateWithStore, args: { workspaceDir: string; projectId: string; templateId: string; version: string; baseGraphRevision: number; viewName?: string; chatSessionKey?: string }) {
  const template = getVisualTemplate(args.templateId, args.version); if (!template) throw new Error("VISUAL_TEMPLATE_NOT_FOUND");
  const output = mutateWithStore(args.workspaceDir, (store) => {
    const project = store.getProject(args.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND");
    const scene = getScenePack(project.scenePackId, project.scenePackVersion); if (!scene) throw new Error("SCENE_PACK_NOT_FOUND");
    const validation = validateVisualTemplateForProject(template, scene, store.getGraph(args.projectId).nodes);
    if (!validation.compatible) throw new Error("VISUAL_TEMPLATE_SCENE_INCOMPATIBLE");
    if (!validation.ready) throw new Error("VISUAL_TEMPLATE_DATA_NOT_READY");
    const currentBinding = args.chatSessionKey ? store.getChatCanvasBinding(args.chatSessionKey) : null;
    if (args.chatSessionKey && (!currentBinding || currentBinding.projectId !== args.projectId)) throw new Error("NO_CANVAS_BOUND_TO_CHAT");
    const layout = store.createViewFromVisualTemplate({ projectId: args.projectId, template, baseGraphRevision: args.baseGraphRevision, viewName: args.viewName, chatBinding: args.chatSessionKey && currentBinding ? { chatSessionKey: args.chatSessionKey, leaseId: currentBinding.leaseId, bindingRevision: currentBinding.bindingRevision } : undefined });
    const binding = args.chatSessionKey ? store.getChatCanvasBinding(args.chatSessionKey) : undefined;
    return { layout, binding };
  });
  track(args.workspaceDir, args.projectId);
  const binding = output.binding ? { leaseId: output.binding.leaseId, bindingRevision: output.binding.bindingRevision, projectId: output.binding.projectId, viewId: output.binding.viewId } : undefined;
  return result({ ...output.layout, chatBinding: binding }, `Created ${output.layout.viewName}.`);
}
