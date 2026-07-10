import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  changeSetSchema,
  layoutOperationSchema,
  layoutPlanSchema,
  nodeContentSchema,
  nodeSchema,
  viewTypeSchema,
  type LayoutDocument,
  type NodeContent,
  type ScenePack,
  type SpaceNode,
} from "@weaver/contracts";
import { applyLayoutOperations, resolveSceneContext } from "@weaver/core";
import { generateLayoutCandidates } from "@weaver/layout-engine";
import { builtinScenePacks, getScenePack } from "@weaver/scene-packs";
import { WorkspaceStore } from "@weaver/storage";
import { builtinVisualTemplates, getVisualTemplate, validateVisualTemplateForProject } from "@weaver/visual-templates";
import { bundledWidgetHtml } from "./widget.js";
import { enrichPublicLink } from "./link-enrichment.js";
import { SseEventHub } from "./event-hub.js";
import { chatSessionKeyFromRequest } from "./thread-context.js";

const manifest = JSON.parse(readFileSync(resolve(process.cwd(), ".codex-plugin", "plugin.json"), "utf8"));
const server = new McpServer({ name: "weaver-mcp-server", version: manifest.version }, { instructions: "Use Weaver tools to create semantic spaces, recommend immutable VisualTemplates, project one content graph into independent views, read concise graph summaries, propose LayoutPlan constraints, and submit auditable ChangeSets. Never invent template ids, final coordinates, or direct asset paths. Applying a template to an existing project must not mutate graph content." });
const eventHub = new SseEventHub();
await eventHub.start();
const widgetUri = "ui://widget/weaver/workspace.html";
const workspaceByProject = new Map<string, string>();
const workspaceByTask = new Map<string, string>();

const workspaceSchema = z.object({ workspaceDir: z.string().min(1) });
const projectSchema = workspaceSchema.extend({ projectId: z.string().min(1) });
const defaultStrategyByView = {
  canvas: "hybrid", tree: "tree", graph: "force", board: "swimlane", timeline: "timeline", flow: "layered", table: "grid",
} as const;

function result<T>(value: T, message = "OK") {
  const structuredContent = (Array.isArray(value) ? { items: value } : value) as Record<string, unknown>;
  return { content: [{ type: "text" as const, text: message }], structuredContent };
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: "text" as const, text: message }], structuredContent: { code: message.split(":", 1)[0], message } };
}

function withStore<T>(workspaceDir: string, callback: (store: WorkspaceStore) => T): T {
  const store = new WorkspaceStore(workspaceDir);
  try { return callback(store); } finally { store.close(); }
}

function mutateWithStore<T>(workspaceDir: string, callback: (store: WorkspaceStore) => T): T {
  const output = withStore(workspaceDir, callback);
  eventHub.notifyWorkspace(workspaceDir);
  return output;
}

function track(workspaceDir: string, projectId: string) { workspaceByProject.set(projectId, workspaceDir); }

function assertViewMutationContext(store: WorkspaceStore, projectId: string, chatSessionKey?: string, lease?: { leaseId?: string; bindingRevision?: number }) {
  if (!chatSessionKey) return;
  const binding = store.getChatCanvasBinding(chatSessionKey);
  if (!binding || binding.projectId !== projectId) throw new Error("NO_CANVAS_BOUND_TO_CHAT");
  if (lease?.leaseId && (binding.leaseId !== lease.leaseId || binding.bindingRevision !== lease.bindingRevision)) throw new Error("CHAT_CANVAS_LEASE_STALE");
}

function summarizeNode(store: WorkspaceStore, node: SpaceNode) {
  const content = node.content.kind === "document" ? { ...node.content, markdown: undefined } : node.content;
  const assetIds = node.content.kind === "image" ? [node.content.assetId]
    : node.content.kind === "document" ? [node.content.coverAssetId, ...node.content.embeddedAssetIds].filter(Boolean) as string[]
      : [node.content.imageAssetId].filter(Boolean) as string[];
  return { id: node.id, projectId: node.projectId, type: node.type, title: node.title, contentKind: node.contentKind, content, properties: node.properties, archived: node.archived, createdAt: node.createdAt, updatedAt: node.updatedAt, assets: assetIds.map((id) => store.getAsset(id)).filter(Boolean) };
}

function assertSceneContent(scene: ScenePack, semanticType: string, contentKind: NodeContent["kind"]) {
  const definition = scene.nodeTypes.find((candidate) => candidate.key === semanticType);
  if (!definition) throw new Error(`NODE_TYPE_NOT_ALLOWED:${semanticType}`);
  if (!definition.allowedContentKinds.includes(contentKind)) throw new Error(`CONTENT_KIND_NOT_ALLOWED:${contentKind}`);
}

registerAppResource(server, "weaver-workspace-widget", widgetUri, {
  title: "Weaver Semantic Space",
  description: "A native semantic node canvas with natural-language layout tasks and deterministic previews.",
  _meta: {
    ui: { prefersBorder: false, csp: { connectDomains: [eventHub.origin], resourceDomains: ["data:", "blob:"] } },
    "openai/widgetDescription": "Weaver semantic knowledge space",
    "openai/widgetPrefersBorder": false,
  },
}, async () => ({ contents: [{ uri: widgetUri, mimeType: RESOURCE_MIME_TYPE, text: bundledWidgetHtml(), _meta: { "openai/widgetPrefersBorder": false } }] }));

registerAppTool(server, "weaver_open_workspace_widget", {
  title: "Open Weaver Workspace",
  description: "Open the native Weaver semantic canvas for an explicit local workspace and optional project.",
  inputSchema: { workspaceDir: z.string().min(1), projectId: z.string().optional(), displayMode: z.enum(["fullscreen", "inline"]).default("fullscreen") },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  _meta: { ui: { resourceUri: widgetUri, visibility: ["model", "app"] }, "ui/resourceUri": widgetUri, "openai/outputTemplate": widgetUri, "openai/widgetAccessible": true },
}, async (input, extra) => {
  try {
    const chatSessionKey = chatSessionKeyFromRequest(extra);
    const binding = mutateWithStore(input.workspaceDir, (store) => {
      let viewId: string | undefined;
      if (input.projectId) {
        const project = store.getProject(input.projectId);
        if (!project) throw new Error("PROJECT_NOT_FOUND");
        viewId = project.defaultViewId;
      }
      return store.openChatCanvasBinding({ chatSessionKey, projectId: input.projectId, viewId });
    });
    return result({ version: 2, widget: "weaver-workspace", workspaceDir: input.workspaceDir, projectId: input.projectId, preferredDisplayMode: input.displayMode, chatBinding: { leaseId: binding.leaseId, bindingRevision: binding.bindingRevision, projectId: binding.projectId, viewId: binding.viewId } }, "Opened Weaver workspace widget.");
  } catch (error) { return failure(error); }
});

server.registerTool("weaver_open_canvas_event_stream", {
  title: "Open Canvas Event Stream",
  description: "Widget-only creation of a project-scoped, read-only loopback SSE stream for durable Weaver task, graph and layout events.",
  inputSchema: { ...projectSchema.shape, canvasSessionId: z.string().min(1) },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  _meta: { ui: { visibility: ["app"] } },
}, async ({ workspaceDir, projectId, canvasSessionId }) => {
  try { return result(eventHub.openStream({ workspaceDir, projectId, canvasSessionId }), "Opened Weaver event stream."); }
  catch (error) { return failure(error); }
});

server.registerTool("weaver_list_projects", {
  title: "List Weaver Projects", description: "List projects stored in <workspaceDir>/.weaver.", inputSchema: workspaceSchema.shape,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ workspaceDir }) => { try { const projects = withStore(workspaceDir, (store) => store.listProjects()); projects.forEach((project) => track(workspaceDir, project.id)); return result(projects, `${projects.length} Weaver projects.`); } catch (error) { return failure(error); } });

server.registerTool("weaver_recommend_scene", {
  title: "Recommend Weaver Scene", description: "Recommend scene packs from a natural-language goal without creating a project.",
  inputSchema: { goal: z.string().min(1) }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ goal }) => {
  const normalized = goal.toLowerCase();
  const preferred = normalized.match(/word|vocab|单词|词汇/) ? "situational-vocabulary" : normalized.match(/cause|因果/) ? "causal-map" : normalized.match(/timeline|时间线|历史/) ? "event-timeline" : normalized.match(/project|项目/) ? "project-breakdown" : "free-brainstorming";
  const ordered = [...builtinScenePacks].sort((left) => left.id === preferred ? -1 : 1).slice(0, 3).map((scene, index) => ({ scenePackId: scene.id, viewType: scene.defaultView, confidence: index === 0 ? 0.9 : 0.55, rationale: index === 0 ? `Goal best matches ${scene.name}.` : `Alternative ${scene.name}.` }));
  return result(ordered, `Recommended ${ordered[0].scenePackId}.`);
});

