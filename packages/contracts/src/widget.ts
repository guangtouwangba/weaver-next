import { z } from "zod";
import { agentTaskSchema, chartContentSchema, contentKindSchema, edgeSchema, graphOperationSchema, imageContentSchema, linkContentSchema, projectViewSchema, viewCatalogDeltaSchema, viewTypeSchema } from "./space.js";
import { layoutOperationSchema } from "./layout.js";
import { viewThemeSchema } from "./visual.js";

export const widgetBindingSchema = z.object({ leaseId: z.string(), bindingRevision: z.number().int().nonnegative(), projectId: z.string().optional(), viewId: z.string().optional() });
export const widgetBootstrapSchema = z.object({ version: z.number().optional(), widget: z.string().optional(), workspaceDir: z.string(), projectId: z.string().optional(), preferredDisplayMode: z.string().optional(), chatBinding: widgetBindingSchema.optional(), serverVersion: z.string().optional(), widgetBuildId: z.string().optional(), workspaceWidgetBuildId: z.string().optional(), runtimeMode: z.enum(["development", "installed"]).optional(), buildMismatch: z.boolean().optional(), schemaReset: z.object({ backupName: z.string().min(1) }).optional() });
export type WidgetBinding = z.infer<typeof widgetBindingSchema>;
export type WidgetBootstrap = z.infer<typeof widgetBootstrapSchema>;

export const widgetProjectSchema = z.object({ id: z.string(), title: z.string(), defaultViewId: z.string(), graphRevision: z.number().int().nonnegative(), viewCatalogRevision: z.number().int().nonnegative(), scenePackId: z.string(), scenePackVersion: z.string(), goal: z.string().optional(), automationLevel: z.string().optional(), createdAt: z.string().optional(), updatedAt: z.string().optional() });
export const widgetAssetSchema = z.object({ id: z.string(), width: z.number(), height: z.number(), mimeType: z.string(), thumbnailUri: z.string() });
const summaryDocumentSchema = z.object({ kind: z.literal("document"), mode: z.enum(["note", "article"]), markdown: z.string().optional(), excerpt: z.string(), embeddedAssetIds: z.array(z.string()), coverAssetId: z.string().optional() });
const summaryContentSchema = z.discriminatedUnion("kind", [summaryDocumentSchema, imageContentSchema, linkContentSchema, chartContentSchema]);
export const widgetGraphNodeSchema = z.object({ id: z.string(), projectId: z.string(), type: z.string(), title: z.string(), contentKind: contentKindSchema, content: summaryContentSchema, assets: z.array(widgetAssetSchema).optional(), properties: z.record(z.string(), z.unknown()), archived: z.boolean(), createdAt: z.string(), updatedAt: z.string() });
export const widgetGraphEdgeSchema = edgeSchema.pick({ id: true, sourceNodeId: true, targetNodeId: true, type: true });

