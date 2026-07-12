import { mkdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AgentTask,
  Asset,
  CanvasContextSnapshot,
  CanvasViewState,
  ChangeSet,
  LayoutCandidate,
  LayoutDocument,
  NodeContent,
  ProjectEvent,
  ProjectView,
  ScenePack,
  SpaceProject,
  VisualTemplate,
} from "@weaver/contracts";
import type { GraphSnapshot } from "@weaver/core";
import * as migrations from "./migrations.js";
import * as projectEvents from "./project-events.js";
import * as chatCanvasBinding from "./chat-canvas-binding.js";
import * as projects from "./projects.js";
import * as viewCatalog from "./view-catalog.js";
import * as graph from "./graph.js";
import * as layoutTemplates from "./layout-templates.js";
import * as assets from "./assets.js";
import * as agentTasks from "./agent-tasks.js";
import * as changesets from "./changesets.js";
import * as artifacts from "./artifacts.js";

function safeWorkspaceDir(input: string) {
  const absolute = resolve(input);
  return realpathSync(absolute);
}

export class WorkspaceStore {
  readonly workspaceDir: string;
  readonly dataDir: string;
  readonly dbPath: string;
  readonly db: DatabaseSync;

  constructor(workspaceDir: string) {
    this.workspaceDir = safeWorkspaceDir(workspaceDir);
    this.dataDir = join(this.workspaceDir, ".weaver");
    mkdirSync(join(this.dataDir, "assets", "tasks"), { recursive: true });
    mkdirSync(join(this.dataDir, "assets", "original"), { recursive: true });
    mkdirSync(join(this.dataDir, "assets", "thumbnails"), { recursive: true });
    mkdirSync(join(this.dataDir, "exports"), { recursive: true });
    this.dbPath = join(this.dataDir, "weaver.sqlite");
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    // NOTE: this migration chain re-runs on every WorkspaceStore instantiation (a fresh store is
    // constructed per MCP tool call). Pre-existing behavior, out of scope for this refactor.
    migrations.migrate(this.db);
    migrations.migrateProjectViewPrimaryKey(this.db);
    migrations.migrateLegacyNodes(this.db);
    migrations.migrateLegacyCanvasContexts(this.db);
    migrations.migrateLegacyAgentTasks(this.db);
    migrations.migrateLegacyProjectViews(this.db);
    migrations.purgeExpiredProjectViews(this.db);
  }

  close() { this.db.close(); }

  // --- project events / audit log ---
  appendProjectEvent(input: Omit<ProjectEvent, "sequence" | "createdAt"> & { createdAt?: string }) { return projectEvents.appendProjectEvent(this.db, input); }
  listProjectEvents(projectId: string, afterSequence = 0, limit = 500) { return projectEvents.listProjectEvents(this.db, projectId, afterSequence, limit); }
  getLatestEventSequence(projectId: string) { return projectEvents.getLatestEventSequence(this.db, projectId); }

  // --- chat-canvas binding / lease ---
  getChatCanvasBinding(chatSessionKey: string) { return chatCanvasBinding.getChatCanvasBinding(this.db, chatSessionKey); }
  openChatCanvasBinding(input: { chatSessionKey: string; projectId?: string; viewId?: string }) { return chatCanvasBinding.openChatCanvasBinding(this.db, input); }
  switchChatCanvasBinding(input: { chatSessionKey: string; leaseId: string; bindingRevision: number; projectId: string; viewId: string }) { return chatCanvasBinding.switchChatCanvasBinding(this.db, input); }
  getBoundCanvas(chatSessionKey: string, requireOnline = false) { return chatCanvasBinding.getBoundCanvas(this.db, chatSessionKey, requireOnline); }
  syncCanvasContext(snapshot: CanvasContextSnapshot, chatSessionKey?: string) { return chatCanvasBinding.syncCanvasContext(this.db, snapshot, chatSessionKey); }
  getCanvasContext(sessionId: string) { return chatCanvasBinding.getCanvasContext(this.db, sessionId); }

  // --- projects (CRUD) ---
  listProjects(): SpaceProject[] { return projects.listProjects(this.db); }
  getProject(projectId: string) { return projects.getProject(this.db, projectId); }
  createProject(input: { title: string; goal: string; scenePack: ScenePack; automationLevel?: SpaceProject["automationLevel"]; createdFromTemplate?: { id: string; version: string }; writeSnapshots?: boolean }) { return projects.createProject(this.db, this.dataDir, input); }
  createSeededProject(input: { title: string; goal: string; scenePack: ScenePack; automationLevel?: SpaceProject["automationLevel"]; chatSessionKey?: string }) { return projects.createSeededProject(this.db, this.dataDir, input); }