server.registerTool("weaver_create_project", {
  title: "Create Weaver Project", description: "Create a project pinned to one scene-pack version with one semantic root node.",
  inputSchema: { ...workspaceSchema.shape, title: z.string().min(1), goal: z.string().default(""), scenePackId: z.string().default("free-brainstorming"), automationLevel: z.enum(["cautious", "collaborative", "automatic"]).default("collaborative") },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, async ({ workspaceDir, title, goal, scenePackId, automationLevel }, extra) => { try { const scene = getScenePack(scenePackId); if (!scene) throw new Error(`SCENE_PACK_NOT_FOUND:${scenePackId}`); const chatSessionKey = chatSessionKeyFromRequest(extra, false); const created = mutateWithStore(workspaceDir, (store) => store.createSeededProject({ title, goal, scenePack: scene, automationLevel, chatSessionKey })); track(workspaceDir, created.project.id); const binding = created.binding ? { leaseId: created.binding.leaseId, bindingRevision: created.binding.bindingRevision, projectId: created.binding.projectId, viewId: created.binding.viewId } : undefined; return result({ ...created.project, binding }, `Created ${created.project.title}.`); } catch (error) { return failure(error); } });

server.registerTool("weaver_list_visual_templates", {
  title: "List Visual Templates", description: "List the built-in versioned structured visual templates, optionally filtered by scene, family or renderer.",
  inputSchema: { scenePackId: z.string().optional(), family: z.enum(["canvas", "hierarchy", "relationship", "flow", "temporal", "board", "matrix", "table"]).optional(), renderer: viewTypeSchema.optional() },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ scenePackId, family, renderer }) => result(builtinVisualTemplates.filter((item) => (!scenePackId || item.compatibleScenePackIds.includes(scenePackId)) && (!family || item.family === family) && (!renderer || item.renderer === renderer))));

server.registerTool("weaver_get_visual_template", {
  title: "Get Visual Template", description: "Read one immutable VisualTemplate definition.", inputSchema: { templateId: z.string(), version: z.string().default("1.0.0") },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ templateId, version }) => { const item = getVisualTemplate(templateId, version); return item ? result(item) : failure(new Error("VISUAL_TEMPLATE_NOT_FOUND")); });

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
}, async ({ workspaceDir, projectId, templateId, version }) => { try { const template = getVisualTemplate(templateId, version); if (!template) throw new Error("VISUAL_TEMPLATE_NOT_FOUND"); const output = withStore(workspaceDir, (store) => { const project = store.getProject(projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); const scene = getScenePack(project.scenePackId, project.scenePackVersion); if (!scene) throw new Error("SCENE_PACK_NOT_FOUND"); return validateVisualTemplateForProject(template, scene, store.getGraph(projectId).nodes); }); return result(output); } catch (error) { return failure(error); } });

server.registerTool("weaver_preview_visual_template", {
  title: "Preview Visual Template", description: "Project current graph data into a temporary template LayoutDocument without persisting it.",
  inputSchema: { ...projectSchema.shape, templateId: z.string(), version: z.string().default("1.0.0"), baseGraphRevision: z.number().int().nonnegative(), viewName: z.string().optional() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ workspaceDir, projectId, templateId, version, baseGraphRevision, viewName }) => { try { const template = getVisualTemplate(templateId, version); if (!template) throw new Error("VISUAL_TEMPLATE_NOT_FOUND"); const output = withStore(workspaceDir, (store) => store.previewVisualTemplate({ projectId, template, baseGraphRevision, viewName })); return result(output); } catch (error) { return failure(error); } });

server.registerTool("weaver_create_project_from_visual_template", {
  title: "Create Project From Visual Template", description: "Atomically create a project, starter content graph and themed default view from a compatible template.",
  inputSchema: { ...workspaceSchema.shape, title: z.string().min(1), goal: z.string().default(""), scenePackId: z.string(), templateId: z.string(), version: z.string().default("1.0.0"), automationLevel: z.enum(["cautious", "collaborative", "automatic"]).default("collaborative"), leaseId: z.string().regex(/^[a-f0-9]{64}$/).optional(), bindingRevision: z.number().int().positive().optional() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, async ({ workspaceDir, title, goal, scenePackId, templateId, version, automationLevel, leaseId, bindingRevision }, extra) => { try { const scene = getScenePack(scenePackId); if (!scene) throw new Error("SCENE_PACK_NOT_FOUND"); const template = getVisualTemplate(templateId, version); if (!template) throw new Error("VISUAL_TEMPLATE_NOT_FOUND"); const chatSessionKey = chatSessionKeyFromRequest(extra, false); const output = mutateWithStore(workspaceDir, (store) => store.createProjectFromVisualTemplate({ title, goal, scenePack: scene, template, automationLevel, chatBinding: chatSessionKey ? { chatSessionKey, leaseId, bindingRevision } : undefined })); track(workspaceDir, output.project.id); const binding = output.binding ? { leaseId: output.binding.leaseId, bindingRevision: output.binding.bindingRevision, projectId: output.binding.projectId, viewId: output.binding.viewId } : undefined; return result({ ...output, binding }, `Created ${title} from ${template.name}.`); } catch (error) { return failure(error); } });

server.registerTool("weaver_create_view_from_visual_template", {
  title: "Create View From Visual Template", description: "Create a new independent themed view over the current graph without modifying graphRevision or existing views.",
  inputSchema: { ...projectSchema.shape, templateId: z.string(), version: z.string().default("1.0.0"), baseGraphRevision: z.number().int().nonnegative(), viewName: z.string().optional() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, async ({ workspaceDir, projectId, templateId, version, baseGraphRevision, viewName }, extra) => { try { const template = getVisualTemplate(templateId, version); if (!template) throw new Error("VISUAL_TEMPLATE_NOT_FOUND"); const chatSessionKey = chatSessionKeyFromRequest(extra, false); const output = mutateWithStore(workspaceDir, (store) => { const project = store.getProject(projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); const scene = getScenePack(project.scenePackId, project.scenePackVersion); if (!scene) throw new Error("SCENE_PACK_NOT_FOUND"); const validation = validateVisualTemplateForProject(template, scene, store.getGraph(projectId).nodes); if (!validation.compatible) throw new Error("VISUAL_TEMPLATE_SCENE_INCOMPATIBLE"); if (!validation.ready) throw new Error("VISUAL_TEMPLATE_DATA_NOT_READY"); const currentBinding = chatSessionKey ? store.getChatCanvasBinding(chatSessionKey) : null; if (chatSessionKey && (!currentBinding || currentBinding.projectId !== projectId)) throw new Error("NO_CANVAS_BOUND_TO_CHAT"); const layout = store.createViewFromVisualTemplate({ projectId, template, baseGraphRevision, viewName, chatBinding: chatSessionKey && currentBinding ? { chatSessionKey, leaseId: currentBinding.leaseId, bindingRevision: currentBinding.bindingRevision } : undefined }); const binding = chatSessionKey ? store.getChatCanvasBinding(chatSessionKey) : undefined; return { layout, binding }; }); track(workspaceDir, projectId); const binding = output.binding ? { leaseId: output.binding.leaseId, bindingRevision: output.binding.bindingRevision, projectId: output.binding.projectId, viewId: output.binding.viewId } : undefined; return result({ ...output.layout, chatBinding: binding }, `Created ${output.layout.viewName}.`); } catch (error) { return failure(error); } });

server.registerTool("weaver_get_project_manifest", {
  title: "Get Project Manifest", description: "Get a project's pinned scene rules, available node/edge types, views, artifacts, revisions and automation level.", inputSchema: projectSchema.shape,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ workspaceDir, projectId }) => { try { const output = withStore(workspaceDir, (store) => { const project = store.getProject(projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); const scenePack = getScenePack(project.scenePackId, project.scenePackVersion); return { project, scenePack, views: store.listProjectViews(projectId, "active").map((view) => ({ ...view, viewId: view.id, viewName: view.name, layoutRevision: store.getLayout(projectId, view.id)?.layoutRevision ?? 0 })) }; }); track(workspaceDir, projectId); return result(output); } catch (error) { return failure(error); } });

server.registerTool("weaver_list_project_views", {
  title: "List Project Views", description: "List durable saved Visual Views, including fixed order and recycle-bin status.",
  inputSchema: { ...projectSchema.shape, status: z.enum(["active", "trashed"]).optional() },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ workspaceDir, projectId, status }) => { try { return result(withStore(workspaceDir, (store) => store.listProjectViews(projectId, status).map((view) => ({ ...view, nodeCount: Object.keys(store.getLayout(projectId, view.id)?.nodes ?? {}).length })))); } catch (error) { return failure(error); } });

server.registerTool("weaver_search_project_views", {
  title: "Search Project Views", description: "Search View names, types and template ids without loading graph content.",
  inputSchema: { ...projectSchema.shape, query: z.string().default(""), status: z.enum(["active", "trashed"]).default("active") },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ workspaceDir, projectId, query, status }) => { try { return result(withStore(workspaceDir, (store) => store.searchProjectViews(projectId, query, status).map((view) => ({ ...view, nodeCount: Object.keys(store.getLayout(projectId, view.id)?.nodes ?? {}).length })))); } catch (error) { return failure(error); } });

server.registerTool("weaver_get_project_view", {
  title: "Get Project View", description: "Read one saved View catalog record.", inputSchema: { ...projectSchema.shape, viewId: z.string() },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ workspaceDir, projectId, viewId }) => { try { const view = withStore(workspaceDir, (store) => store.getProjectView(projectId, viewId)); if (!view) throw new Error("VIEW_NOT_FOUND"); return result(view); } catch (error) { return failure(error); } });

