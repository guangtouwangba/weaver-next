import { App as McpApp } from "@modelcontextprotocol/ext-apps";
import type { ToolResult } from "./types";

export const mcp = new McpApp({ name: "weaver-next-widget", version: "0.1.0" }, { availableDisplayModes: ["inline", "fullscreen"] }, { autoResize: true });
export const isLocalDevelopment = ["localhost", "127.0.0.1"].includes(location.hostname);

export async function callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const result = isLocalDevelopment
    ? await fetch("/api/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, arguments: args }) }).then(async (response) => {
      const value = await response.json() as ToolResult<T>;
      if (!response.ok && !value.isError) throw new Error(`Local MCP proxy failed: ${response.status}`);
      return value;
    })
    : await mcp.callServerTool({ name, arguments: args }) as ToolResult<T>;
  if (result.isError) throw new Error(result.content?.find((item) => item.type === "text")?.text ?? `${name} failed`);
  const value = result.structuredContent as any;
  return (value && Object.keys(value).length === 1 && Array.isArray(value.items) ? value.items : value) as T;
}
