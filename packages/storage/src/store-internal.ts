import { layoutDocumentSchema, type AgentTask, type LayoutDocument, type SpaceProject } from "@weaver/contracts";

export function now() { return new Date().toISOString(); }
export function json<T>(value: T) { return JSON.stringify(value); }
export function parse<T>(value: unknown): T { return JSON.parse(String(value)) as T; }
export function friendlyViewName(layout: Pick<LayoutDocument, "viewName" | "viewType">) { return layout.viewName === layout.viewType ? `${layout.viewType[0].toUpperCase()}${layout.viewType.slice(1)}` : layout.viewName; }

export const terminalTaskStatuses = new Set<AgentTask["status"]>(["completed", "stale", "failed", "cancelled"]);
export const canvasOfflineAfterMs = 30_000;
export const taskTransitions: Record<AgentTask["status"], Set<AgentTask["status"]>> = {
  prepared: new Set(["dispatched", "failed", "cancelled"]),
  dispatched: new Set(["running", "failed", "cancelled"]),
  running: new Set(["pending_review", "completed", "stale", "failed", "cancelled"]),
  pending_review: new Set(["ready_to_continue", "completed", "stale", "cancelled"]),
  ready_to_continue: new Set(["prepared", "stale", "cancelled"]),
  completed: new Set(), stale: new Set(), failed: new Set(), cancelled: new Set(),
};

export function defaultLayout(project: SpaceProject, viewId: string, viewType: LayoutDocument["viewType"], strategy: LayoutDocument["strategy"], viewName: string = viewType): LayoutDocument {
  return layoutDocumentSchema.parse({
    projectId: project.id,
    viewId,
    viewType,
    graphRevision: project.graphRevision,
    layoutRevision: 0,
    viewName,
    strategy,
    config: { direction: "left-right", nodeSpacing: 72, rankSpacing: 120, density: 1, viewportWidth: 1280, viewportHeight: 800 },
    nodes: {}, edges: {}, groups: {}, bounds: { x: 0, y: 0, width: 0, height: 0 }, createdBy: "user", updatedAt: now(),
  });
}
