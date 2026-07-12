import { existsSync, mkdirSync, realpathSync, renameSync } from "node:fs";
import { basename, join, resolve } from "node:path";
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

function backupName(workspaceDir: string, timestamp: Date) {
  const stem = `.weaver-backup-${timestamp.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`;
  let candidate = join(workspaceDir, stem); let suffix = 2;
  while (existsSync(candidate)) candidate = join(workspaceDir, `${stem}-${suffix++}`);
  return candidate;
}

export function prepareWorkspaceData(workspaceDir: string, timestamp = new Date()) {
  const dataDir = join(workspaceDir, ".weaver"); const dbPath = join(dataDir, "weaver.sqlite");
  let schemaResetBackupName: string | undefined;
  if (existsSync(dbPath)) {
    const existing = new DatabaseSync(dbPath); const row = existing.prepare("PRAGMA user_version").get() as { user_version: number }; existing.close();
    if (row.user_version !== migrations.CURRENT_SCHEMA_VERSION) {
      const backup = backupName(workspaceDir, timestamp); renameSync(dataDir, backup); schemaResetBackupName = basename(backup);
    }
  }
  mkdirSync(join(dataDir, "assets", "tasks"), { recursive: true });
  mkdirSync(join(dataDir, "assets", "original"), { recursive: true });
  mkdirSync(join(dataDir, "assets", "thumbnails"), { recursive: true });
  mkdirSync(join(dataDir, "exports"), { recursive: true });
  return { dataDir, dbPath, schemaResetBackupName };
}

export class WorkspaceStore {
  readonly workspaceDir: string;
  readonly dataDir: string;
  readonly dbPath: string;
  readonly db: DatabaseSync;
  readonly schemaResetBackupName?: string;

  constructor(workspaceDir: string) {
    this.workspaceDir = safeWorkspaceDir(workspaceDir);
    const prepared = prepareWorkspaceData(this.workspaceDir);
    this.dataDir = prepared.dataDir; this.dbPath = prepared.dbPath; this.schemaResetBackupName = prepared.schemaResetBackupName;
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    migrations.initializeSchema(this.db);
    viewCatalog.purgeExpiredProjectViews(this.db);
  }

  close() { this.db.close(); }