const viewMutationBase = { ...projectSchema.shape, viewId: z.string(), baseCatalogRevision: z.number().int().nonnegative(), leaseId: z.string().optional(), bindingRevision: z.number().int().positive().optional() };
server.registerTool("weaver_rename_project_view", { title: "Rename Project View", description: "Rename one saved View without changing graph or layout revisions.", inputSchema: { ...viewMutationBase, name: z.string().min(1).max(120) }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } } }, async ({ workspaceDir, projectId, viewId, baseCatalogRevision, name, leaseId, bindingRevision }, extra) => { try { const chatSessionKey = chatSessionKeyFromRequest(extra, false); return result(mutateWithStore(workspaceDir, (store) => { assertViewMutationContext(store, projectId, chatSessionKey, { leaseId, bindingRevision }); return store.renameProjectView({ projectId, viewId, name, baseCatalogRevision }); })); } catch (error) { return failure(error); } });
server.registerTool("weaver_pin_project_view", { title: "Pin Project View", description: "Pin or unpin a View in the top shortcut bar.", inputSchema: { ...viewMutationBase, pinned: z.boolean() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } } }, async ({ workspaceDir, projectId, viewId, baseCatalogRevision, pinned, leaseId, bindingRevision }, extra) => { try { const chatSessionKey = chatSessionKeyFromRequest(extra, false); return result(mutateWithStore(workspaceDir, (store) => { assertViewMutationContext(store, projectId, chatSessionKey, { leaseId, bindingRevision }); return store.pinProjectView({ projectId, viewId, pinned, baseCatalogRevision }); })); } catch (error) { return failure(error); } });
server.registerTool("weaver_reorder_pinned_views", { title: "Reorder Pinned Views", description: "Persist the complete ordered list of pinned Views.", inputSchema: { ...projectSchema.shape, viewIds: z.array(z.string()), baseCatalogRevision: z.number().int().nonnegative(), leaseId: z.string().optional(), bindingRevision: z.number().int().positive().optional() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } } }, async ({ workspaceDir, projectId, viewIds, baseCatalogRevision, leaseId, bindingRevision }, extra) => { try { const chatSessionKey = chatSessionKeyFromRequest(extra, false); return result(mutateWithStore(workspaceDir, (store) => { assertViewMutationContext(store, projectId, chatSessionKey, { leaseId, bindingRevision }); return store.reorderPinnedViews({ projectId, viewIds, baseCatalogRevision }); })); } catch (error) { return failure(error); } });
server.registerTool("weaver_set_default_view", { title: "Set Default View", description: "Set the Project-wide initial View for new Chat bindings.", inputSchema: viewMutationBase, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } } }, async ({ workspaceDir, projectId, viewId, baseCatalogRevision, leaseId, bindingRevision }, extra) => { try { const chatSessionKey = chatSessionKeyFromRequest(extra, false); return result(mutateWithStore(workspaceDir, (store) => { assertViewMutationContext(store, projectId, chatSessionKey, { leaseId, bindingRevision }); return store.setDefaultProjectView({ projectId, viewId, baseCatalogRevision }); })); } catch (error) { return failure(error); } });
server.registerTool("weaver_trash_project_view", { title: "Move View to Recycle Bin", description: "Soft-delete a View for 30 days, selecting a safe fallback without changing Graph data.", inputSchema: { ...viewMutationBase, fallbackViewId: z.string().optional() }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } } }, async ({ workspaceDir, projectId, viewId, fallbackViewId, baseCatalogRevision, leaseId, bindingRevision }, extra) => { try { const chatSessionKey = chatSessionKeyFromRequest(extra, false); const output = mutateWithStore(workspaceDir, (store) => { assertViewMutationContext(store, projectId, chatSessionKey, { leaseId, bindingRevision }); const changed = store.trashProjectView({ projectId, viewId, fallbackViewId, baseCatalogRevision }); const nextBinding = chatSessionKey ? store.getChatCanvasBinding(chatSessionKey) : undefined; return { ...changed, binding: nextBinding ? { leaseId: nextBinding.leaseId, bindingRevision: nextBinding.bindingRevision, projectId: nextBinding.projectId, viewId: nextBinding.viewId } : undefined }; }); return result(output); } catch (error) { return failure(error); } });
server.registerTool("weaver_restore_project_view", { title: "Restore Project View", description: "Restore a View from the recycle bin without stealing focus.", inputSchema: viewMutationBase, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } } }, async ({ workspaceDir, projectId, viewId, baseCatalogRevision, leaseId, bindingRevision }, extra) => { try { const chatSessionKey = chatSessionKeyFromRequest(extra, false); return result(mutateWithStore(workspaceDir, (store) => { assertViewMutationContext(store, projectId, chatSessionKey, { leaseId, bindingRevision }); return store.restoreProjectView({ projectId, viewId, baseCatalogRevision }); })); } catch (error) { return failure(error); } });
server.registerTool("weaver_purge_project_view", { title: "Permanently Delete Project View", description: "Permanently purge an already-trashed View and its layout history.", inputSchema: viewMutationBase, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } } }, async ({ workspaceDir, projectId, viewId, baseCatalogRevision, leaseId, bindingRevision }, extra) => { try { const chatSessionKey = chatSessionKeyFromRequest(extra, false); return result(mutateWithStore(workspaceDir, (store) => { assertViewMutationContext(store, projectId, chatSessionKey, { leaseId, bindingRevision }); return store.purgeProjectView({ projectId, viewId, baseCatalogRevision }); })); } catch (error) { return failure(error); } });
server.registerTool("weaver_duplicate_project_view", { title: "Duplicate Project View", description: "Create an independent layout copy over the same content graph.", inputSchema: { ...viewMutationBase, name: z.string().max(120).optional() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } }, async ({ workspaceDir, projectId, viewId, name, baseCatalogRevision, leaseId, bindingRevision }, extra) => { try { const chatSessionKey = chatSessionKeyFromRequest(extra, false); return result(mutateWithStore(workspaceDir, (store) => { assertViewMutationContext(store, projectId, chatSessionKey, { leaseId, bindingRevision }); return store.duplicateProjectView({ projectId, viewId, name, baseCatalogRevision }); })); } catch (error) { return failure(error); } });

server.registerTool("weaver_get_or_create_view", {
  title: "Get or Create Project View",
  description: "Open an independent stored projection for one of the seven view types, creating its initial layout without changing graphRevision or another view.",
  inputSchema: { ...projectSchema.shape, viewType: viewTypeSchema },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ workspaceDir, projectId, viewType }) => { try {
  const output = withStore(workspaceDir, (store) => {
    const project = store.getProject(projectId); if (!project) throw new Error("PROJECT_NOT_FOUND");
    const scene = getScenePack(project.scenePackId, project.scenePackVersion); if (!scene) throw new Error("SCENE_PACK_NOT_FOUND");
    if (!scene.recommendedViews.includes(viewType)) throw new Error(`VIEW_NOT_RECOMMENDED:${viewType}`);
    const strategy = (scene.defaultView === viewType ? scene.defaultStrategy : defaultStrategyByView[viewType]) as LayoutDocument["strategy"];
    return store.ensureView({ projectId, viewId: `${viewType}-default`, viewType, strategy });
  });
  track(workspaceDir, projectId); return result(output, `Opened ${viewType} view.`);
} catch (error) { return failure(error); } });

