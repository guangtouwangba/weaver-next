import { describe, expect, it } from "vitest";
import { layoutDocumentSchema, type LayoutDocument, type LayoutOperation } from "@weaver/contracts";
import { applyLayoutOperations, diffLayoutDocuments } from "../src/layout.js";

const baseDoc = (): LayoutDocument => layoutDocumentSchema.parse({
  projectId: "p", viewId: "v", viewType: "canvas", graphRevision: 1, layoutRevision: 1,
  viewName: "Canvas", strategy: "cluster",
  config: { direction: "left-right", nodeSpacing: 72, rankSpacing: 120, density: 1, viewportWidth: 1280, viewportHeight: 800 },
  nodes: { n1: { nodeId: "n1", x: 0, y: 0, width: 100, height: 80 }, n2: { nodeId: "n2", x: 200, y: 0, width: 100, height: 80 } },
  edges: {}, groups: {}, bounds: { x: 0, y: 0, width: 0, height: 0 }, createdBy: "user", updatedAt: "x",
});
const view = "v";

describe("operable group operations", () => {
  it("creates, renames, and dissolves a group without touching member nodes", () => {
    const created = applyLayoutOperations(baseDoc(), [
      { type: "create-group", viewId: view, groupId: "g1", frame: { x: -10, y: -10, width: 320, height: 120 }, label: "Cluster A", kind: "interaction" },
      { type: "assign-node-to-group", viewId: view, nodeId: "n1", groupId: "g1" },
      { type: "assign-node-to-group", viewId: view, nodeId: "n2", groupId: "g1" },
    ]);
    expect(created.groups.g1).toMatchObject({ groupId: "g1", label: "Cluster A", kind: "interaction", width: 320 });
    expect(created.nodes.n1.groupId).toBe("g1");

    const renamed = applyLayoutOperations(created, [{ type: "rename-group", viewId: view, groupId: "g1", label: "Renamed" }]);
    expect(renamed.groups.g1.label).toBe("Renamed");

    const dissolved = applyLayoutOperations(renamed, [{ type: "delete-group", viewId: view, groupId: "g1" }]);
    expect(dissolved.groups.g1).toBeUndefined();
    // Members keep their position and simply lose their groupId.
    expect(dissolved.nodes.n1).toMatchObject({ x: 0, y: 0, groupId: undefined });
    expect(dissolved.nodes.n2.groupId).toBeUndefined();
  });

  it("defaults a created group's kind to interaction", () => {
    const created = applyLayoutOperations(baseDoc(), [{ type: "create-group", viewId: view, groupId: "g2", frame: { x: 0, y: 0, width: 100, height: 100 } }]);
    expect(created.groups.g2.kind).toBe("interaction");
  });

  it("rejects renaming a group that does not exist", () => {
    expect(() => applyLayoutOperations(baseDoc(), [{ type: "rename-group", viewId: view, groupId: "ghost", label: "x" }])).toThrow(/LAYOUT_GROUP_NOT_FOUND/);
  });

  it("round-trips group create and delete through diff", () => {
    const before = baseDoc();
    const after = applyLayoutOperations(before, [
      { type: "create-group", viewId: view, groupId: "g1", frame: { x: 0, y: 0, width: 200, height: 100 }, label: "A", kind: "semantic" },
      { type: "assign-node-to-group", viewId: view, nodeId: "n1", groupId: "g1" },
    ]);
    const forward = diffLayoutDocuments(before, after);
    expect(forward).toContainEqual<LayoutOperation>({ type: "create-group", viewId: view, groupId: "g1", frame: { x: 0, y: 0, width: 200, height: 100 }, label: "A", kind: "semantic", direction: undefined });
    // Applying the diff to `before` reproduces `after`'s groups and membership.
    const replayed = applyLayoutOperations(before, forward);
    expect(replayed.groups.g1).toMatchObject({ label: "A", kind: "semantic" });
    expect(replayed.nodes.n1.groupId).toBe("g1");

    const back = diffLayoutDocuments(after, before);
    expect(back).toContainEqual<LayoutOperation>({ type: "delete-group", viewId: view, groupId: "g1" });
  });
});