export const widgetLayoutNodeSchema = z.object({ nodeId: z.string(), x: z.number(), y: z.number(), width: z.number(), height: z.number(), pinned: z.boolean() }).passthrough();
export const widgetLayoutEdgeSchema = z.object({ edgeId: z.string(), routing: z.enum(["straight", "bezier", "orthogonal", "bundled"]), lineStyle: z.enum(["solid", "dashed"]).optional(), arrows: z.enum(["none", "forward", "both"]).optional(), sourcePort: z.string().optional(), targetPort: z.string().optional(), waypoints: z.array(z.object({ x: z.number(), y: z.number() })), hidden: z.boolean().optional() }).passthrough();
export const widgetLayoutGroupSchema = z.object({ groupId: z.string(), x: z.number(), y: z.number(), width: z.number(), height: z.number(), label: z.string().optional(), kind: z.enum(["frame", "interaction", "semantic", "projection"]).optional() }).passthrough();
export const widgetLayoutSchema = z.object({ viewId: z.string(), viewName: z.string(), viewType: viewTypeSchema, graphRevision: z.number().int().nonnegative(), layoutRevision: z.number().int().nonnegative(), templateRef: z.object({ id: z.string(), version: z.string() }).optional(), projection: z.object({ kind: z.string() }).passthrough().optional(), theme: viewThemeSchema.optional(), nodes: z.record(z.string(), widgetLayoutNodeSchema), edges: z.record(z.string(), widgetLayoutEdgeSchema).optional(), groups: z.record(z.string(), widgetLayoutGroupSchema).optional() }).passthrough();
export const widgetCandidateSchema = z.object({ id: z.string(), label: z.string(), metrics: z.object({ score: z.number(), overlapCount: z.number(), edgeCrossings: z.number(), hardViolations: z.array(z.string()) }).passthrough(), document: widgetLayoutSchema });
export const widgetProjectViewSchema = projectViewSchema.extend({ nodeCount: z.number().int().nonnegative().optional() });
export const widgetManifestSchema = z.object({ scenePack: z.object({ id: z.string().optional(), recommendedViews: z.array(viewTypeSchema), recommendedTemplateIds: z.array(z.string()).optional(), nodeTypes: z.array(z.object({ key: z.string(), label: z.string(), defaultContentKind: contentKindSchema, allowedContentKinds: z.array(contentKindSchema) })) }), views: z.array(z.object({ viewId: z.string(), viewName: z.string(), viewType: viewTypeSchema, layoutRevision: z.number(), templateRef: z.object({ id: z.string(), version: z.string() }).optional() })).optional() });
export const widgetChangeSetPreviewSchema = z.object({ changeSet: z.object({ id: z.string(), rationale: z.string(), riskLevel: z.string(), graphOperations: z.array(graphOperationSchema), layoutOperations: z.array(layoutOperationSchema) }), stale: z.boolean(), currentGraphRevision: z.number(), summary: z.object({ addedNodes: z.number(), updatedNodes: z.number(), archivedNodes: z.number(), addedEdges: z.number(), updatedEdges: z.number(), archivedEdges: z.number(), layoutOperations: z.number() }) });

const eventBase = z.object({ sequence: z.number(), graphRevision: z.number().optional(), layoutRevision: z.number().optional(), viewId: z.string().optional() });
export const widgetProjectEventSchema = z.discriminatedUnion("kind", [
  eventBase.extend({ kind: z.literal("task.updated"), payload: agentTaskSchema }),
  eventBase.extend({ kind: z.literal("graph.changed"), payload: z.object({ fromRevision: z.number(), toRevision: z.number(), addedNodes: z.array(widgetGraphNodeSchema), updatedNodes: z.array(widgetGraphNodeSchema), archivedNodeIds: z.array(z.string()), addedEdges: z.array(widgetGraphEdgeSchema), updatedEdges: z.array(widgetGraphEdgeSchema), archivedEdgeIds: z.array(z.string()) }) }),
  eventBase.extend({ kind: z.literal("layout.changed"), payload: z.object({ viewId: z.string(), fromRevision: z.number(), toRevision: z.number(), operations: z.array(layoutOperationSchema), document: widgetLayoutSchema.optional() }) }),
  eventBase.extend({ kind: z.literal("view.created"), payload: z.object({ viewId: z.string() }).passthrough() }),
  eventBase.extend({ kind: z.literal("view.catalog.changed"), payload: viewCatalogDeltaSchema }),
  eventBase.extend({ kind: z.literal("chat.binding.changed"), payload: z.object({ bindingRevision: z.number(), status: z.enum(["active", "detached"]), reason: z.string().optional(), fallbackViewId: z.string().optional() }) }),
  eventBase.extend({ kind: z.literal("stream.reset"), payload: z.object({}).passthrough() }),
]);

export type WidgetProject = z.infer<typeof widgetProjectSchema>;
export type WidgetAsset = z.infer<typeof widgetAssetSchema>;
export type WidgetGraphNode = z.infer<typeof widgetGraphNodeSchema>;
export type WidgetGraphEdge = z.infer<typeof widgetGraphEdgeSchema>;
export type WidgetLayout = z.infer<typeof widgetLayoutSchema>;
export type WidgetCandidate = z.infer<typeof widgetCandidateSchema>;
export type WidgetProjectView = z.infer<typeof widgetProjectViewSchema>;
export type WidgetManifest = z.infer<typeof widgetManifestSchema>;
export type WidgetChangeSetPreview = z.infer<typeof widgetChangeSetPreviewSchema>;
export type WidgetProjectEvent = z.infer<typeof widgetProjectEventSchema>;
