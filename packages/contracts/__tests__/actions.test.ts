import { describe, expect, it } from "vitest";
import { canvasActionSchema, catalogActionSchema, reviewActionSchema, taskActionSchema } from "../src/index.js";

describe("formal MCP action contracts", () => {
  it("requires the fields selected by each catalog action", () => {
    expect(catalogActionSchema.parse({ workspaceDir: "/w", action: "rename_view", projectId: "p", viewId: "v", name: "Map", baseCatalogRevision: 2 }).action).toBe("rename_view");
    expect(() => catalogActionSchema.parse({ workspaceDir: "/w", action: "rename_view", projectId: "p", viewId: "v", baseCatalogRevision: 2 })).toThrow();
  });

  it("rejects incomplete canvas and task variants before dispatch", () => {
    expect(() => canvasActionSchema.parse({ workspaceDir: "/w", action: "archive_node", projectId: "p", nodeId: "n" })).toThrow();
    expect(() => taskActionSchema.parse({ workspaceDir: "/w", action: "progress", taskId: "t" })).toThrow();
    expect(taskActionSchema.parse({ workspaceDir: "/w", action: "progress", taskId: "t", note: "working" }).action).toBe("progress");
  });

  it("enforces resource-specific review arguments", () => {
    expect(() => reviewActionSchema.parse({ workspaceDir: "/w", resource: "layout_run", action: "apply", id: "run" })).toThrow();
    expect(reviewActionSchema.parse({ workspaceDir: "/w", resource: "layout_run", action: "apply", id: "run", candidateId: "c" }).action).toBe("apply");
    // Direct-write mode: applied ChangeSets are revertible (the undo safety net).
    expect(reviewActionSchema.parse({ workspaceDir: "/w", resource: "changeset", action: "revert", id: "cs" }).action).toBe("revert");
  });
});
