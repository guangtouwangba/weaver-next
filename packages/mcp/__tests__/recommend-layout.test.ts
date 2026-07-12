import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createWeaverServer, type WeaverServer } from "../src/create-server.js";

const roots: string[] = [];
const servers: WeaverServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

async function boot() {
  const root = mkdtempSync(join(tmpdir(), "weaver-advisory-")); roots.push(root); mkdirSync(root, { recursive: true });
  const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);
  return { root, server };
}

// The recommend/validate/preview advisories were moved into skills. The 4
// model-only advisory tools are removed entirely; the 2 widget-called template
// tools stay REGISTERED (the widget gallery calls them) but off the model surface.
const REMOVED = [
  "weaver_recommend_scene",
  "weaver_recommend_layout",
  "weaver_recommend_visual_templates",
  "weaver_validate_layout_plan",
] as const;
const RECLASSIFIED = ["weaver_validate_visual_template", "weaver_preview_visual_template"] as const;

describe("advisory tools moved into skills", () => {
  it("drops all 6 advisories from the model surface while keeping the 7 critical tools", async () => {
    const { server } = await boot();
    const diagnostics = await server.dispatch("weaver_get_diagnostics", {}) as any;
    const surface = diagnostics.structuredContent.toolSurface;
    for (const name of [...REMOVED, ...RECLASSIFIED]) {
      expect(surface.modelFacingNames).not.toContain(name);
    }
    // All 7 develop-loop critical tools are still advertised model-facing.
    expect(Object.values(surface.criticalPresent).every(Boolean)).toBe(true);
  });

  it("removes the 4 model-only advisory registrations entirely", async () => {
    const { root, server } = await boot();
    for (const name of REMOVED) {
      await expect(server.dispatch(name, { workspaceDir: root, goal: "x", projectId: "p", plan: {} }))
        .rejects.toThrow(`TOOL_NOT_FOUND:${name}`);
    }
  });

  it("keeps the 2 widget template tools registered but widget-only", async () => {
    const { server } = await boot();
    for (const name of RECLASSIFIED) {
      // Registered (toolMeta resolves) but tagged app-only, so hidden from the model.
      const meta = server.toolMeta(name) as any;
      expect(meta?.ui?.visibility).toEqual(["app"]);
    }
  });
});
