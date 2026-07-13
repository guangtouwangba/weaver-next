import { randomUUID } from "node:crypto";
import { canvasContextSnapshotSchema, nodeContentSchema, type CanvasMutationRequest } from "@weaver/contracts";
import { applyLayoutOperations } from "@weaver/core";
import type { WorkspaceStore } from "@weaver/storage";
import { applyManualCanvasMutation } from "./canvas.js";
import type { WorkspacePrincipal } from "./catalog.js";
import { enrichPublicLink } from "../link-enrichment.js";

function browser(store: WorkspaceStore, principal: WorkspacePrincipal) {
  if (principal.kind !== "browser") throw new Error("BROWSER_PRINCIPAL_REQUIRED");
  const session = store.browserSessions.get(principal.browserSessionId);
  if (!session) throw new Error("BROWSER_SESSION_NOT_FOUND");
  return session;
}

function required(args: Record<string, unknown>, key: string) {
  const value = args[key];
  if (typeof value !== "string" || !value) throw new Error(`INVALID_ARGS:${key} required`);
  return value;
}

function assertChatCanvasTarget(store: WorkspaceStore, chatSessionKey: string, args: Record<string, unknown>) {
  const action = required(args, "action");
  if (action === "claim" || action === "sync" || action === "switch") return;
  const { binding } = store.sessions.boundCanvas(chatSessionKey, true);
  const projectId = required(args, "projectId");
  if (binding.projectId !== projectId || (typeof args.viewId === "string" && binding.viewId !== args.viewId)) throw new Error("CHAT_CANVAS_TARGET_MISMATCH");
}

function mutationRequest(store: WorkspaceStore, browserSessionId: string, args: Record<string, unknown>, operation: Record<string, unknown>): CanvasMutationRequest {
  const projectId = required(args, "projectId");
  const lease = store.browserSessions.writer(projectId);
  if (!lease || lease.status !== "active" || lease.browserSessionId !== browserSessionId) throw new Error("PROJECT_WRITER_LEASE_STALE");
  const graph = store.graphChanges.read(projectId);
  const viewId = typeof args.viewId === "string" ? args.viewId : undefined;
  const layout = viewId ? store.layoutReviews.get(projectId, viewId) : null;
  return {
    mutationId: typeof args.mutationId === "string" ? args.mutationId : randomUUID(),
    projectId,
    viewId,
    writerLeaseRevision: lease.revision,
    baseGraphRevision: typeof args.baseGraphRevision === "number" ? args.baseGraphRevision : graph.revision,
    baseLayoutRevision: typeof args.baseLayoutRevision === "number" ? args.baseLayoutRevision : layout?.layoutRevision,
    operation,
  };
}

