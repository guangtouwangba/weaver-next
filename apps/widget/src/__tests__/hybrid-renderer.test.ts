import { describe, expect, it } from "vitest";
import {
  SceneIndex,
  cameraForBounds,
  compileRenderScene,
  edgePoints,
  edgePointsForFrames,
  hitTestEdge,
  navigationTarget,
  resolveLod,
  screenToWorld,
  visibleDomNodeIds,
  worldToScreen,
  zoomCameraAt,
  type Camera,
  type RenderNode,
} from "../lib/hybrid-renderer";
import type { GraphEdge, GraphNode, Layout } from "../types";

const node = (id: string, x: number, y: number): RenderNode => ({
  id,
  kind: "document",
  title: id,
  semanticType: "entity",
  x,
  y,
  width: 100,
  height: 60,
  pinned: false,
  content: { kind: "document", mode: "note", excerpt: id, embeddedAssetIds: [] },
});

describe("hybrid renderer camera", () => {
  it("keeps the world point under the pointer stable while zooming", () => {
    const camera: Camera = { x: 120, y: 80, zoom: 1 };
    const pointer = { x: 420, y: 280 };
    const before = screenToWorld(pointer, camera);
    const next = zoomCameraAt(camera, pointer, 1.8);
    expect(screenToWorld(pointer, next)).toEqual(before);
    expect(worldToScreen(before, next)).toEqual(pointer);
  });

  it("fits bounds without exceeding the supported zoom range", () => {
    expect(cameraForBounds({ x: 0, y: 0, width: 1000, height: 500 }, { width: 500, height: 500 }, 0.1)).toEqual({ x: 50, y: 150, zoom: 0.4 });
  });
});

describe("hybrid renderer level of detail", () => {
  it("uses GPU-only rendering while interacting and restores rich DOM when idle", () => {
    expect(resolveLod(1, false)).toBe("rich");
    expect(resolveLod(1, true)).toBe("compact");
    expect(resolveLod(0.5, false)).toBe("compact");
    expect(resolveLod(0.2, false)).toBe("overview");
  });

  it("mounts at most 100 rich nodes from the visible overscan region", () => {
    const nodes = Array.from({ length: 150 }, (_, index) => node(String(index), index * 10, 0));
    const index = new SceneIndex(nodes);
    expect(visibleDomNodeIds(index, { x: 0, y: 0, width: 2000, height: 200 }, 100)).toHaveLength(100);
  });
});

