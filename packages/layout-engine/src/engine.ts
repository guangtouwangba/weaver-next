import { createHash } from "node:crypto";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from "d3-force";
import ELK from "elkjs/lib/elk.bundled.js";
import type { LayoutCandidate, LayoutDocument, LayoutPlan, NodeLayout, SpaceEdge, SpaceNode } from "@weaver/contracts";
import { diffLayoutDocuments } from "@weaver/core";
import { scoreLayout } from "./score.js";
import { semanticClusterLayout, type MacroVariant, type MicroVariant } from "./semantic/index.js";

export interface LayoutInput {
  nodes: SpaceNode[];
  edges: SpaceEdge[];
  current: LayoutDocument;
  plan: LayoutPlan;
  layoutRunId?: string;
  /** Optional scene-pack scoringWeights, plumbed by the MCP layer so the score
   * reflects the pack's priorities (e.g. semanticDistance) instead of the defaults. */
  weights?: Record<string, number>;
}

const SEMANTIC_STRATEGIES = new Set(["cluster", "hybrid"]);
// Structurally distinct cluster candidates (not density clones): different micro
// (radial vs rows) AND macro (force vs grid) arrangements of the same clusters.
const CLUSTER_VARIANTS: Array<{ label: string; micro: MicroVariant; macro: MacroVariant; density: number }> = [
  { label: "语义聚类", micro: "radial", macro: "force", density: 1 },
  { label: "分区矩阵", micro: "rows", macro: "force", density: 1 },
  { label: "紧凑网格", micro: "rows", macro: "grid", density: 0.85 },
  { label: "语义聚类 · 宽松", micro: "radial", macro: "force", density: 1.3 },
  { label: "语义聚类 · 紧凑", micro: "radial", macro: "force", density: 0.75 },
];

function seededRandom(seed: string) {
  let state = Number.parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16) || 1;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0x100000000; };
}

function scopeIds(input: LayoutInput) {
  if (input.plan.scope.type === "whole-view") return new Set(input.nodes.map((node) => node.id));
  if (input.plan.scope.type === "selection") return new Set(input.plan.scope.nodeIds);
  const result = new Set(input.plan.scope.nodeIds);
  let frontier = [...result];
  for (let hop = 0; hop < input.plan.scope.hops; hop += 1) {
    const next: string[] = [];
    for (const edge of input.edges) {
      if (frontier.includes(edge.sourceNodeId)) next.push(edge.targetNodeId);
      if (frontier.includes(edge.targetNodeId)) next.push(edge.sourceNodeId);
    }
    next.forEach((id) => result.add(id));
    frontier = next;
  }
  return result;
}

function cloneDocument(input: LayoutInput): LayoutDocument {
  const document = structuredClone(input.current);
  document.strategy = input.plan.strategy;
  document.config.direction = input.plan.direction ?? document.config.direction;
  document.createdBy = "layout-engine";
  document.updatedAt = new Date().toISOString();
  for (const node of input.nodes) {
    if (!document.nodes[node.id]) document.nodes[node.id] = { nodeId: node.id, x: 0, y: 0, width: 220, height: 112, rotation: 0, zIndex: 0, pinned: false, hidden: false, collapsed: false };
  }
  return document;
}

function updateBounds(document: LayoutDocument) {
  const nodes = Object.values(document.nodes).filter((node) => !node.hidden);
  if (!nodes.length) { document.bounds = { x: 0, y: 0, width: 0, height: 0 }; return; }
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...nodes.map((node) => node.y + node.height));
  document.bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function routeEdges(document: LayoutDocument, edges: SpaceEdge[], orthogonal: boolean, clusterOf?: Map<string, string>) {
  for (const edge of edges) {
    const source = document.nodes[edge.sourceNodeId];
    const target = document.nodes[edge.targetNodeId];
    if (!source || !target) continue;
    const a = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
    const b = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
    // Cluster-aware routing: keep intra-cluster edges as short beziers, route
    // cross-cluster edges orthogonally so the inter-region links read cleanly.
    const crossCluster = clusterOf ? clusterOf.get(edge.sourceNodeId) !== clusterOf.get(edge.targetNodeId) : false;
    const useOrthogonal = clusterOf ? crossCluster : orthogonal;
    document.edges[edge.id] = {
      edgeId: edge.id,
      routing: useOrthogonal ? "orthogonal" : "bezier",
      waypoints: useOrthogonal ? [a, { x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y }, b] : [a, b],
      hidden: false,
    };
  }
}

