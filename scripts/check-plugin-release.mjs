import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const plugin = resolve(root, "plugins", "weaver-next");
const required = [
  ".codex-plugin/plugin.json",
  ".mcp.json",
  ".release-manifest.json",
  "runtime/server.mjs",
  "apps/widget/dist/index.html",
  "scripts/start-mcp.mjs",
  "scripts/start-mcp-claude.mjs",
  "node_modules/sharp/package.json",
  "node_modules/detect-libc/package.json",
  "node_modules/semver/package.json",
  "skills/weaver-open-space/SKILL.md",
];
const forbidden = [".weaver", ".env", "secrets.json"];
for (const relative of forbidden) {
  if (existsSync(resolve(plugin, relative))) throw new Error(`Unsafe release content: ${relative} must not be packaged`);
}
for (const relative of required) {
  if (!existsSync(resolve(plugin, relative))) throw new Error(`Incomplete release: ${relative} is missing`);
}
const manifest = JSON.parse(readFileSync(resolve(plugin, ".release-manifest.json"), "utf8"));
const version = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;
if (manifest.version !== version) throw new Error(`Release ${manifest.version} does not match package ${version}`);
console.log(`Weaver release ${version} is complete (${manifest.files.length} files).`);
