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
  type SpaceEdge,
  type SpaceNode,
} from "@weaver/contracts";
import { applyLayoutOperations, resolveSceneContext } from "@weaver/core";
import { generateLayoutCandidates } from "@weaver/layout-engine";
import { builtinScenePacks, getScenePack } from "@weaver/scene-packs";
import { WorkspaceStore } from "@weaver/storage";
import { bundledWidgetHtml } from "./widget.js";
import { enrichPublicLink } from "./link-enrichment.js";
import { SseEventHub } from "./event-hub.js";

const manifest = JSON.parse(readFileSync(resolve(process.cwd(), ".codex-plugin", "plugin.json"), "utf8"));
const server = new McpServer({ name: "weaver-mcp-server", version: manifest.version }, { instructions: "Use Weaver tools to create semantic knowledge spaces, read concise graph summaries, explicitly load full node content, propose LayoutPlan constraints, generate deterministic layout candidates, and submit auditable ChangeSets. Never invent final coordinates or direct asset paths in the model." });
const eventHub = new SseEventHub();
await eventHub.start();
const widgetUri = "ui://widget/weaver/workspace.html";
const workspaceByProject = new Map<string, string>();

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

function seedProject(store: WorkspaceStore, project: ReturnType<WorkspaceStore["getProject"]>, scene: ScenePack) {
  if (!project) throw new Error("PROJECT_NOT_FOUND");
  const timestamp = new Date().toISOString();
  const root: SpaceNode = nodeSchema.parse({ id: randomUUID(), projectId: project.id, type: scene.nodeTypes[0].key, title: project.goal || project.title, body: "", properties: {}, archived: false, createdAt: timestamp, updatedAt: timestamp });
  store.replaceGraph({ projectId: project.id, revision: 1, nodes: [root], edges: [] });
  const layout = store.getLayout(project.id, project.defaultViewId);
  if (layout) {
    layout.graphRevision = 1;
    layout.nodes[root.id] = { nodeId: root.id, x: 0, y: 0, width: scene.nodeTypes[0].defaultWidth, height: scene.nodeTypes[0].defaultHeight, rotation: 0, zIndex: 0, pinned: false, hidden: false, collapsed: false };
    layout.bounds = { x: 0, y: 0, width: scene.nodeTypes[0].defaultWidth, height: scene.nodeTypes[0].defaultHeight };
    store.saveLayout(layout, false);
  }
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
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  _meta: { ui: { resourceUri: widgetUri, visibility: ["model", "app"] }, "ui/resourceUri": widgetUri, "openai/outputTemplate": widgetUri, "openai/widgetAccessible": true },
}, async (input) => result({ version: 1, widget: "weaver-workspace", workspaceDir: input.workspaceDir, projectId: input.projectId, preferredDisplayMode: input.displayMode }, "Opened Weaver workspace widget."));

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
}, async ({ workspaceDir, title, goal, scenePackId, automationLevel }) => { try { const scene = getScenePack(scenePackId); if (!scene) throw new Error(`SCENE_PACK_NOT_FOUND:${scenePackId}`); const project = withStore(workspaceDir, (store) => { const created = store.createProject({ title, goal, scenePack: scene, automationLevel }); seedProject(store, created, scene); return store.getProject(created.id)!; }); track(workspaceDir, project.id); return result(project, `Created ${project.title}.`); } catch (error) { return failure(error); } });

server.registerTool("weaver_get_project_manifest", {
  title: "Get Project Manifest", description: "Get a project's pinned scene rules, available node/edge types, views, artifacts, revisions and automation level.", inputSchema: projectSchema.shape,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ workspaceDir, projectId }) => { try { const output = withStore(workspaceDir, (store) => { const project = store.getProject(projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); const scenePack = getScenePack(project.scenePackId, project.scenePackVersion); return { project, scenePack, views: store.listLayouts(projectId).map(({ viewId, viewType, layoutRevision }) => ({ viewId, viewType, layoutRevision })) }; }); track(workspaceDir, projectId); return result(output); } catch (error) { return failure(error); } });

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
}, async ({ workspaceDir, snapshot }) => { try { return result(withStore(workspaceDir, (store) => store.syncCanvasContext(snapshot))); } catch (error) { return failure(error); } });

server.registerTool("weaver_get_canvas_context", {
  title: "Get Canvas Context", description: "Read the authoritative selection and view snapshot for one canvas session.", inputSchema: { ...workspaceSchema.shape, canvasSessionId: z.string() },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ workspaceDir, canvasSessionId }) => { try { const context = withStore(workspaceDir, (store) => store.getCanvasContext(canvasSessionId)); if (!context) throw new Error("CANVAS_SESSION_NOT_FOUND"); return result(context); } catch (error) { return failure(error); } });

