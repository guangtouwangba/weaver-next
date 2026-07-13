import type { GraphEdge, GraphNode, Layout } from "../types";

export function buildWidgetBenchmarkScene(nodeCount = 500, edgeCount = 1000): { nodes: GraphNode[]; edges: GraphEdge[]; layoutNodes: Array<Layout["nodes"][string]> } {
  const timestamp = "2026-01-01T00:00:00.000Z";
  const columns = 25;
  const nodes: GraphNode[] = Array.from({ length: nodeCount }, (_, index) => ({
    id: `benchmark-node-${index}`,
    projectId: "benchmark",
    type: index % 5 === 0 ? "source" : "entity",
    title: `AI hardware node ${index}`,
    contentKind: "document",
    content: { kind: "document", mode: "note", excerpt: `Deterministic benchmark content ${index}`, embeddedAssetIds: [] },
    properties: { status: `Column ${index % 8}`, occurredAt: `2026-01-${String(index % 28 + 1).padStart(2, "0")}` },
    archived: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
  const edges: GraphEdge[] = Array.from({ length: edgeCount }, (_, index) => {
    const source = index % Math.max(1, nodeCount);
    let target = (index * 17 + 13) % Math.max(1, nodeCount);
    if (target === source) target = (target + 1) % Math.max(1, nodeCount);
    return { id: `benchmark-edge-${index}`, sourceNodeId: `benchmark-node-${source}`, targetNodeId: `benchmark-node-${target}`, type: index % 4 === 0 ? "depends-on" : "relates-to" };
  });
  const layoutNodes = nodes.map((node, index) => ({ nodeId: node.id, x: index % columns * 270, y: Math.floor(index / columns) * 160, width: 220, height: 112, pinned: false }));
  return { nodes, edges, layoutNodes };
}
