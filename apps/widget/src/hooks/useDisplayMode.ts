import { useCallback, useEffect, useState } from "react";
import { mcp, hostMode } from "../mcp-client";

export type DisplayMode = "inline" | "fullscreen";
export function useDisplayMode(): { displayMode: DisplayMode; requestDisplayMode: (mode: DisplayMode) => Promise<void> } {
  const [displayMode, setDisplayMode] = useState<DisplayMode>(() => {
    const query = new URLSearchParams(location.search);
    if (query.get("demo") === "1" && query.get("displayMode") === "inline") return "inline";
    return hostMode === "codex" ? (mcp.getHostContext()?.displayMode === "fullscreen" ? "fullscreen" : "inline") : "fullscreen";
  });
  useEffect(() => {
    const changed = (context: { displayMode?: unknown }) => { const mode = context.displayMode; if (mode === "inline" || mode === "fullscreen") setDisplayMode(mode); };
    mcp.addEventListener("hostcontextchanged", changed); return () => mcp.removeEventListener("hostcontextchanged", changed);
  }, []);
  const requestDisplayMode = useCallback(async (mode: DisplayMode) => { if (hostMode === "codex") { const result = await mcp.requestDisplayMode({ mode }); setDisplayMode(result.mode === "fullscreen" ? "fullscreen" : "inline"); } else setDisplayMode("fullscreen"); }, []);
  return { displayMode, requestDisplayMode };
}
