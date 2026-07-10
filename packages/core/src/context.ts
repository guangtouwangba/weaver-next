import type { ScenePack, SpaceEdge, SpaceNode } from "@weaver/contracts";

export function resolveSceneContext(args: {
  nodes: SpaceNode[];
  edges: SpaceEdge[];
  scenePack: ScenePack;
  selectedNodeIds: string[];
  pinnedNodeIds: string[];
}): SpaceNode[] {
  const byId = new Map(args.nodes.filter((node) => !node.archived).map((node) => [node.id, node]));
  const included = new Set([...args.selectedNodeIds, ...args.pinnedNodeIds]);
  let frontier = [...args.selectedNodeIds];
  for (let hop = 0; hop < args.scenePack.contextPolicy.maxHops; hop += 1) {
    const next: string[] = [];
    for (const edge of args.edges) {
      if (edge.archived) continue;
      if (frontier.includes(edge.sourceNodeId) && !included.has(edge.targetNodeId)) next.push(edge.targetNodeId);
      if (frontier.includes(edge.targetNodeId) && !included.has(edge.sourceNodeId)) next.push(edge.sourceNodeId);
    }
    next.forEach((id) => included.add(id));
    frontier = next;
  }
  return [...included].map((id) => byId.get(id)).filter((node): node is SpaceNode => Boolean(node)).slice(0, args.scenePack.contextPolicy.maxNodes);
}
