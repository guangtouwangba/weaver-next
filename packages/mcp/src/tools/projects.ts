import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getScenePack } from "@weaver/scene-packs";
import { projectSchema, workspaceSchema } from "../shared/schemas.js";
import { readProjectManifest } from "../shared/graph-reads.js";
import { listProjects } from "../shared/catalog-reads.js";
import { track } from "../shared/workspace-registry.js";
import { createProjectFromTemplate } from "../shared/create-project.js";
import { defineTool, result, withStore, type MutateWithStore } from "../shared/tool-runtime.js";
import { chatSessionKeyFromRequest } from "../thread-context.js";

export type ProjectsToolsCtx = { mutateWithStore: MutateWithStore };

/** Project CRUD & scene recommendation, plus reading the pinned project manifest. */
export function registerProjectsTools(server: McpServer, ctx: ProjectsToolsCtx) {
  const { mutateWithStore } = ctx;

  // Widget-only: the preview widget lists projects here, so it stays REGISTERED
  // under this exact name with `_meta.ui.visibility=["app"]` (off the model surface).
  // The model lists projects via weaver_read_catalog(resource:"project.list"); both
  // call the same shared helper (see shared/catalog-reads.ts) so they never drift.
  server.registerTool("weaver_list_projects", {
    title: "List Weaver Projects", description: "List projects stored in <workspaceDir>/.weaver.", inputSchema: workspaceSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } },
  }, defineTool(async ({ workspaceDir }) => { const projects = withStore(workspaceDir, (store) => listProjects(store)); projects.forEach((project) => track(workspaceDir, project.id)); return result(projects, `${projects.length} Weaver projects.`); }));

  // `weaver_recommend_scene` was an advisory model-only tool that mapped a goal
  // to a scene pack via keyword matching; that guidance now lives in the
  // weaver-create-space skill, so the model chooses a scenePackId directly.

  // The single model-facing create tool. Without `template` it seeds a plain
  // project with one semantic root node (original behavior). With `template` it
  // takes the create-from-visual-template path (project + starter graph + themed
  // default view) via the shared helper — the same code the still-registered
  // widget tool `weaver_create_project_from_visual_template` runs, so the two
  // never drift. `leaseId`/`bindingRevision` only apply on the template branch.
  server.registerTool("weaver_create_project", {
    title: "Create Weaver Project", description: "Create a project pinned to one scene-pack version. Without `template`, seeds one semantic root node. With `template:{templateId,version}`, atomically creates a starter content graph and themed default view from that compatible visual template.",
    inputSchema: { ...workspaceSchema.shape, title: z.string().min(1), goal: z.string().default(""), scenePackId: z.string().default("free-brainstorming"), automationLevel: z.enum(["cautious", "collaborative", "automatic"]).default("collaborative"), template: z.object({ templateId: z.string(), version: z.string().default("1.0.0") }).optional(), leaseId: z.string().regex(/^[a-f0-9]{64}$/).optional(), bindingRevision: z.number().int().positive().optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, defineTool(async ({ workspaceDir, title, goal, scenePackId, automationLevel, template, leaseId, bindingRevision }, extra) => {
    const chatSessionKey = chatSessionKeyFromRequest(extra, false);
    if (template) return createProjectFromTemplate(mutateWithStore, { workspaceDir, title, goal, scenePackId, templateId: template.templateId, version: template.version, automationLevel, chatSessionKey, leaseId, bindingRevision });
    const scene = getScenePack(scenePackId); if (!scene) throw new Error(`SCENE_PACK_NOT_FOUND:${scenePackId}`);
    const created = mutateWithStore(workspaceDir, (store) => store.createSeededProject({ title, goal, scenePack: scene, automationLevel, chatSessionKey }));
    track(workspaceDir, created.project.id);
    const binding = created.binding ? { leaseId: created.binding.leaseId, bindingRevision: created.binding.bindingRevision, projectId: created.binding.projectId, viewId: created.binding.viewId } : undefined;
    return result({ ...created.project, binding }, `Created ${created.project.title}.`);
  }));

  // Widget-only: the preview widget reads the manifest here, so it stays REGISTERED
  // under this exact name with `_meta.ui.visibility=["app"]` (off the model surface).
  // The model reads it via weaver_read_graph(resource:"manifest"); both call the same
  // shared helper (see shared/graph-reads.ts) so they never drift.
  server.registerTool("weaver_get_project_manifest", {
    title: "Get Project Manifest", description: "Get a project's pinned scene rules, available node/edge types, views, artifacts, revisions and automation level.", inputSchema: projectSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } },
  }, defineTool(async ({ workspaceDir, projectId }) => { const output = withStore(workspaceDir, (store) => readProjectManifest(store, projectId)); track(workspaceDir, projectId); return result(output); }));
}
