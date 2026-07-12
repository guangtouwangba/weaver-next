import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { changeSetSchema } from "@weaver/contracts";
import { workspaceSchema } from "../shared/schemas.js";
import { defineTool, result, type MutateWithStore } from "../shared/tool-runtime.js";
import { chatSessionKeyFromRequest } from "../thread-context.js";

export function registerChangesetsTools(server: McpServer, { mutateWithStore }: { mutateWithStore: MutateWithStore }) {
  server.registerTool("weaver_submit_changeset", {
    title: "Submit ChangeSet", description: "Submit auditable semantic Graph operations for review; never writes the Graph directly. `changeSet` is a full ChangeSet object { id, taskId, projectId, baseGraphRevision, baseLayoutRevisions, graphOperations[], layoutOperations[], rationale, riskLevel, status } — validated server-side.",
    // `changeSet` is advertised as a loose object, not the full changeSetSchema: the
    // ChangeSet's fully-expanded JSON schema (nested graph+layout operation unions)
    // is so large that Codex drops this tool from the model's tool surface entirely.
    // The handler still enforces the exact schema via changeSetSchema.parse below, so
    // no validation is lost — only the oversized advertised schema.
    inputSchema: { ...workspaceSchema.shape, changeSet: z.unknown() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, defineTool(async ({ workspaceDir, changeSet }, extra) => {
    const chatSessionKey = chatSessionKeyFromRequest(extra); const validated = changeSetSchema.parse(changeSet);
    return result(mutateWithStore(workspaceDir, (store) => { store.tasks.assertChat(validated.taskId, chatSessionKey); return store.graphChanges.submit(validated); }), "Submitted ChangeSet.");
  }));
}
