import { describe, expect, it } from "vitest";
import { requestInitialFullscreen, resolveDisplayMode } from "../hooks/useDisplayMode";

describe("Codex display mode", () => {
  it("requests fullscreen only for the initial Codex mount", async () => {
    const requests: Array<{ mode: "fullscreen" }> = [];

    await requestInitialFullscreen("codex", "inline", async (request) => { requests.push(request); });
    await requestInitialFullscreen("codex", "fullscreen", async (request) => { requests.push(request); });

    expect(requests).toEqual([{ mode: "fullscreen" }]);
  });

  it("keeps the inline mode as a reopen surface after fullscreen closes", () => {
    expect(resolveDisplayMode("codex", "fullscreen")).toBe("fullscreen");
    expect(resolveDisplayMode("codex", "inline")).toBe("inline");
  });

  it("does not ask browser hosts to change display mode", async () => {
    let requested = false;
    await requestInitialFullscreen("claude", "inline", async () => { requested = true; });
    await requestInitialFullscreen("dev", "inline", async () => { requested = true; });
    expect(requested).toBe(false);
    expect(resolveDisplayMode("claude", "inline")).toBe("fullscreen");
    expect(resolveDisplayMode("dev", "inline")).toBe("fullscreen");
  });
});
