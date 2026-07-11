import { resolve } from "node:path";

// Claude Code launcher: run the Weaver MCP server as the standalone-browser
// preview host. This sets WEAVER_HOST_KIND=claude so the process exposes the
// tokenized loopback /preview + /mcp-rpc routes and, when no Codex thread is
// present, derives a stable synthetic chat session key — making Claude Code the
// fully bound canvas agent. Register with:
//   claude mcp add weaver-preview -- node ./scripts/start-mcp-claude.mjs
const root = resolve(import.meta.dirname, "..");
process.env.WEAVER_HOST_KIND = "claude";
process.env.WEAVER_RUNTIME_MODE ??= "development";
process.env.WEAVER_DEV_ROOT ??= root;

await import("./start-mcp.mjs");
