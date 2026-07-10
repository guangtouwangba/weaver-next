import { describe, expect, it } from "vitest";
import { scenePackSchema } from "@weaver/contracts";
import { builtinScenePacks } from "../src/index.js";

describe("built-in scene packs", () => {
  it("ships the complete four-category, thirteen-pack catalog", () => {
    expect(builtinScenePacks).toHaveLength(13);
    expect(new Set(builtinScenePacks.map((pack) => pack.id)).size).toBe(13);
    expect(new Set(builtinScenePacks.map((pack) => pack.category))).toEqual(new Set(["thinking", "learning", "research", "planning"]));
    builtinScenePacks.forEach((pack) => expect(scenePackSchema.parse(pack)).toEqual(pack));
  });
});
