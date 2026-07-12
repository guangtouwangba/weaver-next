import type { LayoutDocument, SpaceNode } from "@weaver/contracts";
import type { Cluster } from "./types.js";

// Sizes the engine may assign — a frame at one of these is considered
// engine-owned and re-flowable; anything else is treated as a manual resize the
// user chose and must be left alone. Includes the content-kind defaults from
// storage/src/graph.ts and the two hierarchy sizes below.
const ENGINE_SIZES = new Set(["220x112", "280x160", "300x180", "340x190", "260x140", "320x220", "240x130"]);
const HUB_SIZE = { width: 340, height: 190 };
const LEAF_SIZE = { width: 220, height: 112 };
const BODY_SIZE = { width: 260, height: 140 };
// Chart/data cards read as heroes — a trend chart is the focal point, so it gets
// a big frame; the compact KPI/metric card stays smaller.
const CHART_SIZE = { width: 320, height: 220 };
const METRIC_SIZE = { width: 240, height: 130 };
// Mirrors the widget's NodeShell per-kind minimum resize bounds so enlarged/shrunk
// cards never clip their content.
const DOC_MIN = { width: 180, height: 100 };

function isManuallyResized(width: number, height: number) {
  return !ENGINE_SIZES.has(`${Math.round(width)}x${Math.round(height)}`);
}

/**
 * Size hierarchy: prominent hubs get a big card, attribute/source leaves a small
 * one, everything else a mid card — so importance reads at a glance. Only touches
 * `document` graph cards (media keeps its aspect frame), skips pinned, manually
 * resized, and (when `preserveNodeSizes`) all nodes.
 */
export function applySizeHierarchy(document: LayoutDocument, clusters: Cluster[], nodesById: Map<string, SpaceNode>, preserveNodeSizes: boolean, fixedIds: Set<string>) {
  if (preserveNodeSizes) return;
  // Only genuinely prominent hubs get the big card (a flat cluster enlarges no one).
  const hubIds = new Set(clusters.filter((c) => c.hubProminent).map((c) => c.hubId).filter((id): id is string => Boolean(id)));
  for (const cluster of clusters) {
    for (const id of cluster.memberIds) {
      const frame = document.nodes[id];
      const node = nodesById.get(id);
      if (!frame || !node || fixedIds.has(id)) continue;
      if (isManuallyResized(frame.width, frame.height)) continue;
      if (node.contentKind === "chart") {
        const size = node.content.kind === "chart" && node.content.chartType === "metric" ? METRIC_SIZE : CHART_SIZE;
        frame.width = size.width;
        frame.height = size.height;
        continue;
      }
      if (node.contentKind !== "document") continue;
      const target = hubIds.has(id) ? HUB_SIZE : (node.type === "attribute" || node.type === "source") ? LEAF_SIZE : BODY_SIZE;
      frame.width = Math.max(DOC_MIN.width, target.width);
      frame.height = Math.max(DOC_MIN.height, target.height);
    }
  }
}
