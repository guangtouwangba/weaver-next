// View-model and domain types shared across the widget. Local types that duplicate a
// @weaver/contracts schema 1:1 (or as a compatible subset) are re-exported under their
// existing local name below so call sites never need to change. Types whose real widget
// usage (demo/seed data, MCP responses) doesn't match the contracts shape stay local —
// see the refactor report for the per-type compatibility notes.

import type { ChartContent, NodeContent, ViewTheme } from "@weaver/contracts";

export type { VisualFamily, ViewTheme, VisualTemplate, TemplateValidationResult as TemplateValidation, AgentTaskIntent as TaskIntent, AgentTask } from "@weaver/contracts";
// These alias cleanly: the widget always supplies every field on construction, and the
// contracts shapes are otherwise structurally identical to the local ones.
export type { DocumentContent, ImageContent, LinkContent, ChartContent, ChartSeries, ChartType, NodeContent } from "@weaver/contracts";

export type ToolResult<T> = { structuredContent?: T; isError?: boolean; content?: Array<{ type: string; text?: string }> };
export type ChatBindingBootstrap = { leaseId: string; bindingRevision: number; projectId?: string; viewId?: string };
export type Bootstrap = {
  version?: number; widget?: string; workspaceDir: string; projectId?: string; preferredDisplayMode?: string; chatBinding?: ChatBindingBootstrap;
  serverVersion?: string; widgetBuildId?: string; workspaceWidgetBuildId?: string;
  runtimeMode?: "development" | "installed"; buildMismatch?: boolean;
};
export type CanvasAccessState = "claiming" | "claim-failed" | "active" | "duplicate" | "detached" | "build-mismatch";

// Kept local: contracts' SpaceProject requires `goal`, `automationLevel`, `createdAt`, `updatedAt`
// (all non-optional in the schema's inferred output) which the widget's demo/seed Project
// literal does not populate. The optional fields below mirror what weaver_list_projects
// actually returns at runtime (the server sends the full SpaceProject) — used for display
// in ProjectPickerModal without forcing the demo path to fabricate them.
export type Project = { id: string; title: string; defaultViewId: string; graphRevision: number; viewCatalogRevision: number; scenePackId: string; scenePackVersion: string; goal?: string; automationLevel?: string; createdAt?: string; updatedAt?: string };

// Kept local: contracts' Asset schema requires `projectId`, `kind`, `size`, `sha256`,
// `storageUri`, `createdAt` and a strict `mimeType` union; the widget only ever constructs
// the thumbnail-shaped subset used for previews (see demo seed data and `createDemoNode`).
export type Asset = { id: string; width: number; height: number; mimeType: string; thumbnailUri: string };

// Kept local: contracts' SpaceNode requires a non-optional `body: string` (from the schema's
// `.transform()`) and has no `assets` field, while the widget's GraphNode always carries
// `assets` and never populates `body` (see demo seed data and `createDemoNode`).
export type GraphNode = { id: string; projectId: string; type: string; title: string; contentKind: NodeContent["kind"]; content: NodeContent; assets?: Asset[]; properties: Record<string, unknown>; archived: boolean; createdAt: string; updatedAt: string };

// Kept local: contracts' SpaceEdge requires `projectId`, `createdAt`, `updatedAt` which the
// widget's demo edges and MCP graph-edge usage don't carry.
export type GraphEdge = { id: string; sourceNodeId: string; targetNodeId: string; type: string };

// Kept local: contracts' NodeLayout requires `rotation`, `zIndex`, `hidden`, `collapsed` as
// non-optional fields (schema defaults make them required in the inferred output type), but
// the widget's demo/seed LayoutNode literals only ever populate nodeId/x/y/width/height/pinned.
export type LayoutNode = { nodeId: string; x: number; y: number; width: number; height: number; pinned: boolean };

// Kept local, matching its sibling LayoutNode/Layout above for consistency (LayoutGroup values
// are only ever read off a Layout the widget received, never literally constructed, so it would
// have aliased for read-only usage, but keeping it local avoids a structure where Layout's own
// nested types are a patchwork of local and aliased shapes).
export type LayoutGroup = { groupId: string; x: number; y: number; width: number; height: number };

