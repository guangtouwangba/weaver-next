import { canvasMutationRequestSchema, nodeContentSchema, type CanvasMutationRecord } from "@weaver/contracts";
import type { WorkspaceStore } from "@weaver/storage";
import type { WorkspacePrincipal } from "./catalog.js";

function requireBrowser(principal: WorkspacePrincipal) {
  if (principal.kind !== "browser") throw new Error("BROWSER_PRINCIPAL_REQUIRED");
  return principal.browserSessionId;
}

function createNodeOperation(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_CANVAS_OPERATION");
  const operation = value as Record<string, unknown>;
  const allowed = new Set(["action", "semanticType", "title", "content", "x", "y"]);
  if (Object.keys(operation).some((key) => !allowed.has(key)) || operation.action !== "create_node"
    || typeof operation.semanticType !== "string" || typeof operation.title !== "string") throw new Error("INVALID_CANVAS_OPERATION");
  return {
    action: "create_node" as const,
    semanticType: operation.semanticType,
    title: operation.title,
    content: nodeContentSchema.parse(operation.content),
    x: typeof operation.x === "number" ? operation.x : 0,
    y: typeof operation.y === "number" ? operation.y : 0,
  };
}

export function applyManualCanvasMutation(store: WorkspaceStore, principal: WorkspacePrincipal, raw: unknown) {
  const browserSessionId = requireBrowser(principal);
  const request = canvasMutationRequestSchema.parse(raw);
  const operation = createNodeOperation(request.operation);
  if (!request.viewId || request.baseGraphRevision === undefined || request.baseLayoutRevision === undefined) throw new Error("MUTATION_BASE_REVISION_REQUIRED");
  let stateResult: ReturnType<WorkspaceStore["graphChanges"]["createNode"]> | undefined;
  const record = store.canvasMutations.apply({ request, browserSessionId, createdAt: new Date().toISOString() }, () => {
    const graph = store.graphChanges.read(request.projectId);
    const layout = store.layoutReviews.get(request.projectId, request.viewId!);
    if (graph.revision !== request.baseGraphRevision) throw new Error("GRAPH_REVISION_CONFLICT");
    if (!layout || layout.layoutRevision !== request.baseLayoutRevision) throw new Error("LAYOUT_REVISION_CONFLICT");
    stateResult = store.graphChanges.createNode({
      projectId: request.projectId,
      viewId: request.viewId!,
      type: operation.semanticType,
      title: operation.title,
      content: operation.content,
      x: operation.x,
      y: operation.y,
    });
    return {
      kind: "mixed" as const,
      resultGraphRevision: stateResult.project!.graphRevision,
      resultLayoutRevision: stateResult.layout.layoutRevision,
      forwardOperations: [operation],
      inverseOperations: [{ action: "archive_node", nodeId: stateResult.node.id, removeFrame: true }],
    };
  });
  const result = stateResult ?? {
    project: store.catalog.getProject(request.projectId),
    layout: store.layoutReviews.get(request.projectId, request.viewId),
  };
  return { mutation: record, result };
}

export function undoManualCanvasMutation(store: WorkspaceStore, principal: WorkspacePrincipal, raw: unknown) {
  const browserSessionId = requireBrowser(principal);
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || typeof (raw as { mutationId?: unknown }).mutationId !== "string") throw new Error("INVALID_UNDO_REQUEST");
  const mutationId = (raw as { mutationId: string }).mutationId;
  const existing = store.canvasMutations.get(mutationId);
  if (!existing) throw new Error("CANVAS_MUTATION_NOT_FOUND");
  const graph = store.graphChanges.read(existing.projectId);
  const layout = existing.viewId ? store.layoutReviews.get(existing.projectId, existing.viewId) : null;
  const reverted = store.canvasMutations.revert({
    id: mutationId,
    browserSessionId,
    currentGraphRevision: graph.revision,
    currentLayoutRevision: layout?.layoutRevision,
    revertedAt: new Date().toISOString(),
  }, (record: CanvasMutationRecord) => {
    const inverse = record.inverseOperations[0] as { action?: string; nodeId?: string; removeFrame?: boolean } | undefined;
    if (inverse?.action !== "archive_node" || !inverse.nodeId) throw new Error("UNDO_OPERATION_UNSUPPORTED");
    const archived = store.graphChanges.archiveNode({ projectId: record.projectId, nodeId: inverse.nodeId, baseGraphRevision: graph.revision });
    if (layout && inverse.removeFrame) {
      const next = structuredClone(layout);
      delete next.nodes[inverse.nodeId];
      next.graphRevision = archived.project!.graphRevision;
      next.layoutRevision += 1;
      next.updatedAt = new Date().toISOString();
      store.layoutReviews.save(next, true, { operations: [{ type: "remove-node-frame", nodeId: inverse.nodeId }] });
    }
  });
  return { mutation: reverted, graph: store.graphChanges.read(existing.projectId), layout: existing.viewId ? store.layoutReviews.get(existing.projectId, existing.viewId) : undefined };
}
