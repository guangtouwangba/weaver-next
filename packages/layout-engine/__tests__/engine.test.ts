import { describe, expect, it } from "vitest";
import type { LayoutDocument, LayoutPlan, SpaceEdge, SpaceNode } from "@weaver/contracts";
import { generateLayoutCandidates } from "../src/engine.js";

const timestamp = "2026-07-10T00:00:00.000Z";
const nodes: SpaceNode[] = ["a", "b", "c", "d"].map((id, index) => ({ id, projectId: "p", type: index ? "idea" : "root", title: id, body: "", contentKind: "document", content: { kind: "document", mode: "note", markdown: "", excerpt: "", embeddedAssetIds: [] }, properties: {}, archived: false, createdAt: timestamp, updatedAt: timestamp }));
const edges: SpaceEdge[] = [
  { id: "ab", projectId: "p", type: "branch", sourceNodeId: "a", targetNodeId: "b", directed: true, properties: {}, archived: false, createdAt: timestamp, updatedAt: timestamp },
  { id: "ac", projectId: "p", type: "branch", sourceNodeId: "a", targetNodeId: "c", directed: true, properties: {}, archived: false, createdAt: timestamp, updatedAt: timestamp },
  { id: "bd", projectId: "p", type: "branch", sourceNodeId: "b", targetNodeId: "d", directed: true, properties: {}, archived: false, createdAt: timestamp, updatedAt: timestamp },
];
const current: LayoutDocument = {
  projectId: "p", viewId: "v", viewType: "graph", graphRevision: 2, layoutRevision: 3, strategy: "grid",
  config: { direction: "left-right", nodeSpacing: 72, rankSpacing: 120, density: 1, viewportWidth: 1280, viewportHeight: 800 },
  nodes: Object.fromEntries(nodes.map((node, index) => [node.id, { nodeId: node.id, x: index * 240, y: 0, width: 180, height: 90, rotation: 0, zIndex: 0, pinned: node.id === "a", hidden: false, collapsed: false }])),
  edges: {}, groups: {}, bounds: { x: 0, y: 0, width: 900, height: 90 }, createdBy: "user", updatedAt: timestamp,
};
const plan: LayoutPlan = {
  projectId: "p", viewId: "v", baseGraphRevision: 2, baseLayoutRevision: 3, scope: { type: "whole-view" }, strategy: "force",
  constraints: [{ type: "avoid-overlap", nodeIds: [], edgeIds: [], edgeTypes: [], strength: 1 }],
  preserve: { pinnedNodes: true, manualGroups: true, relativeOrder: true, mentalMapWeight: 0.7 }, candidateCount: 3, rationale: "Reduce crossings",
};

describe("deterministic layout engine", () => {
  it("repeats coordinates for the same semantic plan and preserves pinned nodes", async () => {
    const first = await generateLayoutCandidates({ nodes, edges, current, plan, layoutRunId: "run-1" });
    const second = await generateLayoutCandidates({ nodes, edges, current, plan, layoutRunId: "run-1" });
    const frames = (candidate: typeof first[number]) => Object.fromEntries(Object.entries(candidate.document.nodes).map(([id, node]) => [id, [node.x, node.y]]));
    expect(frames(first[0])).toEqual(frames(second[0]));
    expect(first[0].document.nodes.a.x).toBe(current.nodes.a.x);
    expect(first[0].document.nodes.a.y).toBe(current.nodes.a.y);
    expect(first[0].document.graphRevision).toBe(current.graphRevision);
    expect(first.map((candidate) => candidate.id)).toEqual(second.map((candidate) => candidate.id));
  });

  it("returns scored preview candidates without mutating the current layout", async () => {
    const before = structuredClone(current);
    const candidates = await generateLayoutCandidates({ nodes, edges, current, plan });
    expect(candidates).toHaveLength(3);
    expect(candidates[0].metrics.score).toBeGreaterThanOrEqual(candidates[1].metrics.score);
    expect(current).toEqual(before);
    expect(candidates.every((candidate) => candidate.document.layoutRevision === current.layoutRevision)).toBe(true);
  });

  it("uses measured mixed-content sizes when placing a grid", async () => {
    const measured = structuredClone(current);
    measured.nodes.a.width = 320; measured.nodes.a.height = 220; measured.nodes.a.pinned = false;
    measured.nodes.b.width = 300; measured.nodes.b.height = 180;
    measured.nodes.c.width = 280; measured.nodes.c.height = 160;
    measured.nodes.d.width = 360; measured.nodes.d.height = 260;
    const [candidate] = await generateLayoutCandidates({ nodes, edges, current: measured, plan: { ...plan, strategy: "grid", candidateCount: 1 }, layoutRunId: "mixed-grid" });
    expect(candidate.metrics.overlapCount).toBe(0);
  });
});
