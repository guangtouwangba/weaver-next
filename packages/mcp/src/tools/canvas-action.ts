import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { canvasActionSchema, canvasContextSnapshotSchema, layoutOperationSchema, nodeContentSchema } from "@weaver/contracts";
import { applyLayoutOperations } from "@weaver/core";
import { workspaceSchema } from "../shared/schemas.js";
import { defineTool, getWorkspaceStore, result, type MutateWithStore } from "../shared/tool-runtime.js";
import { chatSessionKeyFromRequest } from "../thread-context.js";
import { enrichPublicLink } from "../link-enrichment.js";

export function registerCanvasActionTool(server: McpServer, { mutateWithStore }: { mutateWithStore: MutateWithStore }) {
  const shape = {
    ...workspaceSchema.shape,
    action: z.enum(["claim", "sync", "switch", "create_node", "update_node", "archive_node", "attach_asset", "enrich_link", "link_nodes", "layout_operations", "revert_layout"]),
    snapshot: z.unknown().optional(), projectId: z.string().optional(), viewId: z.string().optional(), nodeId: z.string().optional(), sourceNodeId: z.string().optional(), targetNodeId: z.string().optional(), edgeType: z.string().optional(), directed: z.boolean().optional(), assetId: z.string().optional(), role: z.enum(["embedded", "cover"]).optional(),
    leaseId: z.string().optional(), bindingRevision: z.number().int().positive().optional(), baseGraphRevision: z.number().int().nonnegative().optional(), baseLayoutRevision: z.number().int().nonnegative().optional(),
    semanticType: z.string().optional(), title: z.string().optional(), content: z.unknown().optional(), x: z.number().optional(), y: z.number().optional(), operations: z.array(layoutOperationSchema).optional(),
  } as const;
  server.registerTool("weaver_canvas_action", {
    title: "Canvas Action", description: "Claim/sync/switch the exact Canvas or apply direct user editing and manual layout intents.", inputSchema: shape,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } },
  }, defineTool(async (args, extra) => {
    canvasActionSchema.parse(args);
    const chatSessionKey = chatSessionKeyFromRequest(extra);
    const required = <T>(value: T | undefined, name: string): T => { if (value === undefined || value === "") throw new Error(`INVALID_ARGS:${name} required`); return value; };
    if (args.action === "enrich_link") {
      const projectId = required(args.projectId, "projectId"); const nodeId = required(args.nodeId, "nodeId"); const baseGraphRevision = required(args.baseGraphRevision, "baseGraphRevision");
      const store = getWorkspaceStore(args.workspaceDir); const graph = store.graphChanges.read(projectId); if (graph.revision !== baseGraphRevision) throw new Error("GRAPH_REVISION_CONFLICT");
      const node = graph.nodes.find((candidate) => candidate.id === nodeId); if (!node || node.content.kind !== "link") throw new Error("NODE_NOT_FOUND");
      const enriched = await enrichPublicLink(node.content.url); let imageAssetId: string | undefined;
      if (enriched.image) imageAssetId = (await store.assets.importImage({ projectId, mimeType: enriched.image.mimeType, data: enriched.image.data })).asset.id;
      return result(store.graphChanges.updateNode({ projectId, nodeId, baseGraphRevision, title: enriched.title || node.title, content: { kind: "link", url: enriched.url, title: enriched.title || node.title, description: enriched.description, domain: enriched.domain, imageAssetId, enrichmentStatus: "ready" } }));
    }
    return result(mutateWithStore(args.workspaceDir, (store) => {
      if (args.action === "claim" || args.action === "sync") return store.sessions.syncCanvas(canvasContextSnapshotSchema.parse({ ...required(args.snapshot, "snapshot") as object, syncPurpose: args.action === "claim" ? "claim" : "state" }), chatSessionKey);
      if (args.action === "switch") return store.sessions.switchBinding({ chatSessionKey, leaseId: required(args.leaseId, "leaseId"), bindingRevision: required(args.bindingRevision, "bindingRevision"), projectId: required(args.projectId, "projectId"), viewId: required(args.viewId, "viewId") });
      const projectId = required(args.projectId, "projectId");
      if (args.action === "create_node") return store.graphChanges.createNode({ projectId, viewId: required(args.viewId, "viewId"), type: required(args.semanticType, "semanticType"), title: required(args.title, "title"), content: nodeContentSchema.parse(args.content), x: args.x ?? 0, y: args.y ?? 0 });
      if (args.action === "update_node") return store.graphChanges.updateNode({ projectId, nodeId: required(args.nodeId, "nodeId"), baseGraphRevision: required(args.baseGraphRevision, "baseGraphRevision"), title: args.title, type: args.semanticType, content: args.content ? nodeContentSchema.parse(args.content) : undefined });
      if (args.action === "archive_node") return store.graphChanges.archiveNode({ projectId, nodeId: required(args.nodeId, "nodeId"), baseGraphRevision: required(args.baseGraphRevision, "baseGraphRevision") });
      if (args.action === "link_nodes") return store.graphChanges.linkNodes({ projectId, sourceNodeId: required(args.sourceNodeId, "sourceNodeId"), targetNodeId: required(args.targetNodeId, "targetNodeId"), type: required(args.edgeType, "edgeType"), baseGraphRevision: required(args.baseGraphRevision, "baseGraphRevision"), directed: args.directed });
      if (args.action === "attach_asset") return store.graphChanges.attachAsset({ projectId, nodeId: required(args.nodeId, "nodeId"), assetId: required(args.assetId, "assetId"), role: required(args.role, "role"), baseGraphRevision: required(args.baseGraphRevision, "baseGraphRevision") });
      const viewId = required(args.viewId, "viewId");
      if (args.action === "revert_layout") return store.layoutReviews.revert(projectId, viewId);
      const current = store.layoutReviews.get(projectId, viewId); if (!current) throw new Error("LAYOUT_NOT_FOUND");
      if (current.layoutRevision !== required(args.baseLayoutRevision, "baseLayoutRevision")) throw new Error("LAYOUT_REVISION_CONFLICT");
      return store.layoutReviews.save(applyLayoutOperations(current, required(args.operations, "operations")), true, { operations: args.operations });
    }));
  }));
}
