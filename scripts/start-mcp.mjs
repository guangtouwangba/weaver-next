import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { reapStaleSiblings } from "./reap-stale-mcp.mjs";

// Default host kind is `codex` (this is the launcher Codex runs directly).
// start-mcp-claude.mjs sets `claude` before importing this, so it wins there.
process.env.WEAVER_HOST_KIND ??= "codex";

// Reaping is OFF by default. Codex spawns a fresh MCP process per thread and
// briefly orphans the previous one (PPID 1) while still proxying the widget's
// callServerTool to it; the reaper SIGKILLing that orphan closed its stdio
// transport → every widget call failed with `-32000 MCP proxy request failed`.
// The loopback dead-port problem it was meant to fix is now handled by the
// deterministic port + leader/follower takeover, so the reaper is opt-in only.
if (process.env.WEAVER_REAP === "1") reapStaleSiblings();

const serverPath = resolve(process.cwd(), "packages", "mcp", "dist", "server.js");
if (!existsSync(serverPath)) {
  console.error("Weaver MCP is not built. Run npm install && npm run build:plugin in the plugin directory.");
  process.exit(1);
}
await import(pathToFileURL(serverPath).href);
