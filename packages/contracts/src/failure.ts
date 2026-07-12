import { z } from "zod";

export const weaverErrorCodes = [
  "ACTIVE_CANVAS_TASK_EXISTS", "AGENT_DISPATCH_NOT_FOUND", "AGENT_TASK_NOT_FOUND",
  "ASSET_NOT_FOUND", "ASSET_NOT_FOUND_OR_CROSS_PROJECT", "BOUND_CANVAS_NOT_READY",
  "BOUND_CANVAS_OFFLINE", "BROWSER_PREVIEW_AGENT_UNAVAILABLE", "CANVAS_ALREADY_ACTIVE",
  "CANVAS_SESSION_NOT_FOUND", "CATALOG_INVALID", "CHANGESET_NOT_FOUND",
  "CHAT_CANVAS_LEASE_STALE", "CODEX_THREAD_CONTEXT_REQUIRED", "GRAPH_REVISION_CONFLICT",
  "IMAGE_DIMENSIONS_MISSING", "IMAGE_TOO_LARGE", "IMAGE_TYPE_MISMATCH", "INVALID_ARGS",
  "LAST_ACTIVE_VIEW", "LAYOUT_CANDIDATE_NOT_FOUND", "LAYOUT_HARD_VIOLATION",
  "LAYOUT_HISTORY_EMPTY", "LAYOUT_NOT_FOUND", "LAYOUT_REVISION_CONFLICT",
  "LAYOUT_RUN_NOT_FOUND", "LAYOUT_RUN_NOT_PENDING", "NO_CANVAS_BOUND_TO_CHAT",
  "NODE_NOT_FOUND", "PROJECT_NOT_FOUND", "STALE_CANVAS_SEQUENCE", "TASK_BINDING_STALE",
  "TASK_CHAT_MISMATCH", "TASK_NOT_ON_CANVAS", "TASK_NOT_RUNNING", "TASK_REVISION_CONFLICT",
  "TASK_TERMINAL", "TASK_TRANSITION_INVALID", "UNSAFE_ASSET_PATH", "VIEW_CATALOG_EVENT_GAP",
  "VIEW_CATALOG_REVISION_CONFLICT", "VIEW_FALLBACK_REQUIRED", "VIEW_NAME_REQUIRED",
  "VIEW_NOT_FOUND", "VIEW_NOT_TRASHED", "VISUAL_TEMPLATE_BINDING_INVALID",
  "VISUAL_TEMPLATE_BLUEPRINT_INVALID", "VISUAL_TEMPLATE_DATA_NOT_READY",
  "VISUAL_TEMPLATE_NOT_FOUND", "VISUAL_TEMPLATE_SCENE_INCOMPATIBLE", "WORKSPACE_SCHEMA_RESET",
  "WORKSPACE_UNKNOWN", "INTERNAL",
] as const;

export const weaverErrorCodeSchema = z.enum(weaverErrorCodes);
export type WeaverErrorCode = z.infer<typeof weaverErrorCodeSchema>;

export const weaverFailureSchema = z.object({ code: weaverErrorCodeSchema, message: z.string().min(1), details: z.unknown().optional(), retryable: z.boolean() });
export type WeaverFailure = z.infer<typeof weaverFailureSchema>;

const retryableCodes = new Set<WeaverErrorCode>(["BOUND_CANVAS_OFFLINE", "CHAT_CANVAS_LEASE_STALE", "GRAPH_REVISION_CONFLICT", "LAYOUT_REVISION_CONFLICT", "TASK_REVISION_CONFLICT", "VIEW_CATALOG_EVENT_GAP", "VIEW_CATALOG_REVISION_CONFLICT"]);

export class WeaverError extends Error {
  readonly code: WeaverErrorCode;
  readonly details?: unknown;
  readonly retryable: boolean;
  constructor(code: WeaverErrorCode, message = code, details?: unknown, retryable = retryableCodes.has(code)) {
    super(message); this.name = "WeaverError"; this.code = code; this.details = details; this.retryable = retryable;
  }
  toFailure(): WeaverFailure { return { code: this.code, message: this.message, details: this.details, retryable: this.retryable }; }
}

export function normalizeWeaverFailure(error: unknown): WeaverFailure {
  if (error instanceof WeaverError) return error.toFailure();
  const message = error instanceof Error ? error.message : String(error);
  const parsed = weaverErrorCodeSchema.safeParse(message.split(":", 1)[0]);
  return { code: parsed.success ? parsed.data : "INTERNAL", message, retryable: parsed.success ? retryableCodes.has(parsed.data) : false };
}
