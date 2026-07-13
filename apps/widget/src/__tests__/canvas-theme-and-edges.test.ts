import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defaultViewTheme, viewThemeSchema } from "@weaver/contracts";
import { canvasThemeForMode } from "../lib/canvas-theme";
import { describeCanvasSelection, shouldPromptForProject, toFlowEdge } from "../lib/graph-view";
import type { GraphNode, Project } from "../types";

describe("canvas appearance", () => {
  it("keeps the left-positioned minimap from stretching to the right edge", () => {
    const styles = readFileSync(resolve(import.meta.dirname, "../styles.css"), "utf8");
    expect(styles).toMatch(/\.hybrid-minimap\s*\{[^}]*left:\s*14px;[^}]*right:\s*auto;/s);
  });

  it("fills new canvas fields when reading a legacy theme", () => {
    const parsed = viewThemeSchema.parse({ ...defaultViewTheme, canvas: { backgroundColor: "#fff", pattern: "dots", patternColor: "#ccc" } });
    expect(parsed.canvas).toMatchObject({ mode: "light", patternGap: 20, patternSize: 1, patternOpacity: 0.55 });
  });

  it("normalises both modes to the near-monochrome design palette with one blue accent", () => {
    const dark = canvasThemeForMode(defaultViewTheme, "dark");
    const light = canvasThemeForMode(dark, "light");
    expect(dark.canvas).toMatchObject({ mode: "dark", backgroundColor: "#0a0a0a" });
    expect(dark.nodeStyles.default).toMatchObject({ fill: "#1f1f1f", textColor: "#fafafa", accentColor: "#1fa2dc" });
    expect(dark.edgeStyles.default.color).toBe("rgba(255,255,255,0.376)");
    // Light is a neutral cool-grey sibling — not the old warm/green tapnow tint.
    expect(light.canvas).toMatchObject({ mode: "light", backgroundColor: "#f4f5f7" });
    expect(light.nodeStyles.default).toMatchObject({ fill: "#ffffff", textColor: "#171a1f", accentColor: "#1585bd" });
    expect(light.canvas.patternColor).not.toBe("#aeb5aa");
  });
});

describe("edge projection", () => {
  it("carries persisted routing and waypoints into the custom renderer", () => {
    const edge = toFlowEdge({ id: "edge-1", sourceNodeId: "a", targetNodeId: "b", type: "context-reference" }, {
      viewId: "v", viewName: "Tree", viewType: "tree", graphRevision: 1, layoutRevision: 2,
      theme: defaultViewTheme,
      nodes: { a: { nodeId: "a", x: 0, y: 0, width: 100, height: 80, pinned: false }, b: { nodeId: "b", x: 300, y: 100, width: 100, height: 80, pinned: false } },
      edges: { "edge-1": { edgeId: "edge-1", routing: "orthogonal", waypoints: [{ x: 100, y: 40 }, { x: 180, y: 40 }, { x: 180, y: 140 }, { x: 300, y: 140 }] } },
    });
    expect(edge.type).toBe("weaver");
    expect(edge.data).toMatchObject({ routing: "orthogonal", semanticType: "context-reference" });
    expect((edge.data as any).waypoints).toHaveLength(4);
    expect(edge).toMatchObject({ sourceHandle: "source-right", targetHandle: "target-left" });
  });
});

describe("model context selection summary", () => {
  const now = new Date().toISOString();
  const node = (id: string, title: string): GraphNode => ({ id, projectId: "p", type: "idea", title, contentKind: "document", content: { kind: "document", mode: "note", markdown: "", excerpt: "", embeddedAssetIds: [] }, properties: {}, archived: false, createdAt: now, updatedAt: now });
  const nodes = [node("a", "Alpha"), node("b", "Beta"), node("c", "Gamma")];

  it("reports no selection when nothing is selected", () => {
    expect(describeCanvasSelection(nodes, [])).toBe("Canvas selection: no nodes are currently selected.");
  });

  it("describes a single anchored node with no references", () => {
    expect(describeCanvasSelection(nodes, ["a"], "a")).toBe('Canvas selection — anchor: "Alpha" (a).');
  });

  it("lists the anchor plus explicit references", () => {
    expect(describeCanvasSelection(nodes, ["a", "b", "c"], "b")).toBe('Canvas selection — anchor: "Beta" (b); also referencing: "Alpha" (a), "Gamma" (c).');
  });

  it("falls back to the first selected node when no anchor is set", () => {
    expect(describeCanvasSelection(nodes, ["b", "c"])).toBe('Canvas selection — anchor: "Beta" (b); also referencing: "Gamma" (c).');
  });
});

describe("project picker gating", () => {
  const project = (id: string): Project => ({ id, title: id, defaultViewId: "v", graphRevision: 0, viewCatalogRevision: 0, scenePackId: "s", scenePackVersion: "1.0.0" });

  it("never prompts with zero or one project", () => {
    expect(shouldPromptForProject([])).toBe(false);
    expect(shouldPromptForProject([project("a")])).toBe(false);
  });

  it("prompts with multiple projects and no bound project id", () => {
    expect(shouldPromptForProject([project("a"), project("b")])).toBe(true);
  });

  it("does not prompt once a project id is already bound", () => {
    expect(shouldPromptForProject([project("a"), project("b")], "a")).toBe(false);
  });
});
