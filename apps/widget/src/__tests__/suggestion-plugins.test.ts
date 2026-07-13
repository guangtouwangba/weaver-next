import { describe, expect, it } from "vitest";
import { suggestionPluginKey } from "../components/nodes/slash-command";

describe("node editor suggestion plugins", () => {
  it("gives slash commands and reference mentions distinct ProseMirror keys", () => {
    const key = (name: string) => (suggestionPluginKey(name) as unknown as { key: string }).key;
    expect(key("slashCommand")).not.toBe(key("referenceMention"));
  });
});
