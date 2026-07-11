import { describe, expect, it, vi } from "vitest";
import { createShutdown } from "../src/shutdown.js";

describe("MCP shutdown", () => {
  it("closes stdio and the event hub once before exiting", async () => {
    const server = { close: vi.fn(async () => undefined) };
    const eventHub = { close: vi.fn(async () => undefined) };
    const exit = vi.fn();
    const shutdown = createShutdown(server, eventHub, exit);

    await Promise.all([shutdown(), shutdown()]);

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(eventHub.close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(exit).toHaveBeenCalledTimes(1);
  });
});
