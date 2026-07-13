import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { changeSetSchema } from "@weaver/contracts";
import { workspaceSchema } from "../shared/schemas.js";
import { defineTool, result } from "../shared/tool-runtime.js";
import { chatSessionKeyFromRequest } from "../thread-context.js";
import { widgetBuildId } from "../widget.js";
import { dispatchWorkspaceAgentOperation } from "../workspace-runtime.js";

export function registerChangesetsTools(server: McpServer) {
  server.registerTool("weaver_submit_changeset", {
    title: "Submit ChangeSet", description: "Submit semantic Graph operations. By default they apply IMMEDIATELY (direct-write: the record is kept and revertible via weaver_review_action revert); only projects set to automationLevel 'cautious' hold them for manual review. `changeSet` is a full ChangeSet object { id, taskId, projectId, baseGraphRevision, baseLayoutRevisions, graphOperations[], layoutOperations[], rationale, riskLevel, status } — validated server-side.",
    inputSchema: { ...workspaceSchema.shape, changeSet: z.unknown() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, defineTool(async ({ workspaceDir, changeSet }, extra) => {
    changeSetSchema.parse(changeSet);
    const output = await dispatchWorkspaceAgentOperation({ workspaceDir, buildId: widgetBuildId(), chatSessionKey: chatSessionKeyFromRequest(extra), operation: "weaver_submit_changeset", arguments: { changeSet } });
    return result(output, "Submitted ChangeSet.");
  }));
}
