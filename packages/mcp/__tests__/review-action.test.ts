import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getScenePack } from "@weaver/scene-packs";
import { WorkspaceStore } from "@weaver/storage";
import { createWeaverServer, type WeaverServer } from "../src/create-server.js";

const roots: string[] = [];
const servers: WeaverServer[] = [];
let priorHostKind: string | undefined;

beforeEach(() => {
  priorHostKind = process.env.WEAVER_HOST_KIND;
  process.env.WEAVER_HOST_KIND = "claude";
});
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
  if (priorHostKind === undefined) delete process.env.WEAVER_HOST_KIND;
  else process.env.WEAVER_HOST_KIND = priorHostKind;
});

const syntheticChatSessionKey = () =>
  createHash("sha256").update(`weaver-launch:${process.cwd()}`).digest("hex");

function freshRoot() {
  const root = mkdtempSync(join(tmpdir(), "weaver-review-action-")); roots.push(root); mkdirSync(root, { recursive: true });
  return root;
}

/** Drive a fresh workspace to a running, chat-bound task on a bound canvas, with
 * two content nodes so a layout can be generated. `actionKey` picks the stage:
 * "develop_selection" (content) or "layout_view" (layout). */
function seedTask(root: string, actionKey: "develop_selection" | "layout_view") {
  const scene = getScenePack("free-brainstorming")!;
  const canvasSessionId = "session-canvas";
  const store = new WorkspaceStore(root);
  try {
    const project = store.createProject({ title: "Review", goal: "", scenePack: scene });
    store.createContentNode({ projectId: project.id, viewId: project.defaultViewId, type: "idea", title: "Alpha", content: { kind: "document", mode: "note", markdown: "a", excerpt: "", embeddedAssetIds: [] } as any, x: 0, y: 0 });
    store.createContentNode({ projectId: project.id, viewId: project.defaultViewId, type: "idea", title: "Beta", content: { kind: "document", mode: "note", markdown: "b", excerpt: "", embeddedAssetIds: [] } as any, x: 100, y: 0 });

    const chatSessionKey = syntheticChatSessionKey();
    const binding = store.openChatCanvasBinding({ chatSessionKey, projectId: project.id, viewId: project.defaultViewId });
    const timestamp = new Date().toISOString();
    store.syncCanvasContext({ version: 2, canvasSessionId, workspaceDir: root, projectId: project.id, scenePackId: scene.id, scenePackVersion: scene.version, graphRevision: 0, viewId: project.defaultViewId, viewType: scene.defaultView, selectedNodeIds: [], selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, presence: { visible: true, focused: true, lastSeenAt: timestamp }, chatBinding: { leaseId: binding.leaseId, bindingRevision: binding.bindingRevision }, agentEligible: true, sequence: 1, updatedAt: timestamp }, chatSessionKey);
    const prepared = store.prepareAgentTask({ canvasSessionId, actionKey, dispatchKey: "review-1", chatSessionKey });
    const taskId = prepared.taskId;
    store.confirmAgentDispatch(taskId, "review-1");
    store.updateAgentTask(taskId, { status: "running" });

    const project2 = store.getProject(project.id)!;
    const layout = store.getLayout(project.id, project.defaultViewId)!;
    return { projectId: project.id, viewId: project.defaultViewId, taskId, graphRevision: project2.graphRevision, layoutRevision: layout.layoutRevision };
  } finally {
    store.close();
  }
}

/** Submit a pending ChangeSet bound to a running task; return its id. */
function submitChangeSet(root: string, projectId: string, taskId: string, id: string) {
  const store = new WorkspaceStore(root);
  try {
    const graphRevision = store.getProject(projectId)!.graphRevision;
    const timestamp = new Date().toISOString();
    const cs = store.submitChangeSet({ id, taskId, projectId, baseGraphRevision: graphRevision, baseLayoutRevisions: {}, graphOperations: [], layoutOperations: [], rationale: "r", riskLevel: "low", status: "pending", createdAt: timestamp, updatedAt: timestamp });
    return cs.id;
  } finally {
    store.close();
  }
}

