import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { nodeContentSchema, type NodeContent, type ScenePack } from "@weaver/contracts";
import { getScenePack } from "@weaver/scene-packs";
import { WorkspaceStore } from "@weaver/storage";
import { projectSchema } from "../shared/schemas.js";
import { defineTool, failure, result, withStore } from "../shared/tool-runtime.js";
import { enrichPublicLink } from "../link-enrichment.js";

function assertSceneContent(scene: ScenePack, semanticType: string, contentKind: NodeContent["kind"]) {
  const definition = scene.nodeTypes.find((candidate) => candidate.key === semanticType);
  if (!definition) throw new Error(`NODE_TYPE_NOT_ALLOWED:${semanticType}`);
  if (!definition.allowedContentKinds.includes(contentKind)) throw new Error(`CONTENT_KIND_NOT_ALLOWED:${contentKind}`);
}

/** Content node mutation: widget-only create/update of nodes, asset attachment, and link enrichment. */
export function registerContentTools(server: McpServer) {
  server.registerTool("weaver_create_content_node", {
    title: "Create Content Node", description: "Widget-only creation of a document, image or link node at an explicit position in the active view. Increments graphRevision and only that view's layoutRevision.",
    inputSchema: { ...projectSchema.shape, viewId: z.string().min(1), semanticType: z.string().min(1), title: z.string(), content: nodeContentSchema, x: z.number(), y: z.number() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } },
  }, defineTool(async ({ workspaceDir, projectId, viewId, semanticType, title, content, x, y }) => { const output = withStore(workspaceDir, (store) => { const project = store.getProject(projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); const scene = getScenePack(project.scenePackId, project.scenePackVersion); if (!scene) throw new Error("SCENE_PACK_NOT_FOUND"); assertSceneContent(scene, semanticType, content.kind); if (content.kind === "link" && !["http:", "https:"].includes(new URL(content.url).protocol)) throw new Error("LINK_PROTOCOL_BLOCKED"); return store.createContentNode({ projectId, viewId, type: semanticType, title, content, x, y }); }); return result(output, `Created ${content.kind} node.`); }));

  server.registerTool("weaver_update_node_content", {
    title: "Update Node Content", description: "Widget-only revision-checked update of node title, semantic type or full content. Returns GRAPH_REVISION_CONFLICT instead of overwriting newer work.",
    inputSchema: { ...projectSchema.shape, nodeId: z.string().min(1), baseGraphRevision: z.number().int().nonnegative(), title: z.string().optional(), semanticType: z.string().min(1).optional(), content: nodeContentSchema.optional() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } },
  }, defineTool(async ({ workspaceDir, projectId, nodeId, baseGraphRevision, title, semanticType, content }) => { const output = withStore(workspaceDir, (store) => { const project = store.getProject(projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); const scene = getScenePack(project.scenePackId, project.scenePackVersion); if (!scene) throw new Error("SCENE_PACK_NOT_FOUND"); const current = store.getGraph(projectId).nodes.find((node) => node.id === nodeId); if (!current) throw new Error("NODE_NOT_FOUND"); assertSceneContent(scene, semanticType ?? current.type, content?.kind ?? current.content.kind); return store.updateNodeContent({ projectId, nodeId, baseGraphRevision, title, type: semanticType, content }); }); return result(output, "Saved node content."); }));

  server.registerTool("weaver_archive_node", {
    title: "Archive Node", description: "Widget-only revision-checked soft-delete of a node and its connected edges. Increments graphRevision. Returns GRAPH_REVISION_CONFLICT instead of racing newer work.",
    inputSchema: { ...projectSchema.shape, nodeId: z.string().min(1), baseGraphRevision: z.number().int().nonnegative() }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } },
  }, defineTool(async ({ workspaceDir, projectId, nodeId, baseGraphRevision }) => result(withStore(workspaceDir, (store) => { const project = store.getProject(projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); if (!store.getGraph(projectId).nodes.some((node) => node.id === nodeId)) throw new Error("NODE_NOT_FOUND"); return store.archiveNode({ projectId, nodeId, baseGraphRevision }); }), "Archived node.")));

  server.registerTool("weaver_attach_asset", {
    title: "Attach Image Asset", description: "Widget-only attachment of a validated project image as an article cover or embedded media reference.",
    inputSchema: { ...projectSchema.shape, nodeId: z.string().min(1), assetId: z.string().min(1), role: z.enum(["embedded", "cover"]), baseGraphRevision: z.number().int().nonnegative() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } },
  }, defineTool(async ({ workspaceDir, projectId, nodeId, assetId, role, baseGraphRevision }) => result(withStore(workspaceDir, (store) => store.attachAsset({ projectId, nodeId, assetId, role, baseGraphRevision })), "Attached image asset.")));

  // Manually manages its own WorkspaceStore lifecycle instead of the shared withStore/mutateWithStore
  // helpers — preserved exactly as in the original file, not "fixed" here.
  server.registerTool("weaver_enrich_link", {
    title: "Enrich Link Preview", description: "Widget-only fetch of a public HTTP/HTTPS page's title, description and optional cover. Blocks local/private hosts, limits redirects, response size and timeout, and never extracts full page text.",
    inputSchema: { ...projectSchema.shape, nodeId: z.string().min(1), baseGraphRevision: z.number().int().nonnegative() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, _meta: { ui: { visibility: ["app"] } },
  }, async ({ workspaceDir, projectId, nodeId, baseGraphRevision }) => { const store = new WorkspaceStore(workspaceDir); try { const graph = store.getGraph(projectId); if (graph.revision !== baseGraphRevision) throw new Error("GRAPH_REVISION_CONFLICT"); const node = graph.nodes.find((candidate) => candidate.id === nodeId); if (!node || node.content.kind !== "link") throw new Error("LINK_NODE_NOT_FOUND"); try { const enriched = await enrichPublicLink(node.content.url); let imageAssetId: string | undefined; if (enriched.image) imageAssetId = (await store.importImageAsset({ projectId, mimeType: enriched.image.mimeType, data: enriched.image.data })).asset.id; const content = { kind: "link" as const, url: enriched.url, title: enriched.title || node.title, description: enriched.description, domain: enriched.domain, imageAssetId, enrichmentStatus: "ready" as const }; return result(store.updateNodeContent({ projectId, nodeId, baseGraphRevision, title: content.title, content }), "Enriched link preview."); } catch (error) { const failedContent = { ...node.content, enrichmentStatus: "failed" as const }; store.updateNodeContent({ projectId, nodeId, baseGraphRevision, content: failedContent }); throw error; } } catch (error) { return failure(error); } finally { store.close(); } });
}
