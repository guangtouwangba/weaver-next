import type { SpaceNode } from "@weaver/contracts";
import { resolveSceneContext } from "@weaver/core";
import { getScenePack } from "@weaver/scene-packs";
import { builtinVisualTemplates, getVisualTemplate, validateVisualTemplateForProject } from "@weaver/visual-templates";
import type { WorkspaceStore } from "@weaver/storage";
import type { WorkspacePrincipal } from "./catalog.js";

function requiredString(args: Record<string, unknown>, name: string) {
  const value = args[name];
  if (typeof value !== "string" || !value) throw new Error(`INVALID_ARGS:${name} required`);
  return value;
}

function summarizeNode(store: WorkspaceStore, node: SpaceNode) {
  const content = node.content.kind === "document" ? { ...node.content, markdown: undefined } : node.content;
  const assetIds = node.content.kind === "image" ? [node.content.assetId]
    : node.content.kind === "document" ? [node.content.coverAssetId, ...node.content.embeddedAssetIds].filter(Boolean) as string[]
      : node.content.kind === "link" ? [node.content.imageAssetId].filter(Boolean) as string[] : [];
  return { id: node.id, projectId: node.projectId, type: node.type, title: node.title, contentKind: node.contentKind, content, properties: node.properties, archived: node.archived, createdAt: node.createdAt, updatedAt: node.updatedAt, assets: assetIds.map((id) => store.assets.get(id)).filter(Boolean) };
}

export function compatReadCatalog(store: WorkspaceStore, _principal: WorkspacePrincipal, args: Record<string, unknown>) {
  if (args.resource === "project.list") return store.catalog.listProjects();
  if (args.resource === "template.list") return builtinVisualTemplates.filter((item) => (!args.scenePackId || item.compatibleScenePackIds.includes(String(args.scenePackId))) && (!args.family || item.family === args.family) && (!args.renderer || item.renderer === args.renderer));
  if (args.resource === "template.get") {
    const template = getVisualTemplate(requiredString(args, "templateId"), typeof args.version === "string" ? args.version : "1.0.0");
    if (!template) throw new Error("VISUAL_TEMPLATE_NOT_FOUND");
    return template;
  }
  if (args.resource === "artifact.get") {
    const artifact = store.artifacts.get(requiredString(args, "artifactId"));
    if (!artifact) throw new Error("ARTIFACT_NOT_FOUND");
    return artifact;
  }
  const projectId = requiredString(args, "projectId");
  if (args.resource === "view.list") return store.catalog.listViews(projectId, args.status === "trashed" ? "trashed" : args.status === "active" ? "active" : undefined)
    .map((view) => ({ ...view, nodeCount: Object.keys(store.layoutReviews.get(projectId, view.id)?.nodes ?? {}).length }));
  if (args.resource === "view.get") {
    const view = store.catalog.getView(projectId, requiredString(args, "viewId"));
    if (!view) throw new Error("VIEW_NOT_FOUND");
    return view;
  }
  if (args.resource === "view.search") return store.catalog.searchViews(projectId, typeof args.query === "string" ? args.query : "", args.status === "trashed" ? "trashed" : "active")
    .map((view) => ({ ...view, nodeCount: Object.keys(store.layoutReviews.get(projectId, view.id)?.nodes ?? {}).length }));
  if (args.resource === "template.validate") {
    const template = getVisualTemplate(requiredString(args, "templateId"), typeof args.version === "string" ? args.version : undefined);
    const project = store.catalog.getProject(projectId);
    const scene = project ? getScenePack(project.scenePackId, project.scenePackVersion) : undefined;
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    if (!scene || !template) throw new Error("VISUAL_TEMPLATE_NOT_FOUND");
    return validateVisualTemplateForProject(template, scene, store.graphChanges.read(projectId).nodes);
  }
  if (args.resource === "template.preview") {
    const template = getVisualTemplate(requiredString(args, "templateId"), typeof args.version === "string" ? args.version : undefined);
    if (!template) throw new Error("VISUAL_TEMPLATE_NOT_FOUND");
    if (typeof args.baseGraphRevision !== "number") throw new Error("INVALID_ARGS:baseGraphRevision required");
    return store.catalog.previewTemplate({ projectId, template, baseGraphRevision: args.baseGraphRevision, viewName: typeof args.viewName === "string" ? args.viewName : undefined });
  }
  if (args.resource === "asset.metadata") {
    const asset = store.assets.get(requiredString(args, "assetId"));
    if (!asset || asset.projectId !== projectId) throw new Error("ASSET_NOT_FOUND_OR_CROSS_PROJECT");
    return asset;
  }
  if (args.resource === "asset.preview") {
    const assetId = requiredString(args, "assetId");
    const item = store.assets.read(assetId, true);
    if (item.asset.projectId !== projectId) throw new Error("ASSET_NOT_FOUND_OR_CROSS_PROJECT");
    return { assetId, dataUrl: `data:image/webp;base64,${Buffer.from(item.data).toString("base64")}` };
  }
  throw new Error("OPERATION_NOT_FOUND");
}

