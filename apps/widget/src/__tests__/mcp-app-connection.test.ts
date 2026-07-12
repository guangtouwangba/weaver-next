import { describe, expect, it, vi } from "vitest";
import { createMcpAppConnection } from "../mcp-app-connection";

describe("MCP App connection", () => {
  it("shares the explicit UI handshake with tool calls", async () => {
    let finishConnect!: () => void;
    const connect = vi.fn(() => new Promise<void>((resolve) => { finishConnect = resolve; }));
    const close = vi.fn(async () => undefined);
    const callServerTool = vi.fn(async () => ({ structuredContent: { ok: true } }));
    const connection = createMcpAppConnection({ connect, close, callServerTool });

    const handshake = connection.connect();
    const toolCall = connection.callServerTool({ name: "first", arguments: {} });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(callServerTool).not.toHaveBeenCalled();

    finishConnect();
    await expect(Promise.all([handshake, toolCall])).resolves.toEqual([
      undefined,
      { structuredContent: { ok: true } },
    ]);
  });

  it("waits for one shared UI handshake before forwarding concurrent tool calls", async () => {
    let finishConnect!: () => void;
    const connect = vi.fn(() => new Promise<void>((resolve) => { finishConnect = resolve; }));
    const close = vi.fn(async () => undefined);
    const callServerTool = vi.fn(async ({ name }: { name: string }) => ({ structuredContent: { name } }));
    const connection = createMcpAppConnection({ connect, close, callServerTool });

    const first = connection.callServerTool({ name: "first", arguments: {} });
    const second = connection.callServerTool({ name: "second", arguments: {} });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(callServerTool).not.toHaveBeenCalled();

    finishConnect();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { structuredContent: { name: "first" } },
      { structuredContent: { name: "second" } },
    ]);
  });

  it("allows a later retry when the UI handshake fails", async () => {
    const connect = vi.fn()
      .mockRejectedValueOnce(new Error("handshake failed"))
      .mockResolvedValueOnce(undefined);
    const close = vi.fn(async () => undefined);
    const callServerTool = vi.fn(async () => ({ structuredContent: { ok: true } }));
    const connection = createMcpAppConnection({ connect, close, callServerTool });

    await expect(connection.callServerTool({ name: "first", arguments: {} })).rejects.toThrow("handshake failed");
    await expect(connection.callServerTool({ name: "second", arguments: {} })).resolves.toEqual({ structuredContent: { ok: true } });
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("retries an idempotent canvas claim after the MCP proxy drops it", async () => {
    const connect = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const callServerTool = vi.fn()
      .mockRejectedValueOnce(new Error("MCP error -32000: MCP proxy request failed"))
      .mockResolvedValueOnce({ structuredContent: { ok: true } });
    const connection = createMcpAppConnection({ connect, close, callServerTool });

    await expect(connection.callServerTool({
      name: "weaver_canvas_action",
      arguments: { action: "claim", snapshot: { syncPurpose: "claim" } },
    }))
      .resolves.toEqual({ structuredContent: { ok: true } });

    expect(connect).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
    expect(callServerTool).toHaveBeenCalledTimes(2);
  });

  it("does not close the shared MCP connection while another tool call is still in flight", async () => {
    let finishBootstrap!: () => void;
    const bootstrap = new Promise<void>((resolve) => { finishBootstrap = resolve; });
    const connect = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const callServerTool = vi.fn(async ({ name }: { name: string }) => {
      if (name === "bootstrap") {
        await bootstrap;
        return { structuredContent: { name } };
      }
      if (callServerTool.mock.calls.filter(([request]) => request.name === "weaver_canvas_action").length === 1) {
        throw new Error("MCP error -32000: MCP proxy request failed");
      }
      return { structuredContent: { name } };
    });
    const connection = createMcpAppConnection({ connect, close, callServerTool });

    const bootstrapCall = connection.callServerTool({ name: "bootstrap", arguments: {} });
    const claimCall = connection.callServerTool({
      name: "weaver_canvas_action",
      arguments: { action: "claim", snapshot: { syncPurpose: "claim" } },
    });

    await vi.waitFor(() => expect(callServerTool.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(close).not.toHaveBeenCalled();

    finishBootstrap();
    await expect(bootstrapCall).resolves.toEqual({ structuredContent: { name: "bootstrap" } });
    await expect(claimCall).resolves.toEqual({ structuredContent: { name: "weaver_canvas_action" } });
    expect(close).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("does not automatically retry a non-idempotent tool call", async () => {
    const connect = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const callServerTool = vi.fn()
      .mockRejectedValueOnce(new Error("MCP error -32000: MCP proxy request failed"))
      .mockResolvedValueOnce({ structuredContent: { ok: true } });
    const connection = createMcpAppConnection({ connect, close, callServerTool });

    await expect(connection.callServerTool({ name: "weaver_review_action", arguments: {} }))
      .rejects.toThrow("MCP proxy request failed");
    await expect(connection.callServerTool({ name: "weaver_review_action", arguments: {} }))
      .resolves.toEqual({ structuredContent: { ok: true } });

    expect(connect).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
    expect(callServerTool).toHaveBeenCalledTimes(2);
  });
});
