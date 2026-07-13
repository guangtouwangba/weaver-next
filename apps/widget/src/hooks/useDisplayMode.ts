import { useEffect } from "react";
import { mcp, hostMode } from "../mcp-client";
import type { HostMode } from "../mcp-client";

export async function ensureFullscreen(host: HostMode, currentMode: unknown, request: (mode: { mode: "fullscreen" }) => Promise<unknown>): Promise<void> {
  if (host === "codex" && currentMode !== "fullscreen") await request({ mode: "fullscreen" });
}

export function useDisplayMode(): { displayMode: "fullscreen" } {
  useEffect(() => {
    const requestFullscreen = (context: { displayMode?: unknown }) => { void ensureFullscreen(hostMode, context.displayMode, (mode) => mcp.requestDisplayMode(mode)); };
    const changed = (context: { displayMode?: unknown }) => requestFullscreen(context);
    mcp.addEventListener("hostcontextchanged", changed);
    requestFullscreen(mcp.getHostContext() ?? {});
    return () => mcp.removeEventListener("hostcontextchanged", changed);
  }, []);
  return { displayMode: "fullscreen" };
}
