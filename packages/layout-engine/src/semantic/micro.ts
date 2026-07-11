import type { LayoutDocument } from "@weaver/contracts";
import { bboxOf, circleRadius, type Box } from "./geometry.js";
import type { Cluster, MicroVariant } from "./types.js";

const GROUP_PADDING = 32;

/** Place a cluster's member frames in LOCAL coordinates (hub centered near the
 * origin) and return the padded bounding box. Overlap-free by construction; the
 * caller then translates the whole cluster into place. */
export function layoutClusterLocal(cluster: Cluster, document: LayoutDocument, spacing: number, variant: MicroVariant): Box {
  const memberFrames = cluster.memberIds.map((id) => document.nodes[id]).filter(Boolean);
  if (!memberFrames.length) return { x: 0, y: 0, width: 0, height: 0 };
  const hubId = cluster.hubId && document.nodes[cluster.hubId] ? cluster.hubId : cluster.memberIds[0];
  const hub = document.nodes[hubId];
  const satellites = cluster.memberIds.filter((id) => id !== hubId && document.nodes[id]).sort((a, b) => a.localeCompare(b));

  // Hub centered at the local origin.
  hub.x = -hub.width / 2;
  hub.y = -hub.height / 2;

  if (satellites.length) {
    if (variant === "rows") placeRows(hub, satellites, document, spacing);
    else placeRadial(hub, satellites, document, spacing);
  }
  return bboxOf(memberFrames, GROUP_PADDING);
}

function placeRadial(hub: { width: number; height: number }, satellites: string[], document: LayoutDocument, spacing: number) {
  const hubR = circleRadius(hub);
  const maxSatR = Math.max(...satellites.map((id) => circleRadius(document.nodes[id])));
  const baseR = hubR + spacing + maxSatR;
  let index = 0;
  let ring = 0;
  while (index < satellites.length) {
    const r = baseR + ring * (2 * maxSatR + spacing);
    // Angular capacity that keeps adjacent centers ≥ (2·maxSatR + spacing) apart —
    // chord-based, so bounding circles never overlap on a ring.
    const ratio = Math.min(0.999, (maxSatR + spacing / 2) / r);
    const capacity = Math.max(1, Math.floor(Math.PI / Math.asin(ratio)));
    const count = Math.min(capacity, satellites.length - index);
    for (let k = 0; k < count; k += 1) {
      const angle = (Math.PI * 2 * k) / count - Math.PI / 2;
      const cx = Math.cos(angle) * r;
      const cy = Math.sin(angle) * r;
      const node = document.nodes[satellites[index + k]];
      node.x = cx - node.width / 2;
      node.y = cy - node.height / 2;
    }
    index += count;
    ring += 1;
  }
}

function placeRows(hub: { width: number; height: number }, satellites: string[], document: LayoutDocument, spacing: number) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(satellites.length)));
  const cellWidth = Math.max(...satellites.map((id) => document.nodes[id].width)) + spacing;
  const cellHeight = Math.max(...satellites.map((id) => document.nodes[id].height)) + spacing;
  const gridWidth = cols * cellWidth;
  const startX = -gridWidth / 2 + cellWidth / 2;
  const gridTop = hub.height / 2 + spacing;
  satellites.forEach((id, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const cx = startX + col * cellWidth;
    const cy = gridTop + cellHeight / 2 + row * cellHeight;
    const node = document.nodes[id];
    node.x = cx - node.width / 2;
    node.y = cy - node.height / 2;
  });
}
