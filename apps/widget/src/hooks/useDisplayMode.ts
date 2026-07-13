import { useCallback, useEffect, useRef, useState } from "react";
import { connectMcpApp, mcp, hostMode } from "../mcp-client";
import type { HostMode } from "../mcp-client";

export type WeaverDisplayMode = "inline" | "fullscreen";

export function resolveDisplayMode(host: HostMode, currentMode: unknown): WeaverDisplayMode {
  if (host !== "codex") return "fullscreen";
  return currentMode === "fullscreen" ? "fullscreen" : "inline";
}

export async function requestFullscreen(host: HostMode, request: (mode: { mode: "fullscreen" }) => Promise<unknown>): Promise<WeaverDisplayMode | undefined> {
  if (host !== "codex") return undefined;
  const result = await request({ mode: "fullscreen" });
  return resolveDisplayMode(host, (result as { mode?: unknown } | undefined)?.mode);
}

export async function requestInitialFullscreen(host: HostMode, currentMode: unknown, request: (mode: { mode: "fullscreen" }) => Promise<unknown>): Promise<WeaverDisplayMode | undefined> {
  if (currentMode === "fullscreen") return undefined;
  return requestFullscreen(host, request);
}

export function useDisplayMode(): { displayMode: WeaverDisplayMode; openFullscreen: () => Promise<void> } {
  const initialContext = useRef(mcp.getHostContext() ?? {}).current;
  const [displayMode, setDisplayMode] = useState<WeaverDisplayMode>(() => resolveDisplayMode(hostMode, initialContext.displayMode));
  const requestedInitial = useRef(false);

  useEffect(() => {
    const changed = (context: { displayMode?: unknown }) => setDisplayMode(resolveDisplayMode(hostMode, context.displayMode));
    mcp.addEventListener("hostcontextchanged", changed);
    if (!requestedInitial.current) {
      requestedInitial.current = true;
      void connectMcpApp().then(async () => {
        const currentMode = mcp.getHostContext()?.displayMode;
        setDisplayMode(resolveDisplayMode(hostMode, currentMode));
        const mode = await requestInitialFullscreen(hostMode, currentMode, (request) => mcp.requestDisplayMode(request));
        if (mode) setDisplayMode(mode);
      }).catch((error) => console.warn(`[weaver] display-mode initialization failed: ${error instanceof Error ? error.message : String(error)}`));
    }
    return () => mcp.removeEventListener("hostcontextchanged", changed);
  }, [initialContext.displayMode]);

  const openFullscreen = useCallback(async () => {
    const mode = await requestFullscreen(hostMode, (request) => mcp.requestDisplayMode(request));
    if (mode) setDisplayMode(mode);
  }, []);

  return { displayMode, openFullscreen };
}
