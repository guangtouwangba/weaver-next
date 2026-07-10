import { describe, expect, it } from "vitest";
import { applyGraphDelta, applyLayoutOperations } from "../sync";

describe("widget SSE reducers", () => {
  it("applies graph deltas while preserving a locally dirty node", () => {
    const current = [{ id: "dirty", title: "Local" }, { id: "clean", title: "Old" }];
    const result = applyGraphDelta(current, [{ id: "edge-old" }], {
      fromRevision: 2, toRevision: 3,
      addedNodes: [{ id: "new", title: "New" }],
      updatedNodes: [{ id: "dirty", title: "Remote" }, { id: "clean", title: "Updated" }],
      archivedNodeIds: [], addedEdges: [{ id: "edge-new" }], updatedEdges: [], archivedEdgeIds: ["edge-old"],
    }, new Set(["dirty"]));
    expect(result.nodes).toContainEqual({ id: "dirty", title: "Local" });
    expect(result.nodes).toContainEqual({ id: "clean", title: "Updated" });
    expect(result.nodes).toContainEqual({ id: "new", title: "New" });
    expect(result.edges).toEqual([{ id: "edge-new" }]);
  });

  it("applies layout operations without replacing unrelated node frames", () => {
    const layout = { layoutRevision: 4, nodes: { a: { nodeId: "a", x: 0, y: 0, width: 100, height: 80, pinned: false }, b: { nodeId: "b", x: 200, y: 0, width: 100, height: 80, pinned: false } } };
    const next = applyLayoutOperations(layout, 5, [{ type: "set-node-frame", nodeId: "a", frame: { x: 40, y: 60, width: 120, height: 90 } }, { type: "pin-node", nodeId: "a" }]);
    expect(next.layoutRevision).toBe(5);
    expect(next.nodes.a).toMatchObject({ x: 40, y: 60, width: 120, height: 90, pinned: true });
    expect(next.nodes.b).toEqual(layout.nodes.b);
  });
});
