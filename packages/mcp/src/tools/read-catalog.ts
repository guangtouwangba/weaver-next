import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { viewTypeSchema } from "@weaver/contracts";
import {
  getProjectView, layoutCapabilities, listChangeSets, listProjectViews, listProjects, listVisualTemplates,
  previewChangeSet, readArtifact, readAssetMetadata, readChangeSet, readLayout, readLayoutRun, readVisualTemplate, searchProjectViews,
} from "../shared/catalog-reads.js";
import { workspaceSchema } from "../shared/schemas.js";
import { track } from "../shared/workspace-registry.js";
import { defineTool, result, withStore } from "../shared/tool-runtime.js";
import { chatSessionKeyFromRequest } from "../thread-context.js";

const templateFamilySchema = z.enum(["canvas", "hierarchy", "relationship", "flow", "temporal", "board", "matrix", "table"]);

/**
 * `weaver_read_catalog` — one model-facing tool that groups the project/view/
 * template/artifact/asset browse reads. `weaver_read_review` (below) groups the
 * changeset/layout reads. They are split because the view `status` filter
 * (active/trashed) and the ChangeSet `status` filter (pending/applied/rejected/
 * reverted) are distinct enums that would collide under one `status` param.
 * Every `resource` reuses the shared helper the kept widget tool calls (see
 * shared/catalog-reads.ts) so the model surface and widget surface never drift.
 */
