import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { layoutPlanSchema, reviewActionSchema } from "@weaver/contracts";
import { generateLayoutCandidates } from "@weaver/layout-engine";
import { getScenePack } from "@weaver/scene-packs";
import type { WorkspaceStore } from "@weaver/storage";
import type { WorkspacePrincipal } from "./catalog.js";

function chatKey(store: WorkspaceStore, principal: WorkspacePrincipal) {
  if (principal.kind === "chat") return principal.chatSessionKey;
  if (principal.kind === "local-read") throw new Error("CHAT_PRINCIPAL_REQUIRED");
  const key = store.browserSessions.get(principal.browserSessionId)?.pairedChatSessionKey;
  if (!key) throw new Error("AGENT_DISCONNECTED");
  return key;
}

function required(args: Record<string, unknown>, name: string) {
  const value = args[name];
  if (typeof value !== "string" || !value) throw new Error(`INVALID_ARGS:${name} required`);
  return value;
}

export async function recommendLayout(store: WorkspaceStore, principal: WorkspacePrincipal, args: Record<string, unknown>) {
  const taskId = required(args, "taskId");
  const plan = layoutPlanSchema.parse(args.plan);
  const task = store.tasks.assertChat(taskId, chatKey(store, principal));
  if (task.status !== "running") throw new Error(`TASK_NOT_RUNNING:${task.status}`);
  if (task.activeStage !== "layout") throw new Error("TASK_TRANSITION_INVALID:stage");
  const graph = store.graphChanges.read(plan.projectId);
  if (graph.revision !== plan.baseGraphRevision) throw new Error("GRAPH_REVISION_CONFLICT");
  const current = store.layoutReviews.get(plan.projectId, plan.viewId);
  if (!current) throw new Error("LAYOUT_NOT_FOUND");
  if (current.layoutRevision !== plan.baseLayoutRevision) throw new Error("LAYOUT_REVISION_CONFLICT");
  const project = store.catalog.getProject(plan.projectId);
  const weights = project ? getScenePack(project.scenePackId, project.scenePackVersion)?.scoringWeights : undefined;
  const layoutRunId = randomUUID();
  const candidates = await generateLayoutCandidates({ nodes: graph.nodes, edges: graph.edges, current, plan, layoutRunId, weights });
  const run = store.layoutReviews.saveRun({ id: layoutRunId, projectId: plan.projectId, viewId: plan.viewId, taskId, plan, candidates });
  store.tasks.update(taskId, { status: "pending_review", activeStage: "layout", results: { ...task.results, layoutRunId } });
  return { layoutRunId: run.id, candidates: candidates.map(({ id, label, metrics }) => ({ id, label, metrics })) };
}

export function applyReviewAction(store: WorkspaceStore, principal: WorkspacePrincipal, args: Record<string, unknown>) {
  const validated = reviewActionSchema.parse({ ...args, workspaceDir: store.workspaceDir });
  const key = chatKey(store, principal);
  if (validated.resource === "changeset") {
    const id = required(args, "id");
    const item = store.graphChanges.get(id);
    if (!item) throw new Error("CHANGESET_NOT_FOUND");
    if (validated.action === "preview") {
      store.tasks.assertChat(item.taskId, key, false);
      const project = store.catalog.getProject(item.projectId);
      if (!project) throw new Error("PROJECT_NOT_FOUND");
      return { changeSet: item, stale: project.graphRevision !== item.baseGraphRevision, currentGraphRevision: project.graphRevision, summary: {
        addedNodes: item.graphOperations.filter((op) => op.type === "add-node").length,
        updatedNodes: item.graphOperations.filter((op) => ["update-node", "set-node-content", "attach-asset", "detach-asset", "set-node-cover"].includes(op.type)).length,
        archivedNodes: item.graphOperations.filter((op) => op.type === "archive-node").length,
        addedEdges: item.graphOperations.filter((op) => op.type === "add-edge").length,
        updatedEdges: item.graphOperations.filter((op) => op.type === "update-edge").length,
        archivedEdges: item.graphOperations.filter((op) => op.type === "archive-edge").length,
        layoutOperations: item.layoutOperations.length,
      } };
    }
    if (validated.action === "revert") { store.tasks.assertCanvas(item.taskId, key); return store.graphChanges.revert(id); }
    store.tasks.assertChat(item.taskId, key);
    return validated.action === "apply" ? store.graphChanges.apply(id) : store.graphChanges.reject(id);
  }
  if (validated.action === "revert") return store.layoutReviews.revert(required(args, "projectId"), required(args, "viewId"));
  const id = required(args, "id");
  const run = store.layoutReviews.getRun(id);
  if (!run) throw new Error("LAYOUT_RUN_NOT_FOUND");
  if (run.taskId) store.tasks.assertChat(run.taskId, key, validated.action !== "preview");
  if (validated.action === "preview") return run;
  if (validated.action === "apply") return store.layoutReviews.applyCandidate(id, required(args, "candidateId"));
  return store.layoutReviews.rejectRun(id);
}

