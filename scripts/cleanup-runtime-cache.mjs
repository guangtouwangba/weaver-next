import { homedir } from "node:os";
import { resolve } from "node:path";
import { cleanupRuntimeCache } from "../packages/mcp/dist/runtime-cache.js";

const root = resolve(process.argv[2] ?? process.env.WEAVER_RUNTIME_ROOT ?? `${homedir()}/.weaver`);
console.log(JSON.stringify(cleanupRuntimeCache(root), null, 2));