server.registerTool("weaver_get_project_graph", {
  title: "Get Project Graph", description: "Read graph content and one independent view layout.", inputSchema: { ...projectSchema.shape, viewId: z.string().optional() },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ workspaceDir, projectId, viewId }) => { try { const output = withStore(workspaceDir, (store) => { const project = store.getProject(projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); const graph = store.getGraph(projectId); const layout = store.getLayout(projectId, viewId ?? project.defaultViewId); if (!layout) throw new Error("LAYOUT_NOT_FOUND"); return { project, nodes: graph.nodes.map((node) => summarizeNode(store, node)), edges: graph.edges, layout }; }); track(workspaceDir, projectId); return result(output, "Loaded graph summaries and layout. Use weaver_get_node_content for full Markdown."); } catch (error) { return failure(error); } });

server.registerTool("weaver_query_graph", {
  title: "Query Project Graph", description: "Filter semantic nodes and edges without loading the whole graph into model context.",
  inputSchema: { ...projectSchema.shape, nodeIds: z.array(z.string()).optional(), nodeTypes: z.array(z.string()).optional(), text: z.string().optional(), limit: z.number().int().min(1).max(200).default(50) },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ workspaceDir, projectId, nodeIds, nodeTypes, text, limit }) => { try { const output = withStore(workspaceDir, (store) => { const graph = store.getGraph(projectId); let nodes = graph.nodes.filter((node) => !node.archived); if (nodeIds?.length) nodes = nodes.filter((node) => nodeIds.includes(node.id)); if (nodeTypes?.length) nodes = nodes.filter((node) => nodeTypes.includes(node.type)); if (text) nodes = nodes.filter((node) => `${node.title}\n${node.body}`.toLowerCase().includes(text.toLowerCase())); nodes = nodes.slice(0, limit); const ids = new Set(nodes.map((node) => node.id)); const edges = graph.edges.filter((edge) => ids.has(edge.sourceNodeId) || ids.has(edge.targetNodeId)); return { revision: graph.revision, nodes: nodes.map((node) => summarizeNode(store, node)), edges }; }); return result(output); } catch (error) { return failure(error); } });

server.registerTool("weaver_get_node_content", {
  title: "Get Full Node Content", description: "Read the complete content of one Weaver node. Use this after graph discovery when full Markdown or media references are needed.",
  inputSchema: { ...projectSchema.shape, nodeId: z.string().min(1) }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ workspaceDir, projectId, nodeId }) => { try { const output = withStore(workspaceDir, (store) => { const graph = store.getGraph(projectId); const node = graph.nodes.find((candidate) => candidate.id === nodeId); if (!node) throw new Error(`NODE_NOT_FOUND:${nodeId}`); return { graphRevision: graph.revision, node }; }); return result(output); } catch (error) { return failure(error); } });

server.registerTool("weaver_get_asset_metadata", {
  title: "Get Image Asset Metadata", description: "Read safe metadata for a project-local image asset without loading its original binary.",
  inputSchema: { ...projectSchema.shape, assetId: z.string().min(1) }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ workspaceDir, projectId, assetId }) => { try { const asset = withStore(workspaceDir, (store) => store.getAsset(assetId)); if (!asset || asset.projectId !== projectId) throw new Error("ASSET_NOT_FOUND_OR_CROSS_PROJECT"); return result(asset); } catch (error) { return failure(error); } });

server.registerTool("weaver_get_asset_preview", {
  title: "Get Image Asset Preview", description: "Widget-only read of a size-bounded thumbnail data URL for an image card.",
  inputSchema: { ...projectSchema.shape, assetId: z.string().min(1) }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } },
}, async ({ workspaceDir, projectId, assetId }) => { try { const output = withStore(workspaceDir, (store) => { const item = store.readAsset(assetId, true); if (item.asset.projectId !== projectId) throw new Error("ASSET_NOT_FOUND_OR_CROSS_PROJECT"); return { assetId, dataUrl: `data:image/webp;base64,${Buffer.from(item.data).toString("base64")}` }; }); return result(output); } catch (error) { return failure(error); } });

server.registerTool("weaver_import_image_asset", {
  title: "Import Image Asset", description: "Widget-only import of one JPEG, PNG, WebP or GIF up to 20MB. Validates bytes, deduplicates by SHA-256 and generates a bounded WebP thumbnail without changing graphRevision.",
  inputSchema: { ...projectSchema.shape, mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]), base64: z.string().min(1).max(28 * 1024 * 1024) }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } },
}, async ({ workspaceDir, projectId, mimeType, base64 }) => { try { const store = new WorkspaceStore(workspaceDir); try { const output = await store.importImageAsset({ projectId, mimeType, data: Buffer.from(base64, "base64") }); return result(output, output.deduplicated ? "Reused existing image asset." : "Imported image asset."); } finally { store.close(); } } catch (error) { return failure(error); } });

server.registerTool("weaver_create_content_node", {
  title: "Create Content Node", description: "Widget-only creation of a document, image or link node at an explicit position in the active view. Increments graphRevision and only that view's layoutRevision.",
  inputSchema: { ...projectSchema.shape, viewId: z.string().min(1), semanticType: z.string().min(1), title: z.string(), content: nodeContentSchema, x: z.number(), y: z.number() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } },
}, async ({ workspaceDir, projectId, viewId, semanticType, title, content, x, y }) => { try { const output = withStore(workspaceDir, (store) => { const project = store.getProject(projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); const scene = getScenePack(project.scenePackId, project.scenePackVersion); if (!scene) throw new Error("SCENE_PACK_NOT_FOUND"); assertSceneContent(scene, semanticType, content.kind); if (content.kind === "link" && !["http:", "https:"].includes(new URL(content.url).protocol)) throw new Error("LINK_PROTOCOL_BLOCKED"); return store.createContentNode({ projectId, viewId, type: semanticType, title, content, x, y }); }); return result(output, `Created ${content.kind} node.`); } catch (error) { return failure(error); } });

server.registerTool("weaver_update_node_content", {
  title: "Update Node Content", description: "Widget-only revision-checked update of node title, semantic type or full content. Returns GRAPH_REVISION_CONFLICT instead of overwriting newer work.",
  inputSchema: { ...projectSchema.shape, nodeId: z.string().min(1), baseGraphRevision: z.number().int().nonnegative(), title: z.string().optional(), semanticType: z.string().min(1).optional(), content: nodeContentSchema.optional() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } },
}, async ({ workspaceDir, projectId, nodeId, baseGraphRevision, title, semanticType, content }) => { try { const output = withStore(workspaceDir, (store) => { const project = store.getProject(projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); const scene = getScenePack(project.scenePackId, project.scenePackVersion); if (!scene) throw new Error("SCENE_PACK_NOT_FOUND"); const current = store.getGraph(projectId).nodes.find((node) => node.id === nodeId); if (!current) throw new Error("NODE_NOT_FOUND"); assertSceneContent(scene, semanticType ?? current.type, content?.kind ?? current.content.kind); return store.updateNodeContent({ projectId, nodeId, baseGraphRevision, title, type: semanticType, content }); }); return result(output, "Saved node content."); } catch (error) { return failure(error); } });

server.registerTool("weaver_attach_asset", {
  title: "Attach Image Asset", description: "Widget-only attachment of a validated project image as an article cover or embedded media reference.",
  inputSchema: { ...projectSchema.shape, nodeId: z.string().min(1), assetId: z.string().min(1), role: z.enum(["embedded", "cover"]), baseGraphRevision: z.number().int().nonnegative() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } },
}, async ({ workspaceDir, projectId, nodeId, assetId, role, baseGraphRevision }) => { try { return result(withStore(workspaceDir, (store) => store.attachAsset({ projectId, nodeId, assetId, role, baseGraphRevision })), "Attached image asset."); } catch (error) { return failure(error); } });