async function elkLayout(input: LayoutInput, document: LayoutDocument, spacing: number) {
  const ids = scopeIds(input);
  const selected = input.nodes.filter((node) => ids.has(node.id) && !document.nodes[node.id].pinned);
  const elk = new (ELK as unknown as { new(): { layout(graph: unknown): Promise<any> } })();
  const direction = document.config.direction.includes("right") ? "LEFT" : document.config.direction.includes("left") ? "RIGHT" : document.config.direction.includes("bottom") ? "UP" : "DOWN";
  const graph = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.spacing.nodeNode": String(spacing),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(document.config.rankSpacing),
    },
    children: selected.map((node) => ({ id: node.id, width: document.nodes[node.id].width, height: document.nodes[node.id].height })),
    edges: input.edges.filter((edge) => ids.has(edge.sourceNodeId) && ids.has(edge.targetNodeId)).map((edge) => ({ id: edge.id, sources: [edge.sourceNodeId], targets: [edge.targetNodeId] })),
  });
  for (const node of graph.children ?? []) {
    const target = document.nodes[node.id];
    target.x = node.x ?? 0;
    target.y = node.y ?? 0;
  }
}

function gridLayout(input: LayoutInput, document: LayoutDocument, spacing: number) {
  const ids = scopeIds(input);
  const nodes = input.nodes.filter((node) => ids.has(node.id) && !document.nodes[node.id].pinned);
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  const rows = Math.ceil(nodes.length / columns);
  const columnWidths = Array.from({ length: columns }, (_, column) => Math.max(0, ...nodes.filter((_node, index) => index % columns === column).map((node) => document.nodes[node.id].width)));
  const rowHeights = Array.from({ length: rows }, (_, row) => Math.max(0, ...nodes.slice(row * columns, (row + 1) * columns).map((node) => document.nodes[node.id].height)));
  const columnOffsets = columnWidths.map((_width, column) => columnWidths.slice(0, column).reduce((sum, width) => sum + width + spacing, 0));
  const rowOffsets = rowHeights.map((_height, row) => rowHeights.slice(0, row).reduce((sum, height) => sum + height + spacing, 0));
  nodes.forEach((node, index) => {
    document.nodes[node.id].x = columnOffsets[index % columns];
    document.nodes[node.id].y = rowOffsets[Math.floor(index / columns)];
  });
}

function radialLayout(input: LayoutInput, document: LayoutDocument, spacing: number) {
  const ids = scopeIds(input);
  const nodes = input.nodes.filter((node) => ids.has(node.id) && !document.nodes[node.id].pinned);
  const center = nodes.find((node) => input.plan.constraints.some((constraint) => constraint.type === "emphasis" && constraint.nodeIds.includes(node.id))) ?? nodes[0];
  if (!center) return;
  document.nodes[center.id].x = 0;
  document.nodes[center.id].y = 0;
  const rest = nodes.filter((node) => node.id !== center.id);
  const radius = Math.max(260, rest.length * (38 + spacing / 4));
  rest.forEach((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(rest.length, 1) - Math.PI / 2;
    document.nodes[node.id].x = Math.cos(angle) * radius;
    document.nodes[node.id].y = Math.sin(angle) * radius;
  });
}

