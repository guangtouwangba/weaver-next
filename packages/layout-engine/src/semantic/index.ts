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

const DEFAULT_FRAME = { x: 0, y: 0, width: 220, height: 112, rotation: 0, zIndex: 0, pinned: false, hidden: false, collapsed: false } as const;

/** A minimal cluster LayoutPlan for seeding a brand-new view: whole-view, no
 * constraints, no mental-map/manual-group inheritance (there is nothing to
 * inherit), size hierarchy enabled so hubs read larger. */
function seedPlan(document: LayoutDocument): LayoutPlan {
  return {
    projectId: document.projectId,
    viewId: document.viewId,
    baseGraphRevision: document.graphRevision,
    baseLayoutRevision: document.layoutRevision,
    scope: { type: "whole-view" },
    strategy: "cluster",
    direction: document.config.direction,
    constraints: [],
    preserve: { pinnedNodes: false, manualGroups: false, relativeOrder: false, mentalMapWeight: 0.6, nodeSizes: false },
    candidateCount: 3,
    rationale: "initial semantic seed",
  };
}

/** Cluster-aware edge routing mirroring the engine: intra-cluster beziers,
 * cross-cluster orthogonal links so inter-region edges read cleanly. */
function routeSeedEdges(document: LayoutDocument, edges: SpaceEdge[], clusterOf: Map<string, string>) {
  for (const edge of edges) {
    const source = document.nodes[edge.sourceNodeId];
    const target = document.nodes[edge.targetNodeId];
    if (!source || !target) continue;
    const a = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
    const b = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
    const cross = clusterOf.get(edge.sourceNodeId) !== clusterOf.get(edge.targetNodeId);
    document.edges[edge.id] = {
      edgeId: edge.id,
      routing: cross ? "orthogonal" : "bezier",
      waypoints: cross ? [a, { x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y }, b] : [a, b],
      hidden: false,
    };
  }
}

/** Recompute document.bounds over every node and cluster group box, so the
 * initial viewport frames the labeled regions and their whitespace. */
function updateSeedBounds(document: LayoutDocument) {
  const frames = [
    ...Object.values(document.nodes).filter((node) => !node.hidden),
    ...Object.values(document.groups),
  ];
  if (!frames.length) { document.bounds = { x: 0, y: 0, width: 0, height: 0 }; return; }
  const minX = Math.min(...frames.map((frame) => frame.x));
  const minY = Math.min(...frames.map((frame) => frame.y));
  const maxX = Math.max(...frames.map((frame) => frame.x + frame.width));
  const maxY = Math.max(...frames.map((frame) => frame.y + frame.height));
  document.bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Seed a fresh view's layout with the semantic cluster arrangement instead of a
 * flat grid — so the very first render already shows labeled regions, enlarged
 * hubs, and inter-cluster whitespace. Pure, synchronous, deterministic (seeded
 * by viewId), and elkjs-free (importable from storage without dragging in the
 * heavy engine). Mutates `document` in place: fills node frames + sizes, cluster
 * groups, cluster-aware edge routes, and bounds.
 */
export function seedSemanticLayout(params: {
  nodes: SpaceNode[];
  edges: SpaceEdge[];
  document: LayoutDocument;
  spacing?: number;
  micro?: MicroVariant;
  macro?: MacroVariant;
}): { clusterOf: Map<string, string>; groupCount: number } {
  const { nodes, edges, document } = params;
  const spacing = params.spacing ?? document.config.nodeSpacing;
  const micro = params.micro ?? "radial";
  const macro = params.macro ?? "force";
  for (const node of nodes) {
    if (!document.nodes[node.id]) document.nodes[node.id] = { nodeId: node.id, ...DEFAULT_FRAME };
  }
  // `document` doubles as `current`: normalizeConstraints/detectClusters only read
  // it (pinned/groupId), and both reads complete before any frame is mutated.
  const { clusterOf } = semanticClusterLayout({ nodes, edges, plan: seedPlan(document), document, current: document, spacing, seed: document.viewId, micro, macro });
  routeSeedEdges(document, edges, clusterOf);
  updateSeedBounds(document);
  return { clusterOf, groupCount: Object.keys(document.groups).length };
}

/** A cluster in a read-only preview: what the semantic layout *would* group,
 * without computing any coordinates. */
export interface ClusterPreview {
  id: string;
  label: string;
  memberCount: number;
  hubId?: string;
  isCenter?: boolean;
  hubProminent?: boolean;
}

/**
 * Read-only preview of the clusters the semantic layout would form for a graph,
 * used by the layout-advisor MCP tool. Runs only normalize + detect (no sizing,
 * no placement), mutates nothing, and is deterministic.
 */
export function previewClusters(params: { nodes: SpaceNode[]; edges: SpaceEdge[]; plan: LayoutPlan; current: LayoutDocument }): { clusters: ClusterPreview[]; centerId?: string } {
  const constraints = normalizeConstraints(params.plan, params.current);
  const clusters = detectClusters(params.nodes, params.edges, constraints, params.current);
  const center = clusters.find((cluster) => cluster.isCenter);
  return {
    clusters: clusters.map((cluster) => ({ id: cluster.id, label: cluster.label, memberCount: cluster.memberIds.length, hubId: cluster.hubId, isCenter: cluster.isCenter, hubProminent: cluster.hubProminent })),
    centerId: center?.memberIds[0],
  };
}
