import { App as McpApp } from "@modelcontextprotocol/ext-apps";
import { isDevHost, resolveHostMode, type WeaverPreview, type WeaverRuntime } from "./lib/host-mode";
import { createMcpAppConnection } from "./mcp-app-connection";
import type { ToolResult } from "./types";
import { toolErrorMessage } from "./canvas-access";
import { assertRuntimeCompatibility } from "./lib/runtime-compat";

export type { HostMode, WeaverPreview } from "./lib/host-mode";

declare global { interface Window { __weaverPreview?: WeaverPreview; __weaverRuntime?: WeaverRuntime; __weaverCodexLoopback?: { origin: string; token: string } } }

export const mcp = new McpApp({ name: "weaver-next-widget", version: "0.1.0" }, { availableDisplayModes: ["inline", "fullscreen"] }, { autoResize: true });
const connectedMcp = createMcpAppConnection(mcp);

export const connectMcpApp = () => connectedMcp.connect();

// A browser host always has `window`/`location`; guarding here only keeps this module
// importable in a plain node context (e.g. unit tests) — browser behavior is unchanged.
const browserWindow: (Window & typeof globalThis) | undefined = typeof window === "undefined" ? undefined : window;
const browserLocation: Location | undefined = typeof location === "undefined" ? undefined : location;

/** Injected by the MCP process's /preview route when Claude Code is the agent host. */
export const weaverPreview = browserWindow?.__weaverPreview;
export const weaverRuntime = browserWindow?.__weaverRuntime;

// `isLocalDevelopment` means the Vite dev proxy (no chat binding, agent unavailable).
// The Claude preview is also on 127.0.0.1 but is a bound agent host, so it is excluded.
export const isLocalDevelopment = isDevHost(browserLocation?.hostname ?? "localhost", weaverPreview, weaverRuntime);
export const hostMode = resolveHostMode(browserLocation?.hostname ?? "localhost", weaverPreview, weaverRuntime);
let runtimeCsrfToken: string | undefined;
let runtimeCompatibilityError: string | undefined;
export function setRuntimeCsrfToken(value?: string) { runtimeCsrfToken = value; }
export function verifyRuntimeBootstrap(value: { buildId?: string; protocolVersion?: number }) {
  if (!weaverRuntime) return;
  try {
    assertRuntimeCompatibility(weaverRuntime, value);
    runtimeCompatibilityError = undefined;
  } catch (error) {
    runtimeCompatibilityError = error instanceof Error ? error.message : "BUILD_MISMATCH";
    throw error;
  }
}

// Codex loopback bypass. Codex's tools/call proxy rejects some widget calls in the
// renderer before they ever reach the MCP server ("-32000 MCP proxy request failed" —
// observed for exactly the calls with complex/undefined-bearing arguments while flat
// string-arg calls sail through). So the embedded widget talks to the MCP process's
// loopback /mcp-rpc DIRECTLY — the same path the browser preview has proven — and only
// uses the proxy as a fallback. The endpoint is baked into the ui:// resource HTML
// (`window.__weaverCodexLoopback`) by the serving process; putting a URL in the tool
// result instead makes Codex open a browser sidebar rather than the native panel.
let codexLoopback: { origin: string; token: string } | undefined = browserWindow?.__weaverCodexLoopback;
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
  if (hostMode === "runtime" && weaverRuntime) {
    if (runtimeCompatibilityError) throw new Error(runtimeCompatibilityError);
    const response = await fetch(weaverRuntime.rpcPath, { method: "POST", headers: { "content-type": "application/json", "x-weaver-csrf": runtimeCsrfToken ?? "" }, body: JSON.stringify({ operation: name, arguments: args }) });
    const value = await response.json() as { ok: boolean; result?: T; error?: { code?: string } };
    result = value.ok ? { structuredContent: value.result } : { isError: true, content: [{ type: "text", text: value.error?.code ?? `${name} failed` }] };
  }
  else if (hostMode === "claude" && weaverPreview) result = await fetchTool<T>(weaverPreview.rpcPath, name, args, { "x-weaver-preview-token": weaverPreview.token });
  else if (hostMode === "dev") result = await fetchTool<T>("/api/mcp", name, args);
  else result = await callCodexTool<T>(name, args);
  if (result.isError) throw new Error(toolErrorMessage(result, `${name} failed`));
  const value: unknown = result.structuredContent;
  if (value && typeof value === "object" && Object.keys(value).length === 1 && "items" in value && Array.isArray(value.items)) return value.items as T;
  return value as T;
}

export async function takeOverRuntimeProject(projectId: string) {
  if (hostMode !== "runtime") return false;
  const response = await fetch("/api/session/takeover", { method: "POST", headers: { "content-type": "application/json", "x-weaver-csrf": runtimeCsrfToken ?? "" }, body: JSON.stringify({ projectId, confirm: true }) });
  if (!response.ok) throw new Error((await response.json() as { error?: { code?: string } }).error?.code ?? "TAKEOVER_FAILED");
  return true;
}
