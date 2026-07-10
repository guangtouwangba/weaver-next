import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { layoutOperationSchema, layoutPlanSchema } from "@weaver/contracts";
import { applyLayoutOperations } from "@weaver/core";
import { generateLayoutCandidates } from "@weaver/layout-engine";
import { WorkspaceStore } from "@weaver/storage";
import { projectSchema, workspaceSchema } from "../shared/schemas.js";
import { defineTool, failure, result, withStore, type MutateWithStore } from "../shared/tool-runtime.js";
import { chatSessionKeyFromRequest } from "../thread-context.js";
import type { SseEventHub } from "../event-hub.js";

export type LayoutToolsCtx = { eventHub: SseEventHub; mutateWithStore: MutateWithStore };

/** Layout candidate generation/apply/revert, plus layout metadata reads and semantic LayoutPlan validation. */
export function registerLayoutTools(server: McpServer, ctx: LayoutToolsCtx) {
  const { eventHub, mutateWithStore } = ctx;

  // Manually manages its own WorkspaceStore lifecycle (new WorkspaceStore/store.close(), plus a manual
  // eventHub.notifyWorkspace call) instead of the shared withStore/mutateWithStore helpers — preserved
  // exactly as in the original file, not "fixed" here.
  server.registerTool("weaver_generate_layout_candidates", {
    title: "Generate Layout Candidates", description: "Validate an agent-authored semantic LayoutPlan, then let the deterministic engine calculate and score coordinates. The model must not provide final x/y positions.",
    inputSchema: { ...workspaceSchema.shape, taskId: z.string(), plan: z.any() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ workspaceDir, taskId, plan: rawPlan }, extra) => { try {
    const chatSessionKey = chatSessionKeyFromRequest(extra);
    const output = await (async () => {
      const store = new WorkspaceStore(workspaceDir);
      try {
        const task = store.assertTaskChat(taskId, chatSessionKey);
        if (task.status !== "running") throw new Error(["completed", "stale", "failed", "cancelled"].includes(task.status) ? `TASK_TERMINAL:${task.status}` : `TASK_NOT_RUNNING:${task.status}`);
        if (task.activeStage !== "layout") throw new Error(`TASK_STAGE_INVALID:${task.activeStage}`);
        const plan = layoutPlanSchema.parse(rawPlan);
        if (task.projectId !== plan.projectId) throw new Error("TASK_PROJECT_MISMATCH");
        const graph = store.getGraph(plan.projectId); if (graph.revision !== plan.baseGraphRevision) { store.updateAgentTask(taskId, { status: "stale", error: { code: "GRAPH_REVISION_CONFLICT", message: `Expected graph r${plan.baseGraphRevision}, current r${graph.revision}` } }); throw new Error("GRAPH_REVISION_CONFLICT"); }
        const current = store.getLayout(plan.projectId, plan.viewId); if (!current) throw new Error("LAYOUT_NOT_FOUND");
        if (current.layoutRevision !== plan.baseLayoutRevision) { store.updateAgentTask(taskId, { status: "stale", error: { code: "LAYOUT_REVISION_CONFLICT", message: `Expected layout r${plan.baseLayoutRevision}, current r${current.layoutRevision}` } }); throw new Error("LAYOUT_REVISION_CONFLICT"); }
        const layoutRunId = randomUUID();
        const candidates = await generateLayoutCandidates({ nodes: graph.nodes, edges: graph.edges, current, plan, layoutRunId });
        const run = store.saveLayoutRun({ id: layoutRunId, projectId: plan.projectId, viewId: plan.viewId, taskId, plan, candidates });
        store.updateAgentTask(taskId, { status: "pending_review", activeStage: "layout", results: { ...task.results, layoutRunId: run.id } });
        return { layoutRunId: run.id, candidates: candidates.map((candidate) => ({ id: candidate.id, label: candidate.label, metrics: candidate.metrics })) };
      } finally { store.close(); }
    })();
    eventHub.notifyWorkspace(workspaceDir);
    return result(output, `Generated ${output.candidates.length} deterministic layout candidates.`);
  } catch (error) { return failure(error); } });

  server.registerTool("weaver_get_layout_run", { title: "Get Layout Run", description: "Read layout candidates and quality metrics for the current chat-bound task.", inputSchema: { ...workspaceSchema.shape, layoutRunId: z.string() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, defineTool(async ({ workspaceDir, layoutRunId }, extra) => { const chatSessionKey = chatSessionKeyFromRequest(extra); const run = withStore(workspaceDir, (store) => { const item = store.getLayoutRun(layoutRunId); if (!item) throw new Error("LAYOUT_RUN_NOT_FOUND"); if (item.taskId) store.assertTaskChat(item.taskId, chatSessionKey, false); return item; }); return result(run); }));

  server.registerTool("weaver_apply_layout", { title: "Apply Layout Candidate", description: "Apply one valid preview candidate, archive the previous view layout, and increment layoutRevision without changing graphRevision.", inputSchema: { ...workspaceSchema.shape, layoutRunId: z.string(), candidateId: z.string() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } }, defineTool(async ({ workspaceDir, layoutRunId, candidateId }, extra) => { const chatSessionKey = chatSessionKeyFromRequest(extra); return result(mutateWithStore(workspaceDir, (store) => { const run = store.getLayoutRun(layoutRunId); if (!run) throw new Error("LAYOUT_RUN_NOT_FOUND"); if (run.taskId) store.assertTaskChat(run.taskId, chatSessionKey); return store.applyLayoutCandidate(layoutRunId, candidateId); }), "Applied layout candidate."); }));
  server.registerTool("weaver_reject_layout", { title: "Reject Layout Run", description: "Reject a pending layout preview without changing graph or layout revisions.", inputSchema: { ...workspaceSchema.shape, layoutRunId: z.string() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, defineTool(async ({ workspaceDir, layoutRunId }, extra) => { const chatSessionKey = chatSessionKeyFromRequest(extra); return result(mutateWithStore(workspaceDir, (store) => { const run = store.getLayoutRun(layoutRunId); if (!run) throw new Error("LAYOUT_RUN_NOT_FOUND"); if (run.taskId) store.assertTaskChat(run.taskId, chatSessionKey); return store.rejectLayoutRun(layoutRunId); }), "Rejected layout preview."); }));

  server.registerTool("weaver_apply_layout_operations", { title: "Apply Manual Layout Operations", description: "Apply validated low-level layout operations from the widget, never graph mutations.", inputSchema: { ...projectSchema.shape, viewId: z.string(), baseLayoutRevision: z.number().int().nonnegative(), operations: z.array(layoutOperationSchema) }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } } }, defineTool(async ({ workspaceDir, projectId, viewId, baseLayoutRevision, operations }) => { const next = mutateWithStore(workspaceDir, (store) => { const current = store.getLayout(projectId, viewId); if (!current) throw new Error("LAYOUT_NOT_FOUND"); if (current.layoutRevision !== baseLayoutRevision) throw new Error("LAYOUT_REVISION_CONFLICT"); return store.saveLayout(applyLayoutOperations(current, operations), true, { operations }); }); return result(next); }));

  server.registerTool("weaver_revert_layout", { title: "Undo Layout", description: "Restore the previous archived layout as a new layout revision.", inputSchema: { ...projectSchema.shape, viewId: z.string() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } }, defineTool(async ({ workspaceDir, projectId, viewId }) => result(mutateWithStore(workspaceDir, (store) => store.revertLayout(projectId, viewId)), "Restored previous layout.")));

  server.registerTool("weaver_get_layout", { title: "Get Weaver Layout", description: "Read one independent view layout and layoutRevision.", inputSchema: { ...projectSchema.shape, viewId: z.string() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, defineTool(async ({ workspaceDir, projectId, viewId }) => { const layout = withStore(workspaceDir, (store) => store.getLayout(projectId, viewId)); if (!layout) throw new Error("LAYOUT_NOT_FOUND"); return result(layout); }));
  server.registerTool("weaver_get_layout_capabilities", { title: "Get Layout Capabilities", description: "Read available deterministic layout strategies and semantic constraints.", inputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async () => result({ strategies: ["tree", "layered", "radial", "force", "cluster", "grid", "timeline", "swimlane", "hybrid"], constraints: ["pin", "align", "distribute", "order", "rank", "group", "containment", "separation", "relative-position", "direction", "spacing", "avoid-overlap", "preserve-position", "edge-length", "edge-routing", "emphasis", "viewport-fit"], candidateCount: { min: 1, max: 5, default: 3 } }));
  server.registerTool("weaver_validate_layout_plan", { title: "Validate LayoutPlan", description: "Validate semantic layout constraints without calculating or applying coordinates.", inputSchema: { plan: z.any() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, defineTool(async ({ plan }) => result({ valid: true, plan: layoutPlanSchema.parse(plan) })));
}
