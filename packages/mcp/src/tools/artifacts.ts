import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { projectSchema, workspaceSchema } from "../shared/schemas.js";
import { defineTool, result, withStore } from "../shared/tool-runtime.js";

/** Artifacts: publish a scene-declared artifact from selected nodes, and read one back. */
export function registerArtifactsTools(server: McpServer) {
  server.registerTool("weaver_publish_artifact", { title: "Publish Weaver Artifact", description: "Save a scene-declared artifact from selected nodes at an exact graph revision.", inputSchema: { ...projectSchema.shape, artifactType: z.string(), title: z.string(), content: z.any(), sourceNodeIds: z.array(z.string()), graphRevision: z.number().int().nonnegative() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } }, defineTool(async ({ workspaceDir, projectId, artifactType, title, content, sourceNodeIds, graphRevision }) => { const output = withStore(workspaceDir, (store) => store.publishArtifact({ projectId, type: artifactType, title, content, sourceNodeIds, graphRevision })); return result(output, `Published ${artifactType} artifact.`); }));
  server.registerTool("weaver_get_artifact", { title: "Get Weaver Artifact", description: "Read one project-local generated artifact.", inputSchema: { ...workspaceSchema.shape, artifactId: z.string() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, defineTool(async ({ workspaceDir, artifactId }) => { const artifact = withStore(workspaceDir, (store) => store.getArtifact(artifactId)); if (!artifact) throw new Error("ARTIFACT_NOT_FOUND"); return result(artifact); }));
}
