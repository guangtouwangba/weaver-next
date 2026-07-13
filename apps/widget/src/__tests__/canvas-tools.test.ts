import { describe, expect, it } from "vitest";
import { alignNodes, distributeNodes, offsetForPaste } from "../lib/canvas-tools";

const node = (id: string, x: number, y: number, width = 100, height = 60) => ({ id, position: { x, y }, data: {}, style: { width, height } }) as any;

describe("professional canvas geometry", () => {
  it("aligns a selection without changing relative size", () => {
    const result = alignNodes([node("a", 10, 20), node("b", 90, 80)], "left");
    expect(result.map((item) => item.position.x)).toEqual([10, 10]);
  });

  it("distributes three nodes evenly", () => {
    const result = distributeNodes([node("a", 0, 0), node("b", 25, 30), node("c", 100, 60)], "horizontal");
    expect(result.map((item) => item.position.x)).toEqual([0, 50, 100]);
  });

  it("uses a visible deterministic paste offset", () => {
    expect(offsetForPaste(0)).toBe(32);
    expect(offsetForPaste(2)).toBe(64);
  });
});
