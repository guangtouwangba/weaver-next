// View-model and domain types shared across the widget. Local types that duplicate a
// @weaver/contracts schema 1:1 (or as a compatible subset) are re-exported under their
// existing local name below so call sites never need to change. Types whose real widget
// usage (demo/seed data, MCP responses) doesn't match the contracts shape stay local —
// see the refactor report for the per-type compatibility notes.

import type { AgentTask, CanvasCapabilities, ChartContent, NodeContent, WidgetBinding, WidgetBootstrap, WidgetCandidate, WidgetChangeSetPreview, WidgetGraphEdge, WidgetGraphNode, WidgetLayout, WidgetManifest, WidgetProject, WidgetProjectEvent, WidgetProjectView } from "@weaver/contracts";

export type { VisualFamily, ViewTheme, VisualTemplate, TemplateValidationResult as TemplateValidation, AgentTaskIntent as TaskIntent, AgentTask } from "@weaver/contracts";
// These alias cleanly: the widget always supplies every field on construction, and the
// contracts shapes are otherwise structurally identical to the local ones.
export type { DocumentContent, ImageContent, LinkContent, ChartContent, ChartSeries, ChartType, NodeContent } from "@weaver/contracts";

export type ToolResult<T> = { structuredContent?: T; isError?: boolean; content?: Array<{ type: string; text?: string }> };
export type ChatBindingBootstrap = WidgetBinding;
export type Bootstrap = WidgetBootstrap & { capabilities?: CanvasCapabilities; csrfToken?: string };
export type CanvasAccessState = "claiming" | "claim-failed" | "active" | "duplicate" | "detached" | "build-mismatch";
export type Project = WidgetProject;
export type GraphNode = WidgetGraphNode;
export type GraphEdge = WidgetGraphEdge;
export type Layout = WidgetLayout;
export type Candidate = WidgetCandidate;
export type ProjectView = WidgetProjectView;
export type Manifest = WidgetManifest;

export type CardData = { title: string; semanticType: string; pinned: boolean; contentKind: NodeContent["kind"]; excerpt?: string; imageSrc?: string; caption?: string; domain?: string; description?: string; status?: string; chart?: ChartContent; fetchMarkdown?: (nodeId: string) => Promise<string>; saveMarkdown?: (nodeId: string, markdown: string) => Promise<void>; references?: { id: string; title: string }[]; linkReference?: (sourceNodeId: string, targetNodeId: string) => Promise<void>; onResizeStart?: (nodeId: string) => void; onResizeEnd?: (nodeId: string, frame: { x: number; y: number; width: number; height: number }) => void };
export type EditorDraft = { title: string; semanticType: string; markdown: string; excerpt: string; coverAssetId?: string; embeddedAssetIds: string[] };

export type ChangeSetPreview = WidgetChangeSetPreview;
export type ProjectEvent = WidgetProjectEvent;
