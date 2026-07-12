import type { ScenePack, SpaceEdge, SpaceNode } from "@weaver/contracts";

export type SceneContextResult = {
  nodes: SpaceNode[];
  nodeIds: string[];
  truncated: boolean;
  excludedArchivedNodeIds: string[];
  modesApplied: ScenePack["contextPolicy"]["modes"];
  diagnostics: { requestedNodeCount: number; includedNodeCount: number; omittedNodeIds: string[]; maxNodes: number; maxHops: number };
};

export function resolveSceneContext(args: {
  nodes: SpaceNode[];
  edges: SpaceEdge[];
  scenePack: ScenePack;
  selectedNodeIds: string[];
  pinnedNodeIds: string[];
}): SceneContextResult {
  const allowedNodeTypes = new Set(args.scenePack.nodeTypes.map((item) => item.key));
  const allowedEdgeTypes = new Set(args.scenePack.edgeTypes.map((item) => item.key));
  const activeNodes = args.nodes.filter((node) => !node.archived && allowedNodeTypes.has(node.type));
  const byId = new Map(activeNodes.map((node) => [node.id, node]));
  const excludedArchivedNodeIds = args.nodes.filter((node) => node.archived).map((node) => node.id).sort();
  const edges = args.edges.filter((edge) => !edge.archived && allowedEdgeTypes.has(edge.type) && byId.has(edge.sourceNodeId) && byId.has(edge.targetNodeId));
  const ordered: string[] = [];
  const included = new Set<string>();
  const add = (id: string) => { if (byId.has(id) && !included.has(id)) { included.add(id); ordered.push(id); } };
  const selected = [...new Set(args.selectedNodeIds)].filter((id) => byId.has(id));

  if (args.scenePack.contextPolicy.modes.includes("selected_nodes")) selected.forEach(add);
  if (args.scenePack.contextPolicy.modes.includes("pinned_nodes")) [...new Set(args.pinnedNodeIds)].sort().forEach(add);

  if (args.scenePack.contextPolicy.modes.includes("ancestor_path")) {
    let frontier = [...selected].sort();
    const visited = new Set(frontier);
    while (frontier.length) {
      const next: string[] = [];
      for (const nodeId of frontier) {
        for (const edge of edges) {
          const ancestor = edge.targetNodeId === nodeId ? edge.sourceNodeId : !edge.directed && edge.sourceNodeId === nodeId ? edge.targetNodeId : undefined;
          if (ancestor && !visited.has(ancestor)) { visited.add(ancestor); next.push(ancestor); }
        }
      }
      frontier = [...new Set(next)].sort(); frontier.forEach(add);
    }
  }

  if (args.scenePack.contextPolicy.modes.includes("typed_neighborhood")) {
    let frontier = [...selected].sort();
    const visited = new Set(frontier);
    for (let hop = 0; hop < args.scenePack.contextPolicy.maxHops; hop += 1) {
      const next: string[] = [];
      for (const edge of edges) {
        const sourceActive = frontier.includes(edge.sourceNodeId);
        const targetActive = frontier.includes(edge.targetNodeId);
        if (sourceActive && !visited.has(edge.targetNodeId)) next.push(edge.targetNodeId);
        if (targetActive && !visited.has(edge.sourceNodeId)) next.push(edge.sourceNodeId);
      }
      frontier = [...new Set(next)].sort();
      frontier.forEach((id) => { visited.add(id); add(id); });
    }
  }

  const maxNodes = args.scenePack.contextPolicy.maxNodes;
  const nodeIds = ordered.slice(0, maxNodes);
  return { nodes: nodeIds.map((id) => byId.get(id)!), nodeIds, truncated: ordered.length > maxNodes, excludedArchivedNodeIds, modesApplied: args.scenePack.contextPolicy.modes, diagnostics: { requestedNodeCount: ordered.length, includedNodeCount: nodeIds.length, omittedNodeIds: ordered.slice(maxNodes), maxNodes, maxHops: args.scenePack.contextPolicy.maxHops } };
}
