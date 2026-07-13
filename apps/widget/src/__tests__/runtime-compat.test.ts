import { describe, expect, it } from "vitest";
import { assertRuntimeCompatibility } from "../lib/runtime-compat";

describe("localhost runtime identity", () => {
  const expected = { buildId: "build-a", protocolVersion: 1 };

  it("accepts only the exact HTML-pinned build and protocol", () => {
    expect(() => assertRuntimeCompatibility(expected, expected)).not.toThrow();
    expect(() => assertRuntimeCompatibility(expected, { buildId: "build-b", protocolVersion: 1 })).toThrow("BUILD_MISMATCH");
    expect(() => assertRuntimeCompatibility(expected, { buildId: "build-a", protocolVersion: 2 })).toThrow("PROTOCOL_MISMATCH");
    expect(() => assertRuntimeCompatibility(expected, {})).toThrow("PROTOCOL_MISMATCH");
  });
});
