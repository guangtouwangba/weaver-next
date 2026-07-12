import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WorkspaceStore } from "@weaver/storage";
import { projectSchema } from "../shared/schemas.js";
import { listProjectViews } from "../shared/catalog-reads.js";
import { assertViewMutationContext, duplicateView } from "../shared/manage-view.js";
import { defineTool, result, withStore, type MutateWithStore } from "../shared/tool-runtime.js";
import { chatSessionKeyFromRequest } from "../thread-context.js";

export type ViewCatalogToolsCtx = { mutateWithStore: MutateWithStore };

type ViewMutationAnnotations = { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };

/**
 * 8 of the 12 View Catalog tools share one shape: a `projectSchema` + `baseCatalogRevision` + optional
 * `leaseId`/`bindingRevision` input, the same `assertViewMutationContext` chat-lease guard, the same
 * `mutateWithStore` wrapper, and a bare `result(...)` of whatever the callback returns. They differ only in
 * which extra input fields they accept and which `WorkspaceStore` method they call (and, for
 * `weaver_trash_project_view`, some post-processing of the refreshed chat binding). This helper captures that
 * shared shape once; each call site below only supplies the parts that actually differ.
 */
function registerViewMutationTool(
  server: McpServer,
  mutateWithStore: MutateWithStore,
  name: string,
  config: { title: string; description: string; inputSchema: z.ZodRawShape; annotations: ViewMutationAnnotations; meta?: Record<string, unknown> },
  run: (store: WorkspaceStore, input: any, chatSessionKey: string | undefined) => unknown,
) {
  const toolConfig = config.meta
    ? { title: config.title, description: config.description, inputSchema: config.inputSchema, annotations: config.annotations, _meta: config.meta }
    : { title: config.title, description: config.description, inputSchema: config.inputSchema, annotations: config.annotations };
  // Cast through `any` here only: this internal helper deliberately supports a different `inputSchema`
  // shape per call site (see call sites below), which is inherently at odds with `registerTool`'s
  // per-call generic inference. Every call site below still passes a real zod shape, so the tool's
  // published inputSchema and runtime validation are unaffected; only this wrapper's own static typing
  // is loosened.
  (server.registerTool as any)(name, toolConfig, defineTool(async (input: any, extra: any) => {
    const chatSessionKey = chatSessionKeyFromRequest(extra, false);
    return result(mutateWithStore(input.workspaceDir, (store) => {
      assertViewMutationContext(store, input.projectId, chatSessionKey, { leaseId: input.leaseId, bindingRevision: input.bindingRevision });
      return run(store, input, chatSessionKey);
    }));
  }));
}