  readonly sessions = {
    appendEvent: (input: Omit<ProjectEvent, "sequence" | "createdAt"> & { createdAt?: string }) => projectEvents.appendProjectEvent(this.db, input),
    listEvents: (projectId: string, afterSequence = 0, limit = 500) => projectEvents.listProjectEvents(this.db, projectId, afterSequence, limit),
    latestSequence: (projectId: string) => projectEvents.getLatestEventSequence(this.db, projectId),
    getBinding: (chatSessionKey: string) => chatCanvasBinding.getChatCanvasBinding(this.db, chatSessionKey),
    openBinding: (input: { chatSessionKey: string; projectId?: string; viewId?: string }) => chatCanvasBinding.openChatCanvasBinding(this.db, input),
    switchBinding: (input: { chatSessionKey: string; leaseId: string; bindingRevision: number; projectId: string; viewId: string }) => chatCanvasBinding.switchChatCanvasBinding(this.db, input),
    boundCanvas: (chatSessionKey: string, requireOnline = false) => chatCanvasBinding.getBoundCanvas(this.db, chatSessionKey, requireOnline),
    syncCanvas: (snapshot: CanvasContextSnapshot, chatSessionKey?: string) => chatCanvasBinding.syncCanvasContext(this.db, snapshot, chatSessionKey),
    canvasContext: (sessionId: string) => chatCanvasBinding.getCanvasContext(this.db, sessionId),
  };
  readonly catalog = {
    listProjects: (): SpaceProject[] => projects.listProjects(this.db), getProject: (projectId: string) => projects.getProject(this.db, projectId),
    createProject: (input: { title: string; goal: string; scenePack: ScenePack; automationLevel?: SpaceProject["automationLevel"]; createdFromTemplate?: { id: string; version: string }; writeSnapshots?: boolean }) => projects.createProject(this.db, this.dataDir, input),
    createSeededProject: (input: { title: string; goal: string; scenePack: ScenePack; automationLevel?: SpaceProject["automationLevel"]; chatSessionKey?: string }) => projects.createSeededProject(this.db, this.dataDir, input),
    listViews: (projectId: string, status?: ProjectView["status"]) => viewCatalog.listProjectViews(this.db, projectId, status), getView: (projectId: string, viewId: string) => viewCatalog.getProjectView(this.db, projectId, viewId), searchViews: (projectId: string, query: string, status: ProjectView["status"] = "active") => viewCatalog.searchProjectViews(this.db, projectId, query, status),
    renameView: (input: { projectId: string; viewId: string; name: string; baseCatalogRevision: number }) => viewCatalog.renameProjectView(this.db, input), pinView: (input: { projectId: string; viewId: string; pinned: boolean; baseCatalogRevision: number }) => viewCatalog.pinProjectView(this.db, input), reorderViews: (input: { projectId: string; viewIds: string[]; baseCatalogRevision: number }) => viewCatalog.reorderPinnedViews(this.db, input), setDefaultView: (input: { projectId: string; viewId: string; baseCatalogRevision: number }) => viewCatalog.setDefaultProjectView(this.db, input),
    trashView: (input: { projectId: string; viewId: string; fallbackViewId?: string; baseCatalogRevision: number }) => viewCatalog.trashProjectView(this.db, input), restoreView: (input: { projectId: string; viewId: string; baseCatalogRevision: number }) => viewCatalog.restoreProjectView(this.db, input), purgeView: (input: { projectId: string; viewId: string; baseCatalogRevision: number }) => viewCatalog.purgeProjectView(this.db, input), duplicateView: (input: { projectId: string; viewId: string; name?: string; baseCatalogRevision: number }) => viewCatalog.duplicateProjectView(this.db, input),
    saveCanvasState: (input: CanvasViewState) => viewCatalog.saveCanvasViewState(this.db, input), canvasState: (canvasSessionId: string, viewId: string) => viewCatalog.getCanvasViewState(this.db, canvasSessionId, viewId),
    previewTemplate: (input: { projectId: string; template: VisualTemplate; baseGraphRevision: number; viewName?: string }) => layoutTemplates.previewVisualTemplate(this.db, input), createViewFromTemplate: (input: { projectId: string; template: VisualTemplate; baseGraphRevision: number; viewName?: string; chatBinding?: { chatSessionKey: string; leaseId: string; bindingRevision: number } }) => layoutTemplates.createViewFromVisualTemplate(this.db, input), createProjectFromTemplate: (input: { title: string; goal: string; scenePack: ScenePack; template: VisualTemplate; automationLevel?: SpaceProject["automationLevel"]; chatBinding?: { chatSessionKey: string; leaseId?: string; bindingRevision?: number } }) => layoutTemplates.createProjectFromVisualTemplate(this.db, this.dataDir, input),
  };
  readonly graphChanges = {
    read: (projectId: string): GraphSnapshot => graph.getGraph(this.db, projectId), replace: (snapshot: GraphSnapshot, eventContext: { taskId?: string; canvasSessionId?: string } = {}) => graph.replaceGraph(this.db, snapshot, eventContext), createNode: (input: { projectId: string; viewId: string; type: string; title: string; content: NodeContent; x: number; y: number }) => graph.createContentNode(this.db, input), updateNode: (input: { projectId: string; nodeId: string; baseGraphRevision: number; title?: string; type?: string; content?: NodeContent }) => graph.updateNodeContent(this.db, input), archiveNode: (input: { projectId: string; nodeId: string; baseGraphRevision: number }) => graph.archiveNode(this.db, input), linkNodes: (input: { projectId: string; sourceNodeId: string; targetNodeId: string; type: string; baseGraphRevision: number; directed?: boolean }) => graph.linkNodes(this.db, input), attachAsset: (input: { projectId: string; nodeId: string; assetId: string; role: "embedded" | "cover"; baseGraphRevision: number }) => graph.attachAsset(this.db, input),
    submit: (changeSet: ChangeSet) => changesets.submitChangeSet(this.db, changeSet), list: (projectId: string, status?: ChangeSet["status"]) => changesets.listChangeSets(this.db, projectId, status), get: (changeSetId: string) => changesets.getChangeSet(this.db, changeSetId), reject: (changeSetId: string) => changesets.rejectChangeSet(this.db, changeSetId), apply: (changeSetId: string) => changesets.applyChangeSet(this.db, changeSetId), revert: (changeSetId: string) => changesets.revertChangeSet(this.db, changeSetId),
  };
  readonly layoutReviews = {
    get: (projectId: string, viewId: string) => layoutTemplates.getLayout(this.db, projectId, viewId), list: (projectId: string) => layoutTemplates.listLayouts(this.db, projectId), ensureView: (input: { projectId: string; viewId: string; viewType: LayoutDocument["viewType"]; strategy: LayoutDocument["strategy"]; viewName?: string }) => layoutTemplates.ensureView(this.db, input), save: (document: LayoutDocument, archive = true, eventContext: { taskId?: string; canvasSessionId?: string; operations?: unknown[] } = {}) => layoutTemplates.saveLayout(this.db, document, archive, eventContext), saveRun: (input: { id?: string; projectId: string; viewId: string; taskId?: string; plan: unknown; candidates: LayoutCandidate[] }) => layoutTemplates.saveLayoutRun(this.db, input), getRun: (id: string) => layoutTemplates.getLayoutRun(this.db, id), applyCandidate: (runId: string, candidateId: string) => layoutTemplates.applyLayoutCandidate(this.db, runId, candidateId), rejectRun: (runId: string) => layoutTemplates.rejectLayoutRun(this.db, runId), revert: (projectId: string, viewId: string) => layoutTemplates.revertLayout(this.db, projectId, viewId),
  };
  readonly assets = { get: (assetId: string) => assets.getAsset(this.db, assetId), byHash: (projectId: string, sha256: string) => assets.getAssetByHash(this.db, projectId, sha256), read: (assetId: string, thumbnail = false) => assets.readAsset(this.db, this.dataDir, assetId, thumbnail), importImage: (input: { projectId: string; mimeType: Asset["mimeType"]; data: Uint8Array }) => assets.importImageAsset(this.db, this.dataDir, input), saveTaskFile: (taskId: string, fileName: string, data: Uint8Array) => assets.saveTaskAsset(this.dataDir, taskId, fileName, data) };
  readonly tasks = { prepare: (input: { canvasSessionId: string; actionKey: string; userInstruction?: string; dispatchKey?: string; chatSessionKey?: string }) => agentTasks.prepareAgentTask(this.db, input), prepareBound: (input: { chatSessionKey: string; actionKey: string; userInstruction?: string; dispatchKey?: string }) => agentTasks.prepareAgentTaskFromBoundCanvas(this.db, input), assertChat: (taskId: string, chatSessionKey: string, requireOnline = true) => agentTasks.assertTaskChat(this.db, taskId, chatSessionKey, requireOnline), assertCanvas: (taskId: string, chatSessionKey: string, requireOnline = false) => agentTasks.assertTaskCanvas(this.db, taskId, chatSessionKey, requireOnline), get: (taskId: string) => agentTasks.getAgentTask(this.db, taskId), listCanvas: (canvasSessionId: string, includeTerminal = false) => agentTasks.listCanvasTasks(this.db, canvasSessionId, includeTerminal), reapCanvas: (canvasSessionId: string) => agentTasks.reapExpiredCanvasTasks(this.db, canvasSessionId), listProject: (projectId: string, includeTerminal = false) => agentTasks.listProjectTasks(this.db, projectId, includeTerminal), update: (taskId: string, patch: Partial<AgentTask>) => agentTasks.updateAgentTask(this.db, taskId, patch), confirmDispatch: (taskId: string, dispatchKey: string) => agentTasks.confirmAgentDispatch(this.db, taskId, dispatchKey), failDispatch: (taskId: string, dispatchKey: string, input: { code: "AGENT_DISPATCH_REJECTED" | "DISPATCH_UNCONFIRMED"; message: string }) => agentTasks.failAgentDispatch(this.db, taskId, dispatchKey, input), continue: (input: { taskId: string; dispatchKey: string; expectedTaskRevision: number }) => agentTasks.beginAgentContinuation(this.db, input), progress: (taskId: string, note: string) => agentTasks.reportTaskProgress(this.db, taskId, note) };
  readonly artifacts = { publish: (input: { projectId: string; type: string; title: string; content: unknown; sourceNodeIds: string[]; graphRevision: number }) => artifacts.publishArtifact(this.db, input), get: (artifactId: string) => artifacts.getArtifact(this.db, artifactId) };
}
