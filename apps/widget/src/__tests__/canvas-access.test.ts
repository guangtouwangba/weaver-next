import { describe, expect, it } from "vitest";
import { acknowledgedCanvasSequence, canvasAccessFromError, hasWidgetBuildMismatch, toolErrorMessage } from "../canvas-access";

describe("Canvas access guards", () => {
  it("maps duplicate and stale bindings to non-writable UI states", () => {
    expect(canvasAccessFromError(new Error("CANVAS_ALREADY_ACTIVE"))).toBe("duplicate");
    expect(canvasAccessFromError(new Error("CHAT_CANVAS_LEASE_STALE"))).toBe("detached");
    expect(canvasAccessFromError(new Error("OTHER"))).toBeUndefined();
  });

  it("preserves a structured MCP error code when the display text is generic", () => {
    expect(toolErrorMessage({ isError: true, structuredContent: { code: "CHAT_CANVAS_LEASE_STALE" }, content: [{ type: "text", text: "CANVAS_CLAIM_FAILED" }] }, "fallback"))
      .toBe("CHAT_CANVAS_LEASE_STALE: CANVAS_CLAIM_FAILED");
  });

  it("blocks build mismatches only in the development flow", () => {
    expect(hasWidgetBuildMismatch({ workspaceDir: "/tmp", runtimeMode: "development", widgetBuildId: "server" }, "cached")).toBe(true);
    expect(hasWidgetBuildMismatch({ workspaceDir: "/tmp", runtimeMode: "development", widgetBuildId: "same" }, "same")).toBe(false);
    expect(hasWidgetBuildMismatch({ workspaceDir: "/tmp", runtimeMode: "development", buildMismatch: true }, "same")).toBe(true);
    // Installed mode: process-generation skew during a plugin update is a normal
    // transient (old process serves the HTML, a newer sibling answers the tool
    // call) — never brick the canvas over it.
    expect(hasWidgetBuildMismatch({ workspaceDir: "/tmp", runtimeMode: "installed", widgetBuildId: "server" }, "cached")).toBe(false);
    expect(hasWidgetBuildMismatch({ workspaceDir: "/tmp", runtimeMode: "installed", buildMismatch: true }, "same")).toBe(false);
    expect(hasWidgetBuildMismatch({ workspaceDir: "/tmp", widgetBuildId: "server" }, "cached")).toBe(false);
  });

  it("adopts the server-confirmed sequence after an atomic claim", () => {
    expect(acknowledgedCanvasSequence(3, { context: { sequence: 9 } })).toBe(9);
    expect(acknowledgedCanvasSequence(3, undefined)).toBe(3);
    expect(acknowledgedCanvasSequence(3, { context: { sequence: 2 } })).toBe(3);
  });
});