/** View catalog: list saved Views, the near-identical catalog mutations, and the app-only duplicate write. */
export function registerViewCatalogTools(server: McpServer, ctx: ViewCatalogToolsCtx) {
  const { mutateWithStore } = ctx;

  // Widget-only: the preview widget lists Views here, so it stays REGISTERED under
  // this exact name with `_meta.ui.visibility=["app"]` (off the model surface). The
  // model lists/searches/reads Views via weaver_read_catalog(resource:"view.*");
  // both call the same shared helper (see shared/catalog-reads.ts) so they never drift.
  // `weaver_search_project_views` and `weaver_get_project_view` were model-only and
  // are now folded into weaver_read_catalog.
  server.registerTool("weaver_list_project_views", {
    title: "List Project Views", description: "List durable saved Visual Views, including fixed order and recycle-bin status.",
    inputSchema: { ...projectSchema.shape, status: z.enum(["active", "trashed"]).optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } },
  }, defineTool(async ({ workspaceDir, projectId, status }) => result(withStore(workspaceDir, (store) => listProjectViews(store, projectId, status)))));

  const viewMutationBase = { ...projectSchema.shape, viewId: z.string(), baseCatalogRevision: z.number().int().nonnegative(), leaseId: z.string().optional(), bindingRevision: z.number().int().positive().optional() };
  const appVisibility = { ui: { visibility: ["app"] } };

  registerViewMutationTool(server, mutateWithStore, "weaver_rename_project_view", {
    title: "Rename Project View", description: "Rename one saved View without changing graph or layout revisions.",
    inputSchema: { ...viewMutationBase, name: z.string().min(1).max(120) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, meta: appVisibility,
  }, (store, input) => store.renameProjectView({ projectId: input.projectId, viewId: input.viewId, name: input.name, baseCatalogRevision: input.baseCatalogRevision }));

  registerViewMutationTool(server, mutateWithStore, "weaver_pin_project_view", {
    title: "Pin Project View", description: "Pin or unpin a View in the top shortcut bar.",
    inputSchema: { ...viewMutationBase, pinned: z.boolean() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, meta: appVisibility,
  }, (store, input) => store.pinProjectView({ projectId: input.projectId, viewId: input.viewId, pinned: input.pinned, baseCatalogRevision: input.baseCatalogRevision }));

  registerViewMutationTool(server, mutateWithStore, "weaver_reorder_pinned_views", {
    title: "Reorder Pinned Views", description: "Persist the complete ordered list of pinned Views.",
    inputSchema: { ...projectSchema.shape, viewIds: z.array(z.string()), baseCatalogRevision: z.number().int().nonnegative(), leaseId: z.string().optional(), bindingRevision: z.number().int().positive().optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, meta: appVisibility,
  }, (store, input) => store.reorderPinnedViews({ projectId: input.projectId, viewIds: input.viewIds, baseCatalogRevision: input.baseCatalogRevision }));

  registerViewMutationTool(server, mutateWithStore, "weaver_set_default_view", {
    title: "Set Default View", description: "Set the Project-wide initial View for new Chat bindings.",
    inputSchema: viewMutationBase,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, meta: appVisibility,
  }, (store, input) => store.setDefaultProjectView({ projectId: input.projectId, viewId: input.viewId, baseCatalogRevision: input.baseCatalogRevision }));

  registerViewMutationTool(server, mutateWithStore, "weaver_trash_project_view", {
    title: "Move View to Recycle Bin", description: "Soft-delete a View for 30 days, selecting a safe fallback without changing Graph data.",
    inputSchema: { ...viewMutationBase, fallbackViewId: z.string().optional() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }, meta: appVisibility,
  }, (store, input, chatSessionKey) => {
    const changed = store.trashProjectView({ projectId: input.projectId, viewId: input.viewId, fallbackViewId: input.fallbackViewId, baseCatalogRevision: input.baseCatalogRevision });
    const nextBinding = chatSessionKey ? store.getChatCanvasBinding(chatSessionKey) : undefined;
    return { ...changed, binding: nextBinding ? { leaseId: nextBinding.leaseId, bindingRevision: nextBinding.bindingRevision, projectId: nextBinding.projectId, viewId: nextBinding.viewId } : undefined };
  });

  registerViewMutationTool(server, mutateWithStore, "weaver_restore_project_view", {
    title: "Restore Project View", description: "Restore a View from the recycle bin without stealing focus.",
    inputSchema: viewMutationBase,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, meta: appVisibility,
  }, (store, input) => store.restoreProjectView({ projectId: input.projectId, viewId: input.viewId, baseCatalogRevision: input.baseCatalogRevision }));

  registerViewMutationTool(server, mutateWithStore, "weaver_purge_project_view", {
    title: "Permanently Delete Project View", description: "Permanently purge an already-trashed View and its layout history.",
    inputSchema: viewMutationBase,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }, meta: appVisibility,
  }, (store, input) => store.purgeProjectView({ projectId: input.projectId, viewId: input.viewId, baseCatalogRevision: input.baseCatalogRevision }));

  // Widget-only: the preview widget's View menu duplicates Views here
  // (apps/widget useViewCatalog), so it stays REGISTERED under this exact name
  // with `_meta.ui.visibility=["app"]` (off the model surface). The model
  // duplicates via weaver_manage_view(action:"duplicate"); both call the shared
  // duplicateView helper (see shared/manage-view.ts) so they never drift.
  // `weaver_get_or_create_view` was model-only (not widget-called) and is now
  // folded into weaver_manage_view(action:"open_or_create") — its registration is removed.
  server.registerTool("weaver_duplicate_project_view", {
    title: "Duplicate Project View", description: "Create an independent layout copy over the same content graph.",
    inputSchema: { ...viewMutationBase, name: z.string().max(120).optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } },
  }, defineTool(async ({ workspaceDir, projectId, viewId, name, baseCatalogRevision, leaseId, bindingRevision }, extra) => {
    const chatSessionKey = chatSessionKeyFromRequest(extra, false);
    return duplicateView(mutateWithStore, { workspaceDir, projectId, viewId, name, baseCatalogRevision, leaseId, bindingRevision, chatSessionKey });
  }));
}
