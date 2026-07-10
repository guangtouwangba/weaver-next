import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { projectSchema } from "../shared/schemas.js";
import { defineTool, result, type MutateWithStore } from "../shared/tool-runtime.js";
import { chatSessionKeyFromRequest } from "../thread-context.js";
import type { SseEventHub } from "../event-hub.js";

export type WorkspaceToolsCtx = {
  eventHub: SseEventHub;
  mutateWithStore: MutateWithStore;
  widgetUri: string;
};

/** Workspace/widget bootstrap: open the native canvas widget and open its loopback SSE event stream. */
export function registerWorkspaceTools(server: McpServer, ctx: WorkspaceToolsCtx) {
  const { eventHub, mutateWithStore, widgetUri } = ctx;

  registerAppTool(server, "weaver_open_workspace_widget", {
    title: "Open Weaver Workspace",
    description: "Open the native Weaver semantic canvas for an explicit local workspace and optional project.",
    inputSchema: { workspaceDir: z.string().min(1), projectId: z.string().optional(), displayMode: z.enum(["fullscreen", "inline"]).default("fullscreen") },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { resourceUri: widgetUri, visibility: ["model", "app"] }, "ui/resourceUri": widgetUri, "openai/outputTemplate": widgetUri, "openai/widgetAccessible": true },
  }, defineTool(async (input, extra) => {
    const chatSessionKey = chatSessionKeyFromRequest(extra);
    const binding = mutateWithStore(input.workspaceDir, (store) => {
      let viewId: string | undefined;
      if (input.projectId) {
        const project = store.getProject(input.projectId);
        if (!project) throw new Error("PROJECT_NOT_FOUND");
        viewId = project.defaultViewId;
      }
      return store.openChatCanvasBinding({ chatSessionKey, projectId: input.projectId, viewId });
    });
    return result({ version: 2, widget: "weaver-workspace", workspaceDir: input.workspaceDir, projectId: input.projectId, preferredDisplayMode: input.displayMode, chatBinding: { leaseId: binding.leaseId, bindingRevision: binding.bindingRevision, projectId: binding.projectId, viewId: binding.viewId } }, "Opened Weaver workspace widget.");
  }));

  server.registerTool("weaver_open_canvas_event_stream", {
    title: "Open Canvas Event Stream",
    description: "Widget-only creation of a project-scoped, read-only loopback SSE stream for durable Weaver task, graph and layout events.",
    inputSchema: { ...projectSchema.shape, canvasSessionId: z.string().min(1) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    _meta: { ui: { visibility: ["app"] } },
  }, defineTool(async ({ workspaceDir, projectId, canvasSessionId }) => {
    return result(eventHub.openStream({ workspaceDir, projectId, canvasSessionId }), "Opened Weaver event stream.");
  }));
}
