import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupRuntimeCache, RUNTIME_CACHE_KEEP_UNREFERENCED, RUNTIME_CACHE_SOFT_CAP_BYTES } from "../src/runtime-cache.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function runtime(root: string, buildId: string, age: number, bytes = 16) {
  const directory = join(root, "runtimes", buildId);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "runtime.bin"), "x".repeat(bytes));
  const at = new Date(Date.now() - age);
  utimesSync(directory, at, at);
  return directory;
}

describe("immutable runtime cache cleanup", () => {
  it("fixes the retention defaults in code", () => {
    expect(RUNTIME_CACHE_KEEP_UNREFERENCED).toBe(2);
    expect(RUNTIME_CACHE_SOFT_CAP_BYTES).toBe(1024 ** 3);
  });

  it("never deletes referenced builds and keeps only the two newest unreferenced builds", () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-runtime-cache-")); roots.push(root);
    runtime(root, "referenced-old", 50_000);
    runtime(root, "unused-old", 40_000);
    runtime(root, "unused-middle", 30_000);
    runtime(root, "unused-new", 20_000);
    mkdirSync(join(root, "workspaces", "workspace-a"), { recursive: true });
    writeFileSync(join(root, "workspaces", "workspace-a", "runtime.json"), JSON.stringify({ buildId: "referenced-old" }));

    const result = cleanupRuntimeCache(root);

    expect(result.removedBuildIds).toEqual(["unused-old"]);
    expect(result.keptReferencedBuildIds).toEqual(["referenced-old"]);
    expect(result.keptUnreferencedBuildIds).toEqual(["unused-new", "unused-middle"]);
  });

  it("does not follow symlinks or delete temporary install directories", () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-runtime-cache-")); roots.push(root);
    const outside = mkdtempSync(join(tmpdir(), "weaver-runtime-outside-")); roots.push(outside);
    mkdirSync(join(root, "runtimes"), { recursive: true });
    writeFileSync(join(root, "runtimes", ".candidate.tmp"), "partial");
    symlinkSync(outside, join(root, "runtimes", "linked-build"));
    runtime(root, "new-a", 2_000);
    runtime(root, "new-b", 1_000);

    const result = cleanupRuntimeCache(root);
    expect(result.removedBuildIds).toEqual([]);
    expect(result.skippedEntries).toEqual(expect.arrayContaining([".candidate.tmp", "linked-build"]));
  });
});
