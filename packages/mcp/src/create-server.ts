import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodRawShape } from "zod";
import { SseEventHub } from "./event-hub.js";
import { registerResources } from "./resources.js";
import { hostKind, previewHost, syntheticChatSessionKey } from "./session-identity.js";
import { createMutateWithStore } from "./shared/tool-runtime.js";
import { registerAgentTasksTools } from "./tools/agent-tasks.js";
import { registerArtifactsTools } from "./tools/artifacts.js";
import { registerAssetsTools } from "./tools/assets.js";
import { registerCanvasBindingTools } from "./tools/canvas-binding.js";
import { registerCanvasPromptsTools } from "./tools/canvas-prompts.js";
import { registerChangesetsTools } from "./tools/changesets.js";
import { registerContentTools } from "./tools/content.js";
import { registerGraphTools } from "./tools/graph.js";
import { registerLayoutTools } from "./tools/layout.js";
import { registerProjectsTools } from "./tools/projects.js";
import { registerReadGraphTool } from "./tools/read-graph.js";
import { registerReadSessionTool } from "./tools/read-session.js";
import { registerTemplatesTools } from "./tools/templates.js";
import { registerViewCatalogTools } from "./tools/view-catalog.js";
import { registerWorkspaceTools } from "./tools/workspace.js";
import { registerDiagnosticsTools } from "./tools/diagnostics.js";
import { initLog, log, nextRequestId, summarizeArgs, type LogOptions } from "./logger.js";
import { widgetResourceUri, widgetRoot } from "./widget.js";

/**
 * Tools the standalone-browser preview widget is allowed to call over `/mcp-rpc`.
 * Derived from the widget's actual `callTool(...)` usage — host-only tools such as
 * `weaver_open_workspace_widget` are intentionally excluded.
 */
export const PREVIEW_TOOL_ALLOWLIST = new Set<string>([
  "weaver_apply_changeset", "weaver_apply_layout", "weaver_apply_layout_operations", "weaver_archive_node", "weaver_attach_asset",
  "weaver_cancel_agent_task", "weaver_create_content_node", "weaver_create_project_from_visual_template",
  "weaver_create_view_from_visual_template", "weaver_duplicate_project_view", "weaver_enrich_link",
  "weaver_get_asset_preview", "weaver_get_bound_canvas", "weaver_get_canvas_view_state", "weaver_get_layout_run",
  "weaver_get_node_content", "weaver_get_project_graph", "weaver_get_project_manifest", "weaver_import_image_asset",
  "weaver_list_canvas_tasks", "weaver_list_project_views", "weaver_list_projects", "weaver_list_visual_templates",
  "weaver_open_canvas_event_stream", "weaver_pin_project_view", "weaver_preview_changeset", "weaver_preview_visual_template",
  "weaver_purge_project_view", "weaver_reject_changeset", "weaver_reject_layout", "weaver_rename_project_view",
  "weaver_reorder_pinned_views", "weaver_restore_project_view", "weaver_revert_layout", "weaver_set_default_view",
  "weaver_submit_canvas_prompt", "weaver_switch_chat_canvas", "weaver_sync_canvas_context", "weaver_trash_project_view",
  "weaver_update_node_content", "weaver_validate_visual_template", "weaver_get_diagnostics",
]);

type CapturedTool = { shape?: ZodRawShape; handler: (...args: any[]) => unknown; meta?: Record<string, unknown> };

/** The develop-loop write tools an agent MUST have to turn reasoning into a
 * ChangeSet. If any of these is absent from the model-facing surface a task can
 * only spin ("缺少提交 ChangeSet 的写入工具"), so we flag them explicitly. */
export const CRITICAL_MODEL_TOOLS = [
  "weaver_prepare_task_from_active_canvas", "weaver_start_agent_task", "weaver_submit_changeset",
  "weaver_apply_changeset", "weaver_complete_agent_task", "weaver_report_task_progress", "weaver_await_canvas_prompt",
] as const;

