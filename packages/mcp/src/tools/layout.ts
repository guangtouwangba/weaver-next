import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { layoutPlanSchema, layoutOperationSchema, type LayoutDirection, type LayoutDocument, type LayoutStrategy, type SpaceNode } from "@weaver/contracts";
import { applyLayoutOperations } from "@weaver/core";
import { generateLayoutCandidates } from "@weaver/layout-engine";
import { previewClusters } from "@weaver/layout-engine/semantic";
import { getScenePack } from "@weaver/scene-packs";
import { WorkspaceStore } from "@weaver/storage";
import { projectSchema, workspaceSchema } from "../shared/schemas.js";
import { readLayoutRun } from "../shared/catalog-reads.js";
import { applyLayoutCandidate, rejectLayoutRun, revertLayout } from "../shared/review-actions.js";
import { defineTool, failure, result, withStore, type MutateWithStore } from "../shared/tool-runtime.js";
import { chatSessionKeyFromRequest } from "../thread-context.js";
import type { SseEventHub } from "../event-hub.js";

export type LayoutToolsCtx = { eventHub: SseEventHub; mutateWithStore: MutateWithStore };

function layerOf(node: SpaceNode): string {
  const raw = node.properties?.layer;
  return typeof raw === "string" ? raw.trim() : "";
}

/** Cheap structural signals used to recommend a layout strategy — degree
 * distribution, the analyst's `properties.layer` coverage, and star-ness. */
