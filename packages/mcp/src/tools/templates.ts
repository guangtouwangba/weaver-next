import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { viewTypeSchema } from "@weaver/contracts";
import { getScenePack } from "@weaver/scene-packs";
import { builtinVisualTemplates, getVisualTemplate, validateVisualTemplateForProject } from "@weaver/visual-templates";
import { projectSchema, workspaceSchema } from "../shared/schemas.js";
import { listVisualTemplates } from "../shared/catalog-reads.js";
import { createProjectFromTemplate } from "../shared/create-project.js";
import { createViewFromTemplate } from "../shared/manage-view.js";
import { defineTool, result, withStore, type MutateWithStore } from "../shared/tool-runtime.js";
import { chatSessionKeyFromRequest } from "../thread-context.js";

export type TemplatesToolsCtx = { mutateWithStore: MutateWithStore };

/** Visual templates / scene packs: browse, recommend, validate, preview and apply immutable VisualTemplates. */
export function registerTemplatesTools(server: McpServer, ctx: TemplatesToolsCtx) {
  const { mutateWithStore } = ctx;

  // Widget-only: the preview widget lists templates here, so it stays REGISTERED
  // under this exact name with `_meta.ui.visibility=["app"]` (off the model surface).
  // The model lists templates via weaver_read_catalog(resource:"template.list"); both
  // call the same shared helper (see shared/catalog-reads.ts) so they never drift.
  // `weaver_get_visual_template` was model-only and is now folded into weaver_read_catalog.
  server.registerTool("weaver_list_visual_templates", {
    title: "List Visual Templates", description: "List the built-in versioned structured visual templates, optionally filtered by scene, family or renderer.",
    inputSchema: { scenePackId: z.string().optional(), family: z.enum(["canvas", "hierarchy", "relationship", "flow", "temporal", "board", "matrix", "table"]).optional(), renderer: viewTypeSchema.optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } },
  }, async ({ scenePackId, family, renderer }) => result(listVisualTemplates({ scenePackId, family, renderer })));

  server.registerTool("weaver_recommend_visual_templates", {
    title: "Recommend Visual Templates", description: "Recommend compatible visual templates for a natural-language goal without changing data.",
    inputSchema: { goal: z.string().min(1), scenePackId: z.string().optional() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ goal, scenePackId }) => {
    const text = goal.toLowerCase(); const family = text.match(/时间|路线|timeline|roadmap/) ? "temporal" : text.match(/流程|因果|flow|cause/) ? "flow" : text.match(/看板|泳道|kanban|lane/) ? "board" : text.match(/矩阵|象限|matrix|swot/) ? "matrix" : text.match(/表格|对比|table|compare/) ? "table" : text.match(/树|思维导图|tree|mind/) ? "hierarchy" : text.match(/关系|网络|network|relation/) ? "relationship" : "canvas";
    const matches = builtinVisualTemplates.filter((item) => item.family === family && (!scenePackId || item.compatibleScenePackIds.includes(scenePackId))).slice(0, 3).map((template, index) => ({ templateId: template.id, version: template.version, confidence: index === 0 ? .92 : .72, rationale: `${template.name} matches the requested ${family} visual.` }));
    return result(matches, `Recommended ${matches.length} visual templates.`);
  });

  server.registerTool("weaver_validate_visual_template", {
    title: "Validate Visual Template", description: "Check scene compatibility and current graph field readiness without writing data.",
    inputSchema: { ...projectSchema.shape, templateId: z.string(), version: z.string().default("1.0.0") }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, defineTool(async ({ workspaceDir, projectId, templateId, version }) => { const template = getVisualTemplate(templateId, version); if (!template) throw new Error("VISUAL_TEMPLATE_NOT_FOUND"); const output = withStore(workspaceDir, (store) => { const project = store.getProject(projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); const scene = getScenePack(project.scenePackId, project.scenePackVersion); if (!scene) throw new Error("SCENE_PACK_NOT_FOUND"); return validateVisualTemplateForProject(template, scene, store.getGraph(projectId).nodes); }); return result(output); }));

  server.registerTool("weaver_preview_visual_template", {
    title: "Preview Visual Template", description: "Project current graph data into a temporary template LayoutDocument without persisting it.",
    inputSchema: { ...projectSchema.shape, templateId: z.string(), version: z.string().default("1.0.0"), baseGraphRevision: z.number().int().nonnegative(), viewName: z.string().optional() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, defineTool(async ({ workspaceDir, projectId, templateId, version, baseGraphRevision, viewName }) => { const template = getVisualTemplate(templateId, version); if (!template) throw new Error("VISUAL_TEMPLATE_NOT_FOUND"); const output = withStore(workspaceDir, (store) => store.previewVisualTemplate({ projectId, template, baseGraphRevision, viewName })); return result(output); }));

  // Widget-only: the preview widget's template gallery creates projects here
  // (apps/widget useVisualTemplateGallery), so it stays REGISTERED under this
  // exact name with `_meta.ui.visibility=["app"]` (off the model surface). The
  // model creates from a template via weaver_create_project(template:{...}); both
  // call the same shared helper (see shared/create-project.ts) so they never drift.
  server.registerTool("weaver_create_project_from_visual_template", {
    title: "Create Project From Visual Template", description: "Atomically create a project, starter content graph and themed default view from a compatible template.",
    inputSchema: { ...workspaceSchema.shape, title: z.string().min(1), goal: z.string().default(""), scenePackId: z.string(), templateId: z.string(), version: z.string().default("1.0.0"), automationLevel: z.enum(["cautious", "collaborative", "automatic"]).default("collaborative"), leaseId: z.string().regex(/^[a-f0-9]{64}$/).optional(), bindingRevision: z.number().int().positive().optional() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } },
  }, defineTool(async ({ workspaceDir, title, goal, scenePackId, templateId, version, automationLevel, leaseId, bindingRevision }, extra) => { const chatSessionKey = chatSessionKeyFromRequest(extra, false); return createProjectFromTemplate(mutateWithStore, { workspaceDir, title, goal, scenePackId, templateId, version, automationLevel, chatSessionKey, leaseId, bindingRevision }); }));

  // Widget-only: the preview widget's template gallery creates Views here
  // (apps/widget useVisualTemplateGallery), so it stays REGISTERED under this
  // exact name with `_meta.ui.visibility=["app"]` (off the model surface). The
  // model creates a View from a template via weaver_manage_view(action:"create_from_template");
  // both call the shared createViewFromTemplate helper (see shared/manage-view.ts) so they never drift.
  server.registerTool("weaver_create_view_from_visual_template", {
    title: "Create View From Visual Template", description: "Create a new independent themed view over the current graph without modifying graphRevision or existing views.",
    inputSchema: { ...projectSchema.shape, templateId: z.string(), version: z.string().default("1.0.0"), baseGraphRevision: z.number().int().nonnegative(), viewName: z.string().optional() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } },
  }, defineTool(async ({ workspaceDir, projectId, templateId, version, baseGraphRevision, viewName }, extra) => {
    const chatSessionKey = chatSessionKeyFromRequest(extra, false);
    return createViewFromTemplate(mutateWithStore, { workspaceDir, projectId, templateId, version, baseGraphRevision, viewName, chatSessionKey });
  }));
}