export async function importAsset(store: WorkspaceStore, _principal: WorkspacePrincipal, args: Record<string, unknown>) {
  const projectId = required(args, "projectId");
  const browserSessionId = _principal.kind === "browser" ? _principal.browserSessionId : undefined;
  const writerLease = browserSessionId ? store.browserSessions.writer(projectId) : undefined;
  if (browserSessionId && (!writerLease || writerLease.status !== "active" || writerLease.browserSessionId !== browserSessionId)) throw new Error("PROJECT_WRITER_LEASE_STALE");
  const mutationId = browserSessionId ? required(args, "mutationId") : undefined;
  if (browserSessionId && mutationId) {
    const existing = store.canvasMutations.get(mutationId);
    if (existing) {
      if (existing.projectId !== projectId || existing.browserSessionId !== browserSessionId) throw new Error("MUTATION_ID_CONFLICT");
      if (existing.status !== "applied") throw new Error("MUTATION_ALREADY_REVERTED");
      const operation = existing.forwardOperations[0] as { assetId?: unknown; deduplicated?: unknown } | undefined;
      const asset = typeof operation?.assetId === "string" ? store.assets.get(operation.assetId) : null;
      if (!asset) throw new Error("MUTATION_RESULT_UNAVAILABLE");
      return { assetId: asset.id, width: asset.width, height: asset.height, deduplicated: operation?.deduplicated === true };
    }
  }
  let input: { projectId: string; mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: Uint8Array };
  if (args.source === "bytes") {
    const mimeType = required(args, "mimeType") as "image/jpeg" | "image/png" | "image/webp" | "image/gif";
    input = { projectId, mimeType, data: Buffer.from(required(args, "base64"), "base64") };
  } else {
    if (args.source !== "svg") throw new Error("INVALID_ARGS:source required");
    const scale = typeof args.scale === "number" ? args.scale : 2;
    const png = await sharp(Buffer.from(required(args, "svg")), { density: Math.round(96 * scale) }).png().toBuffer();
    input = { projectId, mimeType: "image/png", data: png };
  }
  const prepared = await store.assets.prepareImage(input);
  let output!: ReturnType<WorkspaceStore["assets"]["commitPreparedImage"]>;
  if (browserSessionId && writerLease) {
    store.canvasMutations.apply({
      request: {
        mutationId: mutationId!,
        projectId,
        writerLeaseRevision: writerLease.revision,
        operation: { action: "import_asset" },
      },
      browserSessionId,
      createdAt: new Date().toISOString(),
    }, () => {
      output = store.assets.commitPreparedImage(prepared);
      return {
        kind: "graph",
        forwardOperations: [{ action: "import_asset", assetId: output.asset.id, deduplicated: output.deduplicated }],
        inverseOperations: output.deduplicated ? [] : [{ action: "delete_asset", assetId: output.asset.id }],
      };
    });
  } else output = store.transaction(() => store.assets.commitPreparedImage(prepared));
  return { assetId: output.asset.id, width: output.asset.width, height: output.asset.height, deduplicated: output.deduplicated };
}

export function publishArtifact(store: WorkspaceStore, _principal: WorkspacePrincipal, args: Record<string, unknown>) {
  return store.artifacts.publish({ projectId: required(args, "projectId"), type: required(args, "artifactType"), title: required(args, "title"), content: args.content, sourceNodeIds: Array.isArray(args.sourceNodeIds) ? args.sourceNodeIds.filter((value): value is string => typeof value === "string") : [], graphRevision: Number(args.graphRevision) });
}
