import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { hostKind } from "../session-identity.js";
import { bootedAt, fileLoggingEnabled, recentEntries, recentErrors } from "../logger.js";
import { defineTool, result } from "../shared/tool-runtime.js";
import type { SseEventHub } from "../event-hub.js";

export type DiagnosticsToolsCtx = { eventHub: SseEventHub; serverVersion: string };

/**
 * Observability surface. `weaver_get_diagnostics` lets an agent in EITHER host
 * read what this MCP process has been doing — its identity, uptime, transport
 * endpoints, and the recent structured log — without needing to know the log
 * file path. This is how "the server is a black box" gets fixed for Codex and
 * Claude Code alike: ask the server itself.
 */
export function registerDiagnosticsTools(server: McpServer, ctx: DiagnosticsToolsCtx) {
  const { eventHub, serverVersion } = ctx;
  server.registerTool("weaver_get_diagnostics", {
    title: "Get Weaver Diagnostics",
    description: "Read this MCP server's identity, health and recent structured activity log. Use it to see what the server actually did and why a call failed — works the same in Codex and Claude Code.",
    inputSchema: { limit: z.number().int().min(1).max(500).default(120).optional(), errorsOnly: z.boolean().optional(), workspaceDir: z.string().optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, defineTool(async ({ limit, errorsOnly }) => {
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
    return result({ server, errors: recentErrors(50), recent: errorsOnly ? [] : recentEntries(limit ?? 120) }, "Weaver server diagnostics.");
  }));
}
