import { App as McpApp } from "@modelcontextprotocol/ext-apps";
import { composeCanvasTurnMessage } from "./lib/canvas-turn";
import { isDevHost, resolveHostMode, type WeaverPreview } from "./lib/host-mode";
import { createMcpAppConnection } from "./mcp-app-connection";
import type { ToolResult } from "./types";

export type { HostMode, WeaverPreview } from "./lib/host-mode";

declare global { interface Window { __weaverPreview?: WeaverPreview; __weaverCodexLoopback?: { origin: string; token: string } } }

export const mcp = new McpApp({ name: "weaver-next-widget", version: "0.1.0" }, { availableDisplayModes: ["inline", "fullscreen"] }, { autoResize: true });
const connectedMcp = createMcpAppConnection(mcp);

export const connectMcpApp = () => connectedMcp.connect();

/** Injected by the MCP process's /preview route when Claude Code is the agent host. */
export const weaverPreview = window.__weaverPreview;

// `isLocalDevelopment` means the Vite dev proxy (no chat binding, agent unavailable).
// The Claude preview is also on 127.0.0.1 but is a bound agent host, so it is excluded.
export const isLocalDevelopment = isDevHost(location.hostname, weaverPreview);
export const hostMode = resolveHostMode(location.hostname, weaverPreview);

// Codex loopback bypass. Codex's tools/call proxy rejects some widget calls in the
// renderer before they ever reach the MCP server ("-32000 MCP proxy request failed" —
// observed for exactly the calls with complex/undefined-bearing arguments while flat
// string-arg calls sail through). So the embedded widget talks to the MCP process's
// loopback /mcp-rpc DIRECTLY — the same path the browser preview has proven — and only
// uses the proxy as a fallback. The endpoint is baked into the ui:// resource HTML
// (`window.__weaverCodexLoopback`) by the serving process; putting a URL in the tool
// result instead makes Codex open a browser sidebar rather than the native panel.
let codexLoopback: { origin: string; token: string } | undefined = window.__weaverCodexLoopback;
export function setCodexLoopback(previewUrl?: string, token?: string) {
  if (!previewUrl || !token) return;
  try { codexLoopback = { origin: new URL(previewUrl).origin, token }; }
  catch { /* malformed previewUrl — keep proxy fallback */ }
}
export function codexLoopbackReady(): boolean { return Boolean(codexLoopback); }

async function fetchTool<T>(url: string, name: string, args: Record<string, unknown>, headers: Record<string, string> = {}): Promise<ToolResult<T>> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ name, arguments: args }) });
  const value = await response.json() as ToolResult<T>;
  if (!response.ok && !value.isError) throw new Error(`MCP request failed: ${response.status}`);
  return value;
}

/** True when the Codex host advertises the `ui/message` capability (populated after connect). */
export function hostSupportsMessage(): boolean {
  try { return Boolean((mcp.getHostCapabilities?.() as { message?: unknown } | undefined)?.message); }
  catch { return false; }
}

/**
 * Push a real user turn into the Codex conversation so it responds immediately —
 * the token-efficient "canvas input triggers the agent" path (no watch-loop polling).
 * The message text is self-contained (selection summary + read-the-canvas protocol,
 * via composeCanvasTurnMessage): `updateModelContext` content is invisible and the
 * host may not attach it to the turn, so it is only kept as a best-effort extra.
 * The agent still reads the authoritative selection via weaver_get_bound_canvas.
 */
export async function sendCanvasTurn(instruction: string, contextText?: string): Promise<void> {
  await connectedMcp.connect();
  if (contextText) await mcp.updateModelContext({ content: [{ type: "text", text: contextText }] }).catch(() => {});
  await mcp.sendMessage({ role: "user", content: [{ type: "text", text: composeCanvasTurnMessage(instruction, contextText) }] });
}

async function callCodexTool<T>(name: string, args: Record<string, unknown>): Promise<ToolResult<T>> {
  if (codexLoopback) {
    try {
      return await fetchTool<T>(`${codexLoopback.origin}/mcp-rpc`, name, args, { "x-weaver-preview-token": codexLoopback.token });
    } catch (error) {
      // CSP/network failure or a dead endpoint — this sandbox can't reach the
      // loopback. Fall back to the Apps-SDK proxy for the rest of the session.
      console.warn(`[weaver] loopback-unreachable tool=${name} error=${error instanceof Error ? error.message : String(error)} — falling back to callServerTool`);
      codexLoopback = undefined;
    }
  }
  // Apps-SDK proxy path. The JSON round-trip drops `undefined`-valued keys the way
  // the loopback's JSON.stringify does — the raw object would carry them through
  // postMessage structured clone into the host's argument validation, which is the
  // one objective difference between the (working) loopback claim and the
  // (-32000-rejected) proxied claim. Log name/duration so any recurrence is
  // diagnosable against the Codex host logs.
  const startedAt = Date.now();
  let result: ToolResult<T>;
  try {
    result = await connectedMcp.callServerTool({ name, arguments: JSON.parse(JSON.stringify(args)) }) as ToolResult<T>;
  } catch (error) {
    console.warn(`[weaver] callServerTool transport-failed tool=${name} durationMs=${Date.now() - startedAt} error=${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
  if (result.isError) console.warn(`[weaver] callServerTool tool-error tool=${name} durationMs=${Date.now() - startedAt} message=${result.content?.find((item) => item.type === "text")?.text ?? "?"}`);
  return result;
}

export async function callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
  let result: ToolResult<T>;
  if (hostMode === "claude" && weaverPreview) result = await fetchTool<T>(weaverPreview.rpcPath, name, args, { "x-weaver-preview-token": weaverPreview.token });
  else if (hostMode === "dev") result = await fetchTool<T>("/api/mcp", name, args);
  else result = await callCodexTool<T>(name, args);
  if (result.isError) throw new Error(result.content?.find((item) => item.type === "text")?.text ?? `${name} failed`);
  const value = result.structuredContent as any;
  return (value && Object.keys(value).length === 1 && Array.isArray(value.items) ? value.items : value) as T;
}
