import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentLogFile, initLog, log, resetLoggerForTest, summarizeArgs } from "../src/logger.js";

const roots: string[] = [];
afterEach(() => {
  delete process.env.WEAVER_FILE_LOG;
  delete process.env.WEAVER_STDERR_LOG;
  delete process.env.WEAVER_LOG_LEVEL;
  vi.restoreAllMocks();
  resetLoggerForTest();
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "weaver-log-security-"));
  roots.push(root);
  return root;
}

describe("secure logger", () => {
  it("does not write stderr unless the operator explicitly enables it", () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    log("error", "test.error", { message: "private failure" });

    expect(write).not.toHaveBeenCalled();
  });

  it("does not create persistent logs by default", () => {
    const root = workspace();
    const legacyDir = join(root, ".weaver", "logs");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, "mcp-legacy.jsonl"), "private legacy data\n");
    resetLoggerForTest();
    initLog(root);
    log("error", "test.error", { message: "SECRET_USER_TEXT" });

    expect(currentLogFile()).toBeNull();
    expect(existsSync(legacyDir)).toBe(false);
  });

  it("bounds opt-in logs, prunes old files, and uses owner-only permissions", () => {
    const root = workspace();
    const logsDir = join(root, ".weaver", "logs");
    mkdirSync(logsDir, { recursive: true });
    for (let index = 0; index < 5; index += 1) {
      const file = join(logsDir, `mcp-old-${index}.jsonl`);
      writeFileSync(file, "old\n");
      utimesSync(file, new Date(0), new Date(0));
    }

    resetLoggerForTest();
    initLog(root, { fileLogging: true, maxBytes: 700, maxFiles: 3, maxAgeMs: 60_000 });
    for (let index = 0; index < 20; index += 1) log("warn", "test.warning", { code: "TEST_WARNING", index });

    const files = readdirSync(logsDir).filter((name) => name.endsWith(".jsonl"));
    expect(files.length).toBeLessThanOrEqual(3);
    for (const name of files) {
      const stats = statSync(join(logsDir, name));
      expect(stats.size).toBeLessThanOrEqual(700);
      expect(stats.mode & 0o777).toBe(0o600);
    }
  });

  it("never records arbitrary strings, paths, capability tokens, or nested payloads", () => {
    const token = "a".repeat(64);
    expect(summarizeArgs({
      workspaceDir: "/Users/private/secret-project",
      projectId: "project-safe-id",
      userInstruction: "my unpublished acquisition thesis",
      previewToken: token,
      payload: { markdown: "private research" },
    })).toEqual({
      workspaceDir: "[redacted-path]",
      projectId: "project-safe-id",
      userInstruction: "[string:33]",
      previewToken: "[redacted]",
      payload: "[object]",
    });

    const root = workspace();
    resetLoggerForTest();
    initLog(root, { fileLogging: true });
    log("error", "test.error", { workspaceDir: "/Users/private/secret-project", userInstruction: "private acquisition thesis", message: `failed for ${token}`, stack: "private stack" });
    const persisted = readFileSync(currentLogFile()!, "utf8");
    expect(persisted).not.toContain("/Users/private");
    expect(persisted).not.toContain(token);
    expect(persisted).not.toContain("private stack");
    expect(persisted).not.toContain("private acquisition thesis");
  });
});