function graphSignals(nodes: SpaceNode[], edges: Array<{ sourceNodeId: string; targetNodeId: string }>) {
  const degree = new Map<string, number>();
  for (const node of nodes) degree.set(node.id, 0);
  for (const edge of edges) {
    if (edge.sourceNodeId === edge.targetNodeId) continue;
    degree.set(edge.sourceNodeId, (degree.get(edge.sourceNodeId) ?? 0) + 1);
    degree.set(edge.targetNodeId, (degree.get(edge.targetNodeId) ?? 0) + 1);
  }
  const degrees = [...degree.values()];
  const maxDegree = degrees.length ? Math.max(...degrees) : 0;
  const topHubId = [...degree.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))[0]?.[0];
  const positive = degrees.filter((d) => d > 0).sort((a, b) => a - b);
  const medianDegree = positive.length ? (positive.length % 2 ? positive[(positive.length - 1) / 2] : (positive[positive.length / 2 - 1] + positive[positive.length / 2]) / 2) : 0;
  const isStar = maxDegree >= 3 && maxDegree >= 2 * Math.max(1, medianDegree);

  const withLayer = nodes.filter((node) => layerOf(node));
  const layerCounts = new Map<string, number>();
  for (const node of withLayer) { const layer = layerOf(node); layerCounts.set(layer, (layerCounts.get(layer) ?? 0) + 1); }
  const distinctLayers = [...layerCounts.values()].filter((count) => count >= 2).length;

  const kinds = new Map<string, number>();
  for (const node of nodes) kinds.set(node.contentKind, (kinds.get(node.contentKind) ?? 0) + 1);
  const dominantContentKind = [...kinds.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    layerCoverage: nodes.length ? Math.round((withLayer.length / nodes.length) * 100) / 100 : 0,
    distinctLayers,
    maxDegree,
    medianDegree,
    isStar,
    dominantContentKind,
    topHubId,
  };
}

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
        // Feed the project's scene-pack scoringWeights into the engine so the
        // semantic layout ranks candidates by the pack's priorities (e.g.
        // semanticDistance/direction) instead of the hardcoded defaults.
        const project = store.getProject(plan.projectId);
        const weights = project ? getScenePack(project.scenePackId, project.scenePackVersion)?.scoringWeights : undefined;
        const candidates = await generateLayoutCandidates({ nodes: graph.nodes, edges: graph.edges, current, plan, layoutRunId, weights });
        const run = store.saveLayoutRun({ id: layoutRunId, projectId: plan.projectId, viewId: plan.viewId, taskId, plan, candidates });
        store.updateAgentTask(taskId, { status: "pending_review", activeStage: "layout", results: { ...task.results, layoutRunId: run.id } });
        return { layoutRunId: run.id, candidates: candidates.map((candidate) => ({ id: candidate.id, label: candidate.label, metrics: candidate.metrics })) };
      } finally { store.close(); }
    })();
    eventHub.notifyWorkspace(workspaceDir);
    return result(output, `Generated ${output.candidates.length} deterministic layout candidates.`);
  } catch (error) { return failure(error); } });

  // Widget-only: the preview widget reads the layout run here, so it stays REGISTERED
  // under this exact name with `_meta.ui.visibility=["app"]` (off the model surface).
  // The model reads it via weaver_read_review(resource:"layout.run"); both call the
  // same shared helper (see shared/catalog-reads.ts) so they never drift.
  server.registerTool("weaver_get_layout_run", { title: "Get Layout Run", description: "Read layout candidates and quality metrics for the current chat-bound task.", inputSchema: { ...workspaceSchema.shape, layoutRunId: z.string() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } } }, defineTool(async ({ workspaceDir, layoutRunId }, extra) => { const chatSessionKey = chatSessionKeyFromRequest(extra); return result(withStore(workspaceDir, (store) => readLayoutRun(store, layoutRunId, chatSessionKey))); }));

  // Widget-only: the preview widget's Apply/Reject buttons call these three writes by
  // name, so they stay REGISTERED under their exact names with `_meta.ui.visibility=["app"]`
  // (off the model surface). The model drives them via weaver_review_action(resource:
  // "layout_run", action:"apply"|"reject"|"revert"); both call the same shared helpers
  // (shared/review-actions.ts) so the widget and model surfaces never drift.
  server.registerTool("weaver_apply_layout", { title: "Apply Layout Candidate", description: "Apply one valid preview candidate, archive the previous view layout, and increment layoutRevision without changing graphRevision.", inputSchema: { ...workspaceSchema.shape, layoutRunId: z.string(), candidateId: z.string() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } } }, defineTool(async ({ workspaceDir, layoutRunId, candidateId }, extra) => { const chatSessionKey = chatSessionKeyFromRequest(extra); return result(mutateWithStore(workspaceDir, (store) => applyLayoutCandidate(store, layoutRunId, candidateId, chatSessionKey)), "Applied layout candidate."); }));
  server.registerTool("weaver_reject_layout", { title: "Reject Layout Run", description: "Reject a pending layout preview without changing graph or layout revisions.", inputSchema: { ...workspaceSchema.shape, layoutRunId: z.string() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } } }, defineTool(async ({ workspaceDir, layoutRunId }, extra) => { const chatSessionKey = chatSessionKeyFromRequest(extra); return result(mutateWithStore(workspaceDir, (store) => rejectLayoutRun(store, layoutRunId, chatSessionKey)), "Rejected layout preview."); }));

  server.registerTool("weaver_apply_layout_operations", { title: "Apply Manual Layout Operations", description: "Apply validated low-level layout operations from the widget, never graph mutations.", inputSchema: { ...projectSchema.shape, viewId: z.string(), baseLayoutRevision: z.number().int().nonnegative(), operations: z.array(layoutOperationSchema) }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } } }, defineTool(async ({ workspaceDir, projectId, viewId, baseLayoutRevision, operations }) => { const next = mutateWithStore(workspaceDir, (store) => { const current = store.getLayout(projectId, viewId); if (!current) throw new Error("LAYOUT_NOT_FOUND"); if (current.layoutRevision !== baseLayoutRevision) throw new Error("LAYOUT_REVISION_CONFLICT"); return store.saveLayout(applyLayoutOperations(current, operations), true, { operations }); }); return result(next); }));

  server.registerTool("weaver_revert_layout", { title: "Undo Layout", description: "Restore the previous archived layout as a new layout revision.", inputSchema: { ...projectSchema.shape, viewId: z.string() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } } }, defineTool(async ({ workspaceDir, projectId, viewId }) => result(mutateWithStore(workspaceDir, (store) => revertLayout(store, projectId, viewId)), "Restored previous layout.")));

  // `weaver_get_layout` and `weaver_get_layout_capabilities` were model-only and are
  // now folded into weaver_read_review(resource:"layout.get" / "layout.capabilities").
  server.registerTool("weaver_validate_layout_plan", { title: "Validate LayoutPlan", description: "Validate semantic layout constraints without calculating or applying coordinates.", inputSchema: { plan: z.any() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, defineTool(async ({ plan }) => result({ valid: true, plan: layoutPlanSchema.parse(plan) })));

  // Advisory planner: analyze the current graph and recommend which layout best
  // fits it, returning a ready-to-run LayoutPlan draft plus a preview of the
  // clusters that would form — so the agent's first weaver_generate_layout_candidates
  // call already produces a good layout instead of guessing a strategy blind.
  server.registerTool("weaver_recommend_layout", {
    title: "Recommend Layout",
    description: "Analyze the project graph and recommend a layout strategy, a ready-to-run LayoutPlan draft, and a preview of the clusters that would form. Read-only planning aid — call this before weaver_generate_layout_candidates so the first layout is well-chosen.",
    inputSchema: { ...projectSchema.shape, viewId: z.string().optional(), goal: z.string().optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, defineTool(async ({ workspaceDir, projectId, viewId, goal }) => {
    const payload = withStore(workspaceDir, (store) => {
      const project = store.getProject(projectId); if (!project) throw new Error("PROJECT_NOT_FOUND");
      const scene = getScenePack(project.scenePackId, project.scenePackVersion);
      const graph = store.getGraph(projectId);
      const nodes = graph.nodes.filter((node) => !node.archived);
      const nodeIds = new Set(nodes.map((node) => node.id));
      const edges = graph.edges.filter((edge) => !edge.archived && nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId));
      const targetViewId = viewId ?? `${scene?.defaultView ?? "graph"}-default`;
      const current = store.getLayout(projectId, targetViewId);
      const titleById = new Map(nodes.map((node) => [node.id, node.title] as const));

      const signals = graphSignals(nodes, edges);
      const g = (goal ?? "").toLowerCase();

      // Preview the clusters the semantic layout would form (no coordinates). We
      // set direction + disable pin/manualGroups so `current` is unused — safe
      // even when the target view does not exist yet.
      const direction: LayoutDirection = current?.config.direction ?? "left-right";
      const previewPlan = layoutPlanSchema.parse({ projectId, viewId: targetViewId, baseGraphRevision: graph.revision, baseLayoutRevision: current?.layoutRevision ?? 0, scope: { type: "whole-view" }, strategy: "cluster", direction, constraints: [], preserve: { pinnedNodes: false, manualGroups: false }, candidateCount: 3 });
      const stubCurrent = { config: { direction }, nodes: {} } as unknown as LayoutDocument;
      const { clusters } = previewClusters({ nodes, edges, plan: previewPlan, current: current ?? stubCurrent });
      const labeledClusters = clusters.filter((cluster) => !cluster.isCenter && cluster.memberCount >= 2).length;

      let strategy: LayoutStrategy = "grid";
      let planDirection: LayoutDirection | undefined;
      let rationale: string;
      if (/timeline|时间线|时间轴|历史|chronolog/.test(g)) { strategy = "timeline"; rationale = "目标偏时间线,按时间字段横向排布。"; }
      else if (/flow|流程|pipeline|因果|cause|工作流|工序/.test(g)) { strategy = "layered"; planDirection = "left-right"; rationale = "目标偏流程/因果,用分层有向布局呈现左→右流向。"; }
      else if (signals.edgeCount === 0) { strategy = "grid"; rationale = "图中没有边,缺乏可利用的结构,先用规整网格。"; }
      else if (signals.distinctLayers >= 2 || labeledClusters >= 2) { strategy = "cluster"; rationale = `内容可分成 ${Math.max(signals.distinctLayers, labeledClusters)} 个带标签分区(按 layer/主题),语义聚类能呈现信息分层与簇间留白。`; }
      else if (signals.isStar) { strategy = "cluster"; rationale = "图呈强单枢纽星型,语义聚类以枢纽为中心、卫星环绕,层次最清晰。"; }
      else { strategy = "grid"; rationale = "结构较扁平、无明显分层或枢纽,规整网格已足够。"; }

      const constraints: Array<{ type: "emphasis"; nodeIds: string[] }> = [];
      if (strategy === "cluster" && signals.isStar && signals.topHubId) constraints.push({ type: "emphasis", nodeIds: [signals.topHubId] });

      const suggestedPlan = layoutPlanSchema.parse({
        projectId, viewId: targetViewId,
        baseGraphRevision: graph.revision,
        baseLayoutRevision: current?.layoutRevision ?? 0,
        scope: { type: "whole-view" },
        strategy,
        ...(planDirection ? { direction: planDirection } : {}),
        constraints,
        preserve: {},
        candidateCount: 3,
        rationale,
      });

      const alternatives = ([
        { strategy: "cluster" as LayoutStrategy, rationale: "语义分区,信息分层 + 密度分散。" },
        { strategy: "layered" as LayoutStrategy, rationale: "有向流程/依赖,分层展现流向。" },
        { strategy: "grid" as LayoutStrategy, rationale: "无结构时的规整兜底。" },
      ]).filter((alt) => alt.strategy !== strategy);

      const clusterPreview = clusters.map((cluster) => ({ label: cluster.label, memberCount: cluster.memberCount, hub: cluster.hubId ? titleById.get(cluster.hubId) ?? cluster.hubId : undefined, isCenter: Boolean(cluster.isCenter) }));

      return { recommendedStrategy: strategy, rationale, signals, clusterPreview, suggestedPlan, alternatives, viewExists: Boolean(current) };
    });
    return result(payload, `Recommended ${payload.recommendedStrategy} layout.`);
  }));
}
