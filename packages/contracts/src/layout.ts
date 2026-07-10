import { z } from "zod";
import { graphOperationSchema, viewTypeSchema } from "./space.js";

export const layoutStrategySchema = z.enum(["tree", "layered", "radial", "force", "cluster", "grid", "timeline", "swimlane", "hybrid"]);
export type LayoutStrategy = z.infer<typeof layoutStrategySchema>;
export const layoutDirectionSchema = z.enum(["top-bottom", "bottom-top", "left-right", "right-left"]);
export type LayoutDirection = z.infer<typeof layoutDirectionSchema>;

export const pointSchema = z.object({ x: z.number(), y: z.number() });
export const rectSchema = pointSchema.extend({ width: z.number().nonnegative(), height: z.number().nonnegative() });
export type Rect = z.infer<typeof rectSchema>;

export const nodeLayoutSchema = rectSchema.extend({
  nodeId: z.string(),
  rotation: z.number().default(0),
  zIndex: z.number().int().default(0),
  pinned: z.boolean().default(false),
  hidden: z.boolean().default(false),
  collapsed: z.boolean().default(false),
  groupId: z.string().optional(),
  laneId: z.string().optional(),
  rank: z.number().int().optional(),
});
export type NodeLayout = z.infer<typeof nodeLayoutSchema>;

export const edgeLayoutSchema = z.object({
  edgeId: z.string(),
  routing: z.enum(["straight", "bezier", "orthogonal", "bundled"]).default("bezier"),
  sourcePort: z.string().optional(),
  targetPort: z.string().optional(),
  waypoints: z.array(pointSchema).default([]),
  labelPosition: pointSchema.optional(),
  hidden: z.boolean().default(false),
});
export type EdgeLayout = z.infer<typeof edgeLayoutSchema>;

export const groupLayoutSchema = rectSchema.extend({
  groupId: z.string(),
  direction: z.enum(["horizontal", "vertical", "radial"]).optional(),
  padding: z.number().nonnegative().default(32),
  collapsed: z.boolean().default(false),
});
export type GroupLayout = z.infer<typeof groupLayoutSchema>;

export const layoutConfigSchema = z.object({
  direction: layoutDirectionSchema.default("left-right"),
  nodeSpacing: z.number().positive().default(72),
  rankSpacing: z.number().positive().default(120),
  density: z.number().min(0.5).max(2).default(1),
  viewportWidth: z.number().positive().default(1280),
  viewportHeight: z.number().positive().default(800),
});
export type LayoutConfig = z.infer<typeof layoutConfigSchema>;

export const layoutDocumentSchema = z.object({
  projectId: z.string(),
  viewId: z.string(),
  viewType: viewTypeSchema,
  graphRevision: z.number().int().nonnegative(),
  layoutRevision: z.number().int().nonnegative(),
  strategy: layoutStrategySchema,
  config: layoutConfigSchema,
  nodes: z.record(z.string(), nodeLayoutSchema),
  edges: z.record(z.string(), edgeLayoutSchema),
  groups: z.record(z.string(), groupLayoutSchema),
  bounds: rectSchema,
  createdBy: z.enum(["user", "layout-engine", "agent"]),
  updatedAt: z.string(),
});
export type LayoutDocument = z.infer<typeof layoutDocumentSchema>;

export const layoutConstraintSchema = z.object({
  type: z.enum(["pin", "align", "distribute", "order", "rank", "group", "containment", "separation", "relative-position", "direction", "spacing", "avoid-overlap", "preserve-position", "edge-length", "edge-routing", "emphasis", "viewport-fit"]),
  nodeIds: z.array(z.string()).default([]),
  edgeIds: z.array(z.string()).default([]),
  edgeTypes: z.array(z.string()).default([]),
  axis: z.enum(["x", "y"]).optional(),
  relation: z.enum(["above", "below", "left-of", "right-of", "near", "far"]).optional(),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  strength: z.number().min(0).max(1).default(1),
});
export type LayoutConstraint = z.infer<typeof layoutConstraintSchema>;

export const layoutScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("whole-view") }),
  z.object({ type: z.literal("selection"), nodeIds: z.array(z.string()).min(1) }),
  z.object({ type: z.literal("neighborhood"), nodeIds: z.array(z.string()).min(1), hops: z.number().int().min(1).max(5) }),
]);

