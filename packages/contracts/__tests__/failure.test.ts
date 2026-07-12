import { describe, expect, it } from "vitest";
import { normalizeWeaverFailure, WeaverError, weaverFailureSchema } from "../src/index.js";

describe("WeaverFailure", () => {
  it("preserves typed code, details and retryability", () => {
    const failure = normalizeWeaverFailure(new WeaverError("GRAPH_REVISION_CONFLICT", "stale graph", { expected: 3 }));
    expect(weaverFailureSchema.parse(failure)).toEqual({ code: "GRAPH_REVISION_CONFLICT", message: "stale graph", details: { expected: 3 }, retryable: true });
  });
  it("does not expose unknown string codes", () => {
    expect(normalizeWeaverFailure(new Error("SOMETHING_NEW: nope"))).toEqual({ code: "INTERNAL", message: "SOMETHING_NEW: nope", retryable: false });
  });
});
