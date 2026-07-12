import { describe, expect, it } from "vitest";
import { widgetBootstrapSchema, widgetGraphNodeSchema, widgetLayoutSchema, widgetProjectEventSchema } from "../src/index.js";

const documentNode = { id: "n", projectId: "p", type: "entity", title: "Robot", contentKind: "document", content: { kind: "document", mode: "note", excerpt: "robotics", embeddedAssetIds: [] }, properties: {}, archived: false, createdAt: "now", updatedAt: "now" };

describe("Widget contracts", () => {
  it("parses the bootstrap and graph-summary projections", () => {
    expect(widgetBootstrapSchema.parse({ workspaceDir: "/w", preferredDisplayMode: "fullscreen", chatBinding: { leaseId: "l", bindingRevision: 1 } }).workspaceDir).toBe("/w");
    expect(widgetGraphNodeSchema.parse(documentNode).content.kind).toBe("document");
  });

  it("parses the independent layout projection", () => {
    const layout = widgetLayoutSchema.parse({ viewId: "v", viewName: "Robot map", viewType: "graph", graphRevision: 3, layoutRevision: 5, nodes: { n: { nodeId: "n", x: 0, y: 0, width: 280, height: 160, pinned: false } } });
    expect(layout.layoutRevision).toBe(5);
    expect(() => widgetLayoutSchema.parse({ ...layout, viewType: "unknown" })).toThrow();
  });

  it("parses every Widget event discriminant and rejects malformed payloads", () => {
    const events = [
      { kind: "graph.changed", payload: { fromRevision: 1, toRevision: 2, addedNodes: [documentNode], updatedNodes: [], archivedNodeIds: [], addedEdges: [], updatedEdges: [], archivedEdgeIds: [] } },
      { kind: "layout.changed", payload: { viewId: "v", fromRevision: 1, toRevision: 2, operations: [] } },
      { kind: "view.created", payload: { viewId: "v" } },
      { kind: "view.catalog.changed", payload: { projectId: "p", fromRevision: 1, toRevision: 2, upsertedViews: [], removedViewIds: [] } },
      { kind: "chat.binding.changed", payload: { bindingRevision: 2, status: "active" } },
      { kind: "stream.reset", payload: {} },
    ];
    events.forEach((event, index) => expect(widgetProjectEventSchema.parse({ sequence: index + 1, ...event }).kind).toBe(event.kind));
    expect(() => widgetProjectEventSchema.parse({ sequence: 7, kind: "graph.changed", payload: { toRevision: 2 } })).toThrow();
    expect(() => widgetProjectEventSchema.parse({ sequence: 8, kind: "unknown", payload: {} })).toThrow();
  });
});
