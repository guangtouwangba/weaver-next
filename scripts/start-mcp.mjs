import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const serverPath = resolve(process.cwd(), "packages", "mcp", "dist", "server.js");
if (!existsSync(serverPath)) {
  console.error("Weaver MCP is not built. Run npm install && npm run build:plugin in the plugin directory.");
  process.exit(1);
}
await import(pathToFileURL(serverPath).href);