// Kept local: contracts' LayoutDocument requires `projectId`, `strategy`, `config`, `edges`,
// `bounds`, `createdBy` which the widget's demo layout and layout-mutation call sites don't
// construct or need — the widget only ever needs the node/theme/projection subset for rendering.
export type LayoutEdge = { edgeId: string; routing: "straight" | "bezier" | "orthogonal" | "bundled"; sourcePort?: string; targetPort?: string; waypoints: Array<{ x: number; y: number }>; hidden?: boolean };
export type Layout = { viewId: string; viewName: string; viewType: string; graphRevision: number; layoutRevision: number; templateRef?: { id: string; version: string }; projection?: { kind: string; [key: string]: any }; theme?: ViewTheme; nodes: Record<string, LayoutNode>; edges?: Record<string, LayoutEdge>; groups?: Record<string, LayoutGroup> };

// Kept local: contracts' LayoutCandidate.document is LayoutDocument (kept local above, see
// Layout), and its metrics require several fields (overlapArea, edgeLength, pinnedNodeMoves,
// displacement, compactness) the widget never reads or constructs.
export type Candidate = { id: string; label: string; metrics: { score: number; overlapCount: number; edgeCrossings: number; hardViolations: string[] }; document: Layout };

export type ViewSummary = { viewId: string; viewName: string; viewType: string; layoutRevision: number; templateRef?: { id: string; version: string } };

// Kept local: contracts' ProjectView requires a strict `viewType` enum (the widget's demo data
// assigns a plain `string` viewType sourced from Layout.viewType) and has no `nodeCount` field,
// which the widget's view-library rows read (`view.nodeCount`).
export type ProjectView = { id: string; projectId: string; name: string; viewType: string; templateRef?: { id: string; version: string }; status: "active" | "trashed"; pinned: boolean; pinnedOrder?: number; createdBy: "user" | "agent" | "template"; createdAt: string; updatedAt: string; lastOpenedAt: string; trashedAt?: string; purgeAfter?: string; nodeCount?: number };

export type Manifest = { scenePack: { id?: string; recommendedViews: string[]; recommendedTemplateIds?: string[]; nodeTypes: Array<{ key: string; label: string; defaultContentKind: NodeContent["kind"]; allowedContentKinds: NodeContent["kind"][] }> }; views?: ViewSummary[] };

export type CardData = { title: string; semanticType: string; pinned: boolean; contentKind: NodeContent["kind"]; excerpt?: string; imageSrc?: string; caption?: string; domain?: string; description?: string; status?: string; chart?: ChartContent; onResizeStart?: (nodeId: string) => void; onResizeEnd?: (nodeId: string, frame: { x: number; y: number; width: number; height: number }) => void };
export type EditorDraft = { title: string; semanticType: string; markdown: string; excerpt: string; coverAssetId?: string; embeddedAssetIds: string[] };

export type ChangeSetPreview = { changeSet: { id: string; rationale: string; riskLevel: string; graphOperations: unknown[]; layoutOperations: unknown[] }; stale: boolean; currentGraphRevision: number; summary: { addedNodes: number; updatedNodes: number; archivedNodes: number; addedEdges: number; updatedEdges: number; archivedEdges: number; layoutOperations: number } };

// Kept local: contracts' ProjectEvent.payload is `unknown`, while the widget relies on direct
// property access on the payload (e.g. `event.payload?.toRevision`) ahead of narrowing it per
// event kind; contracts also requires `projectId`/`createdAt` which SSE-received events here
// are only ever cast into, never literally constructed with those fields populated.
export type ProjectEvent = { sequence: number; kind: "task.updated" | "graph.changed" | "layout.changed" | "view.created" | "view.catalog.changed" | "chat.binding.changed" | "stream.reset"; payload: any; graphRevision?: number; layoutRevision?: number; viewId?: string };
