import { describe, expect, it } from "vitest";
import { ensureFullscreen } from "../hooks/useDisplayMode";

describe("Codex display mode", () => {
  it("requests fullscreen when the Codex host starts or returns inline", async () => {
    const requests: Array<{ mode: "fullscreen" }> = [];

    await ensureFullscreen("codex", "inline", async (request) => { requests.push(request); });
    await ensureFullscreen("codex", "fullscreen", async (request) => { requests.push(request); });

    expect(requests).toEqual([{ mode: "fullscreen" }]);
  });

  it("does not ask browser hosts to change display mode", async () => {
    let requested = false;
    await ensureFullscreen("claude", "inline", async () => { requested = true; });
    await ensureFullscreen("dev", "inline", async () => { requested = true; });
    expect(requested).toBe(false);
  });
});
