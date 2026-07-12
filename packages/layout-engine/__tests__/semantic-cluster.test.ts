import { describe, expect, it } from "vitest";
import type { LayoutDocument, LayoutPlan, SpaceEdge, SpaceNode } from "@weaver/contracts";
import { generateLayoutCandidates } from "../src/engine.js";
import { previewClusters, seedSemanticLayout } from "../src/semantic/index.js";

const timestamp = "2026-07-10T00:00:00.000Z";

// A robot-industry-shaped fixture: a central hub, four labeled layer-clusters
// (赛道/产业链/核心技术/应用) each with 2+ members, plus singleton layers.
interface Seed { id: string; type: string; layer: string }
const seeds: Seed[] = [
  { id: "hub", type: "entity", layer: "总览" },
  { id: "track-1", type: "entity", layer: "赛道" }, { id: "track-2", type: "entity", layer: "赛道" }, { id: "track-3", type: "entity", layer: "赛道" },
  { id: "chain-up", type: "entity", layer: "产业链" }, { id: "chain-mid", type: "entity", layer: "产业链" }, { id: "chain-down", type: "entity", layer: "产业链" },
  { id: "tech-1", type: "attribute", layer: "核心技术" }, { id: "tech-2", type: "attribute", layer: "核心技术" }, { id: "tech-3", type: "attribute", layer: "核心技术" }, { id: "tech-4", type: "attribute", layer: "核心技术" },
  { id: "app-1", type: "entity", layer: "应用" }, { id: "app-2", type: "entity", layer: "应用" }, { id: "app-3", type: "entity", layer: "应用" },
  { id: "risk", type: "attribute", layer: "风险" }, { id: "thesis", type: "attribute", layer: "结论" },
  { id: "src-1", type: "source", layer: "来源" }, { id: "src-2", type: "source", layer: "来源" },
];

const nodes: SpaceNode[] = seeds.map((seed) => ({
  id: seed.id, projectId: "p", type: seed.type, title: seed.id, body: "", contentKind: "document",
  content: { kind: "document", mode: "note", markdown: "", excerpt: "", embeddedAssetIds: [] },
  properties: { layer: seed.layer }, archived: false, createdAt: timestamp, updatedAt: timestamp,
}));

function edge(id: string, source: string, target: string, type = "relates-to"): SpaceEdge {
  return { id, projectId: "p", type, sourceNodeId: source, targetNodeId: target, directed: true, properties: {}, archived: false, createdAt: timestamp, updatedAt: timestamp };
}
const edges: SpaceEdge[] = [
  edge("e1", "hub", "track-1"), edge("e2", "hub", "track-2"), edge("e3", "hub", "track-3"),
  edge("e4", "hub", "chain-up"), edge("e5", "hub", "chain-mid"), edge("e6", "hub", "chain-down"),
  edge("e7", "hub", "app-1"), edge("e8", "hub", "risk"), edge("e9", "hub", "thesis"),
  edge("t1", "chain-up", "tech-1", "has-attribute"), edge("t2", "chain-up", "tech-2", "has-attribute"),
  edge("t3", "chain-up", "tech-3", "has-attribute"), edge("t4", "chain-up", "tech-4", "has-attribute"),
  edge("a1", "chain-down", "app-1"), edge("a2", "chain-down", "app-2"), edge("a3", "chain-down", "app-3"),
  edge("s1", "app-1", "src-1", "has-attribute"), edge("s2", "app-2", "src-2", "has-attribute"),
];

function makeCurrent(overrides: Partial<Record<string, Partial<LayoutDocument["nodes"][string]>>> = {}): LayoutDocument {
  return {
    projectId: "p", viewId: "v", viewType: "graph", graphRevision: 2, layoutRevision: 3, strategy: "cluster",
    config: { direction: "left-right", nodeSpacing: 72, rankSpacing: 120, density: 1, viewportWidth: 1280, viewportHeight: 800 },
    nodes: Object.fromEntries(nodes.map((node, index) => [node.id, { nodeId: node.id, x: (index % 5) * 260, y: Math.floor(index / 5) * 150, width: 220, height: 112, rotation: 0, zIndex: 0, pinned: false, hidden: false, collapsed: false, ...overrides[node.id] }])),
    edges: {}, groups: {}, bounds: { x: 0, y: 0, width: 1300, height: 600 }, createdBy: "user", updatedAt: timestamp,
  };
}

