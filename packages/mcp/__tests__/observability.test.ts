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
    const { dispatch, close } = await createWeaverServer({ previewWorkspaceDir: root, logOptions: { fileLogging: true, fileLevel: "debug" } });
    try {
      // A successful call and a failing call both flow through the logging wrap.
      await dispatch("weaver_read_catalog", { workspaceDir: root, resource: "project.list" });
      const failed = await dispatch("weaver_read_graph", { workspaceDir: root, resource: "full", projectId: "does-not-exist" }) as any;
      expect(failed.isError).toBe(true);

      const diagnostics = await dispatch("weaver_get_diagnostics", {}) as any;
      const body = diagnostics.structuredContent;
      // Server identity + health is self-reported for either host.
      expect(body.server.pid).toBe(process.pid);
      expect(body.server.uptimeMs).toBeGreaterThanOrEqual(0);
      expect(typeof body.server.buildId).toBe("string");
      expect(body.server.previewUrl).toBeUndefined();
      expect(body.server.logFile).toBeUndefined();
      expect(body.server.fileLogging).toBe(true);

      const events = body.recent.map((entry: any) => `${entry.event}:${entry.tool ?? ""}`);
      expect(events).toContain("server.boot:");
      expect(events).toContain("tool.result:weaver_read_catalog");
      // The failing call is recorded as an error the diagnostics tool surfaces.
      const listErr = body.errors.find((entry: any) => entry.tool === "weaver_read_graph");
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

  it("reports the model-facing tool surface so a stuck agent can prove Codex dropped a tool", async () => {
    const root = workspace();
    const { dispatch, close } = await createWeaverServer({ previewWorkspaceDir: root });
    try {
      const diagnostics = await dispatch("weaver_get_diagnostics", {}) as any;
      const surface = diagnostics.structuredContent.toolSurface;
      // Whole registered surface, and the subset the server advertises to the model.
      expect(surface.registered).toBe(15);
      expect(surface.registeredNames).toEqual([
        "weaver_canvas_action", "weaver_catalog_action", "weaver_get_diagnostics",
        "weaver_import_asset", "weaver_open_space", "weaver_prepare_task",
        "weaver_publish_artifact", "weaver_read_catalog", "weaver_read_graph",
        "weaver_read_session", "weaver_recommend_layout", "weaver_review_action",
        "weaver_submit_changeset", "weaver_subscribe_canvas", "weaver_task_action",
      ]);
      expect(surface.modelFacing).toBeGreaterThan(0);
      expect(surface.widgetOnly).toBeGreaterThan(0);
      expect(surface.modelFacing + surface.widgetOnly).toBe(surface.registered);
      // The essential develop-loop write tools must be advertised model-facing.
      expect(surface.modelFacingNames).toContain("weaver_submit_changeset");
      expect(surface.modelFacingNames).toContain("weaver_task_action");
      expect(surface.criticalPresent.weaver_submit_changeset).toBe(true);
      expect(surface.criticalPresent.weaver_task_action).toBe(true);
      // Every critical develop-loop tool must stay on the model surface.
      expect(Object.values(surface.criticalPresent).every((present) => present === true)).toBe(true);
      // Regression guard: the model surface must not silently bloat back. It is 19
      // after dropping the legacy task-dispatch tools; keep a small headroom.
      expect(surface.modelFacing).toBeLessThanOrEqual(15);
      // A widget-only tool (visibility ["app"], not in the preview allowlist) stays hidden from the model.
      expect(surface.modelFacingNames).not.toContain("weaver_confirm_agent_dispatch");
      // The legacy dispatch tools are off the model surface (removed / reclassified app-only).
      expect(surface.modelFacingNames).not.toContain("weaver_mark_task_dispatched");
      expect(surface.modelFacingNames).not.toContain("weaver_prepare_agent_task");
      expect(surface.modelFacingNames).not.toContain("weaver_open_workspace_widget");
      await expect(dispatch("weaver_create_project", {})).rejects.toThrow("TOOL_NOT_FOUND");
    } finally { await close(); }
  });

  it("never returns a Claude preview capability URL through diagnostics", async () => {
    const root = workspace();
    const previousHost = process.env.WEAVER_HOST_KIND;
    process.env.WEAVER_HOST_KIND = "claude";
    const { dispatch, close } = await createWeaverServer({ previewWorkspaceDir: root });
    try {
      const diagnostics = await dispatch("weaver_get_diagnostics", {}) as any;
      const serialized = JSON.stringify(diagnostics.structuredContent);
      expect(diagnostics.structuredContent.server.previewAvailable).toBe(true);
      expect(serialized).not.toContain("previewUrl");
      expect(serialized).not.toContain("token=");
      expect(serialized).not.toContain("preview-secret");
    } finally {
      await close();
      if (previousHost === undefined) delete process.env.WEAVER_HOST_KIND;
      else process.env.WEAVER_HOST_KIND = previousHost;
    }
  });
});
