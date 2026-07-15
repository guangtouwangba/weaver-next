import { describe, expect, it } from "vitest";
import { isTransientStreamError, streamReconnectDelay } from "../lib/stream-reconnect";

describe("stream reconnect policy", () => {
  it("backs off failed setup attempts and caps the retry delay", () => {
    expect([0, 1, 2, 3, 4, 10].map(streamReconnectDelay)).toEqual([250, 1_000, 3_000, 5_000, 5_000, 5_000]);
  });

  it("retries worker replacement and loopback transport failures", () => {
    expect(isTransientStreamError(new Error("WORKER_RESTARTING"))).toBe(true);
    expect(isTransientStreamError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isTransientStreamError(new Error("SESSION_DETACHED"))).toBe(false);
  });
});
