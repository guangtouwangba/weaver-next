import type { NodeLayout } from "@weaver/contracts";

export interface Box { x: number; y: number; width: number; height: number }

export function centerOf(node: { x: number; y: number; width: number; height: number }) {
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
}

/** Axis-aligned bounding box of a set of frames, optionally inflated by padding. */
export function bboxOf(frames: Array<{ x: number; y: number; width: number; height: number }>, padding = 0): Box {
  if (!frames.length) return { x: 0, y: 0, width: 0, height: 0 };
  const minX = Math.min(...frames.map((f) => f.x));
  const minY = Math.min(...frames.map((f) => f.y));
  const maxX = Math.max(...frames.map((f) => f.x + f.width));
  const maxY = Math.max(...frames.map((f) => f.y + f.height));
  return { x: minX - padding, y: minY - padding, width: maxX - minX + padding * 2, height: maxY - minY + padding * 2 };
}

/** Overlap area of two boxes (0 when disjoint). */
export function overlapArea(a: Box, b: Box) {
  const w = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return w * h;
}

/** Translate a frame in place by (dx, dy). */
export function translateNode(node: NodeLayout, dx: number, dy: number) {
  node.x += dx;
  node.y += dy;
}

/** The bounding-circle radius of a box (half its diagonal) — a conservative
 * collision radius that makes ring/force packing provably overlap-free. */
export function circleRadius(node: { width: number; height: number }) {
  return Math.hypot(node.width, node.height) / 2;
}