server.registerTool("weaver_enrich_link", {
  title: "Enrich Link Preview", description: "Widget-only fetch of a public HTTP/HTTPS page's title, description and optional cover. Blocks local/private hosts, limits redirects, response size and timeout, and never extracts full page text.",
  inputSchema: { ...projectSchema.shape, nodeId: z.string().min(1), baseGraphRevision: z.number().int().nonnegative() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, _meta: { ui: { visibility: ["app"] } },
}, async ({ workspaceDir, projectId, nodeId, baseGraphRevision }) => { const store = new WorkspaceStore(workspaceDir); try { const graph = store.getGraph(projectId); if (graph.revision !== baseGraphRevision) throw new Error("GRAPH_REVISION_CONFLICT"); const node = graph.nodes.find((candidate) => candidate.id === nodeId); if (!node || node.content.kind !== "link") throw new Error("LINK_NODE_NOT_FOUND"); try { const enriched = await enrichPublicLink(node.content.url); let imageAssetId: string | undefined; if (enriched.image) imageAssetId = (await store.importImageAsset({ projectId, mimeType: enriched.image.mimeType, data: enriched.image.data })).asset.id; const content = { kind: "link" as const, url: enriched.url, title: enriched.title || node.title, description: enriched.description, domain: enriched.domain, imageAssetId, enrichmentStatus: "ready" as const }; return result(store.updateNodeContent({ projectId, nodeId, baseGraphRevision, title: content.title, content }), "Enriched link preview."); } catch (error) { const failedContent = { ...node.content, enrichmentStatus: "failed" as const }; store.updateNodeContent({ projectId, nodeId, baseGraphRevision, content: failedContent }); throw error; } } catch (error) { return failure(error); } finally { store.close(); } });

server.registerTool("weaver_sync_canvas_context", {
  title: "Sync Canvas Context", description: "Widget-only idempotent sync of selection, viewport, pinned nodes and independent graph/layout revisions.",
  inputSchema: { ...workspaceSchema.shape, snapshot: z.any() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  _meta: { ui: { visibility: ["app"] } },
}, async ({ workspaceDir, snapshot }, extra) => { try {
  const chatSessionKey = snapshot?.agentEligible ? chatSessionKeyFromRequest(extra) : chatSessionKeyFromRequest(extra, false);
  return result(mutateWithStore(workspaceDir, (store) => store.syncCanvasContext(snapshot, chatSessionKey)));
} catch (error) { return failure(error); } });

server.registerTool("weaver_switch_chat_canvas", {
  title: "Switch Chat Canvas", description: "Widget-only explicit Project/View switch for the current Codex chat lease.",
  inputSchema: { ...workspaceSchema.shape, leaseId: z.string().regex(/^[a-f0-9]{64}$/), bindingRevision: z.number().int().positive(), projectId: z.string(), viewId: z.string() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } },
}, async ({ workspaceDir, leaseId, bindingRevision, projectId, viewId }, extra) => { try {
  const chatSessionKey = chatSessionKeyFromRequest(extra);
  const binding = mutateWithStore(workspaceDir, (store) => store.switchChatCanvasBinding({ chatSessionKey, leaseId, bindingRevision, projectId, viewId }));
  return result({ leaseId: binding.leaseId, bindingRevision: binding.bindingRevision, projectId: binding.projectId, viewId: binding.viewId });
} catch (error) { return failure(error); } });

server.registerTool("weaver_get_bound_canvas", {
  title: "Get Bound Canvas", description: "Resolve the exact Project, View and Canvas currently bound to this Codex chat. Never guesses from focus or recency.",
  inputSchema: workspaceSchema.shape,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ workspaceDir }, extra) => { try {
  const chatSessionKey = chatSessionKeyFromRequest(extra);
  const output = withStore(workspaceDir, (store) => {
    const { binding, context } = store.getBoundCanvas(chatSessionKey, false);
    const project = store.getProject(context.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND");
    const layout = store.getLayout(context.projectId, context.viewId); if (!layout) throw new Error("LAYOUT_NOT_FOUND");
    const seenAt = Date.parse(context.presence?.lastSeenAt ?? context.updatedAt);
    return { projectId: context.projectId, viewId: context.viewId, canvasSessionId: context.canvasSessionId, online: Date.now() - seenAt <= 30_000, graphRevision: project.graphRevision, layoutRevision: layout.layoutRevision, bindingRevision: binding.bindingRevision };
  });
  return result(output);
} catch (error) { return failure(error); } });

server.registerTool("weaver_get_canvas_context", {
  title: "Get Canvas Context", description: "Read the authoritative selection and view snapshot for one canvas session.", inputSchema: { ...workspaceSchema.shape, canvasSessionId: z.string() },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ workspaceDir, canvasSessionId }) => { try { const context = withStore(workspaceDir, (store) => store.getCanvasContext(canvasSessionId)); if (!context) throw new Error("CANVAS_SESSION_NOT_FOUND"); return result(context); } catch (error) { return failure(error); } });

server.registerTool("weaver_get_canvas_view_state", {
  title: "Get Canvas View State", description: "Widget-only restoration of this Canvas Session's viewport and selection for one View.",
  inputSchema: { ...workspaceSchema.shape, canvasSessionId: z.string(), viewId: z.string() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } },
}, async ({ workspaceDir, canvasSessionId, viewId }) => { try { return result(withStore(workspaceDir, (store) => store.getCanvasViewState(canvasSessionId, viewId) ?? { canvasSessionId, viewId, firstOpen: true })); } catch (error) { return failure(error); } });

server.registerTool("weaver_resolve_context", {
  title: "Resolve Scene Context", description: "Resolve a bounded, auditable node context using the project's pinned scene policy and current canvas selection.",
  inputSchema: { ...workspaceSchema.shape, canvasSessionId: z.string() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ workspaceDir, canvasSessionId }) => { try { const output = withStore(workspaceDir, (store) => { const context = store.getCanvasContext(canvasSessionId); if (!context) throw new Error("CANVAS_SESSION_NOT_FOUND"); const project = store.getProject(context.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); const scenePack = getScenePack(project.scenePackId, project.scenePackVersion); if (!scenePack) throw new Error("SCENE_PACK_NOT_FOUND"); const graph = store.getGraph(project.id); const nodes = resolveSceneContext({ nodes: graph.nodes, edges: graph.edges, scenePack, selectedNodeIds: context.selectedNodeIds, pinnedNodeIds: context.pinnedContextNodeIds }); return { projectId: project.id, graphRevision: graph.revision, policy: scenePack.contextPolicy, nodeIds: nodes.map((node) => node.id), nodes }; }); return result(output, `Resolved ${output.nodes.length} context nodes.`); } catch (error) { return failure(error); } });

server.registerTool("weaver_prepare_agent_task", {
  title: "Prepare Agent Task", description: "Atomically capture the latest canvas state into a durable task before the widget sends a follow-up message.",
  inputSchema: { ...workspaceSchema.shape, canvasSessionId: z.string(), actionKey: z.string(), userInstruction: z.string().optional(), dispatchKey: z.string().min(1) }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ workspaceDir, canvasSessionId, actionKey, userInstruction, dispatchKey }, extra) => { try {
  const chatSessionKey = chatSessionKeyFromRequest(extra);
  const task = mutateWithStore(workspaceDir, (store) => store.prepareAgentTask({ canvasSessionId, actionKey, userInstruction, dispatchKey, chatSessionKey }));
  workspaceByTask.set(task.taskId, workspaceDir); return result(task, "Prepared agent task.");
} catch (error) { return failure(error); } });