describe("hybrid renderer scene projection", () => {
  const graphNodes: GraphNode[] = [
    { id: "a", projectId: "p", type: "entity", title: "Alpha", contentKind: "document", content: { kind: "document", mode: "note", excerpt: "A", embeddedAssetIds: [] }, properties: {}, archived: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
    { id: "b", projectId: "p", type: "entity", title: "Beta", contentKind: "document", content: { kind: "document", mode: "note", excerpt: "B", embeddedAssetIds: [] }, properties: {}, archived: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
  ];
  const graphEdges: GraphEdge[] = [{ id: "e", type: "relates-to", sourceNodeId: "a", targetNodeId: "b" }];

  const layoutFor = (viewType: Layout["viewType"], projection: Layout["projection"]): Layout => ({
    viewId: `view-${viewType}`,
    viewName: viewType,
    viewType,
    graphRevision: 3,
    layoutRevision: 4,
    projection,
    nodes: {
      a: { nodeId: "a", x: 0, y: 0, width: 280, height: 160, pinned: false },
      b: { nodeId: "b", x: 400, y: 200, width: 280, height: 160, pinned: true },
    },
    edges: { e: { edgeId: "e", routing: "straight", waypoints: [{ x: 340, y: 80 }] } },
  });

  it.each([
    ["canvas", { kind: "canvas", nodeTypes: [], edgeTypes: [], clusterBy: "none" }],
    ["tree", { kind: "tree", nodeTypes: [], edgeTypes: [], parentEdgeTypes: [], direction: "top-bottom" }],
    ["graph", { kind: "graph", nodeTypes: [], edgeTypes: [], relationshipDistance: 180 }],
    ["flow", { kind: "flow", nodeTypes: [], edgeTypes: [], stepEdgeTypes: [], direction: "left-right" }],
    ["timeline", { kind: "timeline", nodeTypes: [], edgeTypes: [], timeField: "occurredAt", direction: "left-right" }],
    ["board", { kind: "board", nodeTypes: [], edgeTypes: [], columnField: "status", columnOrder: [] }],
    ["table", { kind: "table", nodeTypes: [], edgeTypes: [], columns: [{ key: "title", label: "Title", source: "title" }] }],
  ] as const)("compiles the %s view through one stable scene interface", (viewType, projection) => {
    const scene = compileRenderScene(graphNodes, graphEdges, layoutFor(viewType, projection));
    expect(scene.projection).toBe(projection.kind);
    expect(scene.nodes.map((item) => item.id)).toEqual(["a", "b"]);
    expect(scene.edges[0]).toMatchObject({ id: "e", sourceId: "a", targetId: "b", waypoints: [{ x: 340, y: 80 }] });
    expect(scene.revisionKey).toBe(`3:4:view-${viewType}`);
  });

  it("supports the matrix projection while retaining the board View type", () => {
    const projection = { kind: "matrix", nodeTypes: [], edgeTypes: [], xField: "impact", yField: "effort", xLabels: ["Low", "High"], yLabels: ["Low", "High"], quadrantLabels: ["Q1", "Q2", "Q3", "Q4"] } as const;
    expect(compileRenderScene(graphNodes, graphEdges, layoutFor("board", projection)).projection).toBe("matrix");
  });

  it("carries safe preview URLs into the GPU scene without changing graph content", () => {
    const layout = layoutFor("graph", { kind: "graph", nodeTypes: [], edgeTypes: [], relationshipDistance: 180 });
    const scene = compileRenderScene(graphNodes, graphEdges, layout, new Map([["a", { imageSrc: "data:image/png;base64,abc" }]]));
    expect(scene.nodes[0].imageSrc).toBe("data:image/png;base64,abc");
    expect(graphNodes[0].content.kind).toBe("document");
  });

  it("finds the nearest node in the requested keyboard direction", () => {
    const nodes = [node("center", 100, 100), node("right-near", 260, 105), node("right-far", 500, 100), node("below", 100, 300)];
    expect(navigationTarget(nodes, "center", "right")).toBe("right-near");
    expect(navigationTarget(nodes, "center", "down")).toBe("below");
  });

  it("hits the topmost node and culls nodes outside a viewport", () => {
    const index = new SceneIndex([{ ...node("back", 0, 0), zIndex: 0 }, { ...node("front", 20, 20), zIndex: 2 }, node("far", 500, 500)]);
    expect(index.hit({ x: 30, y: 30 })?.id).toBe("front");
    expect(index.search({ x: -10, y: -10, width: 160, height: 120 }).map((item) => item.id)).toEqual(["back", "front"]);
  });

  it("routes an edge through persisted waypoints between node centers", () => {
    const nodes = [node("a", 0, 0), node("b", 300, 200)];
    expect(edgePoints({ id: "e", sourceId: "a", targetId: "b", semanticType: "relates", waypoints: [{ x: 200, y: 100 }] }, new Map(nodes.map((item) => [item.id, item])))).toEqual([
      { x: 50, y: 30 },
      { x: 200, y: 100 },
      { x: 350, y: 230 },
    ]);
  });

  it("moves only associated edge endpoints with transient drag frames", () => {
    const nodes = [node("a", 0, 0), node("b", 300, 200)];
    expect(edgePointsForFrames({ id: "e", sourceId: "a", targetId: "b", semanticType: "relates", waypoints: [] }, new Map(nodes.map((item) => [item.id, item])), [{ id: "a", x: 80, y: 40, width: 100, height: 60 }])).toEqual([
      { x: 130, y: 70 },
      { x: 350, y: 230 },
    ]);
  });

  it("selects only an edge inside the world-space tolerance", () => {
    const nodes = [node("a", 0, 0), node("b", 300, 200)];
    const scene = { revisionKey: "1:1:v", projection: "graph" as const, nodes, groups: [], bounds: { x: 0, y: 0, width: 400, height: 260 }, edges: [{ id: "e", sourceId: "a", targetId: "b", semanticType: "relates", waypoints: [] }] };
    expect(hitTestEdge(scene, { x: 200, y: 130 }, 8)?.id).toBe("e");
    expect(hitTestEdge(scene, { x: 200, y: 180 }, 8)).toBeNull();
  });
});
