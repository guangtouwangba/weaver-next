import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { initialDisplayMode } from "../hooks/useDisplayMode";

describe("Codex display mode", () => {
  it("starts in fullscreen and does not render the inline snapshot entry", () => {
    expect(initialDisplayMode()).toBe("fullscreen");

    const main = readFileSync(resolve(import.meta.dirname, "../main.tsx"), "utf8");
    expect(main).not.toContain("InlineEntryCard");
  });
});