server.registerTool("weaver_resolve_context", {
  title: "Resolve Scene Context", description: "Resolve a bounded, auditable node context using the project's pinned scene policy and current canvas selection.",
  inputSchema: { ...workspaceSchema.shape, canvasSessionId: z.string() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ workspaceDir, canvasSessionId }) => { try { const output = withStore(workspaceDir, (store) => { const context = store.getCanvasContext(canvasSessionId); if (!context) throw new Error("CANVAS_SESSION_NOT_FOUND"); const project = store.getProject(context.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); const scenePack = getScenePack(project.scenePackId, project.scenePackVersion); if (!scenePack) throw new Error("SCENE_PACK_NOT_FOUND"); const graph = store.getGraph(project.id); const nodes = resolveSceneContext({ nodes: graph.nodes, edges: graph.edges, scenePack, selectedNodeIds: context.selectedNodeIds, pinnedNodeIds: context.pinnedContextNodeIds }); return { projectId: project.id, graphRevision: graph.revision, policy: scenePack.contextPolicy, nodeIds: nodes.map((node) => node.id), nodes }; }); return result(output, `Resolved ${output.nodes.length} context nodes.`); } catch (error) { return failure(error); } });

server.registerTool("weaver_prepare_agent_task", {
  title: "Prepare Agent Task", description: "Atomically capture the latest canvas state into a durable task before the widget sends a follow-up message.",
  inputSchema: { ...workspaceSchema.shape, canvasSessionId: z.string(), actionKey: z.string(), userInstruction: z.string().optional() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, async ({ workspaceDir, canvasSessionId, actionKey, userInstruction }) => { try { return result(mutateWithStore(workspaceDir, (store) => store.prepareAgentTask({ canvasSessionId, actionKey, userInstruction })), "Prepared agent task."); } catch (error) { return failure(error); } });

server.registerTool("weaver_prepare_task_from_active_canvas", {
  title: "Prepare Task From Active Canvas",
  description: "Create a durable Weaver task from an explicit or uniquely active canvas when a Codex chat did not originate in the widget.",
  inputSchema: { ...workspaceSchema.shape, canvasSessionId: z.string().optional(), projectId: z.string().optional(), actionKey: z.enum(["develop_selection", "layout_view", "develop_then_layout"]), userInstruction: z.string().optional() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, async ({ workspaceDir, canvasSessionId, projectId, actionKey, userInstruction }) => {
  try { return result(mutateWithStore(workspaceDir, (store) => store.prepareAgentTaskFromActiveCanvas({ canvasSessionId, projectId, actionKey, userInstruction })), "Prepared task from active canvas."); }
  catch (error) { return failure(error); }
});

for (const [name, status] of [["weaver_mark_task_dispatched", "dispatched"], ["weaver_start_agent_task", "running"], ["weaver_complete_agent_task", "completed"], ["weaver_cancel_agent_task", "cancelled"]] as const) {
  server.registerTool(name, { title: name.replaceAll("_", " "), description: `Set a durable Weaver agent task to ${status}.`, inputSchema: { ...workspaceSchema.shape, taskId: z.string() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ workspaceDir, taskId }) => { try { return result(mutateWithStore(workspaceDir, (store) => store.updateAgentTask(taskId, { status }))); } catch (error) { return failure(error); } });
}

server.registerTool("weaver_get_agent_task", { title: "Get Agent Task", description: "Read a durable task prepared by the canvas.", inputSchema: { ...workspaceSchema.shape, taskId: z.string() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ workspaceDir, taskId }) => { try { const task = withStore(workspaceDir, (store) => store.getAgentTask(taskId)); if (!task) throw new Error("AGENT_TASK_NOT_FOUND"); return result(task); } catch (error) { return failure(error); } });
server.registerTool("weaver_list_canvas_tasks", { title: "List Canvas Tasks", description: "Widget-only recovery of non-terminal tasks associated with one canvas session.", inputSchema: { ...workspaceSchema.shape, canvasSessionId: z.string() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } } }, async ({ workspaceDir, canvasSessionId }) => { try { return result(withStore(workspaceDir, (store) => store.listCanvasTasks(canvasSessionId))); } catch (error) { return failure(error); } });
server.registerTool("weaver_list_project_tasks", { title: "List Project Tasks", description: "Widget-only recovery of non-terminal tasks for a reopened project canvas.", inputSchema: projectSchema.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } } }, async ({ workspaceDir, projectId }) => { try { return result(withStore(workspaceDir, (store) => store.listProjectTasks(projectId))); } catch (error) { return failure(error); } });

server.registerTool("weaver_generate_layout_candidates", {
  title: "Generate Layout Candidates", description: "Validate an agent-authored semantic LayoutPlan, then let the deterministic engine calculate and score coordinates. The model must not provide final x/y positions.",
  inputSchema: { ...workspaceSchema.shape, taskId: z.string(), plan: z.any() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, async ({ workspaceDir, taskId, plan: rawPlan }) => { try {
  const output = await (async () => {
    const store = new WorkspaceStore(workspaceDir);
    try {
      const task = store.getAgentTask(taskId); if (!task) throw new Error("AGENT_TASK_NOT_FOUND");
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

server.registerTool("weaver_get_layout_run", { title: "Get Layout Run", description: "Read layout candidates and quality metrics for widget preview or agent review.", inputSchema: { ...workspaceSchema.shape, layoutRunId: z.string() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ workspaceDir, layoutRunId }) => { try { const run = withStore(workspaceDir, (store) => store.getLayoutRun(layoutRunId)); if (!run) throw new Error("LAYOUT_RUN_NOT_FOUND"); return result(run); } catch (error) { return failure(error); } });

server.registerTool("weaver_apply_layout", { title: "Apply Layout Candidate", description: "Apply one valid preview candidate, archive the previous view layout, and increment layoutRevision without changing graphRevision.", inputSchema: { ...workspaceSchema.shape, layoutRunId: z.string(), candidateId: z.string() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } }, async ({ workspaceDir, layoutRunId, candidateId }) => { try { return result(mutateWithStore(workspaceDir, (store) => store.applyLayoutCandidate(layoutRunId, candidateId)), "Applied layout candidate."); } catch (error) { return failure(error); } });
server.registerTool("weaver_reject_layout", { title: "Reject Layout Run", description: "Reject a pending layout preview without changing graph or layout revisions.", inputSchema: { ...workspaceSchema.shape, layoutRunId: z.string() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ workspaceDir, layoutRunId }) => { try { return result(mutateWithStore(workspaceDir, (store) => store.rejectLayoutRun(layoutRunId)), "Rejected layout preview."); } catch (error) { return failure(error); } });

server.registerTool("weaver_apply_layout_operations", { title: "Apply Manual Layout Operations", description: "Apply validated low-level layout operations from the widget, never graph mutations.", inputSchema: { ...projectSchema.shape, viewId: z.string(), baseLayoutRevision: z.number().int().nonnegative(), operations: z.array(layoutOperationSchema) }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } } }, async ({ workspaceDir, projectId, viewId, baseLayoutRevision, operations }) => { try { const next = mutateWithStore(workspaceDir, (store) => { const current = store.getLayout(projectId, viewId); if (!current) throw new Error("LAYOUT_NOT_FOUND"); if (current.layoutRevision !== baseLayoutRevision) throw new Error("LAYOUT_REVISION_CONFLICT"); return store.saveLayout(applyLayoutOperations(current, operations), true, { operations }); }); return result(next); } catch (error) { return failure(error); } });

server.registerTool("weaver_revert_layout", { title: "Undo Layout", description: "Restore the previous archived layout as a new layout revision.", inputSchema: { ...projectSchema.shape, viewId: z.string() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } }, async ({ workspaceDir, projectId, viewId }) => { try { return result(mutateWithStore(workspaceDir, (store) => store.revertLayout(projectId, viewId)), "Restored previous layout."); } catch (error) { return failure(error); } });

server.registerTool("weaver_submit_changeset", { title: "Submit Weaver ChangeSet", description: "Submit structured graph and layout operations for review. Agents cannot write the database directly.", inputSchema: { ...workspaceSchema.shape, changeSet: z.any() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ workspaceDir, changeSet }) => { try { return result(mutateWithStore(workspaceDir, (store) => store.submitChangeSet(changeSetSchema.parse(changeSet))), "Submitted ChangeSet."); } catch (error) { return failure(error); } });

server.registerTool("weaver_apply_changeset", { title: "Apply Weaver ChangeSet", description: "Apply one reviewed ChangeSet with graph and per-view layout revision checks.", inputSchema: { ...workspaceSchema.shape, changeSetId: z.string() }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } }, async ({ workspaceDir, changeSetId }) => { try { return result(mutateWithStore(workspaceDir, (store) => store.applyChangeSet(changeSetId)), "Applied ChangeSet."); } catch (error) { return failure(error); } });

server.registerTool("weaver_list_changesets", { title: "List Weaver ChangeSets", description: "List pending or historical graph/layout proposals for a project.", inputSchema: { ...projectSchema.shape, status: z.enum(["pending", "applied", "rejected", "reverted"]).optional() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ workspaceDir, projectId, status }) => { try { return result(withStore(workspaceDir, (store) => store.listChangeSets(projectId, status))); } catch (error) { return failure(error); } });
server.registerTool("weaver_get_changeset", { title: "Get Weaver ChangeSet", description: "Read one auditable graph/layout proposal.", inputSchema: { ...workspaceSchema.shape, changeSetId: z.string() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ workspaceDir, changeSetId }) => { try { const item = withStore(workspaceDir, (store) => store.getChangeSet(changeSetId)); if (!item) throw new Error("CHANGESET_NOT_FOUND"); return result(item); } catch (error) { return failure(error); } });
server.registerTool("weaver_preview_changeset", { title: "Preview Weaver ChangeSet", description: "Return a review-oriented summary and current revision status for one pending ChangeSet.", inputSchema: { ...workspaceSchema.shape, changeSetId: z.string() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ workspaceDir, changeSetId }) => { try {
  const preview = withStore(workspaceDir, (store) => { const item = store.getChangeSet(changeSetId); if (!item) throw new Error("CHANGESET_NOT_FOUND"); const project = store.getProject(item.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); return { changeSet: item, stale: project.graphRevision !== item.baseGraphRevision, currentGraphRevision: project.graphRevision, summary: { addedNodes: item.graphOperations.filter((op) => op.type === "add-node").length, updatedNodes: item.graphOperations.filter((op) => ["update-node", "set-node-content", "attach-asset", "detach-asset", "set-node-cover"].includes(op.type)).length, archivedNodes: item.graphOperations.filter((op) => op.type === "archive-node").length, addedEdges: item.graphOperations.filter((op) => op.type === "add-edge").length, updatedEdges: item.graphOperations.filter((op) => op.type === "update-edge").length, archivedEdges: item.graphOperations.filter((op) => op.type === "archive-edge").length, layoutOperations: item.layoutOperations.length } }; }); return result(preview);
} catch (error) { return failure(error); } });
server.registerTool("weaver_reject_changeset", { title: "Reject Weaver ChangeSet", description: "Reject one pending proposal without changing graph or layout revisions.", inputSchema: { ...workspaceSchema.shape, changeSetId: z.string() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ workspaceDir, changeSetId }) => { try { return result(mutateWithStore(workspaceDir, (store) => store.rejectChangeSet(changeSetId))); } catch (error) { return failure(error); } });

server.registerTool("weaver_get_layout", { title: "Get Weaver Layout", description: "Read one independent view layout and layoutRevision.", inputSchema: { ...projectSchema.shape, viewId: z.string() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ workspaceDir, projectId, viewId }) => { try { const layout = withStore(workspaceDir, (store) => store.getLayout(projectId, viewId)); if (!layout) throw new Error("LAYOUT_NOT_FOUND"); return result(layout); } catch (error) { return failure(error); } });
server.registerTool("weaver_get_layout_capabilities", { title: "Get Layout Capabilities", description: "Read available deterministic layout strategies and semantic constraints.", inputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async () => result({ strategies: ["tree", "layered", "radial", "force", "cluster", "grid", "timeline", "swimlane", "hybrid"], constraints: ["pin", "align", "distribute", "order", "rank", "group", "containment", "separation", "relative-position", "direction", "spacing", "avoid-overlap", "preserve-position", "edge-length", "edge-routing", "emphasis", "viewport-fit"], candidateCount: { min: 1, max: 5, default: 3 } }));
server.registerTool("weaver_validate_layout_plan", { title: "Validate LayoutPlan", description: "Validate semantic layout constraints without calculating or applying coordinates.", inputSchema: { plan: z.any() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ plan }) => { try { return result({ valid: true, plan: layoutPlanSchema.parse(plan) }); } catch (error) { return failure(error); } });

server.registerTool("weaver_publish_artifact", { title: "Publish Weaver Artifact", description: "Save a scene-declared artifact from selected nodes at an exact graph revision.", inputSchema: { ...projectSchema.shape, artifactType: z.string(), title: z.string(), content: z.any(), sourceNodeIds: z.array(z.string()), graphRevision: z.number().int().nonnegative() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } }, async ({ workspaceDir, projectId, artifactType, title, content, sourceNodeIds, graphRevision }) => { try { const output = withStore(workspaceDir, (store) => store.publishArtifact({ projectId, type: artifactType, title, content, sourceNodeIds, graphRevision })); return result(output, `Published ${artifactType} artifact.`); } catch (error) { return failure(error); } });
server.registerTool("weaver_get_artifact", { title: "Get Weaver Artifact", description: "Read one project-local generated artifact.", inputSchema: { ...workspaceSchema.shape, artifactId: z.string() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ workspaceDir, artifactId }) => { try { const artifact = withStore(workspaceDir, (store) => store.getArtifact(artifactId)); if (!artifact) throw new Error("ARTIFACT_NOT_FOUND"); return result(artifact); } catch (error) { return failure(error); } });

server.registerResource("weaver-scene-packs", "weaver://scene-packs", { title: "Weaver Scene Packs", description: "The built-in versioned scene catalog.", mimeType: "application/json" }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(builtinScenePacks) }] }));
server.registerResource("weaver-project-manifest", new ResourceTemplate("weaver://projects/{projectId}/manifest", { list: undefined }), { title: "Weaver Project Manifest", description: "Pinned project and scene rules.", mimeType: "application/json" }, async (uri, variables) => { const projectId = String(variables.projectId); const workspaceDir = workspaceByProject.get(projectId); if (!workspaceDir) throw new Error("WORKSPACE_UNKNOWN_CALL_A_WEAVER_TOOL_FIRST"); const data = withStore(workspaceDir, (store) => { const project = store.getProject(projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); return { project, scenePack: getScenePack(project.scenePackId, project.scenePackVersion) }; }); return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data) }] }; });
server.registerResource("weaver-node-content", new ResourceTemplate("weaver://projects/{projectId}/nodes/{nodeId}/content", { list: undefined }), { title: "Weaver Node Content", description: "Full content for one explicitly selected node.", mimeType: "application/json" }, async (uri, variables) => { const projectId = String(variables.projectId); const nodeId = String(variables.nodeId); const workspaceDir = workspaceByProject.get(projectId); if (!workspaceDir) throw new Error("WORKSPACE_UNKNOWN_CALL_A_WEAVER_TOOL_FIRST"); const node = withStore(workspaceDir, (store) => store.getGraph(projectId).nodes.find((candidate) => candidate.id === nodeId)); if (!node) throw new Error("NODE_NOT_FOUND"); return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(node) }] }; });
server.registerResource("weaver-image-asset", new ResourceTemplate("weaver://projects/{projectId}/assets/{assetId}", { list: undefined }), { title: "Weaver Original Image", description: "Original image bytes for an explicitly requested asset.", mimeType: "application/octet-stream" }, async (uri, variables) => { const projectId = String(variables.projectId); const assetId = String(variables.assetId); const workspaceDir = workspaceByProject.get(projectId); if (!workspaceDir) throw new Error("WORKSPACE_UNKNOWN_CALL_A_WEAVER_TOOL_FIRST"); const item = withStore(workspaceDir, (store) => store.readAsset(assetId, false)); if (item.asset.projectId !== projectId) throw new Error("ASSET_NOT_FOUND_OR_CROSS_PROJECT"); return { contents: [{ uri: uri.href, mimeType: item.asset.mimeType, blob: Buffer.from(item.data).toString("base64") }] }; });
server.registerResource("weaver-image-thumbnail", new ResourceTemplate("weaver://projects/{projectId}/assets/{assetId}/thumbnail", { list: undefined }), { title: "Weaver Image Thumbnail", description: "Bounded WebP thumbnail for one image asset.", mimeType: "image/webp" }, async (uri, variables) => { const projectId = String(variables.projectId); const assetId = String(variables.assetId); const workspaceDir = workspaceByProject.get(projectId); if (!workspaceDir) throw new Error("WORKSPACE_UNKNOWN_CALL_A_WEAVER_TOOL_FIRST"); const item = withStore(workspaceDir, (store) => store.readAsset(assetId, true)); if (item.asset.projectId !== projectId) throw new Error("ASSET_NOT_FOUND_OR_CROSS_PROJECT"); return { contents: [{ uri: uri.href, mimeType: "image/webp", blob: Buffer.from(item.data).toString("base64") }] }; });

const transport = new StdioServerTransport();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void eventHub.close(); });
await server.connect(transport);
const closeTransport = transport.onclose;
transport.onclose = () => { closeTransport?.(); void eventHub.close(); };
