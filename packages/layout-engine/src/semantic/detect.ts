import type { LayoutDocument, SpaceEdge, SpaceNode } from "@weaver/contracts";
import type { Cluster, NormalizedConstraints } from "./types.js";

const LAYER_KEY = "layer";
const MISC_LABEL = "分析要点";

/** Non-archived edges with both endpoints in scope, plus a per-node degree map. */
function buildTopology(nodes: SpaceNode[], edges: SpaceEdge[]) {
  const inScope = new Set(nodes.map((n) => n.id));
  const degree = new Map<string, number>();
  const adjacency = new Map<string, Map<string, number>>();
  for (const node of nodes) { degree.set(node.id, 0); adjacency.set(node.id, new Map()); }
  for (const edge of edges) {
    if (edge.archived || !inScope.has(edge.sourceNodeId) || !inScope.has(edge.targetNodeId) || edge.sourceNodeId === edge.targetNodeId) continue;
    degree.set(edge.sourceNodeId, (degree.get(edge.sourceNodeId) ?? 0) + 1);
    degree.set(edge.targetNodeId, (degree.get(edge.targetNodeId) ?? 0) + 1);
    const a = adjacency.get(edge.sourceNodeId)!; a.set(edge.targetNodeId, (a.get(edge.targetNodeId) ?? 0) + 1);
    const b = adjacency.get(edge.targetNodeId)!; b.set(edge.sourceNodeId, (b.get(edge.sourceNodeId) ?? 0) + 1);
  }
  return { degree, adjacency };
}

function layerOf(node: SpaceNode): string {
  const raw = node.properties?.[LAYER_KEY];
  return typeof raw === "string" ? raw.trim() : "";
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Edges from `nodeId` into `members`, summed. */
function edgesInto(nodeId: string, members: Set<string>, adjacency: Map<string, Map<string, number>>): number {
  let total = 0;
  for (const [other, count] of adjacency.get(nodeId) ?? []) if (members.has(other)) total += count;
  return total;
}

/**
 * Deterministic clustering. Priority: explicit `group` constraints → inherited
 * manual groups → `properties.layer` (the analyst's own layering) → topology
 * hub-star fallback. A single graph-wide hub is pulled out as the center. All
 * ordering is by id/label so two runs on the same input are byte-identical.
 */
export function detectClusters(nodes: SpaceNode[], edges: SpaceEdge[], constraints: NormalizedConstraints, current: LayoutDocument): Cluster[] {
  const sorted = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const { degree, adjacency } = buildTopology(sorted, edges);
  const assigned = new Map<string, string>();
  const clusters: Cluster[] = [];
  const push = (cluster: Cluster) => { clusters.push(cluster); for (const id of cluster.memberIds) assigned.set(id, cluster.id); };
  const unassigned = () => sorted.filter((n) => !assigned.has(n.id));

  // 1. Explicit group constraints win outright.
  constraints.groups.forEach((group, index) => {
    const members = group.nodeIds.filter((id) => degree.has(id) && !assigned.has(id));
    if (members.length) push({ id: `group-${index}`, label: group.label || `分组 ${index + 1}`, memberIds: members });
  });

  // 2. Inherit manual group membership from the current document.
  if (constraints.preserveManualGroups) {
    const byGroup = new Map<string, string[]>();
    for (const node of unassigned()) {
      const gid = current.nodes[node.id]?.groupId;
      if (gid) (byGroup.get(gid) ?? byGroup.set(gid, []).get(gid)!).push(node.id);
    }
    for (const gid of [...byGroup.keys()].sort()) {
      const members = byGroup.get(gid)!;
      if (members.length) push({ id: `manual-${gid}`, label: gid.includes(":") ? gid.split(":").slice(1).join(":") : gid, memberIds: members });
    }
  }

  // Designate the graph-wide center: the top-degree node, but only when it is a
  // genuine hub (degree ≥ 2× median) — otherwise there is no single center.
  const degrees = sorted.map((n) => degree.get(n.id) ?? 0);
  const hubThreshold = Math.max(2, 2 * median(degrees.filter((d) => d > 0)));
  const centerCandidate = [...sorted].sort((a, b) => (degree.get(b.id)! - degree.get(a.id)!) || a.id.localeCompare(b.id))[0];
  const centerId = centerCandidate && !assigned.has(centerCandidate.id) && (degree.get(centerCandidate.id) ?? 0) >= hubThreshold ? centerCandidate.id : undefined;

  // 3. Cluster the remainder by the analyst's `properties.layer`.
  const rest = unassigned().filter((n) => n.id !== centerId);
  const byLayer = new Map<string, string[]>();
  const noLayer: string[] = [];
  for (const node of rest) {
    const layer = layerOf(node);
    if (layer) (byLayer.get(layer) ?? byLayer.set(layer, []).get(layer)!).push(node.id);
    else noLayer.push(node.id);
  }
  const bigLayers = [...byLayer.entries()].filter(([, m]) => m.length >= 2).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [layer, members] of bigLayers) push({ id: `layer-${layer}`, label: layer, memberIds: members });

  // Singleton-layer nodes + layerless nodes become "orphans".
  const singletonLayerIds = [...byLayer.entries()].filter(([, m]) => m.length < 2).flatMap(([, m]) => m);
  const orphans = [...singletonLayerIds, ...noLayer].filter((id) => !assigned.has(id)).sort((a, b) => a.localeCompare(b));

  if (clusters.length === 0 && !centerId && orphans.length) {
    // 4. No layer signal at all → topology hub-star fallback.
    return hubStar(sorted, degree, adjacency, constraints);
  }

  if (orphans.length >= 2) {
    push({ id: "misc", label: MISC_LABEL, memberIds: orphans });
  } else if (orphans.length === 1) {
    const largest = [...clusters].filter((c) => !c.isCenter).sort((a, b) => (b.memberIds.length - a.memberIds.length) || a.id.localeCompare(b.id))[0];
    if (largest) { largest.memberIds.push(orphans[0]); assigned.set(orphans[0], largest.id); }
    else push({ id: "misc", label: MISC_LABEL, memberIds: orphans });
  }

  if (centerId) {
    const centerNode = sorted.find((n) => n.id === centerId)!;
    clusters.unshift({ id: "center", label: layerOf(centerNode) || centerNode.title || "核心", memberIds: [centerId], isCenter: true });
    assigned.set(centerId, "center");
  }

  applySeparations(clusters, constraints, degree, adjacency);
  assignHubs(clusters, constraints, degree);
  return clusters.filter((c) => c.memberIds.length > 0);
}

