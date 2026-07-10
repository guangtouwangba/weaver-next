import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const repoRoot = resolve(import.meta.dirname, "../..");

function localMcpProxy(): Plugin {
  let clientPromise: Promise<Client> | null = null;
  const client = async () => {
    if (!clientPromise) clientPromise = (async () => {
      const transport = new StdioClientTransport({ command: "node", args: ["./scripts/start-mcp.mjs"], cwd: repoRoot, stderr: "inherit" });
      const next = new Client({ name: "weaver-widget-dev", version: "0.1.0" });
      await next.connect(transport);
      return next;
    })();
    return clientPromise;
  };
  return {
    name: "weaver-local-mcp-proxy",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api/bootstrap", (request, response) => {
        if (request.method !== "GET") { response.statusCode = 405; response.end("Method not allowed"); return; }
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ workspaceDir: repoRoot }));
      });
      server.middlewares.use("/api/mcp", async (request, response) => {
        if (request.method !== "POST") { response.statusCode = 405; response.end("Method not allowed"); return; }
        try {
          let raw = "";
          for await (const chunk of request) {
            raw += chunk;
            if (raw.length > 30 * 1024 * 1024) throw new Error("REQUEST_TOO_LARGE");
          }
          const body = JSON.parse(raw) as { name: string; arguments?: Record<string, unknown> };
          const result = await (await client()).callTool({ name: body.name, arguments: body.arguments ?? {} });
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify(result));
        } catch (error) {
          response.statusCode = 500;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] }));
        }
      });
      server.httpServer?.once("close", () => { void clientPromise?.then((current) => current.close()).catch(() => {}); });
    },
  };
}

export default defineConfig(() => ({
  plugins: [react(), localMcpProxy()],
  base: "./",
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
}));