/** A tool is model-facing unless its `ui.visibility` explicitly omits "model"
 * (i.e. it is a widget-only tool). Absent visibility = a normal agent tool. */
function isModelFacing(meta: Record<string, unknown> | undefined): boolean {
  const visibility = (meta as { ui?: { visibility?: string[] } } | undefined)?.ui?.visibility;
  return !visibility || visibility.includes("model");
}

/** What the server advertises to the MODEL, computed from the live registry.
 * The server cannot see Codex's own tool-list cap, but this is the "should be
 * available" set: if the agent can call weaver_get_diagnostics yet reports a
 * CRITICAL tool missing while this says it is model-facing, Codex dropped it. */
export type ToolSurface = { registered: number; modelFacing: number; widgetOnly: number; modelFacingNames: string[]; criticalPresent: Record<string, boolean> };
function computeToolSurface(registry: Map<string, CapturedTool>): ToolSurface {
  const modelFacingNames = [...registry.entries()].filter(([, tool]) => isModelFacing(tool.meta)).map(([name]) => name).sort();
  const modelFacingSet = new Set(modelFacingNames);
  return {
    registered: registry.size,
    modelFacing: modelFacingNames.length,
    widgetOnly: registry.size - modelFacingNames.length,
    modelFacingNames,
    criticalPresent: Object.fromEntries(CRITICAL_MODEL_TOOLS.map((name) => [name, modelFacingSet.has(name)])),
  };
}

export type WeaverServer = {
  server: McpServer;
  eventHub: SseEventHub;
  dispatch: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** The registered `_meta` for a tool (post-normalization), e.g. to assert the widget outputTemplate/resourceUri. */
  toolMeta: (name: string) => Record<string, unknown> | undefined;
  serverVersion: string;
  close: () => Promise<void>;
};

/**
 * Build the MCP server, tool registry and loopback event hub without binding a
 * transport. `server.ts` connects stdio; tests can drive `dispatch` directly.
 * The in-process `dispatch` re-runs schema coercion and passes an empty `_meta`
 * so — under the Claude host — it resolves the same synthetic chat session key
 * as the stdio agent, converging both transports on one binding.
 */
