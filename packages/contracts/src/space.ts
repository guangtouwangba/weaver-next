import { z } from "zod";

export const automationLevelSchema = z.enum(["cautious", "collaborative", "automatic"]);
export type AutomationLevel = z.infer<typeof automationLevelSchema>;

export const contentKindSchema = z.enum(["document", "image", "link"]);
export type ContentKind = z.infer<typeof contentKindSchema>;

export const documentContentSchema = z.object({
  kind: z.literal("document"),
  mode: z.enum(["note", "article"]).default("note"),
  markdown: z.string().default(""),
  excerpt: z.string().default(""),
  coverAssetId: z.string().optional(),
  embeddedAssetIds: z.array(z.string()).default([]),
});
export type DocumentContent = z.infer<typeof documentContentSchema>;

export const imageContentSchema = z.object({
  kind: z.literal("image"),
  assetId: z.string().min(1),
  alt: z.string().default(""),
  caption: z.string().default(""),
});
export type ImageContent = z.infer<typeof imageContentSchema>;

export const linkContentSchema = z.object({
  kind: z.literal("link"),
  url: z.url(),
  title: z.string().default(""),
  description: z.string().default(""),
  domain: z.string().default(""),
  imageAssetId: z.string().optional(),
  enrichmentStatus: z.enum(["pending", "ready", "failed"]).default("pending"),
});
export type LinkContent = z.infer<typeof linkContentSchema>;

export const nodeContentSchema = z.discriminatedUnion("kind", [documentContentSchema, imageContentSchema, linkContentSchema]);
export type NodeContent = z.infer<typeof nodeContentSchema>;

const nodeBaseSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  type: z.string().min(1),
  title: z.string(),
  body: z.string().default(""),
  contentKind: contentKindSchema.optional(),
  content: nodeContentSchema.optional(),
  properties: z.record(z.string(), z.unknown()).default({}),
  archived: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
});

function excerpt(markdown: string) {
  return markdown.replace(/[#>*_`[\]()!-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 280);
}

export const nodeSchema = nodeBaseSchema.transform((node) => {
  const content = node.content ?? documentContentSchema.parse({ kind: "document", markdown: node.body, excerpt: excerpt(node.body) });
  if (node.contentKind && node.contentKind !== content.kind) throw new Error("NODE_CONTENT_KIND_MISMATCH");
  return { ...node, body: content.kind === "document" ? content.markdown : node.body, contentKind: content.kind, content };
});
export type SpaceNode = z.infer<typeof nodeSchema>;

export const assetSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  kind: z.literal("image"),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  size: z.number().int().nonnegative().max(20 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  storageUri: z.string().min(1),
  thumbnailUri: z.string().min(1),
  createdAt: z.string(),
});
export type Asset = z.infer<typeof assetSchema>;

export const edgeSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  type: z.string().min(1),
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
  directed: z.boolean().default(true),
  properties: z.record(z.string(), z.unknown()).default({}),
  archived: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SpaceEdge = z.infer<typeof edgeSchema>;

export const projectSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  goal: z.string().default(""),
  scenePackId: z.string().min(1),
  scenePackVersion: z.string().min(1),
  automationLevel: automationLevelSchema.default("collaborative"),
  defaultViewId: z.string().min(1),
  graphRevision: z.number().int().nonnegative().default(0),
  viewCatalogRevision: z.number().int().nonnegative().default(0),
  createdFromTemplate: z.object({ id: z.string(), version: z.string() }).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SpaceProject = z.infer<typeof projectSchema>;

export const propertyDefinitionSchema = z.object({
  key: z.string().min(1), label: z.string().min(1), type: z.enum(["string", "number", "boolean", "date", "datetime", "enum", "node-reference"]),
  required: z.boolean().default(false), options: z.array(z.string()).optional(), defaultValue: z.unknown().optional(),
});
export type PropertyDefinition = z.infer<typeof propertyDefinitionSchema>;

const nodeTypeDefinitionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  color: z.string().optional(),
  defaultWidth: z.number().positive().default(220),
  defaultHeight: z.number().positive().default(112),
  requiredProperties: z.array(z.string()).default([]),
  properties: z.array(propertyDefinitionSchema).default([]),
  defaultContentKind: contentKindSchema.default("document"),
  allowedContentKinds: z.array(contentKindSchema).min(1).default(["document", "image", "link"]),
});

const edgeTypeDefinitionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  directed: z.boolean().default(true),
  sourceTypes: z.array(z.string()).default([]),
  targetTypes: z.array(z.string()).default([]),
});

export const viewTypeSchema = z.enum(["canvas", "tree", "graph", "board", "timeline", "flow", "table"]);
export type ViewType = z.infer<typeof viewTypeSchema>;

