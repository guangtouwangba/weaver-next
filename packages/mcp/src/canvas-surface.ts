import { hostKind } from "./session-identity.js";

export const LEGACY_WIDGET_FALLBACK_OWNER = "weaver-maintainers";
export const LEGACY_WIDGET_EARLIEST_REMOVAL_DATE = "2026-07-27";

export type CanvasSurface = "localhost" | "legacy-widget";

export function canvasSurface(): CanvasSurface {
  return process.env.WEAVER_CANVAS_SURFACE === "legacy-widget" && hostKind() === "codex" ? "legacy-widget" : "localhost";
}

export function legacyWidgetFallbackReason(): string {
  const value = process.env.WEAVER_CANVAS_FALLBACK_REASON ?? "OPERATOR_ROLLBACK";
  return /^[A-Z0-9_]{1,80}$/.test(value) ? value : "INVALID_FALLBACK_REASON";
}
