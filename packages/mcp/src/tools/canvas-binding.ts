import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { canvasContextSnapshotSchema } from "@weaver/contracts";
import { resolveBoundCanvas } from "../shared/bound-canvas.js";
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
    // Widget-only: the on-canvas widget calls this under its own name. Its own
    // `visibility: ["app"]` overrides the allowlist bump so it stays
    // widget-accessible but off the MODEL surface — the model reads the same
    // binding via `weaver_read_session(resource:"bound_canvas")`.
    _meta: { ui: { visibility: ["app"] } },
  }, defineTool(async ({ workspaceDir }, extra) => {
    const chatSessionKey = chatSessionKeyFromRequest(extra);
    return result(withStore(workspaceDir, (store) => resolveBoundCanvas(store, chatSessionKey)));
  }));

  server.registerTool("weaver_get_canvas_view_state", {
    title: "Get Canvas View State", description: "Widget-only restoration of this Canvas Session's viewport and selection for one View.",
    inputSchema: { ...workspaceSchema.shape, canvasSessionId: z.string(), viewId: z.string() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } },
  }, defineTool(async ({ workspaceDir, canvasSessionId, viewId }) => result(withStore(workspaceDir, (store) => store.getCanvasViewState(canvasSessionId, viewId) ?? { canvasSessionId, viewId, firstOpen: true }))));
}