export const projectViewSchema = z.object({
  id: z.string().min(1), projectId: z.string().min(1), name: z.string().trim().min(1).max(120), viewType: viewTypeSchema,
  templateRef: z.object({ id: z.string().min(1), version: z.string().min(1) }).optional(),
  status: z.enum(["active", "trashed"]).default("active"), pinned: z.boolean().default(false), pinnedOrder: z.number().int().nonnegative().optional(),
  createdBy: z.enum(["user", "agent", "template"]).default("user"), createdAt: z.string(), updatedAt: z.string(), lastOpenedAt: z.string(),
  trashedAt: z.string().optional(), purgeAfter: z.string().optional(),
});
export type ProjectView = z.infer<typeof projectViewSchema>;

export const canvasViewStateSchema = z.object({
  canvasSessionId: z.string().min(1), viewId: z.string().min(1),
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number().positive() }), selectedNodeIds: z.array(z.string()).default([]), focusedNodeId: z.string().optional(), lastOpenedAt: z.string(),
});
export type CanvasViewState = z.infer<typeof canvasViewStateSchema>;

export const viewCatalogDeltaSchema = z.object({
  projectId: z.string().min(1), fromRevision: z.number().int().nonnegative(), toRevision: z.number().int().nonnegative(),
  upsertedViews: z.array(projectViewSchema).default([]), removedViewIds: z.array(z.string()).default([]), defaultViewId: z.string().optional(),
});
export type ViewCatalogDelta = z.infer<typeof viewCatalogDeltaSchema>;

export const scenePackSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(["thinking", "learning", "research", "planning"]),
  description: z.string(),
  nodeTypes: z.array(nodeTypeDefinitionSchema).min(1),
  edgeTypes: z.array(edgeTypeDefinitionSchema),
  recommendedViews: z.array(viewTypeSchema).min(1),
  defaultView: viewTypeSchema,
  allowedStrategies: z.array(z.string()).min(1),
  defaultStrategy: z.string().min(1),
  defaultDirection: z.enum(["top-bottom", "bottom-top", "left-right", "right-left"]).optional(),
  contextPolicy: z.object({
    modes: z.array(z.enum(["ancestor_path", "typed_neighborhood", "selected_nodes", "pinned_nodes", "source_grounding"])),
    maxNodes: z.number().int().positive().default(40),
    maxHops: z.number().int().nonnegative().default(2),
  }),
  artifactTypes: z.array(z.string()).default([]),
  scoringWeights: z.record(z.string(), z.number()).default({}),
  recommendedTemplateIds: z.array(z.string()).default([]),
});
export type ScenePack = z.infer<typeof scenePackSchema>;

const addNodeOperationSchema = z.object({ type: z.literal("add-node"), node: nodeSchema });
const updateNodeOperationSchema = z.object({ type: z.literal("update-node"), nodeId: z.string(), patch: nodeBaseSchema.partial() });
const archiveNodeOperationSchema = z.object({ type: z.literal("archive-node"), nodeId: z.string() });
const addEdgeOperationSchema = z.object({ type: z.literal("add-edge"), edge: edgeSchema });
const updateEdgeOperationSchema = z.object({ type: z.literal("update-edge"), edgeId: z.string(), patch: edgeSchema.partial() });
const archiveEdgeOperationSchema = z.object({ type: z.literal("archive-edge"), edgeId: z.string() });
const createArtifactOperationSchema = z.object({ type: z.literal("create-artifact"), artifactType: z.string(), title: z.string(), content: z.unknown() });
const setNodeContentOperationSchema = z.object({ type: z.literal("set-node-content"), nodeId: z.string(), content: nodeContentSchema });
const attachAssetOperationSchema = z.object({ type: z.literal("attach-asset"), nodeId: z.string(), assetId: z.string(), role: z.enum(["embedded", "cover"]).default("embedded") });
const detachAssetOperationSchema = z.object({ type: z.literal("detach-asset"), nodeId: z.string(), assetId: z.string() });
const setNodeCoverOperationSchema = z.object({ type: z.literal("set-node-cover"), nodeId: z.string(), assetId: z.string().nullable() });

export const graphOperationSchema = z.discriminatedUnion("type", [
  addNodeOperationSchema,
  updateNodeOperationSchema,
  archiveNodeOperationSchema,
  addEdgeOperationSchema,
  updateEdgeOperationSchema,
  archiveEdgeOperationSchema,
  createArtifactOperationSchema,
  setNodeContentOperationSchema,
  attachAssetOperationSchema,
  detachAssetOperationSchema,
  setNodeCoverOperationSchema,
]);
export type GraphOperation = z.infer<typeof graphOperationSchema>;

export const chatCanvasBindingSchema = z.object({
  chatSessionKey: z.string().regex(/^[a-f0-9]{64}$/),
  bindingRevision: z.number().int().positive(),
  leaseId: z.string().regex(/^[a-f0-9]{64}$/),
  projectId: z.string().optional(),
  viewId: z.string().optional(),
  canvasSessionId: z.string().optional(),
  status: z.enum(["opening", "active", "detached"]),
  lastSeenAt: z.string(),
});
export type ChatCanvasBinding = z.infer<typeof chatCanvasBindingSchema>;

