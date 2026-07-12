import { describe, expect, it } from "vitest";
import { applyGraphDelta, applyLayoutOperations, resolveEdgeHandles } from "../sync";
import * as viewCatalog from "../sync";

describe("widget SSE reducers", () => {
  it("routes edges through the facing sides of positioned nodes", () => {
    const center = { x: 300, y: 200, width: 220, height: 112 };
    expect(resolveEdgeHandles(center, { x: 0, y: 200, width: 220, height: 112 })).toEqual({ sourceHandle: "source-left", targetHandle: "target-right" });
    expect(resolveEdgeHandles(center, { x: 600, y: 200, width: 220, height: 112 })).toEqual({ sourceHandle: "source-right", targetHandle: "target-left" });
    expect(resolveEdgeHandles(center, { x: 300, y: -100, width: 220, height: 112 })).toEqual({ sourceHandle: "source-top", targetHandle: "target-bottom" });
    expect(resolveEdgeHandles(center, { x: 300, y: 500, width: 220, height: 112 })).toEqual({ sourceHandle: "source-bottom", targetHandle: "target-top" });
  });

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

  it("applies operable group deltas optimistically (create/assign/rename/delete)", () => {
    const nodes: Record<string, { nodeId: string; x: number; y: number; width: number; height: number; pinned: boolean; groupId?: string }> = {
      a: { nodeId: "a", x: 0, y: 0, width: 100, height: 80, pinned: false },
      b: { nodeId: "b", x: 200, y: 0, width: 100, height: 80, pinned: false },
    };
    const layout = { layoutRevision: 1, nodes, groups: {} as Record<string, { groupId: string; [k: string]: unknown }> };
    const grouped = applyLayoutOperations(layout, 2, [
      { type: "create-group", groupId: "g1", frame: { x: -20, y: -20, width: 340, height: 120 }, label: "Group", kind: "interaction" },
      { type: "assign-node-to-group", nodeId: "a", groupId: "g1" },
      { type: "assign-node-to-group", nodeId: "b", groupId: "g1" },
    ]);
    expect(grouped.groups.g1).toMatchObject({ groupId: "g1", label: "Group", kind: "interaction", width: 340 });
    expect(grouped.nodes.a.groupId).toBe("g1");

    const renamed = applyLayoutOperations(grouped, 3, [{ type: "rename-group", groupId: "g1", label: "Cluster" }]);
    expect(renamed.groups.g1.label).toBe("Cluster");

    const dissolved = applyLayoutOperations(renamed, 4, [{ type: "delete-group", groupId: "g1" }]);
    expect(dissolved.groups.g1).toBeUndefined();
    expect(dissolved.nodes.a.groupId).toBeUndefined();
    expect(dissolved.nodes.a).toMatchObject({ x: 0, y: 0 });
  });

  it("applies view projection and theme as layout-only deltas", () => {
    const layout = { layoutRevision: 1, nodes: {}, viewName: "Canvas", projection: { kind: "canvas" }, theme: { canvas: { backgroundColor: "white" } } };
    const next = applyLayoutOperations(layout, 2, [{ type: "set-view-name", viewName: "Roadmap" }, { type: "set-view-projection", projection: { kind: "timeline" } }, { type: "set-view-theme", theme: { canvas: { backgroundColor: "blue" } } }]);
    expect(next).toMatchObject({ layoutRevision: 2, viewName: "Roadmap", projection: { kind: "timeline" }, theme: { canvas: { backgroundColor: "blue" } } });
  });
});

describe("View catalog presentation", () => {
  const views = [
    { id: "canvas", name: "Canvas", status: "active", pinned: true, pinnedOrder: 1, lastOpenedAt: "2026-07-10T01:00:00Z" },
    { id: "roadmap", name: "Roadmap", status: "active", pinned: true, pinnedOrder: 0, lastOpenedAt: "2026-07-10T02:00:00Z" },
    { id: "mind", name: "Mind map", status: "active", pinned: false, lastOpenedAt: "2026-07-10T03:00:00Z", templateRef: { id: "radial-mind-map", version: "1" } },
    { id: "trash", name: "Old", status: "trashed", pinned: false, lastOpenedAt: "2026-07-09T03:00:00Z" },
  ];

  it("shows pinned Views plus the current unpinned View", () => {
    expect((viewCatalog as any).selectSwitcherViews(views, "mind").map((view: any) => view.id)).toEqual(["roadmap", "canvas", "mind"]);
    expect((viewCatalog as any).selectSwitcherViews(views, "canvas").map((view: any) => view.id)).toEqual(["roadmap", "canvas"]);
  });

  it("applies a contiguous catalog delta and rejects a gap", () => {
    const current = { revision: 2, views: views.slice(0, 3), defaultViewId: "canvas" };
    const next = (viewCatalog as any).applyViewCatalogDelta(current, { fromRevision: 2, toRevision: 3, upsertedViews: [{ ...views[2], name: "Ideas" }], removedViewIds: ["canvas"], defaultViewId: "roadmap" });
    expect(next).toMatchObject({ revision: 3, defaultViewId: "roadmap" });
    expect(next.views.map((view: any) => view.id)).toEqual(["roadmap", "mind"]);
    expect(() => (viewCatalog as any).applyViewCatalogDelta(current, { fromRevision: 1, toRevision: 3, upsertedViews: [], removedViewIds: [] })).toThrow("VIEW_CATALOG_EVENT_GAP");
  });

  it("finds existing Views created from the selected template", () => {
    expect((viewCatalog as any).findTemplateInstances(views, "radial-mind-map").map((view: any) => view.id)).toEqual(["mind"]);
  });
});
