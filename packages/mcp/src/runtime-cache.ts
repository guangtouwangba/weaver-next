import { existsSync, lstatSync, readdirSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { join, resolve } from "node:path";

export const RUNTIME_CACHE_KEEP_UNREFERENCED = 2;
export const RUNTIME_CACHE_SOFT_CAP_BYTES = 1024 ** 3;

type RuntimeEntry = { buildId: string; directory: string; bytes: number; lastUsedMs: number };

function directoryBytes(directory: string): number {
  let total = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) total += directoryBytes(path);
    else if (entry.isFile()) total += statSync(path).size;
  }
  return total;
}

function referencedBuilds(root: string) {
  const referenced = new Set<string>();
  const workspaces = join(root, "workspaces");
  if (!existsSync(workspaces)) return referenced;
  for (const entry of readdirSync(workspaces, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const descriptor = join(workspaces, entry.name, "runtime.json");
    if (!existsSync(descriptor)) continue;
    try {
      const buildId = (JSON.parse(readFileSync(descriptor, "utf8")) as { buildId?: unknown }).buildId;
      if (typeof buildId === "string" && buildId.length > 0) referenced.add(buildId);
    } catch { /* stale/corrupt descriptors cannot authorize deletion */ }
  }
  return referenced;
}

export function markRuntimeUsed(root: string, buildId: string) {
  const directory = join(resolve(root), "runtimes", buildId);
  if (!existsSync(directory) || !lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) return;
  const now = new Date();
  utimesSync(directory, now, now);
}

export function cleanupRuntimeCache(root: string, options: { keepUnreferenced?: number; softCapBytes?: number } = {}) {
  const canonicalRoot = resolve(root);
  const runtimes = join(canonicalRoot, "runtimes");
  const skippedEntries: string[] = [];
  const entries: RuntimeEntry[] = [];
  if (existsSync(runtimes)) {
    for (const entry of readdirSync(runtimes, { withFileTypes: true })) {
      const directory = join(runtimes, entry.name);
      if (entry.name.startsWith(".") || !entry.isDirectory() || entry.isSymbolicLink()) { skippedEntries.push(entry.name); continue; }
      const stat = lstatSync(directory);
      entries.push({ buildId: entry.name, directory, bytes: directoryBytes(directory), lastUsedMs: stat.mtimeMs });
    }
  }
  const referenced = referencedBuilds(canonicalRoot);
  const referencedEntries = entries.filter((entry) => referenced.has(entry.buildId));
  const unreferenced = entries.filter((entry) => !referenced.has(entry.buildId)).sort((a, b) => b.lastUsedMs - a.lastUsedMs || a.buildId.localeCompare(b.buildId));
  const keepCount = Math.max(0, options.keepUnreferenced ?? RUNTIME_CACHE_KEEP_UNREFERENCED);
  const keptUnreferenced = unreferenced.slice(0, keepCount);
  const removable = unreferenced.slice(keepCount);
  for (const entry of removable) rmSync(entry.directory, { recursive: true, force: true });
  const remainingBytes = [...referencedEntries, ...keptUnreferenced].reduce((sum, entry) => sum + entry.bytes, 0);
  const softCapBytes = options.softCapBytes ?? RUNTIME_CACHE_SOFT_CAP_BYTES;
  return {
    removedBuildIds: removable.map((entry) => entry.buildId),
    keptReferencedBuildIds: referencedEntries.map((entry) => entry.buildId).sort(),
    keptUnreferencedBuildIds: keptUnreferenced.map((entry) => entry.buildId),
    skippedEntries: skippedEntries.sort(),
    remainingBytes,
    softCapBytes,
    overSoftCap: remainingBytes > softCapBytes,
  };
}
