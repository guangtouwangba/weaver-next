// Pure host-mode resolution shared by the MCP client and the canvas status UI.
// codex: embedded Apps-SDK iframe (postMessage bridge, model-context channel).
// claude: standalone browser bound to a Claude Code session over loopback RPC (agent-eligible).
// dev:   plain Vite localhost preview — read-only, no chat binding.

export type HostMode = "codex" | "claude" | "runtime" | "dev";
export type WeaverPreview = { host: "claude"; origin: string; rpcPath: string; bootstrapPath: string; token: string; buildId: string };
export type WeaverRuntime = { rpcPath: string; bootstrapPath: string };

/** True only for the Vite dev proxy — the Claude preview is also on 127.0.0.1 but is not dev. */
export function isDevHost(hostname: string, preview?: WeaverPreview, runtime?: WeaverRuntime): boolean {
  return ["localhost", "127.0.0.1"].includes(hostname) && !preview && !runtime;
}

export function resolveHostMode(hostname: string, preview?: WeaverPreview, runtime?: WeaverRuntime): HostMode {
  if (runtime) return "runtime";
  if (preview?.host === "claude") return "claude";
  return isDevHost(hostname, preview, runtime) ? "dev" : "codex";
}

export function agentHostLabel(mode: HostMode): string {
  return mode === "claude" ? "this Claude session" : mode === "runtime" ? "the paired agent session" : "this Codex chat";
}

export function contextStatus(mode: HostMode, standaloneDemo: boolean, bound: boolean, selectionCount: number): string {
  if (mode === "dev" || standaloneDemo) return "Browser preview. Agent unavailable";
  const host = agentHostLabel(mode);
  if (!bound) return `Canvas is not bound to ${host}`;
  if (selectionCount) return `${selectionCount} selected · bound to ${host}`;
  return `Bound to ${host}`;
}
