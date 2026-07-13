import { canvasMutationRequestSchema, edgeSchema, layoutDocumentSchema, nodeContentSchema, nodeSchema, projectViewSchema, type CanvasMutationRecord } from "@weaver/contracts";
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
  const project = store.catalog.getProject(existing.projectId);
  if (!project) throw new Error("PROJECT_NOT_FOUND");
  const reverted = store.canvasMutations.revert({
    id: mutationId,
    browserSessionId,
    currentGraphRevision: graph.revision,
    currentLayoutRevision: layout?.layoutRevision,
    currentViewCatalogRevision: project.viewCatalogRevision,
    revertedAt: new Date().toISOString(),
  }, (record: CanvasMutationRecord) => {
    for (const rawInverse of record.inverseOperations) {
      if (!rawInverse || typeof rawInverse !== "object" || Array.isArray(rawInverse)) throw new Error("UNDO_OPERATION_UNSUPPORTED");
      const inverse = rawInverse as Record<string, unknown>;
      const action = inverse.action;
      if (action === "archive_node" && typeof inverse.nodeId === "string") {
        const current = store.graphChanges.read(record.projectId);
        const archived = store.graphChanges.archiveNode({ projectId: record.projectId, nodeId: inverse.nodeId, baseGraphRevision: current.revision });
        const currentLayout = record.viewId ? store.layoutReviews.get(record.projectId, record.viewId) : null;
        if (currentLayout && inverse.removeFrame === true) {
          const next = structuredClone(currentLayout);
          delete next.nodes[inverse.nodeId];
          next.graphRevision = archived.project!.graphRevision;
          next.layoutRevision += 1;
          next.updatedAt = new Date().toISOString();
          store.layoutReviews.save(next, true, { operations: [{ type: "remove-node-frame", nodeId: inverse.nodeId }] });
        }
        continue;
      }
      if (action === "restore_node") {
        const node = nodeSchema.parse(inverse.node);
        const current = store.graphChanges.read(record.projectId);
        if (!current.nodes.some((candidate) => candidate.id === node.id)) throw new Error("UNDO_TARGET_MISSING");
        store.graphChanges.replace({ ...current, revision: current.revision + 1, nodes: current.nodes.map((candidate) => candidate.id === node.id ? node : candidate) });
        continue;
      }
      if (action === "archive_edge" && typeof inverse.edgeId === "string") {
        const current = store.graphChanges.read(record.projectId);
        const edge = current.edges.find((candidate) => candidate.id === inverse.edgeId);
        if (!edge) throw new Error("UNDO_TARGET_MISSING");
        store.graphChanges.replace({ ...current, revision: current.revision + 1, edges: current.edges.map((candidate) => candidate.id === inverse.edgeId ? edgeSchema.parse({ ...candidate, archived: true, updatedAt: new Date().toISOString() }) : candidate) });
        continue;
      }
      if (action === "restore_graph") {
        const snapshot = inverse.graph as Record<string, unknown> | undefined;
        if (!snapshot || snapshot.projectId !== record.projectId || !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.edges)) throw new Error("UNDO_OPERATION_INVALID");
        const current = store.graphChanges.read(record.projectId);
        store.graphChanges.replace({ projectId: record.projectId, revision: current.revision + 1, nodes: snapshot.nodes.map((node) => nodeSchema.parse(node)), edges: snapshot.edges.map((edge) => edgeSchema.parse(edge)) });
        continue;
      }
      if (action === "restore_layout") {
        const previous = layoutDocumentSchema.parse(inverse.layout);
        const current = store.layoutReviews.get(record.projectId, previous.viewId);
        if (!current) throw new Error("LAYOUT_NOT_FOUND");
        store.layoutReviews.save({ ...previous, graphRevision: store.graphChanges.read(record.projectId).revision, layoutRevision: current.layoutRevision + 1, updatedAt: new Date().toISOString() }, true, { operations: [{ type: "restore-layout" }] });
        continue;
      }
      if (action === "restore_view_catalog" && typeof inverse.defaultViewId === "string" && Array.isArray(inverse.views) && Array.isArray(inverse.layouts)) {
        store.catalog.restoreSnapshot({
          projectId: record.projectId,
          defaultViewId: inverse.defaultViewId,
          views: inverse.views.map((view) => projectViewSchema.parse(view)),
          layouts: inverse.layouts.map((candidate) => layoutDocumentSchema.parse(candidate)),
        });
        continue;
      }
      if (action === "delete_asset" && typeof inverse.assetId === "string") {
        store.assets.deleteUnreferenced(inverse.assetId);
        continue;
      }
      if (action === "delete_pristine_project" && typeof inverse.mutationId === "string") {
        store.catalog.deletePristineProject({ projectId: record.projectId, creationMutationId: inverse.mutationId });
        store.browserSessions.setTarget({ id: browserSessionId, now: new Date().toISOString() });
        continue;
      }
      throw new Error("UNDO_OPERATION_UNSUPPORTED");
    }
  });
  const remainingProject = store.catalog.getProject(existing.projectId);
  return { mutation: reverted, graph: remainingProject ? store.graphChanges.read(existing.projectId) : undefined, layout: remainingProject && existing.viewId ? store.layoutReviews.get(existing.projectId, existing.viewId) : undefined };
}
