import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { viewTypeSchema } from "@weaver/contracts";
import { getScenePack } from "@weaver/scene-packs";
import { getVisualTemplate, validateVisualTemplateForProject } from "@weaver/visual-templates";
import {
  getProjectView, listProjectViews, listProjects, listVisualTemplates,
  readArtifact, readAssetMetadata, readVisualTemplate, searchProjectViews,
} from "../shared/catalog-reads.js";
import { workspaceSchema } from "../shared/schemas.js";
import { track } from "../shared/workspace-registry.js";
import { defineTool, result, withStore } from "../shared/tool-runtime.js";

const templateFamilySchema = z.enum(["canvas", "hierarchy", "relationship", "flow", "temporal", "board", "matrix", "table"]);

/**
 * `weaver_read_catalog` — one model-facing tool that groups the project/view/
 * template/artifact/asset browse reads.
 * Every `resource` reuses the shared helper the kept widget tool calls (see
 * shared/catalog-reads.ts) so the model surface and widget surface never drift.
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
  }, defineTool(async ({ workspaceDir, resource, projectId, viewId, assetId, artifactId, templateId, version, query, status, scenePackId, family, renderer, baseGraphRevision, viewName }) => {
    switch (resource) {
      case "project.list": {
        // weaver_read_catalog(resource:"project.list")
        const projects = withStore(workspaceDir, (store) => listProjects(store));
        projects.forEach((project) => track(workspaceDir, project.id));
        return result(projects, `${projects.length} Weaver projects.`);
      }
      case "view.list": {
        // weaver_read_catalog(resource:"view.list")
        if (!projectId) throw new Error("INVALID_ARGS:projectId required");
        return result(withStore(workspaceDir, (store) => listProjectViews(store, projectId, status)));
      }
      case "view.search": {
        // weaver_search_project_views
        if (!projectId) throw new Error("INVALID_ARGS:projectId required");
        return result(withStore(workspaceDir, (store) => searchProjectViews(store, projectId, query ?? "", status ?? "active")));
      }
      case "view.get": {
        // weaver_get_project_view
        if (!projectId) throw new Error("INVALID_ARGS:projectId required");
        if (!viewId) throw new Error("INVALID_ARGS:viewId required");
        return result(withStore(workspaceDir, (store) => getProjectView(store, projectId, viewId)));
      }
      case "template.list": {
        // weaver_read_catalog(resource:"template.list")
        return result(listVisualTemplates({ scenePackId, family, renderer }));
      }
      case "template.get": {
        // weaver_get_visual_template
        if (!templateId) throw new Error("INVALID_ARGS:templateId required");
        return result(readVisualTemplate(templateId, version ?? "1.0.0"));
      }
      case "template.validate": {
        if (!projectId || !templateId) throw new Error("INVALID_ARGS:projectId and templateId required");
        return result(withStore(workspaceDir, (store) => { const project = store.catalog.getProject(projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); const scene = getScenePack(project.scenePackId, project.scenePackVersion); const template = getVisualTemplate(templateId, version); if (!scene || !template) throw new Error("VISUAL_TEMPLATE_NOT_FOUND"); return validateVisualTemplateForProject(template, scene, store.graphChanges.read(projectId).nodes); }));
      }
      case "template.preview": {
        if (!projectId || !templateId || baseGraphRevision === undefined) throw new Error("INVALID_ARGS:projectId, templateId and baseGraphRevision required");
        return result(withStore(workspaceDir, (store) => { const template = getVisualTemplate(templateId, version); if (!template) throw new Error("VISUAL_TEMPLATE_NOT_FOUND"); return store.catalog.previewTemplate({ projectId, template, baseGraphRevision, viewName }); }));
      }
      case "artifact.get": {
        // weaver_get_artifact
        if (!artifactId) throw new Error("INVALID_ARGS:artifactId required");
        return result(withStore(workspaceDir, (store) => readArtifact(store, artifactId)));
      }
      case "asset.metadata": {
        // weaver_get_asset_metadata
        if (!projectId) throw new Error("INVALID_ARGS:projectId required");
        if (!assetId) throw new Error("INVALID_ARGS:assetId required");
        return result(withStore(workspaceDir, (store) => readAssetMetadata(store, projectId, assetId)));
      }
      case "asset.preview": {
        if (!projectId || !assetId) throw new Error("INVALID_ARGS:projectId and assetId required");
        return result(withStore(workspaceDir, (store) => { const item = store.assets.read(assetId, true); if (item.asset.projectId !== projectId) throw new Error("ASSET_NOT_FOUND_OR_CROSS_PROJECT"); return { assetId, dataUrl: `data:image/webp;base64,${Buffer.from(item.data).toString("base64")}` }; }));
      }
    }
  }));
}