export const canvasContextSnapshotSchema = z.object({
  version: z.literal(2),
  canvasSessionId: z.string().min(1),
  workspaceDir: z.string().min(1),
  projectId: z.string().min(1),
  scenePackId: z.string().min(1),
  scenePackVersion: z.string().min(1),
  graphRevision: z.number().int().nonnegative(),
  viewId: z.string().min(1),
  viewType: viewTypeSchema,
  focusedNodeId: z.string().optional(),
  selectedNodeIds: z.array(z.string()).default([]),
  selectedEdgeIds: z.array(z.string()).default([]),
  selectedGroupIds: z.array(z.string()).default([]),
  pinnedContextNodeIds: z.array(z.string()).default([]),
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number().positive() }),
  presence: z.object({
    visible: z.boolean().default(true),
    focused: z.boolean().default(false),
    lastSeenAt: z.string(),
  }).optional(),
  chatBinding: z.object({
    leaseId: z.string().regex(/^[a-f0-9]{64}$/),
    bindingRevision: z.number().int().positive(),
  }).optional(),
  agentEligible: z.boolean().default(false),
  sequence: z.number().int().nonnegative(),
  updatedAt: z.string(),
});
export type CanvasContextSnapshot = z.infer<typeof canvasContextSnapshotSchema>;

export const agentTaskIntentSchema = z.enum(["develop_selection", "layout_view", "develop_then_layout"]);
export type AgentTaskIntent = z.infer<typeof agentTaskIntentSchema>;
export const agentTaskStageSchema = z.enum(["content", "layout"]);
export type AgentTaskStage = z.infer<typeof agentTaskStageSchema>;
export const agentTaskStatusSchema = z.enum(["prepared", "dispatched", "running", "pending_review", "ready_to_continue", "completed", "stale", "failed", "cancelled"]);
export const agentDispatchRecordSchema = z.object({
  dispatchKey: z.string().min(1),
  stage: agentTaskStageSchema,
  state: z.enum(["prepared", "accepted", "rejected", "unconfirmed"]),
  attemptedAt: z.string(),
  acceptedAt: z.string().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});
export type AgentDispatchRecord = z.infer<typeof agentDispatchRecordSchema>;
const agentTaskErrorSchema = z.preprocess(
  (value) => typeof value === "string" ? { code: "TASK_FAILED", message: value } : value,
  z.object({ code: z.string(), message: z.string() }).optional(),
);
export const agentTaskSchema = z.object({
  taskId: z.string().min(1),
  canvasSessionId: z.string().min(1),
  workspaceDir: z.string().min(1),
  projectId: z.string().min(1),
  viewId: z.string().default(""),
  chatSessionKey: z.string().min(1).default("legacy-unbound"),
  bindingRevision: z.number().int().nonnegative().default(0),
  actionKey: z.string().min(1),
  selectedNodeIds: z.array(z.string()).default([]),
  selectedEdgeIds: z.array(z.string()).default([]),
  pinnedContextNodeIds: z.array(z.string()).default([]),
  userInstruction: z.string().optional(),
  expectedGraphRevision: z.number().int().nonnegative(),
  baseLayoutRevision: z.number().int().nonnegative().optional(),
  contextResourceUri: z.string(),
  attachmentResourceUris: z.array(z.string()).default([]),
  taskRevision: z.number().int().nonnegative().default(0),
  intent: agentTaskIntentSchema.default("develop_selection"),
  activeStage: agentTaskStageSchema.default("content"),
  results: z.object({ changeSetId: z.string().optional(), layoutRunId: z.string().optional() }).default({}),
  dispatches: z.array(agentDispatchRecordSchema).default([]),
  // Legacy fields remain readable while stored tasks migrate to `results`.
  layoutRunId: z.string().optional(),
  changeSetId: z.string().optional(),
  error: agentTaskErrorSchema,
  status: agentTaskStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).transform((task) => ({
  ...task,
  results: {
    changeSetId: task.results.changeSetId ?? task.changeSetId,
    layoutRunId: task.results.layoutRunId ?? task.layoutRunId,
  },
}));
export type AgentTask = z.infer<typeof agentTaskSchema>;

export const projectEventKindSchema = z.enum(["task.updated", "graph.changed", "layout.changed", "view.created", "view.catalog.changed", "chat.binding.changed", "stream.reset"]);
export const projectEventSchema = z.object({
  sequence: z.number().int().positive(),
  projectId: z.string().min(1),
  canvasSessionId: z.string().optional(),
  taskId: z.string().optional(),
  kind: projectEventKindSchema,
  graphRevision: z.number().int().nonnegative().optional(),
  viewId: z.string().optional(),
  layoutRevision: z.number().int().nonnegative().optional(),
  payload: z.unknown(),
  createdAt: z.string(),
});
export type ProjectEvent = z.infer<typeof projectEventSchema>;
