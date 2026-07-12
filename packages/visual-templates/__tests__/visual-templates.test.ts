import { describe, expect, it } from "vitest";
import { builtinScenePacks } from "@weaver/scene-packs";
import { builtinVisualTemplates, validateCatalog, validateVisualTemplateDefinition, validateVisualTemplateForProject } from "../src/index.js";

describe("visual template registry", () => {
  it("contains two valid templates for each family", () => {
    expect(builtinVisualTemplates).toHaveLength(16);
    for (const family of ["canvas", "hierarchy", "relationship", "flow", "temporal", "board", "matrix", "table"]) expect(builtinVisualTemplates.filter((item) => item.family === family)).toHaveLength(2);
    builtinVisualTemplates.forEach((item) => expect(validateVisualTemplateDefinition(item)).toEqual(item));
  });

  it("reports scene compatibility and missing required fields", () => {
    const template = builtinVisualTemplates.find((item) => item.id === "event-timeline")!;
    const scene = builtinScenePacks.find((item) => item.id === "event-timeline")!;
    const result = validateVisualTemplateForProject(template, scene, [{ id: "n", projectId: "p", type: "event", title: "Event", contentKind: "document", content: { kind: "document", mode: "note", markdown: "", excerpt: "", embeddedAssetIds: [] }, properties: {}, archived: false, createdAt: "x", updatedAt: "x" }]);
    expect(result.compatible).toBe(true); expect(result.ready).toBe(false); expect(result.missingRequiredFields[0].propertyKey).toBe("occurredAt");
  });

  it("rejects incompatible recommended templates across the catalog", () => {
    const scene = { ...builtinScenePacks[0], recommendedTemplateIds: ["event-timeline"] };
    expect(() => validateCatalog([scene], builtinVisualTemplates)).toThrow("CATALOG_INVALID");
  });

  it("rejects semantic roles that are not scene node types", () => {
    const template = structuredClone(builtinVisualTemplates[0]);
    const sceneId = template.compatibleScenePackIds[0];
    template.sceneBindings[sceneId].nodeRoles.center = "missing-type";
    expect(() => validateVisualTemplateDefinition(template)).toThrow("VISUAL_TEMPLATE_BINDING_INVALID");
  });

  it("keeps semantic bindings valid when Scene nodeTypes are reordered", () => {
    const scenes = builtinScenePacks.map((scene) => ({ ...scene, nodeTypes: [...scene.nodeTypes].reverse() }));
    expect(validateCatalog(scenes, builtinVisualTemplates).templates).toHaveLength(16);
  });

  it("rejects semantic edge roles that resolve to an undeclared edge type", () => {
    const template = structuredClone(builtinVisualTemplates.find((item) => Object.keys(item.sceneBindings[item.compatibleScenePackIds[0]].edgeRoles).length)!);
    const sceneId = template.compatibleScenePackIds[0];
    const role = Object.keys(template.sceneBindings[sceneId].edgeRoles)[0];
    template.sceneBindings[sceneId].edgeRoles[role] = "missing-edge";
    expect(() => validateVisualTemplateDefinition(template)).toThrow("VISUAL_TEMPLATE_BINDING_INVALID");
  });
});
