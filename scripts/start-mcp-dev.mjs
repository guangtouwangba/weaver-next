import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
process.env.WEAVER_RUNTIME_MODE = "development";
process.env.WEAVER_DEV_ROOT = root;

await import("./start-mcp.mjs");
