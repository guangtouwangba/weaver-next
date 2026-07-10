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
  | { type: string; [key: string]: unknown };

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

export function applyLayoutOperations<T extends { layoutRevision: number; nodes: Record<string, any> }>(document: T, toRevision: number, operations: LayoutOperation[]): T {
  const next = structuredClone(document);
  for (const operation of operations) {
    const node = "nodeId" in operation ? next.nodes[operation.nodeId] : undefined;
    if (operation.type === "set-node-frame") next.nodes[operation.nodeId] = { ...(node ?? { nodeId: operation.nodeId, pinned: false }), ...operation.frame };
    else if (operation.type === "pin-node" && node) node.pinned = true;
    else if (operation.type === "unpin-node" && node) node.pinned = false;
    else if (operation.type === "set-node-visibility" && node) node.hidden = operation.hidden;
    else if (operation.type === "set-node-collapsed" && node) node.collapsed = operation.collapsed;
    else if (operation.type === "set-node-z-index" && node) node.zIndex = operation.zIndex;
  }
  next.layoutRevision = toRevision;
  return next;
}
