import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { InlineLauncher } from "../components/InlineLauncher";

describe("InlineLauncher", () => {
  it("keeps a manual reopen action after the fullscreen canvas is closed", () => {
    const html = renderToStaticMarkup(<InlineLauncher projectTitle="AI hardware" status="24 nodes" labels={{ currentSpace: "当前空间", spaceFallback: "Weaver 空间", brandSubtitle: "语义画布", reopen: "重新打开 Weaver", collapsed: "画布已收起", hint: "点击重新打开" }} onOpen={vi.fn()} />);

    expect(html).toContain("AI hardware");
    expect(html).toContain("重新打开 Weaver");
    expect(html).toContain("24 nodes");
  });
});
