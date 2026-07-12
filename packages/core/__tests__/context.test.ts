import { describe, expect, it } from "vitest";
import { scenePackSchema, type SpaceEdge, type SpaceNode } from "@weaver/contracts";
import { resolveSceneContext } from "../src/context.js";

const node = (id: string, archived = false): SpaceNode => ({ id, projectId: "p", type: "claim", title: id, contentKind: "document", content: { kind: "document", mode: "note", markdown: "", excerpt: "", embeddedAssetIds: [] }, properties: {}, archived, createdAt: "x", updatedAt: "x" });
const edge = (id: string, sourceNodeId: string, targetNodeId: string): SpaceEdge => ({ id, projectId: "p", type: "supports", sourceNodeId, targetNodeId, directed: true, properties: {}, archived: false, createdAt: "x", updatedAt: "x" });
const pack = (modes: Array<"ancestor_path" | "typed_neighborhood" | "selected_nodes" | "pinned_nodes">, maxNodes = 40) => scenePackSchema.parse({ id: "argument-map", version: "1", name: "Argument", category: "thinking", description: "", nodeTypes: [{ key: "claim", label: "Claim", requiredProperties: [], properties: [], defaultContentKind: "document", allowedContentKinds: ["document"] }], edgeTypes: [{ key: "supports", label: "Supports", directed: true, sourceTypes: [], targetTypes: [] }], recommendedViews: ["graph"], defaultView: "graph", allowedStrategies: ["layered"], defaultStrategy: "layered", contextPolicy: { modes, maxNodes, maxHops: 1 }, artifactTypes: [], scoringWeights: {}, recommendedTemplateIds: [] });

describe("resolveSceneContext", () => {
  it("keeps ancestor paths isolated from sibling descendants", () => {
    const result = resolveSceneContext({ nodes: [node("root"), node("a"), node("a1"), node("b")], edges: [edge("e1", "root", "a"), edge("e2", "a", "a1"), edge("e3", "root", "b")], scenePack: pack(["selected_nodes", "ancestor_path"]), selectedNodeIds: ["a1"], pinnedNodeIds: [] });
    expect(result.nodeIds).toEqual(["a1", "a", "root"]); expect(result.nodeIds).not.toContain("b");
  });
  it("orders typed neighborhoods deterministically and reports truncation", () => {
    const result = resolveSceneContext({ nodes: [node("a"), node("b"), node("c"), node("gone", true)], edges: [edge("e1", "a", "c"), edge("e2", "a", "b")], scenePack: pack(["selected_nodes", "typed_neighborhood"], 2), selectedNodeIds: ["a"], pinnedNodeIds: [] });
    expect(result.nodeIds).toEqual(["a", "b"]); expect(result.truncated).toBe(true); expect(result.excludedArchivedNodeIds).toEqual(["gone"]);
    expect(result.diagnostics).toMatchObject({ requestedNodeCount: 3, includedNodeCount: 2, omittedNodeIds: ["c"], maxNodes: 2, maxHops: 1 });
  });
  it("prioritizes sorted pins and excludes types outside the Scene Pack", () => {
    const alien = { ...node("alien"), type: "undeclared" };
    const result = resolveSceneContext({ nodes: [node("selected"), node("pin-b"), node("pin-a"), alien], edges: [edge("e", "selected", "alien")], scenePack: pack(["selected_nodes", "pinned_nodes", "typed_neighborhood"], 3), selectedNodeIds: ["selected"], pinnedNodeIds: ["pin-b", "pin-a"] });
    expect(result.nodeIds).toEqual(["selected", "pin-a", "pin-b"]);
    expect(result.nodeIds).not.toContain("alien");
  });
});
