import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const internalPackages = new Map([
  ["@weaver/contracts", "packages/contracts/src/index.ts"],
  ["@weaver/core", "packages/core/src/index.ts"],
  ["@weaver/layout-engine", "packages/layout-engine/src/index.ts"],
  ["@weaver/scene-packs", "packages/scene-packs/src/index.ts"],
  ["@weaver/storage", "packages/storage/src/index.ts"],
  ["@weaver/visual-templates", "packages/visual-templates/src/index.ts"],
]);

const outfileFlag = process.argv.indexOf("--outfile");
const outfile = outfileFlag >= 0 && process.argv[outfileFlag + 1]
  ? resolve(process.cwd(), process.argv[outfileFlag + 1])
  : resolve(root, "packages/mcp/dist/server.js");

await build({
  entryPoints: [resolve(root, "packages/mcp/src/server.ts")],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  external: ["sharp"],
  sourcemap: true,
  plugins: [{
    name: "bundle-weaver-workspaces",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^@weaver\// }, ({ path }) => {
        const entry = internalPackages.get(path);
        if (!entry) return { errors: [{ text: `Unknown internal Weaver package: ${path}` }] };
        return { path: resolve(root, entry) };
      });
    },
  }],
});
