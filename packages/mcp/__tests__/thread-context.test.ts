import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { chatSessionKeyFromRequest } from "../src/thread-context.js";

describe("Codex thread context", () => {
  it("cross-checks both metadata fields and stores only a deterministic hash", () => {
    const threadId = "019-test-thread";
    const key = chatSessionKeyFromRequest({ _meta: { threadId, "x-codex-turn-metadata": { thread_id: threadId } } });
    expect(key).toBe(createHash("sha256").update(`codex-thread:${threadId}`).digest("hex"));
    expect(key).not.toContain(threadId);
  });

  it("fails closed when trusted metadata is missing or inconsistent", () => {
    expect(() => chatSessionKeyFromRequest({ _meta: { threadId: "a", "x-codex-turn-metadata": { thread_id: "b" } } })).toThrow("CODEX_THREAD_METADATA_MISMATCH");
    expect(() => chatSessionKeyFromRequest({ _meta: {} })).toThrow("CODEX_THREAD_CONTEXT_REQUIRED");
    expect(chatSessionKeyFromRequest({ _meta: {} }, false)).toBeUndefined();
  });
});