function forceLayout(input: LayoutInput, document: LayoutDocument, spacing: number, seed: string) {
  const ids = scopeIds(input);
  const graphNodes = input.nodes.filter((node) => ids.has(node.id)).map((node) => ({ id: node.id, x: document.nodes[node.id].x, y: document.nodes[node.id].y, fx: document.nodes[node.id].pinned ? document.nodes[node.id].x : undefined, fy: document.nodes[node.id].pinned ? document.nodes[node.id].y : undefined }));
  const links = input.edges.filter((edge) => ids.has(edge.sourceNodeId) && ids.has(edge.targetNodeId)).map((edge) => ({ source: edge.sourceNodeId, target: edge.targetNodeId }));
  const simulation = forceSimulation(graphNodes)
    .randomSource(seededRandom(seed))
    .force("link", forceLink(links).id((node: any) => node.id).distance(180 + spacing).strength(0.5))
    .force("charge", forceManyBody().strength(-520))
    .force("center", forceCenter(0, 0))
    .force("collide", forceCollide(145 + spacing / 2).strength(1))
    .stop();
  for (let tick = 0; tick < 360; tick += 1) simulation.tick();
  for (const node of graphNodes) { document.nodes[node.id].x = node.x ?? 0; document.nodes[node.id].y = node.y ?? 0; }
}

function restorePinned(before: LayoutDocument, after: LayoutDocument) {
  for (const [nodeId, node] of Object.entries(before.nodes)) {
    if (!node.pinned || !after.nodes[nodeId]) continue;
    after.nodes[nodeId].x = node.x;
    after.nodes[nodeId].y = node.y;
  }
}

export async function generateLayoutCandidates(input: LayoutInput): Promise<LayoutCandidate[]> {
  const count = input.plan.candidateCount;
  const candidates: LayoutCandidate[] = [];
  const labels = ["Balanced", "Preserve positions", "Compact", "Spacious", "Alternative"];
  const isSemantic = SEMANTIC_STRATEGIES.has(input.plan.strategy);
  for (let index = 0; index < count; index += 1) {
    const document = cloneDocument(input);
    const seed = `${input.plan.projectId}:${input.plan.viewId}:${input.layoutRunId ?? "standalone"}:${index}`;
    let clusterOf: Map<string, string> | undefined;
    let label: string;
    if (isSemantic) {
      const variant = CLUSTER_VARIANTS[index] ?? CLUSTER_VARIANTS[0];
      const spacing = document.config.nodeSpacing * variant.density;
      const scoped = scopeIds(input);
      const nodes = input.nodes.filter((node) => scoped.has(node.id));
      const edges = input.edges.filter((edge) => scoped.has(edge.sourceNodeId) && scoped.has(edge.targetNodeId));
      ({ clusterOf } = semanticClusterLayout({ nodes, edges, plan: input.plan, document, current: input.current, spacing, seed, micro: variant.micro, macro: variant.macro }));
      label = variant.label;
    } else {
      const density = index === 1 ? 1.25 : index === 2 ? 0.75 : 1;
      const spacing = document.config.nodeSpacing * density;
      if (["tree", "layered", "timeline", "swimlane"].includes(input.plan.strategy)) await elkLayout(input, document, spacing);
      else if (input.plan.strategy === "force") forceLayout(input, document, spacing, seed);
      else if (input.plan.strategy === "radial") radialLayout(input, document, spacing);
      else gridLayout(input, document, spacing);
      label = labels[index];
    }
    if (input.plan.preserve.pinnedNodes) restorePinned(input.current, document);
    routeEdges(document, input.edges, ["tree", "layered", "timeline", "swimlane"].includes(input.plan.strategy), clusterOf);
    updateBounds(document);
    const metrics = scoreLayout(document, input.edges, input.current, isSemantic ? { weights: input.weights, direction: input.plan.direction ?? document.config.direction } : undefined);
    const id = createHash("sha256").update(seed).digest("hex").slice(0, 24);
    candidates.push({ id, label, document, operations: diffLayoutDocuments(input.current, document), metrics });
  }
  // Semantic candidates keep their authored order so the recommended "语义聚类"
  // (spacious, hub-and-region) leads — the score's compactness term would otherwise
  // rank the tight grid first, which is exactly the dense look this layout replaces.
  // Applicable candidates (no hard violations) still float above violating ones.
  if (isSemantic) return candidates.sort((left, right) => Number(left.metrics.hardViolations.length > 0) - Number(right.metrics.hardViolations.length > 0));
  return candidates.sort((left, right) => right.metrics.score - left.metrics.score);
}
