import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { layoutPlanSchema } from "@weaver/contracts";
import { generateLayoutCandidates } from "@weaver/layout-engine";
import { getScenePack } from "@weaver/scene-packs";
import { workspaceSchema } from "../shared/schemas.js";
import { defineTool, result, type MutateWithStore } from "../shared/tool-runtime.js";
import { chatSessionKeyFromRequest } from "../thread-context.js";
import type { SseEventHub } from "../event-hub.js";

export function registerLayoutTools(server: McpServer, { eventHub, mutateWithStore }: { eventHub: SseEventHub; mutateWithStore: MutateWithStore }) {
  server.registerTool("weaver_recommend_layout", {
    title: "Recommend Layout", description: "Validate a semantic LayoutPlan and generate deterministic scored candidates; final coordinates are never model-authored.",
    inputSchema: { ...workspaceSchema.shape, taskId: z.string(), plan: z.unknown() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, defineTool(async ({ workspaceDir, taskId, plan: rawPlan }, extra) => {
    const chatSessionKey = chatSessionKeyFromRequest(extra); const plan = layoutPlanSchema.parse(rawPlan);
    const taskState = mutateWithStore(workspaceDir, (store) => {
      const task = store.tasks.assertChat(taskId, chatSessionKey); if (task.status !== "running") throw new Error(`TASK_NOT_RUNNING:${task.status}`); if (task.activeStage !== "layout") throw new Error("TASK_TRANSITION_INVALID:stage");
      const graph = store.graphChanges.read(plan.projectId); if (graph.revision !== plan.baseGraphRevision) throw new Error("GRAPH_REVISION_CONFLICT");
      const current = store.layoutReviews.get(plan.projectId, plan.viewId); if (!current) throw new Error("LAYOUT_NOT_FOUND"); if (current.layoutRevision !== plan.baseLayoutRevision) throw new Error("LAYOUT_REVISION_CONFLICT");
      const project = store.catalog.getProject(plan.projectId); const weights = project ? getScenePack(project.scenePackId, project.scenePackVersion)?.scoringWeights : undefined;
      return { task, graph, current, weights };
    });
    const layoutRunId = randomUUID(); const candidates = await generateLayoutCandidates({ nodes: taskState.graph.nodes, edges: taskState.graph.edges, current: taskState.current, plan, layoutRunId, weights: taskState.weights });
    const output = mutateWithStore(workspaceDir, (store) => { const run = store.layoutReviews.saveRun({ id: layoutRunId, projectId: plan.projectId, viewId: plan.viewId, taskId, plan, candidates }); store.tasks.update(taskId, { status: "pending_review", activeStage: "layout", results: { ...taskState.task.results, layoutRunId } }); return { layoutRunId: run.id, candidates: candidates.map(({ id, label, metrics }) => ({ id, label, metrics })) }; });
    eventHub.notifyWorkspace(workspaceDir); return result(output, `Generated ${output.candidates.length} deterministic layout candidates.`);
  }));
}
