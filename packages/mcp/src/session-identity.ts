import { createHash } from "node:crypto";

/**
 * Stable host-launch identity, anchored to the launcher's working directory.
 *
 * The chat session key must converge THREE things onto one canvas binding: the
 * agent (stdio), the browser widget (loopback), and — crucially — any SIBLING
 * MCP process the host spawns for the same launch. Codex in particular spawns
 * more than one MCP process from a single registration, and re-spawns on every
 * restart; a per-process `randomUUID()` gave each one a different key, so the
 * browser would claim under one key while the agent polled another (the canvas
 * prompt then sits forever at "waiting for pickup").
 *
 * Every process a host launches shares the same `cwd` (Codex runs them all from
 * its plugin cache dir; Claude Code from the repo), and it is stable across
 * restarts — so deriving the key from `cwd` makes all of them converge on ONE
 * binding without trusting any request-supplied `_meta`. The binding itself is
 * stored per-workspace (the retargeted repo store), so a key shared across
 * different repos never collides — they live in different stores.
 */
const launchSessionAnchor = process.cwd();

export type WeaverHostKind = "claude" | "codex" | undefined;

/** The launch host kind, set by the launcher via env (`start-mcp*.mjs`). */
export function hostKind(): WeaverHostKind {
  const value = process.env.WEAVER_HOST_KIND;
  return value === "claude" || value === "codex" ? value : undefined;
}

/**
 * True when this process serves the standalone-browser localhost preview — the
 * unified canvas surface for BOTH Codex and Claude Code. The embedded Codex
 * Apps-SDK widget is intentionally not used; both hosts open the loopback
 * `/preview` URL in a browser and bind via the process-synthetic session key.
 */
export function previewHost(): boolean {
  return hostKind() !== undefined;
}

/** Deterministic chat session key shared by every process of this host launch. */
export function syntheticChatSessionKey(): string {
  return createHash("sha256").update(`weaver-launch:${launchSessionAnchor}`).digest("hex");
}
