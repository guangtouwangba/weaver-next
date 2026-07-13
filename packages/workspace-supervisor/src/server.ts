import { resolve } from "node:path";
import { ensureWorkspaceSupervisor } from "./supervisor.js";
import { runWorkspaceWorkerProcess } from "./worker-process.js";

function argument(name: string, fallback: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const workspaceDir = resolve(argument("workspace", process.cwd()));
const runtimeRoot = resolve(argument("runtime-root", `${process.env.HOME}/.weaver`));
const buildId = argument("build-id", process.env.WEAVER_BUILD_ID ?? "development");
if (process.argv.includes("--worker")) {
  await runWorkspaceWorkerProcess({ workspaceDir, buildId });
} else {
const supervisor = await ensureWorkspaceSupervisor({ workspaceDir, runtimeRoot, buildId, workerEntry: process.argv[1] });
const shutdown = async () => { await supervisor.close(); process.exit(0); };
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
process.stdout.write(`${JSON.stringify({ origin: supervisor.origin, controlSocketPath: supervisor.controlSocketPath })}\n`);
}
