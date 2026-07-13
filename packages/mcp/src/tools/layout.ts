import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { layoutPlanSchema } from "@weaver/contracts";
import { workspaceSchema } from "../shared/schemas.js";
import { defineTool, result } from "../shared/tool-runtime.js";
import { chatSessionKeyFromRequest } from "../thread-context.js";
import { widgetBuildId } from "../widget.js";
import { dispatchWorkspaceAgentOperation } from "../workspace-runtime.js";

export function registerLayoutTools(server: McpServer) {
  server.registerTool("weaver_recommend_layout", {
    title: "Recommend Layout", description: "Validate a semantic LayoutPlan and generate deterministic scored candidates; final coordinates are never model-authored.",
    inputSchema: { ...workspaceSchema.shape, taskId: z.string(), plan: z.unknown() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, defineTool(async ({ workspaceDir, taskId, plan: rawPlan }, extra) => {
    const plan = layoutPlanSchema.parse(rawPlan);
    const output = await dispatchWorkspaceAgentOperation({ workspaceDir, buildId: widgetBuildId(), chatSessionKey: chatSessionKeyFromRequest(extra), operation: "weaver_recommend_layout", arguments: { taskId, plan } }) as { candidates: unknown[] };
    return result(output, `Generated ${output.candidates.length} deterministic layout candidates.`);
  }));
}
