import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { chatSessionKeyFromRequest } from "../src/thread-context.js";
import { syntheticChatSessionKey } from "../src/session-identity.js";

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

describe("Claude host identity fallback", () => {
  afterEach(() => {
    delete process.env.WEAVER_HOST_KIND;
  });

  it("derives a stable synthetic key when the process is the Claude host and no Codex thread is present", () => {
    process.env.WEAVER_HOST_KIND = "claude";
    const first = chatSessionKeyFromRequest({ _meta: {} });
    const second = chatSessionKeyFromRequest({});
    expect(first).toBe(second);
    expect(first).toBe(syntheticChatSessionKey());
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it("derives the synthetic key from cwd so co-spawned host processes converge on one binding", () => {
    // Codex spawns >1 MCP process per launch (all sharing cwd) and re-spawns on
    // restart. A cwd-anchored key makes every one of them resolve to the same
    // binding — the fix for the browser and agent landing on different keys.
    const expected = createHash("sha256").update(`weaver-launch:${process.cwd()}`).digest("hex");
    expect(syntheticChatSessionKey()).toBe(expected);
  });

  it("keeps the synthetic key distinct from any Codex thread key", () => {
    process.env.WEAVER_HOST_KIND = "claude";
    const claudeKey = chatSessionKeyFromRequest({ _meta: {} });
    const codexKey = createHash("sha256").update("codex-thread:some-thread").digest("hex");
    expect(claudeKey).not.toBe(codexKey);
  });

  it("uses the process-synthetic key under a preview host, ignoring any Codex thread id", () => {
    // Unified browser-preview design: the canvas is bound to the process/preview
    // window (so the agent and the loopback browser converge), NOT the chat
    // thread — so the synthetic key wins over a threadId under any preview host.
    for (const host of ["claude", "codex"] as const) {
      process.env.WEAVER_HOST_KIND = host;
      const withThread = chatSessionKeyFromRequest({ _meta: { threadId: "codex-1" } });
      const withoutThread = chatSessionKeyFromRequest({ _meta: {} });
      expect(withThread).toBe(withoutThread);
      expect(withThread).not.toBe(createHash("sha256").update("codex-thread:codex-1").digest("hex"));
    }
  });

  it("falls back to the Codex thread key only when NOT a preview host", () => {
    delete process.env.WEAVER_HOST_KIND;
    const key = chatSessionKeyFromRequest({ _meta: { threadId: "codex-1" } });
    expect(key).toBe(createHash("sha256").update("codex-thread:codex-1").digest("hex"));
  });

  it("still fails closed when neither a preview host nor a Codex thread is present", () => {
    delete process.env.WEAVER_HOST_KIND;
    expect(() => chatSessionKeyFromRequest({ _meta: {} })).toThrow("CODEX_THREAD_CONTEXT_REQUIRED");
    expect(chatSessionKeyFromRequest({ _meta: {} }, false)).toBeUndefined();
  });
});