function makePlan(overrides: Partial<LayoutPlan> = {}): LayoutPlan {
  return {
    projectId: "p", viewId: "v", baseGraphRevision: 2, baseLayoutRevision: 3, scope: { type: "whole-view" }, strategy: "cluster",
    constraints: [], preserve: { pinnedNodes: true, manualGroups: true, relativeOrder: true, mentalMapWeight: 0.6, nodeSizes: false },
    candidateCount: 3, rationale: "", ...overrides,
  };
}

function makeEmptyDoc(viewId = "seed"): LayoutDocument {
  return {
    projectId: "p", viewId, viewType: "graph", graphRevision: 2, layoutRevision: 0, strategy: "cluster",
    config: { direction: "left-right", nodeSpacing: 72, rankSpacing: 120, density: 1, viewportWidth: 1280, viewportHeight: 800 },
    nodes: {}, edges: {}, groups: {}, bounds: { x: 0, y: 0, width: 0, height: 0 }, createdBy: "layout-engine", updatedAt: timestamp,
  };
}

function pairsOverlap(document: LayoutDocument): number {
  const frames = Object.values(document.nodes).filter((n) => !n.hidden);
  let count = 0;
  for (let i = 0; i < frames.length; i += 1) for (let j = i + 1; j < frames.length; j += 1) {
    const a = frames[i]; const b = frames[j];
    const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    if (w > 0.001 && h > 0.001) count += 1;
  }
  return count;
}

