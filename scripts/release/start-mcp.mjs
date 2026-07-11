import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
process.env.WEAVER_HOST_KIND ??= "codex";
process.env.WEAVER_RUNTIME_MODE = "installed";
process.env.WEAVER_DEV_ROOT = root;

await import(pathToFileURL(resolve(root, "runtime", "server.mjs")).href);
