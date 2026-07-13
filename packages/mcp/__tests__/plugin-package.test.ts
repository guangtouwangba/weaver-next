import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("installed plugin package", () => {
  it("bundles every internal @weaver workspace dependency into the MCP entry", () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-plugin-package-"));
    roots.push(root);
    const outfile = join(root, "server.js");
    const built = spawnSync(process.execPath, ["scripts/build-mcp-bundle.mjs", "--outfile", outfile], {
      cwd: join(import.meta.dirname, "../../.."), encoding: "utf8",
    });

    expect(built.status, built.stderr).toBe(0);
    const bundled = readFileSync(outfile, "utf8");
    expect(bundled).not.toMatch(/(?:from\s+|import\s*\()(["'])@weaver\//);
    const externalImports = [...bundled.matchAll(/^import(?:[^"']+from\s+|\s*\()(["'])([^"']+)\1/gm)].map((match) => match[2]);
    expect(externalImports.filter((specifier) => specifier !== "sharp" && !specifier.startsWith("node:"))).toEqual([]);
    expect(bundled).toContain("weaver-mcp-server");
  });

  it("builds a standalone marketplace plugin with runtime assets", () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-release-package-"));
    roots.push(root);
    const built = spawnSync(process.execPath, ["scripts/build-plugin-release.mjs", "--output", root], {
      cwd: join(import.meta.dirname, "../../.."), encoding: "utf8",
    });

    expect(built.status, built.stderr).toBe(0);
    expect(existsSync(join(root, ".codex-plugin", "plugin.json"))).toBe(true);
    expect(existsSync(join(root, ".mcp.json"))).toBe(true);
    expect(existsSync(join(root, "runtime", "server.mjs"))).toBe(true);
    expect(existsSync(join(root, "runtime", "supervisor.mjs"))).toBe(true);
    expect(existsSync(join(root, "runtime", "manifest.json"))).toBe(true);
    expect(existsSync(join(root, "apps", "widget", "dist", "index.html"))).toBe(true);
    expect(existsSync(join(root, "node_modules", "sharp", "package.json"))).toBe(true);
    expect(existsSync(join(root, "node_modules", "detect-libc", "package.json"))).toBe(true);
    expect(existsSync(join(root, "node_modules", "semver", "package.json"))).toBe(true);
    expect(existsSync(join(root, "skills", "weaver-open-space", "SKILL.md"))).toBe(true);

    const manifest = JSON.parse(readFileSync(join(root, ".codex-plugin", "plugin.json"), "utf8"));
    expect(manifest.name).toBe("weaver-next");
    const mcp = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8"));
    expect(mcp.mcpServers.weaver_mcp.args).toEqual(["./scripts/start-mcp.mjs"]);

    const runtime = JSON.parse(readFileSync(join(root, "runtime", "manifest.json"), "utf8")) as { buildId: string; files: Record<string, string> };
    expect(runtime.buildId).toMatch(/^[a-f0-9]{12}$/);
    expect(Object.keys(runtime.files)).toEqual(expect.arrayContaining([
      "runtime/supervisor.mjs",
      "apps/widget/dist/index.html",
      "node_modules/sharp/package.json",
      "node_modules/semver/package.json",
    ]));
    for (const [relative, digest] of Object.entries(runtime.files)) {
      expect(existsSync(join(root, relative)), relative).toBe(true);
      expect(createHash("sha256").update(readFileSync(join(root, relative))).digest("hex"), relative).toBe(digest);
    }

    const probe = spawnSync(process.execPath, ["scripts/probe-mcp.mjs"], {
      cwd: join(import.meta.dirname, "../../.."),
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...process.env,
        WEAVER_PROBE_CWD: root,
        WEAVER_PROBE_ARGS: JSON.stringify(["./scripts/start-mcp.mjs"]),
        WEAVER_PROBE_CACHE_SURVIVAL: "1",
      },
    });
    expect(probe.status, `${probe.stdout}\n${probe.stderr}`).toBe(0);
    expect(probe.stdout).toContain('"ok":true');
  }, 30_000);
});