  // --- project views / catalog ---
  listProjectViews(projectId: string, status?: ProjectView["status"]) { return viewCatalog.listProjectViews(this.db, projectId, status); }
  getProjectView(projectId: string, viewId: string) { return viewCatalog.getProjectView(this.db, projectId, viewId); }
  renameProjectView(input: { projectId: string; viewId: string; name: string; baseCatalogRevision: number }) { return viewCatalog.renameProjectView(this.db, input); }
  pinProjectView(input: { projectId: string; viewId: string; pinned: boolean; baseCatalogRevision: number }) { return viewCatalog.pinProjectView(this.db, input); }
  reorderPinnedViews(input: { projectId: string; viewIds: string[]; baseCatalogRevision: number }) { return viewCatalog.reorderPinnedViews(this.db, input); }
  setDefaultProjectView(input: { projectId: string; viewId: string; baseCatalogRevision: number }) { return viewCatalog.setDefaultProjectView(this.db, input); }
  searchProjectViews(projectId: string, query: string, status: ProjectView["status"] = "active") { return viewCatalog.searchProjectViews(this.db, projectId, query, status); }
  trashProjectView(input: { projectId: string; viewId: string; fallbackViewId?: string; baseCatalogRevision: number }) { return viewCatalog.trashProjectView(this.db, input); }
  restoreProjectView(input: { projectId: string; viewId: string; baseCatalogRevision: number }) { return viewCatalog.restoreProjectView(this.db, input); }
  purgeProjectView(input: { projectId: string; viewId: string; baseCatalogRevision: number }) { return viewCatalog.purgeProjectView(this.db, input); }
  duplicateProjectView(input: { projectId: string; viewId: string; name?: string; baseCatalogRevision: number }) { return viewCatalog.duplicateProjectView(this.db, input); }
  saveCanvasViewState(input: CanvasViewState) { return viewCatalog.saveCanvasViewState(this.db, input); }
  getCanvasViewState(canvasSessionId: string, viewId: string) { return viewCatalog.getCanvasViewState(this.db, canvasSessionId, viewId); }

  // --- graph nodes/edges ---
  getGraph(projectId: string): GraphSnapshot { return graph.getGraph(this.db, projectId); }
  replaceGraph(snapshot: GraphSnapshot, eventContext: { taskId?: string; canvasSessionId?: string } = {}) { return graph.replaceGraph(this.db, snapshot, eventContext); }
  createContentNode(input: { projectId: string; viewId: string; type: string; title: string; content: NodeContent; x: number; y: number }) { return graph.createContentNode(this.db, input); }
  updateNodeContent(input: { projectId: string; nodeId: string; baseGraphRevision: number; title?: string; type?: string; content?: NodeContent }) { return graph.updateNodeContent(this.db, input); }
  archiveNode(input: { projectId: string; nodeId: string; baseGraphRevision: number }) { return graph.archiveNode(this.db, input); }
  attachAsset(input: { projectId: string; nodeId: string; assetId: string; role: "embedded" | "cover"; baseGraphRevision: number }) { return graph.attachAsset(this.db, input); }

  // --- layout documents / view templates ---
  getLayout(projectId: string, viewId: string) { return layoutTemplates.getLayout(this.db, projectId, viewId); }
  listLayouts(projectId: string) { return layoutTemplates.listLayouts(this.db, projectId); }
  ensureView(input: { projectId: string; viewId: string; viewType: LayoutDocument["viewType"]; strategy: LayoutDocument["strategy"]; viewName?: string }) { return layoutTemplates.ensureView(this.db, input); }
  previewVisualTemplate(input: { projectId: string; template: VisualTemplate; baseGraphRevision: number; viewName?: string }) { return layoutTemplates.previewVisualTemplate(this.db, input); }
  createViewFromVisualTemplate(input: { projectId: string; template: VisualTemplate; baseGraphRevision: number; viewName?: string; chatBinding?: { chatSessionKey: string; leaseId: string; bindingRevision: number } }) { return layoutTemplates.createViewFromVisualTemplate(this.db, input); }
  createProjectFromVisualTemplate(input: { title: string; goal: string; scenePack: ScenePack; template: VisualTemplate; automationLevel?: SpaceProject["automationLevel"]; chatBinding?: { chatSessionKey: string; leaseId?: string; bindingRevision?: number } }) { return layoutTemplates.createProjectFromVisualTemplate(this.db, this.dataDir, input); }
  saveLayout(document: LayoutDocument, archive = true, eventContext: { taskId?: string; canvasSessionId?: string; operations?: unknown[] } = {}) { return layoutTemplates.saveLayout(this.db, document, archive, eventContext); }
  saveLayoutRun(input: { id?: string; projectId: string; viewId: string; taskId?: string; plan: unknown; candidates: LayoutCandidate[] }) { return layoutTemplates.saveLayoutRun(this.db, input); }
  getLayoutRun(id: string) { return layoutTemplates.getLayoutRun(this.db, id); }
  applyLayoutCandidate(runId: string, candidateId: string) { return layoutTemplates.applyLayoutCandidate(this.db, runId, candidateId); }
  rejectLayoutRun(runId: string) { return layoutTemplates.rejectLayoutRun(this.db, runId); }
  revertLayout(projectId: string, viewId: string) { return layoutTemplates.revertLayout(this.db, projectId, viewId); }