function chatCanvasAction(store: WorkspaceStore, chatSessionKey: string, args: Record<string, unknown>) {
  const action = required(args, "action");
  if (action === "claim" || action === "sync") {
    const requested = args.snapshot;
    if (!requested || typeof requested !== "object" || Array.isArray(requested)) throw new Error("INVALID_ARGS:snapshot required");
    return store.sessions.syncCanvas(canvasContextSnapshotSchema.parse({ ...requested, workspaceDir: store.workspaceDir, syncPurpose: action === "claim" ? "claim" : "state" }), chatSessionKey);
  }
  if (action === "switch") return store.sessions.switchBinding({
    chatSessionKey,
    leaseId: required(args, "leaseId"),
    bindingRevision: Number(args.bindingRevision),
    projectId: required(args, "projectId"),
    viewId: required(args, "viewId"),
  });
  const projectId = required(args, "projectId");
  if (action === "create_node") return store.graphChanges.createNode({ projectId, viewId: required(args, "viewId"), type: required(args, "semanticType"), title: required(args, "title"), content: nodeContentSchema.parse(args.content), x: typeof args.x === "number" ? args.x : 0, y: typeof args.y === "number" ? args.y : 0 });
  if (action === "update_node") return store.graphChanges.updateNode({ projectId, nodeId: required(args, "nodeId"), baseGraphRevision: Number(args.baseGraphRevision), title: typeof args.title === "string" ? args.title : undefined, type: typeof args.semanticType === "string" ? args.semanticType : undefined, content: args.content ? nodeContentSchema.parse(args.content) : undefined });
  if (action === "archive_node") return store.graphChanges.archiveNode({ projectId, nodeId: required(args, "nodeId"), baseGraphRevision: Number(args.baseGraphRevision) });
  if (action === "link_nodes") return store.graphChanges.linkNodes({ projectId, sourceNodeId: required(args, "sourceNodeId"), targetNodeId: required(args, "targetNodeId"), type: required(args, "edgeType"), baseGraphRevision: Number(args.baseGraphRevision), directed: typeof args.directed === "boolean" ? args.directed : undefined });
  if (action === "attach_asset") return store.graphChanges.attachAsset({ projectId, nodeId: required(args, "nodeId"), assetId: required(args, "assetId"), role: required(args, "role") as "embedded" | "cover", baseGraphRevision: Number(args.baseGraphRevision) });
  const viewId = required(args, "viewId");
  if (action === "revert_layout") return store.layoutReviews.revert(projectId, viewId);
  if (action === "layout_operations") {
    const current = store.layoutReviews.get(projectId, viewId);
    if (!current) throw new Error("LAYOUT_NOT_FOUND");
    if (current.layoutRevision !== Number(args.baseLayoutRevision)) throw new Error("LAYOUT_REVISION_CONFLICT");
    const operations = Array.isArray(args.operations) ? args.operations : [];
    return store.layoutReviews.save(applyLayoutOperations(current, operations as never[]), true, { operations });
  }
  throw new Error("OPERATION_NOT_FOUND");
}

async function prepareLinkEnrichment(store: WorkspaceStore, args: Record<string, unknown>) {
  const projectId = required(args, "projectId");
  const nodeId = required(args, "nodeId");
  const baseGraphRevision = Number(args.baseGraphRevision);
  const graph = store.graphChanges.read(projectId);
  if (graph.revision !== baseGraphRevision) throw new Error("GRAPH_REVISION_CONFLICT");
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node || node.content.kind !== "link") throw new Error("NODE_NOT_FOUND");
  const enriched = await enrichPublicLink(node.content.url);
  let imageAssetId: string | undefined;
  if (enriched.image) imageAssetId = (await store.assets.importImage({ projectId, mimeType: enriched.image.mimeType, data: enriched.image.data })).asset.id;
  return { projectId, nodeId, baseGraphRevision, before: node, title: enriched.title || node.title, content: { kind: "link" as const, url: enriched.url, title: enriched.title || node.title, description: enriched.description, domain: enriched.domain, imageAssetId, enrichmentStatus: "ready" as const } };
}

