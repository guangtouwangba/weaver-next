import { describe, expect, it } from "vitest";
import { buildWidgetBenchmarkScene } from "../lib/benchmark-scene";

describe("widget performance fixture", () => {
  it("creates a deterministic 500 node / 1000 edge graph", () => {
    const first = buildWidgetBenchmarkScene(500, 1000);
    const second = buildWidgetBenchmarkScene(500, 1000);
    expect(first.nodes).toHaveLength(500);
    expect(first.edges).toHaveLength(1000);
    expect(first.layoutNodes).toHaveLength(500);
    expect(first).toEqual(second);
    expect(new Set(first.edges.map((edge) => edge.id)).size).toBe(1000);
    expect(first.edges.every((edge) => edge.sourceNodeId !== edge.targetNodeId)).toBe(true);
  });
});