server.registerTool("weaver_prepare_task_from_active_canvas", {
  title: "Prepare Task From Active Canvas",
  description: "Create a durable Weaver task only from the exact Canvas bound to the current Codex chat.",
  inputSchema: { ...workspaceSchema.shape, actionKey: z.enum(["develop_selection", "layout_view", "develop_then_layout"]), userInstruction: z.string().optional() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, async ({ workspaceDir, actionKey, userInstruction }, extra) => {
  try {
    const chatSessionKey = chatSessionKeyFromRequest(extra);
    const dispatchKey = `chat-${randomUUID()}`;
    const task = mutateWithStore(workspaceDir, (store) => {
      const { context } = store.getBoundCanvas(chatSessionKey, true);
      const continuation = store.listCanvasTasks(context.canvasSessionId).find((candidate) => candidate.status === "ready_to_continue" && candidate.activeStage === "layout");
      if (continuation && ["layout_view", "develop_then_layout"].includes(actionKey)) {
        store.assertTaskChat(continuation.taskId, chatSessionKey);
        const prepared = store.beginAgentContinuation({ taskId: continuation.taskId, dispatchKey, expectedTaskRevision: continuation.taskRevision });
        const updated = userInstruction ? store.updateAgentTask(prepared.taskId, { userInstruction }) : prepared;
        return store.confirmAgentDispatch(updated.taskId, dispatchKey);
      }
      const prepared = store.prepareAgentTaskFromBoundCanvas({ chatSessionKey, actionKey, userInstruction, dispatchKey });
      return store.confirmAgentDispatch(prepared.taskId, dispatchKey);
    });
    workspaceByTask.set(task.taskId, workspaceDir);
    return result(task, "Prepared and dispatched task from active canvas.");
  }
  catch (error) { return failure(error); }
});

server.registerTool("weaver_confirm_agent_dispatch", { title: "Confirm Agent Dispatch", description: "Confirm that the Codex host accepted the visible task message.", inputSchema: { ...workspaceSchema.shape, taskId: z.string(), dispatchKey: z.string().min(1) }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } } }, async ({ workspaceDir, taskId, dispatchKey }, extra) => { try { const chatSessionKey = chatSessionKeyFromRequest(extra); const task = mutateWithStore(workspaceDir, (store) => { store.assertTaskChat(taskId, chatSessionKey); return store.confirmAgentDispatch(taskId, dispatchKey); }); workspaceByTask.set(task.taskId, workspaceDir); return result(task); } catch (error) { return failure(error); } });
server.registerTool("weaver_fail_agent_dispatch", { title: "Fail Agent Dispatch", description: "Record a rejected or unconfirmed Codex host dispatch without retrying it.", inputSchema: { ...workspaceSchema.shape, taskId: z.string(), dispatchKey: z.string().min(1), code: z.enum(["AGENT_DISPATCH_REJECTED", "DISPATCH_UNCONFIRMED"]), message: z.string().min(1) }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } } }, async ({ workspaceDir, taskId, dispatchKey, code, message }, extra) => { try { const chatSessionKey = chatSessionKeyFromRequest(extra); return result(mutateWithStore(workspaceDir, (store) => { store.assertTaskChat(taskId, chatSessionKey); return store.failAgentDispatch(taskId, dispatchKey, { code, message }); })); } catch (error) { return failure(error); } });
server.registerTool("weaver_begin_agent_continuation", { title: "Begin Agent Continuation", description: "Atomically claim the layout dispatch for a reviewed mixed task.", inputSchema: { ...workspaceSchema.shape, taskId: z.string(), dispatchKey: z.string().min(1), expectedTaskRevision: z.number().int().nonnegative() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } } }, async ({ workspaceDir, taskId, dispatchKey, expectedTaskRevision }, extra) => { try { const chatSessionKey = chatSessionKeyFromRequest(extra); return result(mutateWithStore(workspaceDir, (store) => { store.assertTaskChat(taskId, chatSessionKey); return store.beginAgentContinuation({ taskId, dispatchKey, expectedTaskRevision }); })); } catch (error) { return failure(error); } });

server.registerTool("weaver_mark_task_dispatched", { title: "Mark Task Dispatched", description: "Compatibility entry point for confirming the latest prepared dispatch.", inputSchema: { ...workspaceSchema.shape, taskId: z.string() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ workspaceDir, taskId }, extra) => { try { const chatSessionKey = chatSessionKeyFromRequest(extra); return result(mutateWithStore(workspaceDir, (store) => { const task = store.assertTaskChat(taskId, chatSessionKey); const dispatch = [...task.dispatches].reverse().find((item) => item.state === "prepared"); if (!dispatch) throw new Error("AGENT_DISPATCH_NOT_FOUND"); return store.confirmAgentDispatch(taskId, dispatch.dispatchKey); })); } catch (error) { return failure(error); } });
for (const [name, status] of [["weaver_start_agent_task", "running"], ["weaver_complete_agent_task", "completed"]] as const) {
  server.registerTool(name, { title: name.replaceAll("_", " "), description: `Set a durable Weaver agent task to ${status}.`, inputSchema: { ...workspaceSchema.shape, taskId: z.string() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ workspaceDir, taskId }, extra) => { try { const chatSessionKey = chatSessionKeyFromRequest(extra); return result(mutateWithStore(workspaceDir, (store) => { store.assertTaskChat(taskId, chatSessionKey); return store.updateAgentTask(taskId, { status }); })); } catch (error) { return failure(error); } });
}
server.registerTool("weaver_cancel_agent_task", { title: "Cancel Agent Task", description: "Cooperatively cancel a non-terminal task so later agent writes are rejected.", inputSchema: { ...workspaceSchema.shape, taskId: z.string() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } } }, async ({ workspaceDir, taskId }, extra) => { try { const chatSessionKey = chatSessionKeyFromRequest(extra); return result(mutateWithStore(workspaceDir, (store) => { const task = store.assertTaskChat(taskId, chatSessionKey, false); if (["completed", "stale", "failed", "cancelled"].includes(task.status)) return task; return store.updateAgentTask(taskId, { status: "cancelled" }); })); } catch (error) { return failure(error); } });

server.registerTool("weaver_get_agent_task", { title: "Get Agent Task", description: "Read a durable task only when it belongs to the current Codex chat binding.", inputSchema: { ...workspaceSchema.shape, taskId: z.string() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ workspaceDir, taskId }, extra) => { try { const chatSessionKey = chatSessionKeyFromRequest(extra); const task = withStore(workspaceDir, (store) => store.assertTaskChat(taskId, chatSessionKey, false)); workspaceByTask.set(taskId, workspaceDir); return result(task); } catch (error) { return failure(error); } });
server.registerTool("weaver_list_canvas_tasks", { title: "List Canvas Tasks", description: "Widget-only recovery of non-terminal tasks associated with one canvas session.", inputSchema: { ...workspaceSchema.shape, canvasSessionId: z.string() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } } }, async ({ workspaceDir, canvasSessionId }) => { try { return result(withStore(workspaceDir, (store) => store.listCanvasTasks(canvasSessionId))); } catch (error) { return failure(error); } });
server.registerTool("weaver_list_project_tasks", { title: "List Project Tasks", description: "Widget-only recovery of non-terminal tasks for a reopened project canvas.", inputSchema: projectSchema.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } } }, async ({ workspaceDir, projectId }) => { try { return result(withStore(workspaceDir, (store) => store.listProjectTasks(projectId))); } catch (error) { return failure(error); } });

