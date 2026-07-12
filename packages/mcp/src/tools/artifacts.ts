import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { projectSchema } from "../shared/schemas.js";
import { defineTool, result, withStore } from "../shared/tool-runtime.js";

/**
 * Artifacts: publish a scene-declared artifact from selected nodes.
 * `weaver_get_artifact` was model-only and is now folded into
 * weaver_read_catalog(resource:"artifact.get").
 */
export function registerArtifactsTools(server: McpServer) {
  server.registerTool("weaver_publish_artifact", { title: "Publish Weaver Artifact", description: "Save a scene-declared artifact from selected nodes at an exact graph revision.", inputSchema: { ...projectSchema.shape, artifactType: z.string(), title: z.string(), content: z.any(), sourceNodeIds: z.array(z.string()), graphRevision: z.number().int().nonnegative() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } }, defineTool(async ({ workspaceDir, projectId, artifactType, title, content, sourceNodeIds, graphRevision }) => { const output = withStore(workspaceDir, (store) => store.artifacts.publish({ projectId, type: artifactType, title, content, sourceNodeIds, graphRevision })); return result(output, `Published ${artifactType} artifact.`); }));
}