export async function compatCanvasAction(store: WorkspaceStore, principal: WorkspacePrincipal, args: Record<string, unknown>) {
  const action = required(args, "action");
  if (principal.kind === "chat") {
    assertChatCanvasTarget(store, principal.chatSessionKey, args);
    if (action === "enrich_link") {
      const prepared = await prepareLinkEnrichment(store, args);
      return store.graphChanges.updateNode({ projectId: prepared.projectId, nodeId: prepared.nodeId, baseGraphRevision: prepared.baseGraphRevision, title: prepared.title, content: prepared.content });
    }
    return chatCanvasAction(store, principal.chatSessionKey, args);
  }
  const session = browser(store, principal);
  if (action === "claim" || action === "sync") {
    const requested = args.snapshot as Record<string, unknown>;
    const projectId = required(requested, "projectId");
    const lease = store.browserSessions.writer(projectId);
    const ownsWriter = lease?.status === "active" && lease.browserSessionId === session.id;
    const snapshot = canvasContextSnapshotSchema.parse({
      ...requested,
      workspaceDir: store.workspaceDir,
      syncPurpose: action === "claim" ? "claim" : "state",
      agentEligible: ownsWriter && Boolean(session.pairedChatSessionKey),
      chatBinding: ownsWriter && session.pairedChatSessionKey ? requested.chatBinding : undefined,
    });
    const context = store.sessions.syncCanvas(snapshot, session.pairedChatSessionKey);
    return { context, manualWrite: lease?.status === "active" && lease.browserSessionId === session.id, writerLeaseRevision: lease?.revision };
  }
  if (action === "switch") {
    if (!session.pairedChatSessionKey) {
      const projectId = required(args, "projectId");
      const viewId = required(args, "viewId");
      const target = store.browserSessions.setTarget({ id: session.id, projectId, viewId, now: new Date().toISOString() });
      const lease = store.browserSessions.writer(projectId);
      if (!lease || lease.status !== "active") store.browserSessions.claimWriter({ projectId, browserSessionId: session.id, now: new Date().toISOString() });
      return { projectId: target.projectId, viewId: target.viewId };
    }
    const switched = store.sessions.switchBinding({
      chatSessionKey: session.pairedChatSessionKey,
      leaseId: required(args, "leaseId"),
      bindingRevision: Number(args.bindingRevision),
      projectId: required(args, "projectId"),
      viewId: required(args, "viewId"),
    });
    const lease = store.browserSessions.writer(switched.projectId!);
    if (!lease || lease.status !== "active") store.browserSessions.claimWriter({ projectId: switched.projectId!, browserSessionId: session.id, now: new Date().toISOString() });
    return switched;
  }
  const browserSessionId = session.id;
  const projectId = required(args, "projectId");
  if (action === "create_node") {
    const operation = { action, semanticType: required(args, "semanticType"), title: required(args, "title"), content: args.content, x: args.x, y: args.y };
    const request = mutationRequest(store, browserSessionId, args, operation);
    if (!request.viewId) throw new Error("INVALID_ARGS:viewId required");
    request.baseLayoutRevision ??= store.layoutReviews.get(projectId, request.viewId)?.layoutRevision;
    return applyManualCanvasMutation(store, principal, request).result;
  }
  if (action === "update_node") {
    const nodeId = required(args, "nodeId");
    const before = store.graphChanges.read(projectId).nodes.find((node) => node.id === nodeId);
    if (!before) throw new Error("NODE_NOT_FOUND");
    const operation = { action, nodeId, title: args.title, semanticType: args.semanticType, content: args.content };
    const request = mutationRequest(store, browserSessionId, args, operation);
    let result: ReturnType<WorkspaceStore["graphChanges"]["updateNode"]> | undefined;
    store.canvasMutations.apply({ request, browserSessionId, createdAt: new Date().toISOString() }, () => {
      result = store.graphChanges.updateNode({ projectId, nodeId, baseGraphRevision: request.baseGraphRevision!, title: typeof args.title === "string" ? args.title : undefined, type: typeof args.semanticType === "string" ? args.semanticType : undefined, content: args.content ? nodeContentSchema.parse(args.content) : undefined });
      return { kind: "graph", resultGraphRevision: result.project!.graphRevision, forwardOperations: [operation], inverseOperations: [{ action: "restore_node", node: before }] };
    });
    return result ?? { node: store.graphChanges.read(projectId).nodes.find((node) => node.id === nodeId), project: store.catalog.getProject(projectId) };
  }
  if (action === "link_nodes") {
    const operation = { action, sourceNodeId: required(args, "sourceNodeId"), targetNodeId: required(args, "targetNodeId"), edgeType: required(args, "edgeType"), directed: args.directed };
    const request = mutationRequest(store, browserSessionId, args, operation);
    let result: ReturnType<WorkspaceStore["graphChanges"]["linkNodes"]> | undefined;
    store.canvasMutations.apply({ request, browserSessionId, createdAt: new Date().toISOString() }, () => {
      result = store.graphChanges.linkNodes({ projectId, sourceNodeId: operation.sourceNodeId, targetNodeId: operation.targetNodeId, type: operation.edgeType, directed: typeof operation.directed === "boolean" ? operation.directed : undefined, baseGraphRevision: request.baseGraphRevision! });
      return { kind: "graph", resultGraphRevision: result.project!.graphRevision, forwardOperations: [operation], inverseOperations: [{ action: "archive_edge", edgeId: result.edge.id }] };
    });
    return result;
  }
  if (action === "archive_node") {
    const nodeId = required(args, "nodeId");
    const before = store.graphChanges.read(projectId);
    const request = mutationRequest(store, browserSessionId, args, { action, nodeId });
    let result: ReturnType<WorkspaceStore["graphChanges"]["archiveNode"]> | undefined;
    store.canvasMutations.apply({ request, browserSessionId, createdAt: new Date().toISOString() }, () => {
      result = store.graphChanges.archiveNode({ projectId, nodeId, baseGraphRevision: request.baseGraphRevision! });
      return { kind: "graph", resultGraphRevision: result.project!.graphRevision, forwardOperations: [{ action, nodeId }], inverseOperations: [{ action: "restore_graph", graph: before }] };
    });
    return result;
  }
  if (action === "attach_asset") {
    const before = store.graphChanges.read(projectId);
    const operation = { action, nodeId: required(args, "nodeId"), assetId: required(args, "assetId"), role: required(args, "role") };
    const request = mutationRequest(store, browserSessionId, args, operation);
    let result: ReturnType<WorkspaceStore["graphChanges"]["attachAsset"]> | undefined;
    store.canvasMutations.apply({ request, browserSessionId, createdAt: new Date().toISOString() }, () => {
      result = store.graphChanges.attachAsset({ projectId, nodeId: operation.nodeId, assetId: operation.assetId, role: operation.role as "embedded" | "cover", baseGraphRevision: request.baseGraphRevision! });
      return { kind: "graph", resultGraphRevision: result.project!.graphRevision, forwardOperations: [operation], inverseOperations: [{ action: "restore_graph", graph: before }] };
    });
    return result;
  }
  if (action === "enrich_link") {
    const request = mutationRequest(store, browserSessionId, args, { action, nodeId: required(args, "nodeId") });
    const prepared = await prepareLinkEnrichment(store, { ...args, baseGraphRevision: request.baseGraphRevision });
    let result: ReturnType<WorkspaceStore["graphChanges"]["updateNode"]> | undefined;
    store.canvasMutations.apply({ request, browserSessionId, createdAt: new Date().toISOString() }, () => {
      result = store.graphChanges.updateNode({ projectId, nodeId: prepared.nodeId, baseGraphRevision: request.baseGraphRevision!, title: prepared.title, content: prepared.content });
      return { kind: "graph", resultGraphRevision: result.project!.graphRevision, forwardOperations: [{ action, nodeId: prepared.before.id }], inverseOperations: [{ action: "restore_node", node: prepared.before }] };
    });
    return result;
  }
  if (action === "layout_operations") {
    const viewId = required(args, "viewId");
    const current = store.layoutReviews.get(projectId, viewId);
    if (!current) throw new Error("LAYOUT_NOT_FOUND");
    const operations = Array.isArray(args.operations) ? args.operations : [];
    const request = mutationRequest(store, browserSessionId, args, { action, operations });
    let result: ReturnType<WorkspaceStore["layoutReviews"]["save"]> | undefined;
    store.canvasMutations.apply({ request, browserSessionId, createdAt: new Date().toISOString() }, () => {
      if (current.layoutRevision !== request.baseLayoutRevision) throw new Error("LAYOUT_REVISION_CONFLICT");
      result = store.layoutReviews.save(applyLayoutOperations(current, operations as never[]), true, { operations });
      return { kind: "layout", resultLayoutRevision: result.layoutRevision, forwardOperations: operations, inverseOperations: [{ action: "restore_layout", layout: current }] };
    });
    return result ?? store.layoutReviews.get(projectId, viewId);
  }
  if (action === "revert_layout") {
    const viewId = required(args, "viewId");
    const current = store.layoutReviews.get(projectId, viewId);
    if (!current) throw new Error("LAYOUT_NOT_FOUND");
    const request = mutationRequest(store, browserSessionId, args, { action });
    let result: ReturnType<WorkspaceStore["layoutReviews"]["revert"]> | undefined;
    store.canvasMutations.apply({ request, browserSessionId, createdAt: new Date().toISOString() }, () => {
      result = store.layoutReviews.revert(projectId, viewId);
      return { kind: "layout", resultLayoutRevision: result.layoutRevision, forwardOperations: [{ action }], inverseOperations: [{ action: "restore_layout", layout: current }] };
    });
    return result;
  }
  throw new Error("OPERATION_NOT_FOUND");
}