server.registerTool("weaver_generate_layout_candidates", {
  title: "Generate Layout Candidates", description: "Validate an agent-authored semantic LayoutPlan, then let the deterministic engine calculate and score coordinates. The model must not provide final x/y positions.",
  inputSchema: { ...workspaceSchema.shape, taskId: z.string(), plan: z.any() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, async ({ workspaceDir, taskId, plan: rawPlan }, extra) => { try {
  const chatSessionKey = chatSessionKeyFromRequest(extra);
  const output = await (async () => {
    const store = new WorkspaceStore(workspaceDir);
    try {
      const task = store.assertTaskChat(taskId, chatSessionKey);
      if (task.status !== "running") throw new Error(["completed", "stale", "failed", "cancelled"].includes(task.status) ? `TASK_TERMINAL:${task.status}` : `TASK_NOT_RUNNING:${task.status}`);
      if (task.activeStage !== "layout") throw new Error(`TASK_STAGE_INVALID:${task.activeStage}`);
      const plan = layoutPlanSchema.parse(rawPlan);
      if (task.projectId !== plan.projectId) throw new Error("TASK_PROJECT_MISMATCH");
      const graph = store.getGraph(plan.projectId); if (graph.revision !== plan.baseGraphRevision) { store.updateAgentTask(taskId, { status: "stale", error: { code: "GRAPH_REVISION_CONFLICT", message: `Expected graph r${plan.baseGraphRevision}, current r${graph.revision}` } }); throw new Error("GRAPH_REVISION_CONFLICT"); }
      const current = store.getLayout(plan.projectId, plan.viewId); if (!current) throw new Error("LAYOUT_NOT_FOUND");
      if (current.layoutRevision !== plan.baseLayoutRevision) { store.updateAgentTask(taskId, { status: "stale", error: { code: "LAYOUT_REVISION_CONFLICT", message: `Expected layout r${plan.baseLayoutRevision}, current r${current.layoutRevision}` } }); throw new Error("LAYOUT_REVISION_CONFLICT"); }
      const layoutRunId = randomUUID();
      const candidates = await generateLayoutCandidates({ nodes: graph.nodes, edges: graph.edges, current, plan, layoutRunId });
      const run = store.saveLayoutRun({ id: layoutRunId, projectId: plan.projectId, viewId: plan.viewId, taskId, plan, candidates });
      store.updateAgentTask(taskId, { status: "pending_review", activeStage: "layout", results: { ...task.results, layoutRunId: run.id } });
      return { layoutRunId: run.id, candidates: candidates.map((candidate) => ({ id: candidate.id, label: candidate.label, metrics: candidate.metrics })) };
    } finally { store.close(); }
  })();
  eventHub.notifyWorkspace(workspaceDir);
  return result(output, `Generated ${output.candidates.length} deterministic layout candidates.`);
} catch (error) { return failure(error); } });

server.registerTool("weaver_get_layout_run", { title: "Get Layout Run", description: "Read layout candidates and quality metrics for the current chat-bound task.", inputSchema: { ...workspaceSchema.shape, layoutRunId: z.string() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ workspaceDir, layoutRunId }, extra) => { try { const chatSessionKey = chatSessionKeyFromRequest(extra); const run = withStore(workspaceDir, (store) => { const item = store.getLayoutRun(layoutRunId); if (!item) throw new Error("LAYOUT_RUN_NOT_FOUND"); if (item.taskId) store.assertTaskChat(item.taskId, chatSessionKey, false); return item; }); return result(run); } catch (error) { return failure(error); } });

server.registerTool("weaver_apply_layout", { title: "Apply Layout Candidate", description: "Apply one valid preview candidate, archive the previous view layout, and increment layoutRevision without changing graphRevision.", inputSchema: { ...workspaceSchema.shape, layoutRunId: z.string(), candidateId: z.string() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } }, async ({ workspaceDir, layoutRunId, candidateId }, extra) => { try { const chatSessionKey = chatSessionKeyFromRequest(extra); return result(mutateWithStore(workspaceDir, (store) => { const run = store.getLayoutRun(layoutRunId); if (!run) throw new Error("LAYOUT_RUN_NOT_FOUND"); if (run.taskId) store.assertTaskChat(run.taskId, chatSessionKey); return store.applyLayoutCandidate(layoutRunId, candidateId); }), "Applied layout candidate."); } catch (error) { return failure(error); } });
server.registerTool("weaver_reject_layout", { title: "Reject Layout Run", description: "Reject a pending layout preview without changing graph or layout revisions.", inputSchema: { ...workspaceSchema.shape, layoutRunId: z.string() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ workspaceDir, layoutRunId }, extra) => { try { const chatSessionKey = chatSessionKeyFromRequest(extra); return result(mutateWithStore(workspaceDir, (store) => { const run = store.getLayoutRun(layoutRunId); if (!run) throw new Error("LAYOUT_RUN_NOT_FOUND"); if (run.taskId) store.assertTaskChat(run.taskId, chatSessionKey); return store.rejectLayoutRun(layoutRunId); }), "Rejected layout preview."); } catch (error) { return failure(error); } });

server.registerTool("weaver_apply_layout_operations", { title: "Apply Manual Layout Operations", description: "Apply validated low-level layout operations from the widget, never graph mutations.", inputSchema: { ...projectSchema.shape, viewId: z.string(), baseLayoutRevision: z.number().int().nonnegative(), operations: z.array(layoutOperationSchema) }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } } }, async ({ workspaceDir, projectId, viewId, baseLayoutRevision, operations }) => { try { const next = mutateWithStore(workspaceDir, (store) => { const current = store.getLayout(projectId, viewId); if (!current) throw new Error("LAYOUT_NOT_FOUND"); if (current.layoutRevision !== baseLayoutRevision) throw new Error("LAYOUT_REVISION_CONFLICT"); return store.saveLayout(applyLayoutOperations(current, operations), true, { operations }); }); return result(next); } catch (error) { return failure(error); } });

server.registerTool("weaver_revert_layout", { title: "Undo Layout", description: "Restore the previous archived layout as a new layout revision.", inputSchema: { ...projectSchema.shape, viewId: z.string() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } }, async ({ workspaceDir, projectId, viewId }) => { try { return result(mutateWithStore(workspaceDir, (store) => store.revertLayout(projectId, viewId)), "Restored previous layout."); } catch (error) { return failure(error); } });

server.registerTool("weaver_submit_changeset", { title: "Submit Weaver ChangeSet", description: "Submit structured graph and layout operations for review. Agents cannot write the database directly.", inputSchema: { ...workspaceSchema.shape, changeSet: z.any() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ workspaceDir, changeSet }, extra) => { try { const chatSessionKey = chatSessionKeyFromRequest(extra); return result(mutateWithStore(workspaceDir, (store) => { const validated = changeSetSchema.parse(changeSet); store.assertTaskChat(validated.taskId, chatSessionKey); return store.submitChangeSet(validated); }), "Submitted ChangeSet."); } catch (error) { return failure(error); } });

server.registerTool("weaver_apply_changeset", { title: "Apply Weaver ChangeSet", description: "Apply one reviewed ChangeSet with graph and per-view layout revision checks.", inputSchema: { ...workspaceSchema.shape, changeSetId: z.string() }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } }, async ({ workspaceDir, changeSetId }, extra) => { try { const chatSessionKey = chatSessionKeyFromRequest(extra); return result(mutateWithStore(workspaceDir, (store) => { const item = store.getChangeSet(changeSetId); if (!item) throw new Error("CHANGESET_NOT_FOUND"); store.assertTaskChat(item.taskId, chatSessionKey); return store.applyChangeSet(changeSetId); }), "Applied ChangeSet."); } catch (error) { return failure(error); } });

server.registerTool("weaver_list_changesets", { title: "List Weaver ChangeSets", description: "List pending or historical graph/layout proposals for a project.", inputSchema: { ...projectSchema.shape, status: z.enum(["pending", "applied", "rejected", "reverted"]).optional() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ workspaceDir, projectId, status }) => { try { return result(withStore(workspaceDir, (store) => store.listChangeSets(projectId, status))); } catch (error) { return failure(error); } });
server.registerTool("weaver_get_changeset", { title: "Get Weaver ChangeSet", description: "Read one auditable graph/layout proposal for the current chat-bound task.", inputSchema: { ...workspaceSchema.shape, changeSetId: z.string() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ workspaceDir, changeSetId }, extra) => { try { const chatSessionKey = chatSessionKeyFromRequest(extra); const item = withStore(workspaceDir, (store) => { const value = store.getChangeSet(changeSetId); if (!value) throw new Error("CHANGESET_NOT_FOUND"); store.assertTaskChat(value.taskId, chatSessionKey, false); return value; }); return result(item); } catch (error) { return failure(error); } });
server.registerTool("weaver_preview_changeset", { title: "Preview Weaver ChangeSet", description: "Return a review-oriented summary and current revision status for one pending ChangeSet.", inputSchema: { ...workspaceSchema.shape, changeSetId: z.string() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ workspaceDir, changeSetId }, extra) => { try {
  const chatSessionKey = chatSessionKeyFromRequest(extra);
  const preview = withStore(workspaceDir, (store) => { const item = store.getChangeSet(changeSetId); if (!item) throw new Error("CHANGESET_NOT_FOUND"); store.assertTaskChat(item.taskId, chatSessionKey, false); const project = store.getProject(item.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); return { changeSet: item, stale: project.graphRevision !== item.baseGraphRevision, currentGraphRevision: project.graphRevision, summary: { addedNodes: item.graphOperations.filter((op) => op.type === "add-node").length, updatedNodes: item.graphOperations.filter((op) => ["update-node", "set-node-content", "attach-asset", "detach-asset", "set-node-cover"].includes(op.type)).length, archivedNodes: item.graphOperations.filter((op) => op.type === "archive-node").length, addedEdges: item.graphOperations.filter((op) => op.type === "add-edge").length, updatedEdges: item.graphOperations.filter((op) => op.type === "update-edge").length, archivedEdges: item.graphOperations.filter((op) => op.type === "archive-edge").length, layoutOperations: item.layoutOperations.length } }; }); return result(preview);
} catch (error) { return failure(error); } });
server.registerTool("weaver_reject_changeset", { title: "Reject Weaver ChangeSet", description: "Reject one pending proposal without changing graph or layout revisions.", inputSchema: { ...workspaceSchema.shape, changeSetId: z.string() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ workspaceDir, changeSetId }, extra) => { try { const chatSessionKey = chatSessionKeyFromRequest(extra); return result(mutateWithStore(workspaceDir, (store) => { const item = store.getChangeSet(changeSetId); if (!item) throw new Error("CHANGESET_NOT_FOUND"); store.assertTaskChat(item.taskId, chatSessionKey); return store.rejectChangeSet(changeSetId); })); } catch (error) { return failure(error); } });

