import type { Bootstrap, CanvasAccessState } from "./types";

export function hasWidgetBuildMismatch(bootstrap: Bootstrap, embeddedBuildId?: string) {
  // Only the DEVELOPMENT flow blocks on build skew (stale dev HTML against a newer
  // dev server is a real footgun). In installed mode, skew is a normal transient:
  // Codex keeps multiple MCP process generations alive across a plugin update, so
  // the ui:// HTML (snapshotted by one process at boot) routinely differs from the
  // tool result of a newer sibling. Data safety is covered by graph/layout revision
  // checks, so blocking here would just make every update brick the canvas.
  if (bootstrap.runtimeMode !== "development") return false;
  const hostMismatch = Boolean(bootstrap.widgetBuildId && embeddedBuildId && bootstrap.widgetBuildId !== embeddedBuildId);
  return hostMismatch || Boolean(bootstrap.buildMismatch);
}

export function canvasAccessFromError(error: unknown): CanvasAccessState | undefined {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("CANVAS_ALREADY_ACTIVE")) return "duplicate";
  if (message.includes("CHAT_CANVAS_LEASE_STALE")) return "detached";
  if (message.includes("WIDGET_BUILD_MISMATCH")) return "build-mismatch";
  return undefined;
}

export function acknowledgedCanvasSequence(current: number, result: unknown) {
  const confirmed = Number((result as { context?: { sequence?: unknown } } | undefined)?.context?.sequence);
  return Number.isFinite(confirmed) && confirmed > current ? confirmed : current;
}