export function registerReadCatalogTool(server: McpServer) {
  server.registerTool("weaver_read_catalog", {
    title: "Read Catalog",
    description: "Browse a workspace's catalog: projects (`project.list`), saved Views (`view.list` / `view.search` / `view.get`), built-in visual templates (`template.list` / `template.get`), a generated artifact (`artifact.get`), or an image asset's safe metadata (`asset.metadata`). Pick one via `resource`.",
    inputSchema: {
      ...workspaceSchema.shape,
      resource: z.enum(["project.list", "view.list", "view.search", "view.get", "template.list", "template.get", "artifact.get", "asset.metadata"]),
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
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, defineTool(async ({ workspaceDir, resource, projectId, viewId, assetId, artifactId, templateId, version, query, status, scenePackId, family, renderer }) => {
    switch (resource) {
      case "project.list": {
        // weaver_list_projects
        const projects = withStore(workspaceDir, (store) => listProjects(store));
        projects.forEach((project) => track(workspaceDir, project.id));
        return result(projects, `${projects.length} Weaver projects.`);
      }
      case "view.list": {
        // weaver_list_project_views
        if (!projectId) throw new Error("CATALOG_RESOURCE_REQUIRES_projectId");
        return result(withStore(workspaceDir, (store) => listProjectViews(store, projectId, status)));
      }
      case "view.search": {
        // weaver_search_project_views
        if (!projectId) throw new Error("CATALOG_RESOURCE_REQUIRES_projectId");
        return result(withStore(workspaceDir, (store) => searchProjectViews(store, projectId, query ?? "", status ?? "active")));
      }
      case "view.get": {
        // weaver_get_project_view
        if (!projectId) throw new Error("CATALOG_RESOURCE_REQUIRES_projectId");
        if (!viewId) throw new Error("CATALOG_RESOURCE_REQUIRES_viewId");
        return result(withStore(workspaceDir, (store) => getProjectView(store, projectId, viewId)));
      }
      case "template.list": {
        // weaver_list_visual_templates
        return result(listVisualTemplates({ scenePackId, family, renderer }));
      }
      case "template.get": {
        // weaver_get_visual_template
        if (!templateId) throw new Error("CATALOG_RESOURCE_REQUIRES_templateId");
        return result(readVisualTemplate(templateId, version ?? "1.0.0"));
      }
      case "artifact.get": {
        // weaver_get_artifact
        if (!artifactId) throw new Error("CATALOG_RESOURCE_REQUIRES_artifactId");
        return result(withStore(workspaceDir, (store) => readArtifact(store, artifactId)));
      }
      case "asset.metadata": {
        // weaver_get_asset_metadata
        if (!projectId) throw new Error("CATALOG_RESOURCE_REQUIRES_projectId");
        if (!assetId) throw new Error("CATALOG_RESOURCE_REQUIRES_assetId");
        return result(withStore(workspaceDir, (store) => readAssetMetadata(store, projectId, assetId)));
      }
    }
  }));
}

/**
 * `weaver_read_review` — one model-facing tool that groups the changeset/layout
 * reads used to review a proposed change: list/get/preview a ChangeSet
 * (`changeset.list` / `changeset.get` / `changeset.preview`), read one view's
 * layout (`layout.get`), read a layout run's candidates (`layout.run`), or list
 * the deterministic layout strategies and constraints (`layout.capabilities`).
 * The chat-guarded resources (`changeset.get`/`changeset.preview`/`layout.run`)
 * preserve the exact `assertTaskChat` auth of the tools they replace.
 */
export function registerReadReviewTool(server: McpServer) {
  server.registerTool("weaver_read_review", {
    title: "Read Review",
    description: "Review a proposed change: list/read/preview a ChangeSet (`changeset.list` / `changeset.get` / `changeset.preview`), read one view's layout (`layout.get`), read a layout run's candidates and metrics (`layout.run`), or read the available layout strategies and constraints (`layout.capabilities`). Pick one via `resource`.",
    inputSchema: {
      ...workspaceSchema.shape,
      resource: z.enum(["changeset.list", "changeset.get", "changeset.preview", "layout.get", "layout.run", "layout.capabilities"]),
      projectId: z.string().optional(),
      viewId: z.string().optional(),
      changeSetId: z.string().optional(),
      layoutRunId: z.string().optional(),
      status: z.enum(["pending", "applied", "rejected", "reverted"]).optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, defineTool(async ({ workspaceDir, resource, projectId, viewId, changeSetId, layoutRunId, status }, extra) => {
    switch (resource) {
      case "changeset.list": {
        // weaver_list_changesets
        if (!projectId) throw new Error("REVIEW_RESOURCE_REQUIRES_projectId");
        return result(withStore(workspaceDir, (store) => listChangeSets(store, projectId, status)));
      }
      case "changeset.get": {
        // weaver_get_changeset
        if (!changeSetId) throw new Error("REVIEW_RESOURCE_REQUIRES_changeSetId");
        const chatSessionKey = chatSessionKeyFromRequest(extra);
        return result(withStore(workspaceDir, (store) => readChangeSet(store, changeSetId, chatSessionKey)));
      }
      case "changeset.preview": {
        // weaver_preview_changeset
        if (!changeSetId) throw new Error("REVIEW_RESOURCE_REQUIRES_changeSetId");
        const chatSessionKey = chatSessionKeyFromRequest(extra);
        return result(withStore(workspaceDir, (store) => previewChangeSet(store, changeSetId, chatSessionKey)));
      }
      case "layout.get": {
        // weaver_get_layout
        if (!projectId) throw new Error("REVIEW_RESOURCE_REQUIRES_projectId");
        if (!viewId) throw new Error("REVIEW_RESOURCE_REQUIRES_viewId");
        return result(withStore(workspaceDir, (store) => readLayout(store, projectId, viewId)));
      }
      case "layout.run": {
        // weaver_get_layout_run
        if (!layoutRunId) throw new Error("REVIEW_RESOURCE_REQUIRES_layoutRunId");
        const chatSessionKey = chatSessionKeyFromRequest(extra);
        return result(withStore(workspaceDir, (store) => readLayoutRun(store, layoutRunId, chatSessionKey)));
      }
      case "layout.capabilities": {
        // weaver_get_layout_capabilities
        return result(layoutCapabilities());
      }
    }
  }));
}
