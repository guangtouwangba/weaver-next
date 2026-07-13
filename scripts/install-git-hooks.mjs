import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
if (!existsSync(resolve(root, ".git"))) process.exit(0);

const configured = spawnSync("git", ["config", "--local", "core.hooksPath", ".githooks"], {
  cwd: root,
  encoding: "utf8",
});

if (configured.status !== 0) {
  process.stderr.write(configured.stderr);
  process.exit(configured.status ?? 1);
}

console.log("Configured Git hooks from .githooks");
