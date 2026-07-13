import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { builtinScenePacks } from "@weaver/scene-packs";
import { builtinVisualTemplates, getVisualTemplate } from "@weaver/visual-templates";
import { workspaceByProject, workspaceByTask } from "./shared/workspace-registry.js";
import { log } from "./logger.js";
import type { SseEventHub } from "./event-hub.js";
import { chatSessionKeyFromRequest } from "./thread-context.js";
import { widgetBuildId } from "./widget.js";
import { dispatchWorkspaceAgentOperation } from "./workspace-runtime.js";

export type ResourcesCtx = { eventHub: SseEventHub; widgetUri: string };

export const LEGACY_WIDGET_URI = "ui://widget/weaver/workspace.html";

/** MCP resources: the widget app resource plus declarative reads for scene-packs/templates/tasks/views/assets. */
export function registerResources(server: McpServer, ctx: ResourcesCtx) {
  const { eventHub, widgetUri } = ctx;
  const read = (workspaceDir: string, arguments_: Record<string, unknown>, extra: unknown) => dispatchWorkspaceAgentOperation({ workspaceDir, buildId: widgetBuildId(), chatSessionKey: chatSessionKeyFromRequest(extra), operation: "resource.read", arguments: arguments_ });

  const widgetResourceOptions = {
    title: "Weaver Semantic Space",
    description: "A native semantic node canvas with natural-language layout tasks and deterministic previews.",
    _meta: {
      ui: { prefersBorder: false, csp: { connectDomains: [eventHub.origin], resourceDomains: ["data:", "blob:", eventHub.origin] } },
      "openai/widgetDescription": "Weaver semantic knowledge space",
      "openai/widgetPrefersBorder": false,
    },
  };
  // Log every widget HTML read so a Codex `resources/read` (the render path that
  // used to fail with -32602) is traceable in .weaver/logs against the host logs.
  const readWidget = (uri: string) => async () => {
    log("info", "resource.read", { uri, buildId: eventHub.buildId });
    return { contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: eventHub.inlineWidgetHtml(), _meta: { "openai/widgetPrefersBorder": false } }] };
  };

  registerAppResource(server, "weaver-workspace-widget", widgetUri, widgetResourceOptions, readWidget(widgetUri));
  // Existing Codex tasks can retain an older tool descriptor after the plugin
  // process upgrades. Keep its stable outputTemplate readable while all newly
  // advertised tools use the immutable build-versioned URI above.
  if (widgetUri !== LEGACY_WIDGET_URI) {
    registerAppResource(server, "weaver-workspace-widget-legacy", LEGACY_WIDGET_URI, widgetResourceOptions, readWidget(LEGACY_WIDGET_URI));
  }

  server.registerResource("weaver-scene-packs", "weaver://scene-packs", { title: "Weaver Scene Packs", description: "The built-in versioned scene catalog.", mimeType: "application/json" }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(builtinScenePacks) }] }));
  server.registerResource("weaver-visual-templates", "weaver://visual-templates", { title: "Weaver Visual Templates", description: "The built-in immutable structured visual template catalog.", mimeType: "application/json" }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(builtinVisualTemplates) }] }));
  server.registerResource("weaver-visual-template", new ResourceTemplate("weaver://visual-templates/{templateId}/{version}", { list: undefined }), { title: "Weaver Visual Template", description: "One versioned VisualTemplate definition.", mimeType: "application/json" }, async (uri, variables) => { const item = getVisualTemplate(String(variables.templateId), String(variables.version)); if (!item) throw new Error("VISUAL_TEMPLATE_NOT_FOUND"); return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(item) }] }; });
  server.registerResource("weaver-agent-task", new ResourceTemplate("weaver://agent-tasks/{taskId}", { list: undefined }), { title: "Weaver Agent Task", description: "One persisted AgentTask. Call a task tool first so the server can resolve its workspace.", mimeType: "application/json" }, async (uri, variables, extra) => { const taskId = String(variables.taskId); const workspaceDir = workspaceByTask.get(taskId); if (!workspaceDir) throw new Error("WORKSPACE_UNKNOWN_CALL_WEAVER_GET_AGENT_TASK_FIRST"); const task = await read(workspaceDir, { resource: "agent_task", taskId }, extra); return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(task) }] }; });
  server.registerResource("weaver-project-views", new ResourceTemplate("weaver://projects/{projectId}/views", { list: undefined }), { title: "Weaver Project Views", description: "Durable saved View catalog records for a project, including recycle-bin state.", mimeType: "application/json" }, async (uri, variables, extra) => { const projectId = String(variables.projectId); const workspaceDir = workspaceByProject.get(projectId); if (!workspaceDir) throw new Error("WORKSPACE_UNKNOWN_CALL_A_WEAVER_TOOL_FIRST"); const views = await read(workspaceDir, { resource: "project_views", projectId }, extra); return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(views) }] }; });
  server.registerResource("weaver-view-projection", new ResourceTemplate("weaver://projects/{projectId}/views/{viewId}/projection", { list: undefined }), { title: "Weaver View Projection", description: "Projection and theme metadata for one visual view.", mimeType: "application/json" }, async (uri, variables, extra) => { const projectId = String(variables.projectId); const workspaceDir = workspaceByProject.get(projectId); if (!workspaceDir) throw new Error("WORKSPACE_UNKNOWN_CALL_A_WEAVER_TOOL_FIRST"); const data = await read(workspaceDir, { resource: "view_projection", projectId, viewId: String(variables.viewId) }, extra); return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data) }] }; });
  server.registerResource("weaver-project-manifest", new ResourceTemplate("weaver://projects/{projectId}/manifest", { list: undefined }), { title: "Weaver Project Manifest", description: "Pinned project and scene rules.", mimeType: "application/json" }, async (uri, variables, extra) => { const projectId = String(variables.projectId); const workspaceDir = workspaceByProject.get(projectId); if (!workspaceDir) throw new Error("WORKSPACE_UNKNOWN_CALL_A_WEAVER_TOOL_FIRST"); const data = await read(workspaceDir, { resource: "project_manifest", projectId }, extra); return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data) }] }; });
  server.registerResource("weaver-node-content", new ResourceTemplate("weaver://projects/{projectId}/nodes/{nodeId}/content", { list: undefined }), { title: "Weaver Node Content", description: "Full content for one explicitly selected node.", mimeType: "application/json" }, async (uri, variables, extra) => { const projectId = String(variables.projectId); const workspaceDir = workspaceByProject.get(projectId); if (!workspaceDir) throw new Error("WORKSPACE_UNKNOWN_CALL_A_WEAVER_TOOL_FIRST"); const node = await read(workspaceDir, { resource: "node_content", projectId, nodeId: String(variables.nodeId) }, extra); return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(node) }] }; });
  server.registerResource("weaver-image-asset", new ResourceTemplate("weaver://projects/{projectId}/assets/{assetId}", { list: undefined }), { title: "Weaver Original Image", description: "Original image bytes for an explicitly requested asset.", mimeType: "application/octet-stream" }, async (uri, variables, extra) => { const projectId = String(variables.projectId); const workspaceDir = workspaceByProject.get(projectId); if (!workspaceDir) throw new Error("WORKSPACE_UNKNOWN_CALL_A_WEAVER_TOOL_FIRST"); const item = await read(workspaceDir, { resource: "image_asset", projectId, assetId: String(variables.assetId) }, extra) as { mimeType: string; base64: string }; return { contents: [{ uri: uri.href, mimeType: item.mimeType, blob: item.base64 }] }; });
  server.registerResource("weaver-image-thumbnail", new ResourceTemplate("weaver://projects/{projectId}/assets/{assetId}/thumbnail", { list: undefined }), { title: "Weaver Image Thumbnail", description: "Bounded WebP thumbnail for one image asset.", mimeType: "image/webp" }, async (uri, variables, extra) => { const projectId = String(variables.projectId); const workspaceDir = workspaceByProject.get(projectId); if (!workspaceDir) throw new Error("WORKSPACE_UNKNOWN_CALL_A_WEAVER_TOOL_FIRST"); const item = await read(workspaceDir, { resource: "image_thumbnail", projectId, assetId: String(variables.assetId) }, extra) as { base64: string }; return { contents: [{ uri: uri.href, mimeType: "image/webp", blob: item.base64 }] }; });
}
