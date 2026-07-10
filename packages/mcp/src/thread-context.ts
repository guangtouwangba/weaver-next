import { createHash } from "node:crypto";

export function chatSessionKeyFromRequest(extra: any): string;
export function chatSessionKeyFromRequest(extra: any, required: true): string;
export function chatSessionKeyFromRequest(extra: any, required: false): string | undefined;
export function chatSessionKeyFromRequest(extra: any, required = true): string | undefined {
  const meta = extra?._meta as Record<string, unknown> | undefined;
  const direct = typeof meta?.threadId === "string" ? meta.threadId : undefined;
  const turnMetadata = meta?.["x-codex-turn-metadata"] as Record<string, unknown> | undefined;
  const nested = typeof turnMetadata?.thread_id === "string" ? turnMetadata.thread_id : undefined;
  if (direct && nested && direct !== nested) throw new Error("CODEX_THREAD_METADATA_MISMATCH");
  const threadId = direct ?? nested;
  if (!threadId) {
    if (required) throw new Error("CODEX_THREAD_CONTEXT_REQUIRED");
    return undefined;
  }
  return createHash("sha256").update(`codex-thread:${threadId}`).digest("hex");
}