/** Generate a real layout run (with a valid candidate) via the layout tool. */
async function generateRun(server: WeaverServer, root: string, seed: { projectId: string; viewId: string; taskId: string; graphRevision: number; layoutRevision: number }) {
  const plan = { projectId: seed.projectId, viewId: seed.viewId, baseGraphRevision: seed.graphRevision, baseLayoutRevision: seed.layoutRevision, scope: { type: "whole-view" }, strategy: "grid", constraints: [], preserve: {}, candidateCount: 1 };
  const res = await server.dispatch("weaver_generate_layout_candidates", { workspaceDir: root, taskId: seed.taskId, plan }) as any;
  expect(res.isError).toBeFalsy();
  return { layoutRunId: res.structuredContent.layoutRunId as string, candidateId: res.structuredContent.candidates[0].id as string };
}

describe("weaver_review_action", () => {
  it("rejects a ChangeSet, matching weaver_reject_changeset", async () => {
    const root = freshRoot();
    const seed = seedTask(root, "develop_selection");
    const csNew = submitChangeSet(root, seed.projectId, seed.taskId, "cs-new");
    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);

    const res = await server.dispatch("weaver_review_action", { workspaceDir: root, resource: "changeset", action: "reject", id: csNew }) as any;
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent.id).toBe(csNew);
    expect(res.structuredContent.status).toBe("rejected");
  });

  it("produces the same result as the old weaver_reject_changeset tool", async () => {
    // Two independent workspaces: one changeset rejected via weaver_review_action,
    // an identical one rejected via the still-registered (app-only) old tool.
    const rootA = freshRoot();
    const seedA = seedTask(rootA, "develop_selection");
    submitChangeSet(rootA, seedA.projectId, seedA.taskId, "cs-a");
    const serverA = await createWeaverServer({ previewWorkspaceDir: rootA }); servers.push(serverA);
    const viaAction = await serverA.dispatch("weaver_review_action", { workspaceDir: rootA, resource: "changeset", action: "reject", id: "cs-a" }) as any;

    const rootB = freshRoot();
    const seedB = seedTask(rootB, "develop_selection");
    submitChangeSet(rootB, seedB.projectId, seedB.taskId, "cs-b");
    const serverB = await createWeaverServer({ previewWorkspaceDir: rootB }); servers.push(serverB);
    const viaOld = await serverB.dispatch("weaver_reject_changeset", { workspaceDir: rootB, changeSetId: "cs-b" }) as any;

    // Identical keys and identical semantics: both flip status to "rejected" and
    // leave the ChangeSet body untouched (ids/timestamps/projectIds differ by workspace).
    expect(Object.keys(viaAction.structuredContent).sort()).toEqual(Object.keys(viaOld.structuredContent).sort());
    const stable = (cs: any) => ({ status: cs.status, rationale: cs.rationale, riskLevel: cs.riskLevel, graphOperations: cs.graphOperations, layoutOperations: cs.layoutOperations, baseLayoutRevisions: cs.baseLayoutRevisions });
    expect(stable(viaAction.structuredContent)).toEqual(stable(viaOld.structuredContent));
    expect(viaAction.structuredContent.status).toBe("rejected");
  });

  it("applies a layout candidate, matching weaver_apply_layout", async () => {
    const root = freshRoot();
    const seed = seedTask(root, "layout_view");
    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);
    const { layoutRunId, candidateId } = await generateRun(server, root, seed);

    const res = await server.dispatch("weaver_review_action", { workspaceDir: root, resource: "layout_run", action: "apply", id: layoutRunId, candidateId }) as any;
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent.layoutRevision).toBe(seed.layoutRevision + 1);
  });

  it("rejects a layout run, matching weaver_reject_layout", async () => {
    const root = freshRoot();
    const seed = seedTask(root, "layout_view");
    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);
    const { layoutRunId } = await generateRun(server, root, seed);

    const res = await server.dispatch("weaver_review_action", { workspaceDir: root, resource: "layout_run", action: "reject", id: layoutRunId }) as any;
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent.status).toBe("rejected");
  });

  it("reverts a layout, matching weaver_revert_layout", async () => {
    const root = freshRoot();
    const seed = seedTask(root, "layout_view");
    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);
    const { layoutRunId, candidateId } = await generateRun(server, root, seed);
    // Apply first so there is an archived layout to revert to.
    const applied = await server.dispatch("weaver_review_action", { workspaceDir: root, resource: "layout_run", action: "apply", id: layoutRunId, candidateId }) as any;
    expect(applied.isError).toBeFalsy();

    const res = await server.dispatch("weaver_review_action", { workspaceDir: root, resource: "layout_run", action: "revert", projectId: seed.projectId, viewId: seed.viewId }) as any;
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent.layoutRevision).toBe(applied.structuredContent.layoutRevision + 1);
  });

  // SECURITY: applying a ChangeSet must NEVER go through this tool. Only
  // weaver_apply_changeset may apply one. The forbidden combo is rejected by a
  // parse-time zod refine on the schema.
  it("forbids resource:changeset + action:apply at the schema (security)", async () => {
    const root = freshRoot();
    seedTask(root, "develop_selection");
    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);

    const res = await server.dispatch("weaver_review_action", { workspaceDir: root, resource: "changeset", action: "apply", id: "cs-x" }) as any;
    expect(res.isError).toBe(true);
    expect(res.structuredContent.code).toBe("CHANGESET_APPLY_FORBIDDEN");
  });

  it("returns typed errors for missing required params per combo", async () => {
    const root = freshRoot();
    seedTask(root, "develop_selection");
    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);

    const noId = await server.dispatch("weaver_review_action", { workspaceDir: root, resource: "changeset", action: "reject" }) as any;
    expect(noId.isError).toBe(true);
    expect(noId.structuredContent.code).toBe("REVIEW_ACTION_REQUIRES_id");

    const noCandidate = await server.dispatch("weaver_review_action", { workspaceDir: root, resource: "layout_run", action: "apply", id: "run-1" }) as any;
    expect(noCandidate.isError).toBe(true);
    expect(noCandidate.structuredContent.code).toBe("REVIEW_ACTION_REQUIRES_candidateId");

    const noRunId = await server.dispatch("weaver_review_action", { workspaceDir: root, resource: "layout_run", action: "reject" }) as any;
    expect(noRunId.isError).toBe(true);
    expect(noRunId.structuredContent.code).toBe("REVIEW_ACTION_REQUIRES_id");

    const noProject = await server.dispatch("weaver_review_action", { workspaceDir: root, resource: "layout_run", action: "revert", viewId: "v" }) as any;
    expect(noProject.isError).toBe(true);
    expect(noProject.structuredContent.code).toBe("REVIEW_ACTION_REQUIRES_projectId");

    const noView = await server.dispatch("weaver_review_action", { workspaceDir: root, resource: "layout_run", action: "revert", projectId: "p" }) as any;
    expect(noView.isError).toBe(true);
    expect(noView.structuredContent.code).toBe("REVIEW_ACTION_REQUIRES_viewId");

    // An outright invalid resource/action pairing is a typed error too.
    const badCombo = await server.dispatch("weaver_review_action", { workspaceDir: root, resource: "changeset", action: "revert" }) as any;
    expect(badCombo.isError).toBe(true);
    expect(badCombo.structuredContent.code).toBe("REVIEW_ACTION_INVALID_COMBO");
  });

  it("is model-facing while the four merged write tools are not (but stay registered)", async () => {
    const root = freshRoot();
    const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);

    const diagnostics = await server.dispatch("weaver_get_diagnostics", {}) as any;
    const modelFacing: string[] = diagnostics.structuredContent.toolSurface.modelFacingNames;
    expect(modelFacing).toContain("weaver_review_action");
    // The four widget-called writes are off the model surface now.
    expect(modelFacing).not.toContain("weaver_reject_changeset");
    expect(modelFacing).not.toContain("weaver_apply_layout");
    expect(modelFacing).not.toContain("weaver_reject_layout");
    expect(modelFacing).not.toContain("weaver_revert_layout");
    // weaver_apply_changeset (critical) stays model-facing and untouched.
    expect(modelFacing).toContain("weaver_apply_changeset");
    expect(diagnostics.structuredContent.toolSurface.criticalPresent.weaver_apply_changeset).toBe(true);

    // But all four remain registered under their exact names for the widget.
    expect(server.toolMeta("weaver_reject_changeset")).toBeTruthy();
    expect(server.toolMeta("weaver_apply_layout")).toBeTruthy();
    expect(server.toolMeta("weaver_reject_layout")).toBeTruthy();
    expect(server.toolMeta("weaver_revert_layout")).toBeTruthy();
  });
});
