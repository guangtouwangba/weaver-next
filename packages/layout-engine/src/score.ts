import type { LayoutDocument, LayoutMetrics, SpaceEdge } from "@weaver/contracts";

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

export function scoreLayout(document: LayoutDocument, edges: SpaceEdge[], previous?: LayoutDocument): LayoutMetrics {
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
  const hardViolations: string[] = [];
  if (overlapCount) hardViolations.push(`NODE_OVERLAP:${overlapCount}`);
  if (pinnedNodeMoves) hardViolations.push(`PINNED_NODE_MOVED:${pinnedNodeMoves}`);
  const score = 1000 - overlapCount * 500 - edgeCrossings * 18 - edgeLength * 0.002 - displacement * 0.01 + compactness * 80;
  return { overlapCount, overlapArea, edgeCrossings, edgeLength, pinnedNodeMoves, displacement, compactness, hardViolations, score };
}
