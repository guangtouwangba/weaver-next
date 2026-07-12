import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const outputFlag = process.argv.indexOf("--output");
const output = outputFlag >= 0 ? resolve(process.argv[outputFlag + 1]) : resolve(root, "plugins", "weaver-next");
const required = [
  "apps/widget/dist/index.html",
  "packages/mcp/src/server.ts",
  ".codex-plugin/plugin.json",
];
for (const relative of required) {
  if (!existsSync(resolve(root, relative))) throw new Error(`Missing release input: ${relative}. Run npm run build:plugin first.`);
}

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

const internalPackages = new Map([
  ["@weaver/contracts", "packages/contracts/src/index.ts"],
  ["@weaver/core", "packages/core/src/index.ts"],
  ["@weaver/layout-engine", "packages/layout-engine/src/index.ts"],
  ["@weaver/layout-engine/semantic", "packages/layout-engine/src/semantic/index.ts"],
  ["@weaver/scene-packs", "packages/scene-packs/src/index.ts"],
  ["@weaver/storage", "packages/storage/src/index.ts"],
  ["@weaver/visual-templates", "packages/visual-templates/src/index.ts"],
]);
mkdirSync(join(output, "runtime"), { recursive: true });
await build({
  entryPoints: [resolve(root, "packages/mcp/src/server.ts")],
  outfile: join(output, "runtime", "server.mjs"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  external: ["sharp"],
  legalComments: "none",
  plugins: [{
    name: "bundle-weaver-workspaces",
    setup(api) {
      api.onResolve({ filter: /^@weaver\// }, ({ path }) => {
        const entry = internalPackages.get(path);
        return entry ? { path: resolve(root, entry) } : { errors: [{ text: `Unknown internal package: ${path}` }] };
      });
    },
  }],
});

function copy(relative, target = relative) {
  mkdirSync(dirname(resolve(output, target)), { recursive: true });
  cpSync(resolve(root, relative), resolve(output, target), { recursive: true });
}
copy(".codex-plugin");
copy("skills");
copy("tools/claude-skills", "claude-skills");
copy("scripts/release/start-mcp.mjs", "scripts/start-mcp.mjs");
copy("scripts/release/start-mcp-claude.mjs", "scripts/start-mcp-claude.mjs");
copy("LICENSE");

const widgetSource = resolve(root, "apps/widget/dist");
const widgetTarget = resolve(output, "apps/widget/dist");
mkdirSync(widgetTarget, { recursive: true });
copy("apps/widget/dist/index.html");
const html = readFileSync(join(widgetSource, "index.html"), "utf8");
for (const match of html.matchAll(/(?:href|src)="\.\/([^"?#]+\.(?:css|js))"/g)) copy(`apps/widget/dist/${match[1]}`);

for (const packageName of ["sharp", "@img", "detect-libc", "semver"]) {
  const source = resolve(root, "node_modules", packageName);
  if (!existsSync(source)) throw new Error(`Missing runtime dependency ${packageName}; run npm install.`);
  copy(`node_modules/${packageName}`);
}

const pluginMcp = {
  mcpServers: {
    weaver_mcp: {
      title: "Weaver Semantic Space MCP",
      description: "Open and operate project-local Weaver semantic spaces.",
      command: "node",
      args: ["./scripts/start-mcp.mjs"],
      cwd: "."
    }
  }
};
writeFileSync(join(output, ".mcp.json"), `${JSON.stringify(pluginMcp, null, 2)}\n`);

const version = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;
const files = [];
function walk(directory, prefix = "") {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = join(prefix, entry.name);
    if (entry.isDirectory()) walk(join(directory, entry.name), relative);
    else files.push(relative);
  }
}
walk(output);
writeFileSync(join(output, ".release-manifest.json"), `${JSON.stringify({ version, platform: "darwin", node: ">=24", files: files.sort() }, null, 2)}\n`);
console.log(`Built Weaver plugin ${version} at ${output}`);
