import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { projectSchema } from "../shared/schemas.js";
import { defineTool, result } from "../shared/tool-runtime.js";
import { chatSessionKeyFromRequest } from "../thread-context.js";
import { widgetBuildId } from "../widget.js";
import { dispatchWorkspaceAgentOperation } from "../workspace-runtime.js";

export function registerArtifactsTools(server: McpServer) {
  server.registerTool("weaver_publish_artifact", {
    title: "Publish Weaver Artifact", description: "Save a scene-declared artifact from selected nodes at an exact graph revision.",
    inputSchema: { ...projectSchema.shape, artifactType: z.string(), title: z.string(), content: z.any(), sourceNodeIds: z.array(z.string()), graphRevision: z.number().int().nonnegative() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, defineTool(async (args, extra) => {
    const output = await dispatchWorkspaceAgentOperation({ workspaceDir: args.workspaceDir, buildId: widgetBuildId(), chatSessionKey: chatSessionKeyFromRequest(extra), operation: "weaver_publish_artifact", arguments: args });
    return result(output, `Published ${args.artifactType} artifact.`);
  }));
}
