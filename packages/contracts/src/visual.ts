import { z } from "zod";
import { contentKindSchema, viewTypeSchema } from "./space.js";

export const visualFamilySchema = z.enum(["canvas", "hierarchy", "relationship", "flow", "temporal", "board", "matrix", "table"]);
export type VisualFamily = z.infer<typeof visualFamilySchema>;

const selectorSchema = z.object({ nodeTypes: z.array(z.string()).default([]), edgeTypes: z.array(z.string()).default([]) });
const fieldSchema = z.object({ propertyKey: z.string().min(1), required: z.boolean().default(false) });
export const projectionSpecSchema = z.discriminatedUnion("kind", [
  selectorSchema.extend({ kind: z.literal("canvas"), clusterBy: z.enum(["type", "property", "none"]).default("none"), clusterField: z.string().optional() }),
  selectorSchema.extend({ kind: z.literal("tree"), rootNodeType: z.string().optional(), parentEdgeTypes: z.array(z.string()).default([]), direction: z.enum(["top-bottom", "bottom-top", "left-right", "right-left"]).default("top-bottom") }),
  selectorSchema.extend({ kind: z.literal("graph"), groupBy: z.string().optional(), relationshipDistance: z.number().positive().default(180) }),
  selectorSchema.extend({ kind: z.literal("flow"), stepEdgeTypes: z.array(z.string()).default([]), direction: z.enum(["top-bottom", "left-right"]).default("left-right") }),
  selectorSchema.extend({ kind: z.literal("timeline"), timeField: z.string().min(1), endField: z.string().optional(), groupField: z.string().optional(), direction: z.enum(["left-right", "top-bottom"]).default("left-right") }),
  selectorSchema.extend({ kind: z.literal("board"), columnField: z.string().min(1), laneField: z.string().optional(), columnOrder: z.array(z.string()).default([]) }),
  selectorSchema.extend({ kind: z.literal("matrix"), xField: z.string().min(1), yField: z.string().min(1), xLabels: z.tuple([z.string(), z.string()]), yLabels: z.tuple([z.string(), z.string()]), quadrantLabels: z.array(z.string()).length(4) }),
  selectorSchema.extend({ kind: z.literal("table"), columns: z.array(z.object({ key: z.string(), label: z.string(), source: z.enum(["title", "type", "property"]), propertyKey: z.string().optional() })).min(1), sortBy: z.string().optional(), groupBy: z.string().optional() }),
]);
export type ProjectionSpec = z.infer<typeof projectionSpecSchema>;

export const defaultProjectionByView = {
  canvas: { kind: "canvas", nodeTypes: [], edgeTypes: [], clusterBy: "none" },
  tree: { kind: "tree", nodeTypes: [], edgeTypes: [], parentEdgeTypes: [], direction: "top-bottom" },
  graph: { kind: "graph", nodeTypes: [], edgeTypes: [], relationshipDistance: 180 },
  flow: { kind: "flow", nodeTypes: [], edgeTypes: [], stepEdgeTypes: [], direction: "left-right" },
  timeline: { kind: "timeline", nodeTypes: [], edgeTypes: [], timeField: "occurredAt", direction: "left-right" },
  board: { kind: "board", nodeTypes: [], edgeTypes: [], columnField: "status", columnOrder: [] },
  table: { kind: "table", nodeTypes: [], edgeTypes: [], columns: [{ key: "title", label: "Title", source: "title" }] },
} as const;

const nodeStyleSchema = z.object({ fill: z.string(), borderColor: z.string(), textColor: z.string(), accentColor: z.string().optional(), borderRadius: z.number().nonnegative(), titleScale: z.number().positive() });
const edgeStyleSchema = z.object({ color: z.string(), width: z.number().positive(), dashed: z.boolean(), routing: z.enum(["straight", "bezier", "orthogonal", "bundled"]), marker: z.enum(["none", "arrow"]) });
export const viewThemeSchema = z.object({
  canvas: z.object({
    mode: z.enum(["dark", "light"]).default("light"),
    backgroundColor: z.string(),
    pattern: z.enum(["dots", "grid", "plain"]),
    patternGap: z.number().positive().default(20),
    patternSize: z.number().positive().default(1),
    patternColor: z.string(),
    patternOpacity: z.number().min(0).max(1).default(0.55),
  }),
  nodeStyles: z.record(z.string(), nodeStyleSchema),
  edgeStyles: z.record(z.string(), edgeStyleSchema),
});
export type ViewTheme = z.infer<typeof viewThemeSchema>;

export const defaultViewTheme: ViewTheme = {
  canvas: { mode: "light", backgroundColor: "#f2f3ed", pattern: "dots", patternGap: 20, patternSize: 1, patternColor: "#aeb5aa", patternOpacity: 0.42 },
  nodeStyles: { default: { fill: "#fbfbf6", borderColor: "#cbd0c6", textColor: "#20231f", accentColor: "#315cf6", borderRadius: 8, titleScale: 1 } },
  edgeStyles: { default: { color: "#7e867c", width: 1.5, dashed: false, routing: "bezier", marker: "arrow" } },
};

export const sceneTemplateBindingSchema = z.object({
  nodeRoles: z.record(z.string(), z.string()).default({}), edgeRoles: z.record(z.string(), z.string()).default({}), fields: z.record(z.string(), fieldSchema).default({}),
});
export type SceneTemplateBinding = z.infer<typeof sceneTemplateBindingSchema>;

const templateNodeSchema = z.object({ key: z.string().min(1), role: z.string().min(1), title: z.string(), contentKind: contentKindSchema.default("document"), properties: z.record(z.string(), z.unknown()).default({}) });
const templateEdgeSchema = z.object({ key: z.string().min(1), role: z.string().min(1), sourceKey: z.string().min(1), targetKey: z.string().min(1) });
export const visualTemplateSchema = z.object({
  id: z.string().min(1), version: z.string().min(1), name: z.string().min(1), description: z.string(), family: visualFamilySchema,
  renderer: viewTypeSchema, defaultScenePackId: z.string().min(1), compatibleScenePackIds: z.array(z.string()).min(1),
  starterBlueprint: z.object({ nodes: z.array(templateNodeSchema).max(20), edges: z.array(templateEdgeSchema) }),
  sceneBindings: z.record(z.string(), sceneTemplateBindingSchema), projection: projectionSpecSchema,
  layoutPreset: z.object({ strategy: z.enum(["tree", "layered", "radial", "force", "cluster", "grid", "timeline", "swimlane", "hybrid"]), direction: z.enum(["top-bottom", "bottom-top", "left-right", "right-left"]).optional(), config: z.object({ nodeSpacing: z.number().positive().optional(), rankSpacing: z.number().positive().optional(), density: z.number().min(.5).max(2).optional() }).default({}), constraints: z.array(z.object({ type: z.string(), role: z.string().optional(), value: z.union([z.string(), z.number(), z.boolean()]).optional() })).default([]) }),
  theme: viewThemeSchema, agentGuidance: z.string().default(""),
});
export type VisualTemplate = z.infer<typeof visualTemplateSchema>;

export const templateValidationResultSchema = z.object({
  compatible: z.boolean(), ready: z.boolean(), matchedNodeCount: z.number().int().nonnegative(), unmatchedNodeCount: z.number().int().nonnegative(),
  missingRequiredFields: z.array(z.object({ nodeId: z.string().optional(), nodeType: z.string(), propertyKey: z.string() })), warnings: z.array(z.string()),
});
export type TemplateValidationResult = z.infer<typeof templateValidationResultSchema>;
