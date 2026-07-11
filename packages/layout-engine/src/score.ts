import type { LayoutDirection, LayoutDocument, LayoutMetrics, SpaceEdge } from "@weaver/contracts";

function overlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

function orientation(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) {
  return Math.sign((b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y));
}

function intersects(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }) {
  return orientation(a, b, c) !== orientation(a, b, d) && orientation(c, d, a) !== orientation(c, d, b);
}

// Multipliers chosen so the DEFAULT weights below exactly reproduce the original
// hardcoded score (`overlap·500, crossings·18, displacement·0.01, compactness·80`),
// making weight-plumbing a zero-behavior-change migration when no scene-pack
// weights and no groups are present.
const OVERLAP_MULT = 50;
const CROSSINGS_MULT = 4.5;
const DISPLACEMENT_MULT = 0.005;
const COMPACTNESS_MULT = 80;
const EDGE_LENGTH_MULT = 0.002;
const CLUSTER_SEP_MULT = 40;
const DIRECTION_MULT = 20;
const DEFAULT_WEIGHTS = { overlap: 10, crossings: 4, displacement: 2, compactness: 1 } as const;

const INTER_GAP_TARGET = 180; // matches macro's 2.5 × default nodeSpacing (72)

/** Minimum gap between any two group boxes, normalized to [0,1] against the target
 * gutter — the whitespace/de-clustering payoff surfaced as a metric. 0 when <2 groups. */
function clusterSeparation(document: LayoutDocument): number {
  const groups = Object.values(document.groups);
  if (groups.length < 2) return 0;
  let minGap = Infinity;
  for (let i = 0; i < groups.length; i += 1) {
    for (let j = i + 1; j < groups.length; j += 1) {
      const a = groups[i]; const b = groups[j];
      const gapX = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width));
      const gapY = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height));
      const gap = Math.max(gapX, gapY); // separated on at least one axis when ≥ 0
      minGap = Math.min(minGap, gap);
    }
  }
  if (!Number.isFinite(minGap)) return 0;
  return Math.max(0, Math.min(1, minGap / INTER_GAP_TARGET));
}

const DIRECTION_AXIS: Record<LayoutDirection, { axis: "x" | "y"; sign: number }> = {
  "left-right": { axis: "x", sign: 1 },
  "right-left": { axis: "x", sign: -1 },
  "top-bottom": { axis: "y", sign: 1 },
  "bottom-top": { axis: "y", sign: -1 },
};

/** Fraction of directed edges whose target sits downstream of its source along the
 * requested flow direction (0..1). 0 when no direction is supplied. */
function directionFlow(document: LayoutDocument, edges: SpaceEdge[], direction?: LayoutDirection): number {
  if (!direction) return 0;
  const { axis, sign } = DIRECTION_AXIS[direction];
  const directed = edges.filter((edge) => !edge.archived && edge.directed);
  if (!directed.length) return 0;
  let aligned = 0;
  for (const edge of directed) {
    const source = document.nodes[edge.sourceNodeId];
    const target = document.nodes[edge.targetNodeId];
    if (!source || !target) continue;
    const delta = axis === "x" ? (target.x - source.x) : (target.y - source.y);
    if (delta * sign > 0) aligned += 1;
  }
  return aligned / directed.length;
}

export interface ScoreOptions { weights?: Record<string, number>; direction?: LayoutDirection }

export function scoreLayout(document: LayoutDocument, edges: SpaceEdge[], previous?: LayoutDocument, options: ScoreOptions = {}): LayoutMetrics {
  const weights: Record<string, number> = { ...DEFAULT_WEIGHTS, ...options.weights };
  const nodes = Object.values(document.nodes).filter((node) => !node.hidden);
  let overlapCount = 0;
  let overlapArea = 0;
  let pinnedNodeMoves = 0;
  let displacement = 0;
  for (let index = 0; index < nodes.length; index += 1) {
    for (let other = index + 1; other < nodes.length; other += 1) {
      const area = overlap(nodes[index], nodes[other]);
      if (area > 0) { overlapCount += 1; overlapArea += area; }
    }
    const before = previous?.nodes[nodes[index].nodeId];
    if (before) {
      const distance = Math.hypot(nodes[index].x - before.x, nodes[index].y - before.y);
      displacement += distance;
      if (before.pinned && distance > 0.01) pinnedNodeMoves += 1;
    }
  }

  const segments = edges.filter((edge) => !edge.archived).map((edge) => {
    const source = document.nodes[edge.sourceNodeId];
    const target = document.nodes[edge.targetNodeId];
    if (!source || !target) return null;
    return {
      edge,
      a: { x: source.x + source.width / 2, y: source.y + source.height / 2 },
      b: { x: target.x + target.width / 2, y: target.y + target.height / 2 },
    };
  }).filter((item): item is NonNullable<typeof item> => Boolean(item));
  let edgeCrossings = 0;
  let edgeLength = 0;
  for (let index = 0; index < segments.length; index += 1) {
    edgeLength += Math.hypot(segments[index].a.x - segments[index].b.x, segments[index].a.y - segments[index].b.y);
    for (let other = index + 1; other < segments.length; other += 1) {
      const left = segments[index].edge;
      const right = segments[other].edge;
      if ([left.sourceNodeId, left.targetNodeId].some((id) => id === right.sourceNodeId || id === right.targetNodeId)) continue;
      if (intersects(segments[index].a, segments[index].b, segments[other].a, segments[other].b)) edgeCrossings += 1;
    }
  }

  const bounds = document.bounds;
  const area = Math.max(1, bounds.width * bounds.height);
  const occupied = nodes.reduce((sum, node) => sum + node.width * node.height, 0);
  const compactness = occupied / area;
  const separation = clusterSeparation(document);
  const flow = directionFlow(document, edges, options.direction);
  const hardViolations: string[] = [];
  if (overlapCount) hardViolations.push(`NODE_OVERLAP:${overlapCount}`);
  if (pinnedNodeMoves) hardViolations.push(`PINNED_NODE_MOVED:${pinnedNodeMoves}`);
  const score = 1000
    - overlapCount * (OVERLAP_MULT * weights.overlap)
    - edgeCrossings * (CROSSINGS_MULT * weights.crossings)
    - edgeLength * EDGE_LENGTH_MULT
    - displacement * (DISPLACEMENT_MULT * weights.displacement)
    + compactness * (COMPACTNESS_MULT * weights.compactness)
    + separation * (CLUSTER_SEP_MULT * (weights.clusterSeparation ?? 1))
    + flow * (DIRECTION_MULT * (weights.direction ?? 0));
  return { overlapCount, overlapArea, edgeCrossings, edgeLength, pinnedNodeMoves, displacement, compactness, clusterSeparation: separation, directionFlow: flow, hardViolations, score };
}