export function compatReadGraph(store: WorkspaceStore, _principal: WorkspacePrincipal, args: Record<string, unknown>) {
  const projectId = requiredString(args, "projectId");
  const project = store.catalog.getProject(projectId);
  if (!project) throw new Error("PROJECT_NOT_FOUND");
  if (args.resource === "manifest") {
    const scenePack = getScenePack(project.scenePackId, project.scenePackVersion);
    if (!scenePack) throw new Error("SCENE_PACK_NOT_FOUND");
    return { project, scenePack, views: store.catalog.listViews(projectId, "active").map((view) => ({ ...view, viewId: view.id, viewName: view.name, layoutRevision: store.layoutReviews.get(projectId, view.id)?.layoutRevision ?? 0 })) };
  }
  const graph = store.graphChanges.read(projectId);
  if (args.resource === "node") {
    const node = graph.nodes.find((candidate) => candidate.id === requiredString(args, "nodeId"));
    if (!node) throw new Error("NODE_NOT_FOUND");
    return { graphRevision: graph.revision, node };
  }
  if (args.resource === "query") {
    let nodes = graph.nodes.filter((node) => !node.archived);
    const nodeIds = Array.isArray(args.nodeIds) ? args.nodeIds.filter((value): value is string => typeof value === "string") : [];
    const nodeTypes = Array.isArray(args.nodeTypes) ? args.nodeTypes.filter((value): value is string => typeof value === "string") : [];
    if (nodeIds.length) nodes = nodes.filter((node) => nodeIds.includes(node.id));
    if (nodeTypes.length) nodes = nodes.filter((node) => nodeTypes.includes(node.type));
    if (typeof args.text === "string" && args.text) {
      const text = args.text.toLowerCase();
      nodes = nodes.filter((node) => `${node.title}\n${node.content.kind === "document" ? node.content.markdown : node.content.kind === "link" ? node.content.description : node.content.kind === "chart" ? node.content.title : node.content.caption}`.toLowerCase().includes(text));
    }
    nodes = nodes.slice(0, typeof args.limit === "number" ? args.limit : 50);
    const ids = new Set(nodes.map((node) => node.id));
    return { revision: graph.revision, nodes: nodes.map((node) => summarizeNode(store, node)), edges: graph.edges.filter((edge) => ids.has(edge.sourceNodeId) || ids.has(edge.targetNodeId)) };
  }
  if (args.resource === "full") {
    const viewId = typeof args.viewId === "string" ? args.viewId : project.defaultViewId;
    const layout = store.layoutReviews.get(projectId, viewId);
    if (!layout) throw new Error("LAYOUT_NOT_FOUND");
    const nodes = graph.nodes.filter((node) => !node.archived);
    const ids = new Set(nodes.map((node) => node.id));
    return { project, nodes: nodes.map((node) => summarizeNode(store, node)), edges: graph.edges.filter((edge) => !edge.archived && ids.has(edge.sourceNodeId) && ids.has(edge.targetNodeId)), layout };
  }
  throw new Error("OPERATION_NOT_FOUND");
}