server.registerTool("weaver_get_layout", { title: "Get Weaver Layout", description: "Read one independent view layout and layoutRevision.", inputSchema: { ...projectSchema.shape, viewId: z.string() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ workspaceDir, projectId, viewId }) => { try { const layout = withStore(workspaceDir, (store) => store.getLayout(projectId, viewId)); if (!layout) throw new Error("LAYOUT_NOT_FOUND"); return result(layout); } catch (error) { return failure(error); } });
server.registerTool("weaver_get_layout_capabilities", { title: "Get Layout Capabilities", description: "Read available deterministic layout strategies and semantic constraints.", inputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async () => result({ strategies: ["tree", "layered", "radial", "force", "cluster", "grid", "timeline", "swimlane", "hybrid"], constraints: ["pin", "align", "distribute", "order", "rank", "group", "containment", "separation", "relative-position", "direction", "spacing", "avoid-overlap", "preserve-position", "edge-length", "edge-routing", "emphasis", "viewport-fit"], candidateCount: { min: 1, max: 5, default: 3 } }));
server.registerTool("weaver_validate_layout_plan", { title: "Validate LayoutPlan", description: "Validate semantic layout constraints without calculating or applying coordinates.", inputSchema: { plan: z.any() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ plan }) => { try { return result({ valid: true, plan: layoutPlanSchema.parse(plan) }); } catch (error) { return failure(error); } });

server.registerTool("weaver_publish_artifact", { title: "Publish Weaver Artifact", description: "Save a scene-declared artifact from selected nodes at an exact graph revision.", inputSchema: { ...projectSchema.shape, artifactType: z.string(), title: z.string(), content: z.any(), sourceNodeIds: z.array(z.string()), graphRevision: z.number().int().nonnegative() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } }, async ({ workspaceDir, projectId, artifactType, title, content, sourceNodeIds, graphRevision }) => { try { const output = withStore(workspaceDir, (store) => store.publishArtifact({ projectId, type: artifactType, title, content, sourceNodeIds, graphRevision })); return result(output, `Published ${artifactType} artifact.`); } catch (error) { return failure(error); } });
server.registerTool("weaver_get_artifact", { title: "Get Weaver Artifact", description: "Read one project-local generated artifact.", inputSchema: { ...workspaceSchema.shape, artifactId: z.string() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ workspaceDir, artifactId }) => { try { const artifact = withStore(workspaceDir, (store) => store.getArtifact(artifactId)); if (!artifact) throw new Error("ARTIFACT_NOT_FOUND"); return result(artifact); } catch (error) { return failure(error); } });

server.registerResource("weaver-scene-packs", "weaver://scene-packs", { title: "Weaver Scene Packs", description: "The built-in versioned scene catalog.", mimeType: "application/json" }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(builtinScenePacks) }] }));
server.registerResource("weaver-visual-templates", "weaver://visual-templates", { title: "Weaver Visual Templates", description: "The built-in immutable structured visual template catalog.", mimeType: "application/json" }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(builtinVisualTemplates) }] }));
server.registerResource("weaver-visual-template", new ResourceTemplate("weaver://visual-templates/{templateId}/{version}", { list: undefined }), { title: "Weaver Visual Template", description: "One versioned VisualTemplate definition.", mimeType: "application/json" }, async (uri, variables) => { const item = getVisualTemplate(String(variables.templateId), String(variables.version)); if (!item) throw new Error("VISUAL_TEMPLATE_NOT_FOUND"); return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(item) }] }; });
server.registerResource("weaver-agent-task", new ResourceTemplate("weaver://agent-tasks/{taskId}", { list: undefined }), { title: "Weaver Agent Task", description: "One persisted AgentTask. Call a task tool first so the server can resolve its workspace.", mimeType: "application/json" }, async (uri, variables) => { const taskId = String(variables.taskId); const workspaceDir = workspaceByTask.get(taskId); if (!workspaceDir) throw new Error("WORKSPACE_UNKNOWN_CALL_WEAVER_GET_AGENT_TASK_FIRST"); const task = withStore(workspaceDir, (store) => store.getAgentTask(taskId)); if (!task) throw new Error("AGENT_TASK_NOT_FOUND"); return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(task) }] }; });
server.registerResource("weaver-project-views", new ResourceTemplate("weaver://projects/{projectId}/views", { list: undefined }), { title: "Weaver Project Views", description: "Durable saved View catalog records for a project, including recycle-bin state.", mimeType: "application/json" }, async (uri, variables) => { const projectId = String(variables.projectId); const workspaceDir = workspaceByProject.get(projectId); if (!workspaceDir) throw new Error("WORKSPACE_UNKNOWN_CALL_A_WEAVER_TOOL_FIRST"); const views = withStore(workspaceDir, (store) => store.listProjectViews(projectId)); return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(views) }] }; });
server.registerResource("weaver-view-projection", new ResourceTemplate("weaver://projects/{projectId}/views/{viewId}/projection", { list: undefined }), { title: "Weaver View Projection", description: "Projection and theme metadata for one visual view.", mimeType: "application/json" }, async (uri, variables) => { const projectId = String(variables.projectId); const workspaceDir = workspaceByProject.get(projectId); if (!workspaceDir) throw new Error("WORKSPACE_UNKNOWN_CALL_A_WEAVER_TOOL_FIRST"); const layout = withStore(workspaceDir, (store) => store.getLayout(projectId, String(variables.viewId))); if (!layout) throw new Error("LAYOUT_NOT_FOUND"); return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ viewId: layout.viewId, viewName: layout.viewName, viewType: layout.viewType, templateRef: layout.templateRef, projection: layout.projection, theme: layout.theme }) }] }; });
server.registerResource("weaver-project-manifest", new ResourceTemplate("weaver://projects/{projectId}/manifest", { list: undefined }), { title: "Weaver Project Manifest", description: "Pinned project and scene rules.", mimeType: "application/json" }, async (uri, variables) => { const projectId = String(variables.projectId); const workspaceDir = workspaceByProject.get(projectId); if (!workspaceDir) throw new Error("WORKSPACE_UNKNOWN_CALL_A_WEAVER_TOOL_FIRST"); const data = withStore(workspaceDir, (store) => { const project = store.getProject(projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); return { project, scenePack: getScenePack(project.scenePackId, project.scenePackVersion) }; }); return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data) }] }; });
server.registerResource("weaver-node-content", new ResourceTemplate("weaver://projects/{projectId}/nodes/{nodeId}/content", { list: undefined }), { title: "Weaver Node Content", description: "Full content for one explicitly selected node.", mimeType: "application/json" }, async (uri, variables) => { const projectId = String(variables.projectId); const nodeId = String(variables.nodeId); const workspaceDir = workspaceByProject.get(projectId); if (!workspaceDir) throw new Error("WORKSPACE_UNKNOWN_CALL_A_WEAVER_TOOL_FIRST"); const node = withStore(workspaceDir, (store) => store.getGraph(projectId).nodes.find((candidate) => candidate.id === nodeId)); if (!node) throw new Error("NODE_NOT_FOUND"); return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(node) }] }; });
server.registerResource("weaver-image-asset", new ResourceTemplate("weaver://projects/{projectId}/assets/{assetId}", { list: undefined }), { title: "Weaver Original Image", description: "Original image bytes for an explicitly requested asset.", mimeType: "application/octet-stream" }, async (uri, variables) => { const projectId = String(variables.projectId); const assetId = String(variables.assetId); const workspaceDir = workspaceByProject.get(projectId); if (!workspaceDir) throw new Error("WORKSPACE_UNKNOWN_CALL_A_WEAVER_TOOL_FIRST"); const item = withStore(workspaceDir, (store) => store.readAsset(assetId, false)); if (item.asset.projectId !== projectId) throw new Error("ASSET_NOT_FOUND_OR_CROSS_PROJECT"); return { contents: [{ uri: uri.href, mimeType: item.asset.mimeType, blob: Buffer.from(item.data).toString("base64") }] }; });
server.registerResource("weaver-image-thumbnail", new ResourceTemplate("weaver://projects/{projectId}/assets/{assetId}/thumbnail", { list: undefined }), { title: "Weaver Image Thumbnail", description: "Bounded WebP thumbnail for one image asset.", mimeType: "image/webp" }, async (uri, variables) => { const projectId = String(variables.projectId); const assetId = String(variables.assetId); const workspaceDir = workspaceByProject.get(projectId); if (!workspaceDir) throw new Error("WORKSPACE_UNKNOWN_CALL_A_WEAVER_TOOL_FIRST"); const item = withStore(workspaceDir, (store) => store.readAsset(assetId, true)); if (item.asset.projectId !== projectId) throw new Error("ASSET_NOT_FOUND_OR_CROSS_PROJECT"); return { contents: [{ uri: uri.href, mimeType: "image/webp", blob: Buffer.from(item.data).toString("base64") }] }; });

const transport = new StdioServerTransport();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void eventHub.close(); });
await server.connect(transport);
const closeTransport = transport.onclose;
transport.onclose = () => { closeTransport?.(); void eventHub.close(); };