/** Topology-only clustering when no `properties.layer` exists: high-degree anchors
 * pull in their most-connected satellites; leftovers form a final cluster. */
function hubStar(nodes: SpaceNode[], degree: Map<string, number>, adjacency: Map<string, Map<string, number>>, constraints: NormalizedConstraints): Cluster[] {
  const degrees = nodes.map((n) => degree.get(n.id) ?? 0);
  const med = median(degrees.filter((d) => d > 0));
  const anchorFloor = Math.max(3, 2 * med);
  const anchorCap = Math.max(1, Math.ceil(nodes.length / 6));
  const anchors = [...nodes]
    .filter((n) => (degree.get(n.id) ?? 0) >= anchorFloor || constraints.emphasisIds.includes(n.id))
    .sort((a, b) => (degree.get(b.id)! - degree.get(a.id)!) || a.id.localeCompare(b.id))
    .slice(0, anchorCap);
  if (!anchors.length) return [{ id: "all", label: "全部", memberIds: nodes.map((n) => n.id).sort((a, b) => a.localeCompare(b)) }];

  const anchorIds = new Set(anchors.map((a) => a.id));
  const clusters: Cluster[] = anchors.map((a) => ({ id: `hub-${a.id}`, label: a.title || a.id, memberIds: [a.id], hubId: a.id }));
  const clusterByAnchor = new Map(clusters.map((c) => [c.hubId!, c]));
  const leftover: string[] = [];
  for (const node of nodes) {
    if (anchorIds.has(node.id)) continue;
    let best: Cluster | undefined;
    let bestScore = 0;
    for (const anchor of anchors) {
      const score = adjacency.get(node.id)?.get(anchor.id) ?? 0;
      if (score > bestScore) { bestScore = score; best = clusterByAnchor.get(anchor.id); }
    }
    if (best) best.memberIds.push(node.id); else leftover.push(node.id);
  }
  if (leftover.length) clusters.push({ id: "misc", label: MISC_LABEL, memberIds: leftover.sort((a, b) => a.localeCompare(b)) });
  applySeparations(clusters, constraints, degree, adjacency);
  assignHubs(clusters, constraints, degree);
  return clusters;
}

/** Enforce separation pairs: if two must-split nodes share a cluster, move the
 * lower-degree one to its next-best cluster (by shared edges), else a spillover. */
function applySeparations(clusters: Cluster[], constraints: NormalizedConstraints, degree: Map<string, number>, adjacency: Map<string, Map<string, number>>) {
  if (!constraints.separations.length) return;
  const clusterOf = new Map<string, Cluster>();
  for (const cluster of clusters) for (const id of cluster.memberIds) clusterOf.set(id, cluster);
  for (const [a, b] of constraints.separations) {
    const ca = clusterOf.get(a); const cb = clusterOf.get(b);
    if (!ca || !cb || ca !== cb) continue;
    const mover = (degree.get(a) ?? 0) <= (degree.get(b) ?? 0) ? a : b;
    ca.memberIds = ca.memberIds.filter((id) => id !== mover);
    const target = clusters
      .filter((c) => c !== ca && !c.isCenter)
      .map((c) => ({ c, score: edgesInto(mover, new Set(c.memberIds), adjacency) }))
      .sort((x, y) => (y.score - x.score) || x.c.id.localeCompare(y.c.id))[0];
    if (target) { target.c.memberIds.push(mover); clusterOf.set(mover, target.c); }
    else { const spill: Cluster = { id: `split-${mover}`, label: MISC_LABEL, memberIds: [mover] }; clusters.push(spill); clusterOf.set(mover, spill); }
  }
}

/** Cluster hub = emphasis member if present, else highest total degree (tie: id).
 * A hub is "prominent" (eligible for enlargement) only when it is the center, is
 * emphasized, or out-degrees every clustermate — so flat clusters enlarge no one. */
function assignHubs(clusters: Cluster[], constraints: NormalizedConstraints, degree: Map<string, number>) {
  for (const cluster of clusters) {
    if (!cluster.hubId || !cluster.memberIds.includes(cluster.hubId)) {
      const emphasis = cluster.memberIds.filter((id) => constraints.emphasisIds.includes(id)).sort((a, b) => a.localeCompare(b))[0];
      cluster.hubId = emphasis ?? [...cluster.memberIds].sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || a.localeCompare(b))[0];
    }
    const hubId = cluster.hubId;
    const others = cluster.memberIds.filter((id) => id !== hubId);
    const maxOther = others.length ? Math.max(...others.map((id) => degree.get(id) ?? 0)) : -1;
    cluster.hubProminent = Boolean(cluster.isCenter || constraints.emphasisIds.includes(hubId) || (degree.get(hubId) ?? 0) > maxOther);
  }
}
