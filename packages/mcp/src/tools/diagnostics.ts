import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { hostKind } from "../session-identity.js";
import { bootedAt, fileLoggingEnabled, recentEntries, recentErrors } from "../logger.js";
import { defineTool, result } from "../shared/tool-runtime.js";
import type { SseEventHub } from "../event-hub.js";
import { widgetBuildId } from "../widget.js";
import { clearWorkspaceRuntimeDiagnostics, readWorkspaceRuntimeDiagnostics } from "../workspace-runtime.js";

export type DiagnosticsToolsCtx = { eventHub: SseEventHub; serverVersion: string; toolSurface: () => unknown };

/**
 * Observability surface. `weaver_get_diagnostics` lets an agent in EITHER host
 * read what this MCP process has been doing — its identity, uptime, transport
 * endpoints, and the recent structured log — without needing to know the log
 * file path. This is how "the server is a black box" gets fixed for Codex and
 * Claude Code alike: ask the server itself.
 */
export function registerDiagnosticsTools(server: McpServer, ctx: DiagnosticsToolsCtx) {
  const { eventHub, serverVersion, toolSurface } = ctx;
  server.registerTool("weaver_get_diagnostics", {
    title: "Get Weaver Diagnostics",
    description: "Read this MCP server's identity, health, recent activity log, and the model-facing tool surface it advertises. If `toolSurface.criticalPresent.weaver_submit_changeset` is true but you cannot call that tool, this host (e.g. Codex) dropped it from your tool list — not the server.",
    inputSchema: { limit: z.number().int().min(1).max(500).default(120).optional(), errorsOnly: z.boolean().optional(), workspaceDir: z.string().optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, defineTool(async ({ limit, errorsOnly, workspaceDir }) => {
    const preview = hostKind() === "claude";
    const server = {
      pid: process.pid,
      host: hostKind() ?? "codex",
      serverVersion,
      nodeVersion: process.version,
      uptimeMs: Date.now() - bootedAt(),
      buildId: eventHub.buildId,
      previewAvailable: preview,
      fileLogging: fileLoggingEnabled(),
    };
    const runtime = workspaceDir ? await readWorkspaceRuntimeDiagnostics({ workspaceDir, buildId: widgetBuildId(), errorsOnly, limit: Math.min(limit ?? 120, 200) }) : undefined;
    return result({ server, toolSurface: toolSurface(), errors: recentErrors(50), recent: errorsOnly ? [] : recentEntries(limit ?? 120), runtime }, "Weaver server diagnostics.");
  }));

  server.registerTool("weaver_clear_runtime_diagnostics", {
    title: "Clear Weaver Runtime Diagnostics",
    description: "Delete the redacted, rotated operational diagnostics for one workspace runtime. Project data and browser sessions are not changed.",
    inputSchema: { workspaceDir: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, defineTool(async ({ workspaceDir }) => result(await clearWorkspaceRuntimeDiagnostics({ workspaceDir, buildId: widgetBuildId() }), "Cleared Weaver runtime diagnostics.")));
}
