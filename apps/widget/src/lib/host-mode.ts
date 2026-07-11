// Pure host-mode resolution shared by the MCP client and the canvas status UI.
// codex: embedded Apps-SDK iframe (postMessage bridge, model-context channel).
// claude: standalone browser bound to a Claude Code session over loopback RPC (agent-eligible).
// dev:   plain Vite localhost preview — read-only, no chat binding.

export type HostMode = "codex" | "claude" | "dev";
export type WeaverPreview = { host: "claude"; origin: string; rpcPath: string; bootstrapPath: string; token: string; buildId: string };

/** True only for the Vite dev proxy — the Claude preview is also on 127.0.0.1 but is not dev. */
export function isDevHost(hostname: string, preview?: WeaverPreview): boolean {
  return ["localhost", "127.0.0.1"].includes(hostname) && !preview;
}

export function resolveHostMode(hostname: string, preview?: WeaverPreview): HostMode {
  if (preview?.host === "claude") return "claude";
  return isDevHost(hostname, preview) ? "dev" : "codex";
}

export function agentHostLabel(mode: HostMode): string {
  return mode === "claude" ? "this Claude session" : "this Codex chat";
}

export function contextStatus(mode: HostMode, standaloneDemo: boolean, bound: boolean, selectionCount: number): string {
  if (mode === "dev" || standaloneDemo) return "Browser preview. Agent unavailable";
  const host = agentHostLabel(mode);
  if (!bound) return `Canvas is not bound to ${host}`;
  if (selectionCount) return `${selectionCount} selected · bound to ${host}`;
  return `Bound to ${host}`;
}
