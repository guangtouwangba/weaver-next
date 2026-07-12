import { describe, expect, it } from "vitest";
import { resolveEdgeVisual, semanticEdgeDefault } from "../lib/edge-style";

describe("semantic edge defaults", () => {
  it("defaults every relationship type to straight routing", () => {
    for (const type of ["relates-to", "has-attribute", "association", "reference", "context-reference"]) {
      expect(semanticEdgeDefault(type).routing).toBe("straight");
    }
  });

  it("draws directed relationships with a forward arrow and solid line", () => {
    expect(semanticEdgeDefault("relates-to")).toMatchObject({ lineStyle: "solid", arrows: "forward" });
    expect(semanticEdgeDefault("has-attribute")).toMatchObject({ lineStyle: "solid", arrows: "forward" });
  });

  it("draws associations undirected and references as muted dashes", () => {
    expect(semanticEdgeDefault("association")).toMatchObject({ arrows: "none", lineStyle: "solid" });
    expect(semanticEdgeDefault("context-reference")).toMatchObject({ arrows: "none", lineStyle: "dashed", muted: true });
    expect(semanticEdgeDefault("reference")).toMatchObject({ arrows: "none", lineStyle: "dashed", muted: true });
  });

  it("falls back to a solid forward straight edge for unknown types", () => {
    expect(semanticEdgeDefault("mystery-relation")).toEqual({ lineStyle: "solid", arrows: "forward", routing: "straight" });
    expect(semanticEdgeDefault(undefined)).toEqual({ lineStyle: "solid", arrows: "forward", routing: "straight" });
  });
});

describe("resolveEdgeVisual override precedence", () => {
  it("uses the semantic default when there is no override", () => {
    expect(resolveEdgeVisual("context-reference")).toEqual({ lineStyle: "dashed", arrows: "none", routing: "straight", muted: true });
  });

  it("lets a per-edge override win over the semantic default", () => {
    const visual = resolveEdgeVisual("relates-to", { lineStyle: "dashed", arrows: "both", routing: "bezier" });
    expect(visual).toMatchObject({ lineStyle: "dashed", arrows: "both", routing: "bezier" });
  });

  it("keeps muted as a property of the type even when overridden to solid", () => {
    const visual = resolveEdgeVisual("reference", { lineStyle: "solid", arrows: "forward" });
    expect(visual).toMatchObject({ lineStyle: "solid", arrows: "forward", muted: true });
  });

  it("applies partial overrides field by field", () => {
    expect(resolveEdgeVisual("association", { arrows: "forward" })).toMatchObject({ arrows: "forward", lineStyle: "solid", routing: "straight" });
  });
});
