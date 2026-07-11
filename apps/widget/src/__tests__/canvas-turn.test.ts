import { describe, expect, it } from "vitest";
import { composeCanvasTurnMessage } from "../lib/canvas-turn";

describe("composeCanvasTurnMessage (canvas composer → Codex user turn)", () => {
  it("embeds the selection context in the message itself, not just model context", () => {
    const text = composeCanvasTurnMessage("这个内容具体是什么", 'Canvas selection — anchor: "全球代表生态" (node-1).');
    expect(text).toContain("全球代表生态");
    expect(text).toContain("这个内容具体是什么");
    expect(text).toContain("weaver_get_bound_canvas");
    expect(text).toContain("weaver_submit_changeset");
  });

  it("states explicitly when nothing is selected", () => {
    const text = composeCanvasTurnMessage("总结一下这个画布");
    expect(text).toContain("未选中任何节点");
    expect(text).toContain("总结一下这个画布");
  });
});
