import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createWeaverServer } from "../src/create-server.js";
import { currentLogFile } from "../src/logger.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "weaver-obs-")); roots.push(root); mkdirSync(root, { recursive: true });
  return root;
}

describe("observability", () => {
  it("logs boot, every tool call, and errors — and weaver_get_diagnostics reads them back", async () => {
    const root = workspace();
    const { dispatch, close } = await createWeaverServer({ previewWorkspaceDir: root });
    try {
      // A successful call and a failing call both flow through the logging wrap.
      await dispatch("weaver_list_projects", { workspaceDir: root });
      const failed = await dispatch("weaver_get_project_graph", { workspaceDir: root, projectId: "does-not-exist" }) as any;
      expect(failed.isError).toBe(true);

      const diagnostics = await dispatch("weaver_get_diagnostics", {}) as any;
      const body = diagnostics.structuredContent;
      // Server identity + health is self-reported for either host.
      expect(body.server.pid).toBe(process.pid);
      expect(body.server.uptimeMs).toBeGreaterThanOrEqual(0);
      expect(typeof body.server.buildId).toBe("string");

      const events = body.recent.map((entry: any) => `${entry.event}:${entry.tool ?? ""}`);
      expect(events).toContain("server.boot:");
      expect(events).toContain("tool.result:weaver_list_projects");
      // The failing call is recorded as an error the diagnostics tool surfaces.
      const listErr = body.errors.find((entry: any) => entry.tool === "weaver_get_project_graph");
      expect(listErr).toBeTruthy();
      expect(listErr.event).toBe("tool.error");

      // The same lines are persisted to a per-process JSONL file on disk.
      const file = currentLogFile()!;
      expect(file).toContain(join(root, ".weaver", "logs"));
      const lines = readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(lines.some((entry) => entry.event === "server.boot")).toBe(true);
      expect(lines.every((entry) => entry.pid === process.pid && typeof entry.ts === "string")).toBe(true);
    } finally { await close(); }
  });
});
