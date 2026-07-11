import { describe, expect, it, vi } from "vitest";
import { registerCanvasBindingTools } from "../src/tools/canvas-binding.js";

describe("canvas binding tool metadata", () => {
  it("allows the widget to call the canvas context sync tool", () => {
    const registrations = new Map<string, any>();
    const server = {
      registerTool: vi.fn((name: string, config: unknown) => registrations.set(name, config)),
    };

    registerCanvasBindingTools(server as any, { mutateWithStore: vi.fn() as any });

    expect(registrations.get("weaver_sync_canvas_context")?._meta).toMatchObject({
      ui: { visibility: ["app"] },
      "openai/widgetAccessible": true,
    });
  });
});