  // --- assets ---
  getAsset(assetId: string) { return assets.getAsset(this.db, assetId); }
  getAssetByHash(projectId: string, sha256: string) { return assets.getAssetByHash(this.db, projectId, sha256); }
  readAsset(assetId: string, thumbnail = false) { return assets.readAsset(this.db, this.dataDir, assetId, thumbnail); }
  importImageAsset(input: { projectId: string; mimeType: Asset["mimeType"]; data: Uint8Array }) { return assets.importImageAsset(this.db, this.dataDir, input); }
  saveTaskAsset(taskId: string, fileName: string, data: Uint8Array) { return assets.saveTaskAsset(this.dataDir, taskId, fileName, data); }

  // --- agent tasks / dispatches ---
  prepareAgentTask(input: { canvasSessionId: string; actionKey: string; userInstruction?: string; dispatchKey?: string; chatSessionKey?: string }) { return agentTasks.prepareAgentTask(this.db, input); }
  prepareAgentTaskFromBoundCanvas(input: { chatSessionKey: string; actionKey: string; userInstruction?: string; dispatchKey?: string }) { return agentTasks.prepareAgentTaskFromBoundCanvas(this.db, input); }
  assertTaskChat(taskId: string, chatSessionKey: string, requireOnline = true) { return agentTasks.assertTaskChat(this.db, taskId, chatSessionKey, requireOnline); }
  assertTaskCanvas(taskId: string, chatSessionKey: string, requireOnline = false) { return agentTasks.assertTaskCanvas(this.db, taskId, chatSessionKey, requireOnline); }
  getAgentTask(taskId: string) { return agentTasks.getAgentTask(this.db, taskId); }
  listCanvasTasks(canvasSessionId: string, includeTerminal = false) { return agentTasks.listCanvasTasks(this.db, canvasSessionId, includeTerminal); }
  reapExpiredCanvasTasks(canvasSessionId: string) { return agentTasks.reapExpiredCanvasTasks(this.db, canvasSessionId); }
  listProjectTasks(projectId: string, includeTerminal = false) { return agentTasks.listProjectTasks(this.db, projectId, includeTerminal); }
  updateAgentTask(taskId: string, patch: Partial<AgentTask>) { return agentTasks.updateAgentTask(this.db, taskId, patch); }
  confirmAgentDispatch(taskId: string, dispatchKey: string) { return agentTasks.confirmAgentDispatch(this.db, taskId, dispatchKey); }
  failAgentDispatch(taskId: string, dispatchKey: string, input: { code: "AGENT_DISPATCH_REJECTED" | "DISPATCH_UNCONFIRMED"; message: string }) { return agentTasks.failAgentDispatch(this.db, taskId, dispatchKey, input); }
  beginAgentContinuation(input: { taskId: string; dispatchKey: string; expectedTaskRevision: number }) { return agentTasks.beginAgentContinuation(this.db, input); }
  reportTaskProgress(taskId: string, note: string) { return agentTasks.reportTaskProgress(this.db, taskId, note); }

  // --- changesets ---
  submitChangeSet(changeSet: ChangeSet) { return changesets.submitChangeSet(this.db, changeSet); }
  listChangeSets(projectId: string, status?: ChangeSet["status"]) { return changesets.listChangeSets(this.db, projectId, status); }
  getChangeSet(changeSetId: string) { return changesets.getChangeSet(this.db, changeSetId); }
  rejectChangeSet(changeSetId: string) { return changesets.rejectChangeSet(this.db, changeSetId); }
  applyChangeSet(changeSetId: string) { return changesets.applyChangeSet(this.db, changeSetId); }

  // --- artifacts ---
  publishArtifact(input: { projectId: string; type: string; title: string; content: unknown; sourceNodeIds: string[]; graphRevision: number }) { return artifacts.publishArtifact(this.db, input); }
  getArtifact(artifactId: string) { return artifacts.getArtifact(this.db, artifactId); }
}
