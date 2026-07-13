import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { viewTypeSchema } from "@weaver/contracts";
import { workspaceSchema } from "../shared/schemas.js";
import { track } from "../shared/workspace-registry.js";
import { defineTool, result } from "../shared/tool-runtime.js";
import { chatSessionKeyFromRequest } from "../thread-context.js";
import { widgetBuildId } from "../widget.js";
import { dispatchWorkspaceAgentOperation } from "../workspace-runtime.js";

const templateFamilySchema = z.enum(["canvas", "hierarchy", "relationship", "flow", "temporal", "board", "matrix", "table"]);

/**
 * `weaver_read_catalog` — one model-facing tool that groups the project/view/
 * template/artifact/asset browse reads.
 * Every `resource` is dispatched to the workspace service so the model and
 * browser surfaces use one operation authority.
 */
export function registerReadCatalogTool(server: McpServer) {
  server.registerTool("weaver_read_catalog", {
    title: "Read Catalog",
    description: "Browse a workspace's catalog: projects (`project.list`), saved Views (`view.list` / `view.search` / `view.get`), built-in visual templates (`template.list` / `template.get`), a generated artifact (`artifact.get`), or an image asset's safe metadata (`asset.metadata`). Pick one via `resource`.",
    inputSchema: {
      ...workspaceSchema.shape,
      resource: z.enum(["project.list", "view.list", "view.search", "view.get", "template.list", "template.get", "template.validate", "template.preview", "artifact.get", "asset.metadata", "asset.preview"]),
      projectId: z.string().optional(),
      viewId: z.string().optional(),
      assetId: z.string().optional(),
      artifactId: z.string().optional(),
      templateId: z.string().optional(),
      version: z.string().optional(),
      query: z.string().optional(),
      status: z.enum(["active", "trashed"]).optional(),
      scenePackId: z.string().optional(),
      family: templateFamilySchema.optional(),
      renderer: viewTypeSchema.optional(),
      baseGraphRevision: z.number().int().nonnegative().optional(),
      viewName: z.string().optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, defineTool(async ({ workspaceDir, resource, projectId, viewId, assetId, artifactId, templateId, version, query, status, scenePackId, family, renderer, baseGraphRevision, viewName }, extra) => {
    const output = await dispatchWorkspaceAgentOperation({
      workspaceDir,
      buildId: widgetBuildId(),
      chatSessionKey: chatSessionKeyFromRequest(extra),
      operation: "weaver_read_catalog",
      arguments: { resource, projectId, viewId, assetId, artifactId, templateId, version, query, status, scenePackId, family, renderer, baseGraphRevision, viewName },
    });
    if (projectId) track(workspaceDir, projectId);
    switch (resource) {
      case "project.list": {
        const projects = output as Array<{ id: string }>;
        projects.forEach((project) => track(workspaceDir, project.id));
        return result(projects, `${projects.length} Weaver projects.`);
      }
      case "view.list": {
        if (!projectId) throw new Error("INVALID_ARGS:projectId required");
        return result(output);
      }
      case "view.search": {
        if (!projectId) throw new Error("INVALID_ARGS:projectId required");
        return result(output);
      }
      case "view.get": {
        if (!projectId) throw new Error("INVALID_ARGS:projectId required");
        if (!viewId) throw new Error("INVALID_ARGS:viewId required");
        return result(output);
      }
      case "template.list": {
        return result(output);
      }
      case "template.get": {
        if (!templateId) throw new Error("INVALID_ARGS:templateId required");
        return result(output);
      }
      case "template.validate": {
        if (!projectId || !templateId) throw new Error("INVALID_ARGS:projectId and templateId required");
        return result(output);
      }
      case "template.preview": {
        if (!projectId || !templateId || baseGraphRevision === undefined) throw new Error("INVALID_ARGS:projectId, templateId and baseGraphRevision required");
        return result(output);
      }
      case "artifact.get": {
        if (!artifactId) throw new Error("INVALID_ARGS:artifactId required");
        return result(output);
      }
      case "asset.metadata": {
        if (!projectId) throw new Error("INVALID_ARGS:projectId required");
        if (!assetId) throw new Error("INVALID_ARGS:assetId required");
        return result(output);
      }
      case "asset.preview": {
        if (!projectId || !assetId) throw new Error("INVALID_ARGS:projectId and assetId required");
        return result(output);
      }
    }
  }));
}
