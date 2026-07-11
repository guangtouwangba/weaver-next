import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { canvasContextSnapshotSchema } from "@weaver/contracts";
import { resolveSceneContext } from "@weaver/core";
import { getScenePack } from "@weaver/scene-packs";
import { workspaceSchema } from "../shared/schemas.js";
import { defineTool, result, withStore, type MutateWithStore } from "../shared/tool-runtime.js";
import { chatSessionKeyFromRequest } from "../thread-context.js";

export type CanvasBindingToolsCtx = { mutateWithStore: MutateWithStore };

/** Canvas binding/context sync: idempotent widget context sync, chat<->canvas lease binding, and scene-policy context resolution. */
export function registerCanvasBindingTools(server: McpServer, ctx: CanvasBindingToolsCtx) {
  const { mutateWithStore } = ctx;

  server.registerTool("weaver_sync_canvas_context", {
    title: "Sync Canvas Context", description: "Widget-only idempotent sync of selection, viewport, pinned nodes and independent graph/layout revisions.",
    // `snapshot` is the fully-typed context schema (not z.any()) so hosts that
    // validate/serialize widget args against the input schema before proxying —
    // Codex's Apps-SDK does — can actually send the call. An untyped z.any()
    // produced an empty schema Codex refused to proxy (-32000, the call never
    // reached the server), which was the whole "画布连接失败" claim failure.
    // readOnlyHint MUST be true: Codex's Apps-SDK proxy blocks widget-initiated
    // *writes* (readOnlyHint:false) with -32000, and this is the one write the
    // widget makes on load — the "画布连接失败" claim. It is an idempotent context
    // sync (selection/viewport/heartbeat), not a destructive graph mutation, so
    // read-only is an honest annotation that lets the proxy deliver the call.
    inputSchema: { ...workspaceSchema.shape, snapshot: canvasContextSnapshotSchema }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { visibility: ["app"] }, "openai/widgetAccessible": true },
  }, defineTool(async ({ workspaceDir, snapshot }, extra) => {
    const chatSessionKey = snapshot?.agentEligible ? chatSessionKeyFromRequest(extra) : chatSessionKeyFromRequest(extra, false);
    const output = mutateWithStore(workspaceDir, (store) => {
      const context = store.syncCanvasContext(snapshot, chatSessionKey);
      const project = store.getProject(context.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND");
      const layout = store.getLayout(context.projectId, context.viewId); if (!layout) throw new Error("LAYOUT_NOT_FOUND");
      const binding = chatSessionKey ? store.getChatCanvasBinding(chatSessionKey) : undefined;
      return {
        context, bindingStatus: binding?.status ?? "detached", canvasSessionId: context.canvasSessionId,
        graphRevision: project.graphRevision, layoutRevision: layout.layoutRevision,
      };
    });
    return result(output);
  }));

  server.registerTool("weaver_switch_chat_canvas", {
    title: "Switch Chat Canvas", description: "Widget-only explicit Project/View switch for the current Codex chat lease.",
    inputSchema: { ...workspaceSchema.shape, leaseId: z.string().regex(/^[a-f0-9]{64}$/), bindingRevision: z.number().int().positive(), projectId: z.string(), viewId: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } },
  }, defineTool(async ({ workspaceDir, leaseId, bindingRevision, projectId, viewId }, extra) => {
    const chatSessionKey = chatSessionKeyFromRequest(extra);
    const binding = mutateWithStore(workspaceDir, (store) => store.switchChatCanvasBinding({ chatSessionKey, leaseId, bindingRevision, projectId, viewId }));
    return result({ leaseId: binding.leaseId, bindingRevision: binding.bindingRevision, projectId: binding.projectId, viewId: binding.viewId });
  }));

  server.registerTool("weaver_get_bound_canvas", {
    title: "Get Bound Canvas", description: "Resolve the exact Project, View and Canvas currently bound to this Codex chat. Never guesses from focus or recency.",
    inputSchema: workspaceSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { visibility: ["app", "model"] } },
  }, defineTool(async ({ workspaceDir }, extra) => {
    const chatSessionKey = chatSessionKeyFromRequest(extra);
    const output = withStore(workspaceDir, (store) => {
      const { binding, context } = store.getBoundCanvas(chatSessionKey, false);
      const project = store.getProject(context.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND");
      const layout = store.getLayout(context.projectId, context.viewId); if (!layout) throw new Error("LAYOUT_NOT_FOUND");
      const seenAt = Date.parse(context.presence?.lastSeenAt ?? context.updatedAt);
      return {
        projectId: context.projectId, viewId: context.viewId, canvasSessionId: context.canvasSessionId,
        bindingStatus: binding.status, online: Date.now() - seenAt <= 30_000, lastSeenAt: context.presence?.lastSeenAt ?? context.updatedAt,
        graphRevision: project.graphRevision, layoutRevision: layout.layoutRevision, bindingRevision: binding.bindingRevision,
      };
    });
    return result(output);
  }));

  server.registerTool("weaver_get_canvas_context", {
    title: "Get Canvas Context", description: "Read the authoritative selection and view snapshot for one canvas session.", inputSchema: { ...workspaceSchema.shape, canvasSessionId: z.string() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, defineTool(async ({ workspaceDir, canvasSessionId }) => { const context = withStore(workspaceDir, (store) => store.getCanvasContext(canvasSessionId)); if (!context) throw new Error("CANVAS_SESSION_NOT_FOUND"); return result(context); }));

  server.registerTool("weaver_get_canvas_view_state", {
    title: "Get Canvas View State", description: "Widget-only restoration of this Canvas Session's viewport and selection for one View.",
    inputSchema: { ...workspaceSchema.shape, canvasSessionId: z.string(), viewId: z.string() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } },
  }, defineTool(async ({ workspaceDir, canvasSessionId, viewId }) => result(withStore(workspaceDir, (store) => store.getCanvasViewState(canvasSessionId, viewId) ?? { canvasSessionId, viewId, firstOpen: true }))));

  server.registerTool("weaver_resolve_context", {
    title: "Resolve Scene Context", description: "Resolve a bounded, auditable node context using the project's pinned scene policy and current canvas selection.",
    inputSchema: { ...workspaceSchema.shape, canvasSessionId: z.string() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, defineTool(async ({ workspaceDir, canvasSessionId }) => { const output = withStore(workspaceDir, (store) => { const context = store.getCanvasContext(canvasSessionId); if (!context) throw new Error("CANVAS_SESSION_NOT_FOUND"); const project = store.getProject(context.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); const scenePack = getScenePack(project.scenePackId, project.scenePackVersion); if (!scenePack) throw new Error("SCENE_PACK_NOT_FOUND"); const graph = store.getGraph(project.id); const nodes = resolveSceneContext({ nodes: graph.nodes, edges: graph.edges, scenePack, selectedNodeIds: context.selectedNodeIds, pinnedNodeIds: context.pinnedContextNodeIds }); return { projectId: project.id, graphRevision: graph.revision, policy: scenePack.contextPolicy, nodeIds: nodes.map((node) => node.id), nodes }; }); return result(output, `Resolved ${output.nodes.length} context nodes.`); }));
}
