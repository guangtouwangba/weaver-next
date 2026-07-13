import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const releaseDir = mkdtempSync(join(tmpdir(), "weaver-pre-push-release-"));

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

try {
  for (const script of ["lint", "build:packages", "build:widget", "test:ts", "typecheck:widget"]) {
    run("npm", ["run", script]);
  }
  run(process.execPath, ["scripts/build-plugin-release.mjs", "--output", releaseDir]);
  run(process.execPath, ["scripts/check-plugin-release.mjs", "--plugin", releaseDir]);
  run(process.execPath, ["scripts/probe-mcp.mjs"], {
    WEAVER_PROBE_CWD: releaseDir,
    WEAVER_PROBE_ARGS: '["./scripts/start-mcp.mjs"]',
  });
} finally {
  rmSync(releaseDir, { recursive: true, force: true });
}
