import { spawn } from "node:child_process";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { projectSchema } from "../shared/schemas.js";
import { defineTool, result } from "../shared/tool-runtime.js";
import { chatSessionKeyFromRequest } from "../thread-context.js";
import { hostKind } from "../session-identity.js";
import type { SseEventHub } from "../event-hub.js";
import { log } from "../logger.js";
import { widgetBuildId } from "../widget.js";
import { createWorkspaceLaunch, openWorkspaceNativeBinding, recordWorkspaceSurfaceFallback } from "../workspace-runtime.js";
import { LEGACY_WIDGET_URI } from "../resources.js";
import { canvasSurface, legacyWidgetFallbackReason } from "../canvas-surface.js";

export type WorkspaceToolsCtx = {
  eventHub: SseEventHub;
  widgetUri: string;
  serverVersion: string;
};

/**
 * Open the tokenized loopback preview URL in the user's default browser — once per
 * URL per process. Used only for the Claude Code host, whose terminal cannot render
 * an embedded panel, so the browser IS its canvas surface. Codex renders the
 * embedded widget via `openai/outputTemplate` instead (no browser pop). Best-effort
 * and detached; a failure never fails the tool call, and the URL is still returned.
 */
const openedPreviews = new Set<string>();
function autoOpenPreview(url: string) {
  if (openedPreviews.has(url)) return;
  openedPreviews.add(url);
  if (process.env.WEAVER_NO_AUTO_OPEN === "1" || process.env.VITEST) return;
  const [cmd, args] =
    process.platform === "darwin" ? ["open", [url]] :
    process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] :
    ["xdg-open", [url]];
  try {
    const child = spawn(cmd as string, args as string[], { stdio: "ignore", detached: true });
    child.on("error", (error) => log("warn", "preview.autoOpenFailed", { message: error instanceof Error ? error.message : String(error) }));
    child.unref();
    log("info", "preview.autoOpen", { opener: cmd });
  } catch (error) {
    log("warn", "preview.autoOpenFailed", { message: error instanceof Error ? error.message : String(error) });
  }
}

/** Workspace bootstrap: bind the canvas, render/open its surface, and open the SSE event stream. */
export function registerWorkspaceTools(server: McpServer, ctx: WorkspaceToolsCtx) {
  const { eventHub } = ctx;
  const legacyWidget = canvasSurface() === "legacy-widget";

  // Codex renders the embedded widget by reading `_meta.ui.resourceUri` (and the
  // legacy `openai/outputTemplate`) and calling `resources/read` on that ui:// URI.
  // Point at the STABLE, un-versioned LEGACY_WIDGET_URI (always registered by
  // registerResources): a build-versioned URI goes stale after every rebuild while
  // Codex still holds the old cached descriptor, which surfaced as
  // `-32602 Resource not found` and cascaded into the widget's -32000. The stable
  // URI always resolves to the current process's fresh inline HTML.
  server.registerTool("weaver_open_space", {
    title: "Open Weaver Workspace",
    description: "Ensure the workspace-scoped localhost Canvas runtime and create a short-lived, one-time launch URL for an explicit local workspace and optional project.",
    inputSchema: { workspaceDir: z.string().min(1), projectId: z.string().optional(), displayMode: z.enum(["fullscreen", "inline"]).default("fullscreen") },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    ...(legacyWidget ? { _meta: { ui: { resourceUri: LEGACY_WIDGET_URI, visibility: ["model", "app"] }, "ui/resourceUri": LEGACY_WIDGET_URI, "openai/outputTemplate": LEGACY_WIDGET_URI, "openai/widgetAccessible": true } } : {}),
  }, defineTool(async (input, extra) => {
    const chatSessionKey = chatSessionKeyFromRequest(extra);
    if (legacyWidget) {
      const chatBinding = await openWorkspaceNativeBinding({ workspaceDir: input.workspaceDir, buildId: widgetBuildId(), chatSessionKey, projectId: input.projectId });
      const code = legacyWidgetFallbackReason();
      await recordWorkspaceSurfaceFallback({ workspaceDir: input.workspaceDir, buildId: widgetBuildId(), code });
      log("warn", "canvas.legacyFallbackUsed", { code, status: "active", actionKey: "legacy-widget" });
      return result({
        version: 2,
        widget: "weaver-workspace",
        workspaceDir: input.workspaceDir,
        projectId: input.projectId,
        preferredDisplayMode: "fullscreen",
        serverVersion: ctx.serverVersion,
        widgetBuildId: widgetBuildId(),
        runtimeMode: "installed",
        chatBinding: { leaseId: chatBinding.leaseId, bindingRevision: chatBinding.bindingRevision, projectId: chatBinding.projectId, viewId: chatBinding.viewId },
        rendering: "native-widget",
      }, "Opened the temporary Weaver native Widget rollback surface.");
    }
    const launch = await createWorkspaceLaunch({ workspaceDir: input.workspaceDir, buildId: widgetBuildId(), chatSessionKey, projectId: input.projectId });
    if (hostKind() === "claude" && process.env.WEAVER_DISABLE_AUTO_OPEN !== "1") autoOpenPreview(launch.launchUrl);
    return result(launch, "Created a short-lived Weaver Canvas launch. Open it with the Weaver open-space workflow; do not repeat the URL in prose.");
  }));

  server.registerTool("weaver_subscribe_canvas", {
    title: "Open Canvas Event Stream",
    description: "Widget-only creation of a project-scoped, read-only loopback SSE stream for durable Weaver task, graph and layout events.",
    inputSchema: { ...projectSchema.shape, canvasSessionId: z.string().min(1) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    _meta: { ui: { visibility: ["app"] } },
  }, defineTool(async ({ workspaceDir, projectId, canvasSessionId }) => {
    return result(eventHub.openStream({ workspaceDir, projectId, canvasSessionId }), "Opened Weaver event stream.");
  }));
}
