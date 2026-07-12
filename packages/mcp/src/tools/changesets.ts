import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { changeSetSchema } from "@weaver/contracts";
import { workspaceSchema } from "../shared/schemas.js";
import { defineTool, result, type MutateWithStore } from "../shared/tool-runtime.js";
import { chatSessionKeyFromRequest } from "../thread-context.js";

export function registerChangesetsTools(server: McpServer, { mutateWithStore }: { mutateWithStore: MutateWithStore }) {
  server.registerTool("weaver_submit_changeset", {
    title: "Submit ChangeSet", description: "Submit auditable semantic Graph operations for review; never writes the Graph directly.",
    inputSchema: { ...workspaceSchema.shape, changeSet: changeSetSchema }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, defineTool(async ({ workspaceDir, changeSet }, extra) => {
    const chatSessionKey = chatSessionKeyFromRequest(extra); const validated = changeSetSchema.parse(changeSet);
    return result(mutateWithStore(workspaceDir, (store) => { store.tasks.assertChat(validated.taskId, chatSessionKey); return store.graphChanges.submit(validated); }), "Submitted ChangeSet.");
  }));
}