export async function createWeaverServer(options: { previewWorkspaceDir?: string; logOptions?: LogOptions } = {}): Promise<WeaverServer> {
  initLog(options.previewWorkspaceDir ?? process.cwd(), options.logOptions);
  const manifest = JSON.parse(readFileSync(resolve(process.cwd(), ".codex-plugin", "plugin.json"), "utf8"));
  const serverVersion = manifest.version as string;
  const server = new McpServer({ name: "weaver-mcp-server", version: serverVersion }, { instructions: "Use Weaver tools to create semantic spaces, recommend immutable VisualTemplates, project one content graph into independent views, read concise graph summaries, propose LayoutPlan constraints, and submit auditable ChangeSets. For quantitative or trend data (market size over time, share breakdowns, growth rates, KPIs), author a `chart` content node instead of prose — set content.kind='chart' with chartType line/bar/area (series of {label,value} points), pie (share breakdown), or metric (a single KPI with delta), and always fill sourceNote + asOf so figures stay auditable. Submit these via weaver_submit_changeset like any other content. Never invent template ids, final coordinates, or direct asset paths. Applying a template to an existing project must not mutate graph content." });
  const eventHub = new SseEventHub();
  await eventHub.start();
  const widgetUri = widgetResourceUri(eventHub.buildId);
  const mutateWithStore = createMutateWithStore(eventHub);

  // Capture every registered tool's handler + input shape so the loopback RPC
  // dispatcher can invoke it in-process. registerAppTool also routes through
  // server.registerTool, so app tools are captured too.
  const registry = new Map<string, CapturedTool>();
  const originalRegisterTool = server.registerTool.bind(server);
  // Wrap every handler once so BOTH transports (stdio agent + loopback browser,
  // which reuses `registry`) emit a structured call/result/error log line with
  // timing. defineTool swallows thrown errors into an `{isError}` result, so we
  // inspect the return value too — not just catch throws.
  (server as any).registerTool = (name: string, config: any, handler: (...args: any[]) => unknown) => {
    // Codex's Apps-SDK refuses to proxy a widget-initiated tool call unless the
    // tool advertises `openai/widgetAccessible: true` (rejected with -32000
    // before it reaches this server). The widget's call set IS the preview
    // allowlist, so mark exactly those tools accessible here — one place, always
    // in sync with the allowlist — instead of hand-annotating ~40 declarations.
    if (PREVIEW_TOOL_ALLOWLIST.has(name)) {
      config = { ...config, _meta: { ...config?._meta, "openai/widgetAccessible": true, ui: { visibility: ["app", "model"], ...config?._meta?.ui } } };
    }
    const logged = async (...args: any[]) => {
      const requestId = nextRequestId();
      const startedMs = Date.now();
      log("debug", "tool.call", { tool: name, requestId, args: summarizeArgs(args[0]) });
      try {
        const output: any = await handler(...args);
        const durationMs = Date.now() - startedMs;
        if (output && typeof output === "object" && output.isError) log("warn", "tool.error", { tool: name, requestId, durationMs, code: output.structuredContent?.code, message: output.structuredContent?.message });
        else log("info", "tool.result", { tool: name, requestId, durationMs });
        return output;
      } catch (error) {
        log("error", "tool.throw", { tool: name, requestId, durationMs: Date.now() - startedMs, message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
        throw error;
      }
    };
    registry.set(name, { shape: config?.inputSchema, handler: logged, meta: config?._meta });
    return (originalRegisterTool as any)(name, config, logged);
  };

  registerWorkspaceTools(server, { eventHub, mutateWithStore, widgetUri, serverVersion });
  registerProjectsTools(server, { mutateWithStore });
  registerTemplatesTools(server, { mutateWithStore });
  registerViewCatalogTools(server, { mutateWithStore });
  registerGraphTools(server);
  registerReadGraphTool(server);
  registerAssetsTools(server);
  registerContentTools(server);
  registerCanvasBindingTools(server, { mutateWithStore });
  registerReadSessionTool(server);
  registerCanvasPromptsTools(server, { mutateWithStore });
  registerAgentTasksTools(server, { mutateWithStore });
  registerLayoutTools(server, { eventHub, mutateWithStore });
  registerChangesetsTools(server, { mutateWithStore });
  registerArtifactsTools(server);
  // Lazy: reads the registry at call time, so it reflects the full tool set even
  // though diagnostics is registered before every tool below it exists yet.
  registerDiagnosticsTools(server, { eventHub, serverVersion, toolSurface: () => computeToolSurface(registry) });
  registerResources(server, { eventHub, widgetUri });

  (server as any).registerTool = originalRegisterTool;

  const surface = computeToolSurface(registry);
  log("info", "server.boot", { serverVersion, hostKind: hostKind() ?? "codex", runtimeMode: process.env.WEAVER_RUNTIME_MODE ?? "installed", buildId: eventHub.buildId, origin: eventHub.origin, cwd: process.cwd(), node: process.version, toolCount: registry.size, modelFacingTools: surface.modelFacing, criticalModelTools: surface.criticalPresent });

  const dispatch = async (name: string, args: Record<string, unknown>) => {
    const entry = registry.get(name);
    if (!entry) throw new Error(`TOOL_NOT_FOUND:${name}`);
    const parsed = entry.shape ? z.object(entry.shape).parse(args ?? {}) : args;
    return entry.handler(parsed, { _meta: {} });
  };

  if (previewHost()) {
    eventHub.configurePreview({ workspaceDir: options.previewWorkspaceDir ?? widgetRoot(), chatSessionKey: syntheticChatSessionKey(), dispatch, allowlist: PREVIEW_TOOL_ALLOWLIST });
  }

  return { server, eventHub, dispatch, toolMeta: (name: string) => registry.get(name)?.meta, serverVersion, close: () => eventHub.close() };
}
