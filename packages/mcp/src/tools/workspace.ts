import { spawn } from "node:child_process";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { projectSchema } from "../shared/schemas.js";
import { defineTool, result, type MutateWithStore } from "../shared/tool-runtime.js";
import { chatSessionKeyFromRequest } from "../thread-context.js";
import { hostKind, previewHost } from "../session-identity.js";
import { LEGACY_WIDGET_URI } from "../resources.js";
import type { SseEventHub } from "../event-hub.js";
import { log } from "../logger.js";
import { runtimeMode, shouldBlockWorkspaceBuildMismatch, widgetBuildId, workspaceWidgetBuildId } from "../widget.js";

export type WorkspaceToolsCtx = {
  eventHub: SseEventHub;
  mutateWithStore: MutateWithStore;
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
  const { eventHub, mutateWithStore, serverVersion } = ctx;

  // Codex renders the embedded widget by reading `_meta.ui.resourceUri` (and the
  // legacy `openai/outputTemplate`) and calling `resources/read` on that ui:// URI.
  // Point at the STABLE, un-versioned LEGACY_WIDGET_URI (always registered by
  // registerResources): a build-versioned URI goes stale after every rebuild while
  // Codex still holds the old cached descriptor, which surfaced as
  // `-32602 Resource not found` and cascaded into the widget's -32000. The stable
  // URI always resolves to the current process's fresh inline HTML.
  registerAppTool(server, "weaver_open_space", {
    title: "Open Weaver Workspace",
    description: "Open the Weaver semantic canvas for an explicit local workspace and optional project. Codex renders it as an embedded panel; Claude Code opens it as a tokenized loopback browser preview.",
    inputSchema: { workspaceDir: z.string().min(1), projectId: z.string().optional(), displayMode: z.enum(["fullscreen", "inline"]).default("inline") },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { resourceUri: LEGACY_WIDGET_URI, visibility: ["model", "app"] }, "ui/resourceUri": LEGACY_WIDGET_URI, "openai/outputTemplate": LEGACY_WIDGET_URI, "openai/widgetAccessible": true },
  }, defineTool(async (input, extra) => {
    const chatSessionKey = chatSessionKeyFromRequest(extra);
    const opened = mutateWithStore(input.workspaceDir, (store) => {
      let viewId: string | undefined;
      if (input.projectId) {
        const project = store.catalog.getProject(input.projectId);
        if (!project) throw new Error("PROJECT_NOT_FOUND");
        viewId = project.defaultViewId;
      }
      return { binding: store.sessions.openBinding({ chatSessionKey, projectId: input.projectId, viewId }), schemaResetBackupName: store.schemaResetBackupName };
    });
    const { binding, schemaResetBackupName } = opened;
    const activeWidgetBuildId = widgetBuildId();
    const workspaceBuildId = workspaceWidgetBuildId(input.workspaceDir);
    const activeRuntimeMode = runtimeMode();
    const isPreview = previewHost();
    const isCodex = hostKind() === "codex";
    // Pin the loopback preview to the agent's real workspace — Codex boots the MCP
    // from its cache dir, so without this both the embedded widget's callServerTool
    // and the browser read an empty cache `.weaver` and hang.
    if (isPreview) {
      if (eventHub.retargetPreviewWorkspace(input.workspaceDir)) log("info", "preview.retarget", { workspaceDir: input.workspaceDir });
      // Only the Claude host pops the browser (the terminal has no embedded panel).
      // Codex renders the widget in-panel via outputTemplate, so no browser pop.
      if (!isCodex && eventHub.previewUrl) autoOpenPreview(eventHub.previewUrl);
    }
    // Codex renders the NATIVE panel (window.openai widget) from openai/outputTemplate
    // and reads this structuredContent as window.openai.toolOutput. Returning a
    // previewUrl made Codex open a browser sidebar instead of the native panel
    // (Cowart, which renders natively, returns no URL) — so omit it for Codex.
    // Claude Code has no native panel, so it still gets the loopback browser URL.
    const preview = (isPreview && !isCodex) ? { previewUrl: eventHub.previewUrl, previewToken: eventHub.previewToken } : {};
    const message = isCodex
      ? 'Opened the Weaver canvas panel. The user selects nodes on the canvas, then asks you (in chat) to develop them: read the live selection with weaver_read_session(resource:"bound_canvas"), do the work, then weaver_submit_changeset — the panel refreshes to show it. The canvas is a visual surface; you are triggered from the chat.'
      : isPreview
        ? "Opened the Weaver canvas in your browser. If no window appeared, open previewUrl manually."
        : "Opened Weaver workspace widget.";
    return result({
      version: 2, widget: "weaver-workspace", workspaceDir: input.workspaceDir, projectId: input.projectId,
      preferredDisplayMode: input.displayMode, serverVersion, widgetBuildId: activeWidgetBuildId,
      workspaceWidgetBuildId: workspaceBuildId, runtimeMode: activeRuntimeMode,
      buildMismatch: shouldBlockWorkspaceBuildMismatch(activeRuntimeMode, activeWidgetBuildId, workspaceBuildId),
      chatBinding: { leaseId: binding.leaseId, bindingRevision: binding.bindingRevision, projectId: binding.projectId, viewId: binding.viewId },
      schemaReset: schemaResetBackupName ? { backupName: schemaResetBackupName } : undefined,
      ...(isCodex ? { rendering: "native-widget" } : {}),
      ...preview,
    }, message);
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
