export type GraphDelta<Node, Edge> = {
  fromRevision: number;
  toRevision: number;
  addedNodes: Node[];
  updatedNodes: Node[];
  archivedNodeIds: string[];
  addedEdges: Edge[];
  updatedEdges: Edge[];
  archivedEdgeIds: string[];
};

export type LayoutOperation =
  | { type: "set-node-frame"; nodeId: string; frame: { x: number; y: number; width: number; height: number } }
  | { type: "pin-node" | "unpin-node"; nodeId: string }
  | { type: "set-node-visibility"; nodeId: string; hidden: boolean }
  | { type: "set-node-collapsed"; nodeId: string; collapsed: boolean }
  | { type: "set-node-z-index"; nodeId: string; zIndex: number }
  | { type: "set-view-name"; viewName: string }
  | { type: "set-view-projection"; projection: unknown }
  | { type: "set-view-theme"; theme: unknown }
  | { type: string; [key: string]: unknown };

type NodeFrame = { x: number; y: number; width: number; height: number };

export function resolveEdgeHandles(source?: NodeFrame, target?: NodeFrame) {
  if (!source || !target) return { sourceHandle: "source-right", targetHandle: "target-left" };
  const dx = target.x + target.width / 2 - (source.x + source.width / 2);
  const dy = target.y + target.height / 2 - (source.y + source.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0
    ? { sourceHandle: "source-right", targetHandle: "target-left" }
    : { sourceHandle: "source-left", targetHandle: "target-right" };
  return dy >= 0
    ? { sourceHandle: "source-bottom", targetHandle: "target-top" }
    : { sourceHandle: "source-top", targetHandle: "target-bottom" };
}

export function applyGraphDelta<Node extends { id: string }, Edge extends { id: string }>(
  nodes: Node[],
  edges: Edge[],
  delta: GraphDelta<Node, Edge>,
  protectedNodeIds = new Set<string>(),
) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  for (const node of delta.addedNodes) nodeMap.set(node.id, node);
  for (const node of delta.updatedNodes) if (!protectedNodeIds.has(node.id)) nodeMap.set(node.id, node);
  for (const id of delta.archivedNodeIds) if (!protectedNodeIds.has(id)) nodeMap.delete(id);
  const edgeMap = new Map(edges.map((edge) => [edge.id, edge]));
  for (const edge of [...delta.addedEdges, ...delta.updatedEdges]) edgeMap.set(edge.id, edge);
  for (const id of delta.archivedEdgeIds) edgeMap.delete(id);
  return { nodes: [...nodeMap.values()], edges: [...edgeMap.values()] };
}

type MutableLayoutNode = { pinned?: boolean; hidden?: boolean; collapsed?: boolean; zIndex?: number; [key: string]: unknown };
export function applyLayoutOperations<T extends { layoutRevision: number; nodes: Record<string, MutableLayoutNode> }>(document: T, toRevision: number, operations: LayoutOperation[]): T {
  const next = structuredClone(document);
  for (const operation of operations) {
    const nodeId = "nodeId" in operation ? (operation.nodeId as string) : undefined;
    const node = nodeId ? next.nodes[nodeId] : undefined;
    if (operation.type === "set-node-frame" && nodeId) next.nodes[nodeId] = { ...(node ?? { nodeId, pinned: false }), ...(operation.frame as Record<string, unknown>) };
    else if (operation.type === "pin-node" && node) node.pinned = true;
    else if (operation.type === "unpin-node" && node) node.pinned = false;
    else if (operation.type === "set-node-visibility" && node) node.hidden = Boolean(operation.hidden);
    else if (operation.type === "set-node-collapsed" && node) node.collapsed = Boolean(operation.collapsed);
    else if (operation.type === "set-node-z-index" && node) node.zIndex = Number(operation.zIndex);
    else if (operation.type === "set-view-name") Object.assign(next, { viewName: operation.viewName });
    else if (operation.type === "set-view-projection") Object.assign(next, { projection: operation.projection });
    else if (operation.type === "set-view-theme") Object.assign(next, { theme: operation.theme });
  }
  next.layoutRevision = toRevision;
  return next;
}

export type ViewCatalogItem = {
  id: string;
  name: string;
  status: "active" | "trashed" | string;
  pinned: boolean;
  pinnedOrder?: number;
  lastOpenedAt: string;
  templateRef?: { id: string; version: string };
};

export function selectSwitcherViews<T extends ViewCatalogItem>(views: T[], currentViewId: string) {
  const active = views.filter((view) => view.status === "active");
  const pinned = active.filter((view) => view.pinned).sort((left, right) => (left.pinnedOrder ?? Number.MAX_SAFE_INTEGER) - (right.pinnedOrder ?? Number.MAX_SAFE_INTEGER));
  const current = active.find((view) => view.id === currentViewId);
  return current && !current.pinned ? [...pinned, current] : pinned;
}

export function applyViewCatalogDelta<T extends ViewCatalogItem>(
  current: { revision: number; views: T[]; defaultViewId: string },
  delta: { fromRevision: number; toRevision: number; upsertedViews: T[]; removedViewIds: string[]; defaultViewId?: string },
) {
  if (delta.fromRevision !== current.revision) throw new Error("VIEW_CATALOG_EVENT_GAP");
  const views = new Map(current.views.map((view) => [view.id, view]));
  for (const view of delta.upsertedViews) views.set(view.id, { ...views.get(view.id), ...view });
  for (const viewId of delta.removedViewIds) views.delete(viewId);
  return { revision: delta.toRevision, views: [...views.values()], defaultViewId: delta.defaultViewId ?? current.defaultViewId };
}

export function findTemplateInstances<T extends ViewCatalogItem>(views: T[], templateId: string) {
  return views.filter((view) => view.status === "active" && view.templateRef?.id === templateId).sort((left, right) => Date.parse(right.lastOpenedAt) - Date.parse(left.lastOpenedAt));
}
