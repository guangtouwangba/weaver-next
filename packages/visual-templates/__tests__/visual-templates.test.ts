import { describe, expect, it } from "vitest";
import { builtinScenePacks } from "@weaver/scene-packs";
import { builtinVisualTemplates, validateVisualTemplateDefinition, validateVisualTemplateForProject } from "../src/index.js";

describe("visual template registry", () => {
  it("contains two valid templates for each family", () => {
    expect(builtinVisualTemplates).toHaveLength(16);
    for (const family of ["canvas", "hierarchy", "relationship", "flow", "temporal", "board", "matrix", "table"]) expect(builtinVisualTemplates.filter((item) => item.family === family)).toHaveLength(2);
    builtinVisualTemplates.forEach((item) => expect(validateVisualTemplateDefinition(item)).toEqual(item));
  });

  it("reports scene compatibility and missing required fields", () => {
    const template = builtinVisualTemplates.find((item) => item.id === "event-timeline")!;
    const scene = builtinScenePacks.find((item) => item.id === "event-timeline")!;
    const result = validateVisualTemplateForProject(template, scene, [{ id: "n", projectId: "p", type: "event", title: "Event", body: "", contentKind: "document", content: { kind: "document", mode: "note", markdown: "", excerpt: "", embeddedAssetIds: [] }, properties: {}, archived: false, createdAt: "x", updatedAt: "x" }]);
    expect(result.compatible).toBe(true); expect(result.ready).toBe(false); expect(result.missingRequiredFields[0].propertyKey).toBe("occurredAt");
  });
});