export const layoutPlanSchema = z.object({
  projectId: z.string(),
  viewId: z.string(),
  baseGraphRevision: z.number().int().nonnegative(),
  baseLayoutRevision: z.number().int().nonnegative(),
  scope: layoutScopeSchema,
  strategy: layoutStrategySchema,
  direction: layoutDirectionSchema.optional(),
  constraints: z.array(layoutConstraintSchema).default([]),
  preserve: z.object({
    pinnedNodes: z.boolean().default(true),
    manualGroups: z.boolean().default(true),
    relativeOrder: z.boolean().default(true),
    mentalMapWeight: z.number().min(0).max(1).default(0.6),
  }),
  candidateCount: z.number().int().min(1).max(5).default(3),
  rationale: z.string().default(""),
});
export type LayoutPlan = z.infer<typeof layoutPlanSchema>;

export const layoutOperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("set-node-frame"), viewId: z.string(), nodeId: z.string(), frame: rectSchema }),
  z.object({ type: z.literal("pin-node"), viewId: z.string(), nodeId: z.string() }),
  z.object({ type: z.literal("unpin-node"), viewId: z.string(), nodeId: z.string() }),
  z.object({ type: z.literal("set-node-visibility"), viewId: z.string(), nodeId: z.string(), hidden: z.boolean() }),
  z.object({ type: z.literal("set-node-collapsed"), viewId: z.string(), nodeId: z.string(), collapsed: z.boolean() }),
  z.object({ type: z.literal("set-node-z-index"), viewId: z.string(), nodeId: z.string(), zIndex: z.number().int() }),
  z.object({ type: z.literal("assign-node-to-group"), viewId: z.string(), nodeId: z.string(), groupId: z.string().nullable() }),
  z.object({ type: z.literal("set-group-frame"), viewId: z.string(), groupId: z.string(), frame: rectSchema }),
  z.object({ type: z.literal("set-group-direction"), viewId: z.string(), groupId: z.string(), direction: z.enum(["horizontal", "vertical", "radial"]) }),
  z.object({ type: z.literal("set-node-rank"), viewId: z.string(), nodeId: z.string(), rank: z.number().int() }),
  z.object({ type: z.literal("set-node-lane"), viewId: z.string(), nodeId: z.string(), laneId: z.string().nullable() }),
  z.object({ type: z.literal("set-edge-route"), viewId: z.string(), edgeId: z.string(), route: edgeLayoutSchema }),
  z.object({ type: z.literal("set-layout-config"), viewId: z.string(), config: layoutConfigSchema }),
  z.object({ type: z.literal("set-viewport-preset"), viewId: z.string(), viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number().positive() }) }),
]);
export type LayoutOperation = z.infer<typeof layoutOperationSchema>;

export const layoutMetricsSchema = z.object({
  overlapCount: z.number().int().nonnegative(),
  overlapArea: z.number().nonnegative(),
  edgeCrossings: z.number().int().nonnegative(),
  edgeLength: z.number().nonnegative(),
  pinnedNodeMoves: z.number().int().nonnegative(),
  displacement: z.number().nonnegative(),
  compactness: z.number().nonnegative(),
  hardViolations: z.array(z.string()),
  score: z.number(),
});
export type LayoutMetrics = z.infer<typeof layoutMetricsSchema>;

export const layoutCandidateSchema = z.object({
  id: z.string(),
  label: z.string(),
  document: layoutDocumentSchema,
  operations: z.array(layoutOperationSchema),
  metrics: layoutMetricsSchema,
});
export type LayoutCandidate = z.infer<typeof layoutCandidateSchema>;

export const changeSetSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  projectId: z.string(),
  baseGraphRevision: z.number().int().nonnegative(),
  baseLayoutRevisions: z.record(z.string(), z.number().int().nonnegative()),
  graphOperations: z.array(graphOperationSchema),
  layoutOperations: z.array(layoutOperationSchema),
  rationale: z.string(),
  riskLevel: z.enum(["low", "medium", "high"]),
  status: z.enum(["pending", "applied", "rejected", "reverted"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ChangeSet = z.infer<typeof changeSetSchema>;