describe("semantic cluster layout", () => {
  it("is deterministic across runs", async () => {
    const first = await generateLayoutCandidates({ nodes, edges, current: makeCurrent(), plan: makePlan(), layoutRunId: "run-x" });
    const second = await generateLayoutCandidates({ nodes, edges, current: makeCurrent(), plan: makePlan(), layoutRunId: "run-x" });
    const frames = (c: typeof first[number]) => Object.fromEntries(Object.entries(c.document.nodes).map(([id, n]) => [id, [n.x, n.y, n.width, n.height]]));
    expect(frames(first[0])).toEqual(frames(second[0]));
    expect(first.map((c) => c.id)).toEqual(second.map((c) => c.id));
    expect(Object.keys(first[0].document.groups)).toEqual(Object.keys(second[0].document.groups));
  });

  it("produces overlap-free candidates with no hard violations", async () => {
    const candidates = await generateLayoutCandidates({ nodes, edges, current: makeCurrent(), plan: makePlan(), layoutRunId: "run-o" });
    for (const candidate of candidates) {
      expect(pairsOverlap(candidate.document)).toBe(0);
      expect(candidate.metrics.overlapCount).toBe(0);
      expect(candidate.metrics.hardViolations).toEqual([]);
    }
  });

  it("clusters by the analyst's properties.layer and labels the group boxes", async () => {
    const [candidate] = await generateLayoutCandidates({ nodes, edges, current: makeCurrent(), plan: makePlan(), layoutRunId: "run-l" });
    const labels = Object.keys(candidate.document.groups);
    for (const layer of ["核心技术", "赛道", "产业链", "应用", "来源"]) {
      expect(labels).toContain(`cluster:${layer}`);
    }
    // Every node with a groupId sits inside its group box (containment).
    for (const node of Object.values(candidate.document.nodes)) {
      if (!node.groupId) continue;
      const box = candidate.document.groups[node.groupId];
      expect(box).toBeTruthy();
      expect(node.x).toBeGreaterThanOrEqual(box.x - 0.001);
      expect(node.y).toBeGreaterThanOrEqual(box.y - 0.001);
      expect(node.x + node.width).toBeLessThanOrEqual(box.x + box.width + 0.001);
      expect(node.y + node.height).toBeLessThanOrEqual(box.y + box.height + 0.001);
    }
    expect(Object.values(candidate.document.groups).every((g) => g.width > 0 && g.height > 0)).toBe(true);
  });

  it("separates group boxes with a wide gutter", async () => {
    const [candidate] = await generateLayoutCandidates({ nodes, edges, current: makeCurrent(), plan: makePlan(), layoutRunId: "run-g" });
    const groups = Object.values(candidate.document.groups);
    for (let i = 0; i < groups.length; i += 1) for (let j = i + 1; j < groups.length; j += 1) {
      const a = groups[i]; const b = groups[j];
      const gapX = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width));
      const gapY = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height));
      expect(Math.max(gapX, gapY)).toBeGreaterThanOrEqual(-0.001); // boxes never overlap
    }
    expect(candidate.metrics.clusterSeparation).toBeGreaterThan(0);
  });

  it("enlarges hubs and keeps leaves small, honoring emphasis and preserve.nodeSizes", async () => {
    const [candidate] = await generateLayoutCandidates({ nodes, edges, current: makeCurrent(), plan: makePlan(), layoutRunId: "run-s" });
    // The global hub gets the big card.
    expect(candidate.document.nodes.hub.width).toBe(340);
    expect(candidate.document.nodes.hub.height).toBe(190);
    // A flat cluster (核心技术: four equal-degree attributes) enlarges no one.
    for (const id of ["tech-1", "tech-2", "tech-3", "tech-4"]) expect(candidate.document.nodes[id].width).toBe(220);
    // A real local hub (chain-up out-degrees its clustermates) gets enlarged.
    expect(candidate.document.nodes["chain-up"].width).toBe(340);

    // Emphasis overrides hub choice within a cluster.
    const emphasized = await generateLayoutCandidates({ nodes, edges, current: makeCurrent(), plan: makePlan({ constraints: [{ type: "emphasis", nodeIds: ["tech-4"], edgeIds: [], edgeTypes: [], strength: 1 }] }), layoutRunId: "run-e" });
    expect(emphasized[0].document.nodes["tech-4"].width).toBe(340);

    // preserve.nodeSizes leaves everything at 220×112.
    const preserved = await generateLayoutCandidates({ nodes, edges, current: makeCurrent(), plan: makePlan({ preserve: { pinnedNodes: true, manualGroups: true, relativeOrder: true, mentalMapWeight: 0.6, nodeSizes: true } }), layoutRunId: "run-p" });
    expect(Object.values(preserved[0].document.nodes).every((n) => n.width === 220 && n.height === 112)).toBe(true);
  });

  it("returns three structurally distinct candidates", async () => {
    const candidates = await generateLayoutCandidates({ nodes, edges, current: makeCurrent(), plan: makePlan(), layoutRunId: "run-d" });
    expect(candidates).toHaveLength(3);
    const byLabel = Object.fromEntries(candidates.map((c) => [c.label, c.document]));
    const labels = candidates.map((c) => c.label).sort();
    expect(labels).toEqual(["分区矩阵", "紧凑网格", "语义聚类"]);
    // Mean per-node displacement between two candidates must be non-trivial.
    const docs = candidates.map((c) => c.document);
    const meanShift = (a: LayoutDocument, b: LayoutDocument) => {
      const ids = Object.keys(a.nodes);
      return ids.reduce((sum, id) => sum + Math.hypot(a.nodes[id].x - b.nodes[id].x, a.nodes[id].y - b.nodes[id].y), 0) / ids.length;
    };
    expect(meanShift(docs[0], docs[1])).toBeGreaterThan(20);
    expect(meanShift(docs[1], docs[2])).toBeGreaterThan(20);
    void byLabel;
  });

  it("honors explicit group and separation constraints", async () => {
    const grouped = await generateLayoutCandidates({ nodes, edges, current: makeCurrent(), plan: makePlan({ constraints: [{ type: "group", nodeIds: ["risk", "thesis"], edgeIds: [], edgeTypes: [], value: "判断", strength: 1 }] }), layoutRunId: "run-grp" });
    expect(grouped[0].document.nodes.risk.groupId).toBe(grouped[0].document.nodes.thesis.groupId);
    expect(grouped[0].document.nodes.risk.groupId).toBe("cluster:判断");

    const separated = await generateLayoutCandidates({ nodes, edges, current: makeCurrent(), plan: makePlan({ constraints: [{ type: "separation", nodeIds: ["tech-1", "tech-2"], edgeIds: [], edgeTypes: [], strength: 1 }] }), layoutRunId: "run-sep" });
    expect(separated[0].document.nodes["tech-1"].groupId).not.toBe(separated[0].document.nodes["tech-2"].groupId);
  });

  it("keeps a pinned node fixed without introducing overlap", async () => {
    const current = makeCurrent({ "track-1": { pinned: true, x: 999, y: -400 } });
    const [candidate] = await generateLayoutCandidates({ nodes, edges, current, plan: makePlan(), layoutRunId: "run-pin" });
    expect(candidate.document.nodes["track-1"].x).toBe(999);
    expect(candidate.document.nodes["track-1"].y).toBe(-400);
    expect(candidate.metrics.pinnedNodeMoves).toBe(0);
    expect(candidate.metrics.overlapCount).toBe(0);
  });
});

