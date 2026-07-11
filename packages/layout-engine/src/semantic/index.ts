import type { LayoutDocument, LayoutPlan, SpaceEdge, SpaceNode } from "@weaver/contracts";
import type { Box } from "./geometry.js";
import { normalizeConstraints } from "./constraints.js";
import { detectClusters } from "./detect.js";
import { applySizeHierarchy } from "./size.js";
import { layoutClusterLocal } from "./micro.js";
import { macroPlace } from "./macro.js";
import type { MacroVariant, MicroVariant } from "./types.js";

export type { MicroVariant, MacroVariant } from "./types.js";

/**
 * The semantic, hierarchy-aware cluster layout. Detects clusters (the analyst's
 * `properties.layer`, explicit group constraints, or topology), sizes hubs larger
 * than leaves, lays each cluster out locally (radial or rows), then packs the
 * clusters apart with a wide gutter — delivering the "信息分层 + 密度分散" the flat
 * grid lacks. Pure and deterministic; mutates `document` in place and returns the
 * node→cluster map for cluster-aware edge routing. Overlap-free by construction.
 */
export function semanticClusterLayout(params: {
  nodes: SpaceNode[];
  edges: SpaceEdge[];
  plan: LayoutPlan;
  document: LayoutDocument;
  current: LayoutDocument;
  spacing: number;
  seed: string;
  micro: MicroVariant;
  macro: MacroVariant;
}): { clusterOf: Map<string, string> } {
  const { nodes, edges, plan, document, current, spacing, seed, micro, macro } = params;
  const constraints = normalizeConstraints(plan, current);
  const clusters = detectClusters(nodes, edges, constraints, current);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  applySizeHierarchy(document, clusters, nodesById, plan.preserve.nodeSizes, constraints.fixedIds);

  const bboxes = new Map<string, Box>();
  for (const cluster of clusters) bboxes.set(cluster.id, layoutClusterLocal(cluster, document, spacing, micro));

  const clusterOf = new Map<string, string>();
  for (const cluster of clusters) for (const id of cluster.memberIds) clusterOf.set(id, cluster.id);

  macroPlace(document, clusters, bboxes, edges, clusterOf, constraints.fixedIds, current, spacing, macro, seed);
  return { clusterOf };
}
