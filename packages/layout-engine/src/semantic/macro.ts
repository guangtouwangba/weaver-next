import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from "d3-force";
import type { LayoutDocument, SpaceEdge } from "@weaver/contracts";
import { overlapArea, translateNode, type Box } from "./geometry.js";
import type { Cluster, MacroVariant } from "./types.js";

interface Placed { cluster: Cluster; bbox: Box; w: number; h: number; center: { x: number; y: number }; fixed: boolean; memberCount: number }

/**
 * Arrange already-micro-laid clusters in the plane, then translate their members
 * into absolute coordinates. Guarantees the cluster boxes are non-overlapping
 * (force arrangement → deterministic AABB separation sweep → grid fallback), with
 * a 2.5× gutter that produces the de-clustered whitespace. Clusters holding a
 * fixed (pinned) node are anchored to keep that node's absolute position.
 */
export function macroPlace(
  document: LayoutDocument,
  clusters: Cluster[],
  bboxes: Map<string, Box>,
  edges: SpaceEdge[],
  clusterOf: Map<string, string>,
  fixedIds: Set<string>,
  current: LayoutDocument,
  spacing: number,
  variant: MacroVariant,
  seed: string,
): void {
  const interGap = 2.5 * spacing;
  const placed: Placed[] = clusters.map((cluster) => {
    const bbox = bboxes.get(cluster.id) ?? { x: 0, y: 0, width: 0, height: 0 };
    const localCenter = { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
    const fixedMember = cluster.memberIds.filter((id) => fixedIds.has(id)).sort((a, b) => a.localeCompare(b))[0];
    let center = localCenter;
    let fixed = false;
    if (fixedMember && current.nodes[fixedMember]) {
      // Offset so the pinned member lands exactly at its original center.
      const local = document.nodes[fixedMember];
      const localAnchor = { x: local.x + local.width / 2, y: local.y + local.height / 2 };
      const orig = current.nodes[fixedMember];
      const origAnchor = { x: orig.x + orig.width / 2, y: orig.y + orig.height / 2 };
      center = { x: localCenter.x + (origAnchor.x - localAnchor.x), y: localCenter.y + (origAnchor.y - localAnchor.y) };
      fixed = true;
    }
    return { cluster, bbox, w: bbox.width, h: bbox.height, center, fixed, memberCount: cluster.memberIds.length };
  });

  if (variant === "grid") packGrid(placed, interGap, current.config.viewportWidth);
  else {
    packForce(placed, edges, clusterOf, interGap, seed);
    const converged = separate(placed, interGap);
    if (!converged) packGrid(placed, interGap, current.config.viewportWidth);
  }

  // Translate every member from local into absolute coordinates and emit the box.
  document.groups = {};
  for (const item of placed) {
    const dx = item.center.x - (item.bbox.x + item.bbox.width / 2);
    const dy = item.center.y - (item.bbox.y + item.bbox.height / 2);
    for (const id of item.cluster.memberIds) { const node = document.nodes[id]; if (node) translateNode(node, dx, dy); }
    if (!item.cluster.isCenter && item.cluster.memberIds.length >= 2) {
      const groupId = `cluster:${item.cluster.label}`;
      document.groups[groupId] = { groupId, x: item.bbox.x + dx, y: item.bbox.y + dy, width: item.bbox.width, height: item.bbox.height, direction: variant === "grid" ? "vertical" : "radial", padding: 32, collapsed: false };
      for (const id of item.cluster.memberIds) { if (document.nodes[id]) document.nodes[id].groupId = groupId; }
    } else {
      for (const id of item.cluster.memberIds) { if (document.nodes[id]) document.nodes[id].groupId = undefined; }
    }
  }
}

function packForce(placed: Placed[], edges: SpaceEdge[], clusterOf: Map<string, string>, interGap: number, seed: string) {
  const radius = (item: Placed) => Math.hypot(item.w, item.h) / 2 + interGap / 2;
  // Deterministic spiral seeding so the force sim starts separated.
  const nodes = placed.map((item, index) => {
    const angle = index * 2.399963229728653; // golden angle
    const spiral = 120 * Math.sqrt(index + 1);
    return { id: item.cluster.id, x: item.fixed ? item.center.x : Math.cos(angle) * spiral, y: item.fixed ? item.center.y : Math.sin(angle) * spiral, fx: item.fixed ? item.center.x : undefined, fy: item.fixed ? item.center.y : undefined, item };
  });
  const counts = new Map<string, number>();
  for (const edge of edges) {
    if (edge.archived) continue;
    const a = clusterOf.get(edge.sourceNodeId); const b = clusterOf.get(edge.targetNodeId);
    if (!a || !b || a === b) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const links = [...counts.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([key, count]) => { const [a, b] = key.split("|"); return { source: a, target: b, count }; });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const simulation = forceSimulation(nodes as any)
    .force("link", forceLink(links as any).id((n: any) => n.id).distance((link: any) => radius(byId.get(link.source.id)!.item) + radius(byId.get(link.target.id)!.item) + interGap).strength((link: any) => Math.min(0.9, link.count / (link.count + 2))))
    .force("charge", forceManyBody().strength(-1)) // gentle; collide does the real spacing
    .force("center", forceCenter(0, 0))
    .force("collide", forceCollide((n: any) => radius(n.item)).strength(1))
    .stop();
  for (let tick = 0; tick < 300; tick += 1) simulation.tick();
  for (const node of nodes) { if (!node.item.fixed) node.item.center = { x: node.x ?? 0, y: node.y ?? 0 }; }
}

/** Iterative AABB separation with an interGap gutter; immovable = fixed clusters.
 * Returns true if it converged to zero overlap. */
function separate(placed: Placed[], interGap: number): boolean {
  const half = interGap / 2;
  const box = (item: Placed): Box => ({ x: item.center.x - item.w / 2 - half, y: item.center.y - item.h / 2 - half, width: item.w + interGap, height: item.h + interGap });
  for (let iter = 0; iter < 400; iter += 1) {
    let moved = false;
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i]; const b = placed[j];
        const ba = box(a); const bb = box(b);
        if (overlapArea(ba, bb) <= 0) continue;
        const ox = Math.min(ba.x + ba.width, bb.x + bb.width) - Math.max(ba.x, bb.x);
        const oy = Math.min(ba.y + ba.height, bb.y + bb.height) - Math.max(ba.y, bb.y);
        const bothMovable = !a.fixed && !b.fixed;
        if (ox < oy) {
          const dir = a.center.x <= b.center.x ? -1 : 1;
          const shift = bothMovable ? ox / 2 : ox;
          if (!a.fixed) a.center.x += dir * shift;
          if (!b.fixed) b.center.x -= dir * shift;
          if (a.fixed && b.fixed) continue;
        } else {
          const dir = a.center.y <= b.center.y ? -1 : 1;
          const shift = bothMovable ? oy / 2 : oy;
          if (!a.fixed) a.center.y += dir * shift;
          if (!b.fixed) b.center.y -= dir * shift;
          if (a.fixed && b.fixed) continue;
        }
        moved = true;
      }
    }
    if (!moved) return true;
  }
  // Final check.
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const a = placed[i]; const b = placed[j];
      const ba = box(a); const bb = box(b);
      if (overlapArea(ba, bb) > 0) return false;
    }
  }
  return true;
}

function packGrid(placed: Placed[], interGap: number, viewportWidth: number) {
  const target = Math.max(viewportWidth * 1.6, Math.max(...placed.map((p) => p.w)) + interGap);
  const order = [...placed].sort((a, b) => (b.memberCount - a.memberCount) || a.cluster.id.localeCompare(b.cluster.id));
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  for (const item of order) {
    if (cursorX > 0 && cursorX + item.w > target) { cursorX = 0; cursorY += rowHeight + interGap; rowHeight = 0; }
    item.center = { x: cursorX + item.w / 2, y: cursorY + item.h / 2 };
    cursorX += item.w + interGap;
    rowHeight = Math.max(rowHeight, item.h);
  }
}
