#!/usr/bin/env node
import { resolve } from "node:path";
import { ensureWorkspaceSupervisor } from "../packages/workspace-supervisor/dist/index.js";

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const workspaceDir = resolve(argument("workspace", process.cwd()));
const runtimeRoot = resolve(argument("runtime-root", `${process.env.HOME}/.weaver`));
const buildId = argument("build-id", process.env.WEAVER_BUILD_ID ?? "development");
const supervisor = await ensureWorkspaceSupervisor({ workspaceDir, runtimeRoot, buildId, workerEntry: resolve(import.meta.dirname, "../packages/workspace-supervisor/dist/server.js") });

const shutdown = async () => { await supervisor.close(); process.exit(0); };
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
process.stdout.write(`${JSON.stringify({ origin: supervisor.origin, controlSocketPath: supervisor.controlSocketPath })}\n`);