export function compatReadSession(store: WorkspaceStore, principal: WorkspacePrincipal, args: Record<string, unknown>) {
  const chatSessionKey = principal.kind === "chat" ? principal.chatSessionKey : principal.kind === "browser" ? store.browserSessions.get(principal.browserSessionId)?.pairedChatSessionKey : undefined;
  const boundCanvas = () => {
    if (!chatSessionKey) throw new Error("NO_CANVAS_BOUND_TO_CHAT");
    const { binding, context } = store.sessions.boundCanvas(chatSessionKey, false);
    const project = store.catalog.getProject(context.projectId);
    const layout = store.layoutReviews.get(context.projectId, context.viewId);
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    if (!layout) throw new Error("LAYOUT_NOT_FOUND");
    const lastSeenAt = context.presence?.lastSeenAt ?? context.updatedAt;
    return { projectId: context.projectId, viewId: context.viewId, canvasSessionId: context.canvasSessionId, bindingStatus: binding.status, online: Date.now() - Date.parse(lastSeenAt) <= 30_000, lastSeenAt, graphRevision: project.graphRevision, layoutRevision: layout.layoutRevision, bindingRevision: binding.bindingRevision };
  };
  if (args.resource === "canvas_view_state") {
    const canvasSessionId = requiredString(args, "canvasSessionId");
    const viewId = requiredString(args, "viewId");
    return store.catalog.canvasState(canvasSessionId, viewId) ?? { canvasSessionId, viewId, firstOpen: true };
  }
  if (args.resource === "canvas_tasks") {
    const canvasSessionId = requiredString(args, "canvasSessionId");
    store.tasks.reapCanvas(canvasSessionId);
    return store.tasks.listCanvas(canvasSessionId);
  }
  if (args.resource === "bound_canvas") return boundCanvas();
  if (args.resource === "task") {
    if (!chatSessionKey) throw new Error("NO_CANVAS_BOUND_TO_CHAT");
    return store.tasks.assertChat(requiredString(args, "taskId"), chatSessionKey, false);
  }
  if (args.resource === "canvas_context") {
    const context = store.sessions.canvasContext(requiredString(args, "canvasSessionId"));
    if (!context) throw new Error("CANVAS_SESSION_NOT_FOUND");
    return context;
  }
  if (args.resource === "resolved_context") {
    const context = store.sessions.canvasContext(requiredString(args, "canvasSessionId"));
    if (!context) throw new Error("CANVAS_SESSION_NOT_FOUND");
    const project = store.catalog.getProject(context.projectId);
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    const scenePack = getScenePack(project.scenePackId, project.scenePackVersion);
    if (!scenePack) throw new Error("SCENE_PACK_NOT_FOUND");
    const graph = store.graphChanges.read(project.id);
    const resolved = resolveSceneContext({ nodes: graph.nodes, edges: graph.edges, scenePack, selectedNodeIds: context.selectedNodeIds, pinnedNodeIds: context.pinnedContextNodeIds });
    return { projectId: project.id, graphRevision: graph.revision, policy: scenePack.contextPolicy, ...resolved };
  }
  if (args.resource === "guard") {
    if (!chatSessionKey) throw new Error("NO_CANVAS_BOUND_TO_CHAT");
    const bound = boundCanvas();
    const task = typeof args.taskId === "string" ? store.tasks.assertChat(args.taskId, chatSessionKey, false) : store.tasks.listCanvas(bound.canvasSessionId)[0] ?? null;
    return { boundCanvas: bound, task };
  }
  throw new Error("OPERATION_NOT_FOUND");
}

export function compatSubscribeCanvas(store: WorkspaceStore, principal: WorkspacePrincipal, args: Record<string, unknown>) {
  if (principal.kind !== "browser") throw new Error("BROWSER_PRINCIPAL_REQUIRED");
  const projectId = requiredString(args, "projectId");
  const canvasSessionId = requiredString(args, "canvasSessionId");
  const context = store.sessions.canvasContext(canvasSessionId);
  if (!context || context.projectId !== projectId) throw new Error("CANVAS_SESSION_NOT_FOUND");
  const session = store.browserSessions.get(principal.browserSessionId);
  const binding = session?.pairedChatSessionKey ? store.sessions.getBinding(session.pairedChatSessionKey) : null;
  if (!binding || binding.canvasSessionId !== canvasSessionId) throw new Error("CHAT_CANVAS_LEASE_STALE");
  const currentSequence = store.sessions.latestSequence(projectId);
  return { eventStreamUrl: `/events?projectId=${encodeURIComponent(projectId)}&canvasSessionId=${encodeURIComponent(canvasSessionId)}&after=${currentSequence}`, currentSequence };
}
