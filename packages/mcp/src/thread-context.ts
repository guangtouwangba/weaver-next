import { createHash } from "node:crypto";
import { previewHost, syntheticChatSessionKey } from "./session-identity.js";

export function chatSessionKeyFromRequest(extra: any): string;
export function chatSessionKeyFromRequest(extra: any, required: true): string;
export function chatSessionKeyFromRequest(extra: any, required: false): string | undefined;
export function chatSessionKeyFromRequest(extra: any, required = true): string | undefined {
  // Unified browser-preview host (Codex or Claude): both the agent (stdio) and
  // the browser widget (loopback) derive the SAME process-synthetic key so they
  // converge on one canvas binding. This deliberately ignores the Codex thread
  // id — the canvas is bound to the process/preview window, not the chat thread,
  // which is what makes the localhost canvas a fully bound agent surface in both
  // hosts. (Binding/lease/task-chat checks are satisfied unchanged.)
  if (previewHost()) return syntheticChatSessionKey();
  const meta = extra?._meta as Record<string, unknown> | undefined;
  const direct = typeof meta?.threadId === "string" ? meta.threadId : undefined;
  const turnMetadata = meta?.["x-codex-turn-metadata"] as Record<string, unknown> | undefined;
  const nested = typeof turnMetadata?.thread_id === "string" ? turnMetadata.thread_id : undefined;
  if (direct && nested && direct !== nested) throw new Error("CODEX_THREAD_METADATA_MISMATCH");
  const threadId = direct ?? nested;
  if (threadId) return createHash("sha256").update(`codex-thread:${threadId}`).digest("hex");
  if (required) throw new Error("CODEX_THREAD_CONTEXT_REQUIRED");
  return undefined;
}