describe("seedSemanticLayout (initial layout)", () => {
  it("seeds a fresh view into labeled, overlap-free, hub-sized clusters", () => {
    const document = makeEmptyDoc();
    const { groupCount } = seedSemanticLayout({ nodes, edges, document });

    // Every active node placed, no overlaps, labeled group boxes emitted.
    expect(Object.keys(document.nodes)).toHaveLength(nodes.length);
    expect(pairsOverlap(document)).toBe(0);
    expect(groupCount).toBeGreaterThan(0);
    for (const layer of ["核心技术", "赛道", "产业链", "应用", "来源"]) expect(Object.keys(document.groups)).toContain(`cluster:${layer}`);

    // Size hierarchy applied: the global hub is enlarged, flat-cluster leaves stay small.
    expect(document.nodes.hub.width).toBe(340);
    expect(document.nodes["tech-1"].width).toBe(220);

    // Edges are routed and bounds frame every node + group box.
    expect(Object.keys(document.edges)).toHaveLength(edges.length);
    const frames = [...Object.values(document.nodes), ...Object.values(document.groups)];
    for (const frame of frames) {
      expect(frame.x).toBeGreaterThanOrEqual(document.bounds.x - 0.001);
      expect(frame.y).toBeGreaterThanOrEqual(document.bounds.y - 0.001);
      expect(frame.x + frame.width).toBeLessThanOrEqual(document.bounds.x + document.bounds.width + 0.001);
      expect(frame.y + frame.height).toBeLessThanOrEqual(document.bounds.y + document.bounds.height + 0.001);
    }
  });

  it("is deterministic for the same viewId", () => {
    const a = makeEmptyDoc("view-1");
    const b = makeEmptyDoc("view-1");
    seedSemanticLayout({ nodes, edges, document: a });
    seedSemanticLayout({ nodes, edges, document: b });
    const frames = (doc: LayoutDocument) => Object.fromEntries(Object.entries(doc.nodes).map(([id, n]) => [id, [n.x, n.y, n.width, n.height]]));
    expect(frames(a)).toEqual(frames(b));
    expect(Object.keys(a.groups)).toEqual(Object.keys(b.groups));
    expect(a.bounds).toEqual(b.bounds);
  });
});

describe("previewClusters (layout advisor)", () => {
  it("previews cluster labels and member counts without mutating inputs", () => {
    const nodesBefore = JSON.stringify(nodes);
    const edgesBefore = JSON.stringify(edges);
    const current = makeCurrent();
    const currentBefore = JSON.stringify(current);

    const { clusters, centerId } = previewClusters({ nodes, edges, plan: makePlan(), current });

    const byLabel = new Map(clusters.map((c) => [c.label, c]));
    expect(byLabel.get("核心技术")?.memberCount).toBe(4);
    expect(byLabel.get("赛道")?.memberCount).toBe(3);
    expect(centerId).toBe("hub");
    expect(byLabel.get("总览")?.isCenter).toBe(true);

    // Pure: no coordinates, no input mutation.
    expect(JSON.stringify(nodes)).toBe(nodesBefore);
    expect(JSON.stringify(edges)).toBe(edgesBefore);
    expect(JSON.stringify(current)).toBe(currentBefore);
  });
});
