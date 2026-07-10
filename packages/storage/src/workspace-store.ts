import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import {
  agentTaskSchema,
  assetSchema,
  canvasContextSnapshotSchema,
  changeSetSchema,
  layoutDocumentSchema,
  nodeContentSchema,
  nodeSchema,
  projectSchema,
  projectEventSchema,
  type AgentTask,
  type Asset,
  type CanvasContextSnapshot,
  type ChangeSet,
  type LayoutCandidate,
  type LayoutDocument,
  type NodeContent,
  type ProjectEvent,
  type ScenePack,
  type SpaceEdge,
  type SpaceNode,
  type SpaceProject,
} from "@weaver/contracts";
import { applyGraphOperations, applyLayoutOperations, type GraphSnapshot } from "@weaver/core";

function now() { return new Date().toISOString(); }
function json<T>(value: T) { return JSON.stringify(value); }
function parse<T>(value: unknown): T { return JSON.parse(String(value)) as T; }

function safeWorkspaceDir(input: string) {
  const absolute = resolve(input);
  return realpathSync(absolute);
}

function defaultLayout(project: SpaceProject, viewId: string, viewType: LayoutDocument["viewType"], strategy: LayoutDocument["strategy"]): LayoutDocument {
  return layoutDocumentSchema.parse({
    projectId: project.id,
    viewId,
    viewType,
    graphRevision: project.graphRevision,
    layoutRevision: 0,
    strategy,
    config: { direction: "left-right", nodeSpacing: 72, rankSpacing: 120, density: 1, viewportWidth: 1280, viewportHeight: 800 },
    nodes: {}, edges: {}, groups: {}, bounds: { x: 0, y: 0, width: 0, height: 0 }, createdBy: "user", updatedAt: now(),
  });
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
    this.migrate();
    this.migrateLegacyNodes();
  }

  close() { this.db.close(); }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS project (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS node (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS ix_node_project ON node(project_id);
      CREATE TABLE IF NOT EXISTS edge (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS ix_edge_project ON edge(project_id);
      CREATE TABLE IF NOT EXISTS layout (project_id TEXT NOT NULL, view_id TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(project_id, view_id));
      CREATE TABLE IF NOT EXISTS layout_history (project_id TEXT NOT NULL, view_id TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(project_id, view_id, revision));
      CREATE TABLE IF NOT EXISTS layout_run (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, view_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS canvas_session (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, sequence INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_task (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS changeset (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS artifact (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS asset (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, sha256 TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(project_id, sha256));
      CREATE INDEX IF NOT EXISTS ix_asset_project ON asset(project_id);
      CREATE TABLE IF NOT EXISTS project_event (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        canvas_session_id TEXT,
        task_id TEXT,
        kind TEXT NOT NULL,
        graph_revision INTEGER,
        view_id TEXT,
        layout_revision INTEGER,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_project_event_project_sequence ON project_event(project_id, sequence);
      CREATE INDEX IF NOT EXISTS ix_project_event_session_sequence ON project_event(canvas_session_id, sequence);
      PRAGMA user_version = 3;
    `);
  }

  private transaction<T>(callback: () => T): T {
    if (this.db.isTransaction) return callback();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = callback();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  appendProjectEvent(input: Omit<ProjectEvent, "sequence" | "createdAt"> & { createdAt?: string }) {
    const createdAt = input.createdAt ?? now();
    const result = this.db.prepare(`
      INSERT INTO project_event(project_id, canvas_session_id, task_id, kind, graph_revision, view_id, layout_revision, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.projectId, input.canvasSessionId ?? null, input.taskId ?? null, input.kind, input.graphRevision ?? null, input.viewId ?? null, input.layoutRevision ?? null, json(input.payload), createdAt);
    return projectEventSchema.parse({ ...input, sequence: Number(result.lastInsertRowid), createdAt });
  }

  listProjectEvents(projectId: string, afterSequence = 0, limit = 500) {
    return (this.db.prepare(`
      SELECT sequence, project_id, canvas_session_id, task_id, kind, graph_revision, view_id, layout_revision, payload, created_at
      FROM project_event WHERE project_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT ?
    `).all(projectId, afterSequence, limit) as any[]).map((row) => projectEventSchema.parse({
      sequence: Number(row.sequence), projectId: row.project_id, canvasSessionId: row.canvas_session_id ?? undefined,
      taskId: row.task_id ?? undefined, kind: row.kind, graphRevision: row.graph_revision ?? undefined,
      viewId: row.view_id ?? undefined, layoutRevision: row.layout_revision ?? undefined,
      payload: parse(row.payload), createdAt: row.created_at,
    }));
  }

  getLatestEventSequence(projectId: string) {
    const row = this.db.prepare("SELECT MAX(sequence) AS sequence FROM project_event WHERE project_id = ?").get(projectId) as any;
    return Number(row?.sequence ?? 0);
  }

  private migrateLegacyNodes() {
    const rows = this.db.prepare("SELECT id, data FROM node").all() as Array<{ id: string; data: string }>;
    const update = this.db.prepare("UPDATE node SET data = ? WHERE id = ?");
    for (const row of rows) {
      const raw = parse<Record<string, unknown>>(row.data);
      if (raw.content && raw.contentKind) continue;
      update.run(json(nodeSchema.parse(raw)), row.id);
    }
  }

  listProjects(): SpaceProject[] {
    return this.db.prepare("SELECT data FROM project ORDER BY json_extract(data, '$.updatedAt') DESC").all().map((row: any) => projectSchema.parse(parse(row.data)));
  }

  getProject(projectId: string) {
    const row = this.db.prepare("SELECT data FROM project WHERE id = ?").get(projectId) as any;
    return row ? projectSchema.parse(parse(row.data)) : null;
  }

  createProject(input: { title: string; goal: string; scenePack: ScenePack; automationLevel?: SpaceProject["automationLevel"] }) {
    const timestamp = now();
    const project = projectSchema.parse({
      id: randomUUID(), title: input.title, goal: input.goal, scenePackId: input.scenePack.id, scenePackVersion: input.scenePack.version,
      automationLevel: input.automationLevel ?? "collaborative", defaultViewId: `${input.scenePack.defaultView}-default`, graphRevision: 0, createdAt: timestamp, updatedAt: timestamp,
    });
    this.db.prepare("INSERT INTO project(id, data) VALUES (?, ?)").run(project.id, json(project));
    const snapshotPath = join(this.dataDir, "scene-pack.snapshot.json");
    writeFileSync(snapshotPath, `${JSON.stringify(input.scenePack, null, 2)}\n`, "utf8");
    writeFileSync(join(this.dataDir, "project.json"), `${JSON.stringify(project, null, 2)}\n`, "utf8");
    const layout = defaultLayout(project, project.defaultViewId, input.scenePack.defaultView, input.scenePack.defaultStrategy as LayoutDocument["strategy"]);
    this.saveLayout(layout, false);
    return project;
  }

  getGraph(projectId: string): GraphSnapshot {
    const project = this.getProject(projectId);
    if (!project) throw new Error(`PROJECT_NOT_FOUND:${projectId}`);
    const nodes = this.db.prepare("SELECT data FROM node WHERE project_id = ?").all(projectId).map((row: any) => nodeSchema.parse(parse(row.data)));
    const edges = this.db.prepare("SELECT data FROM edge WHERE project_id = ?").all(projectId).map((row: any) => parse<SpaceEdge>(row.data));
    return { projectId, revision: project.graphRevision, nodes, edges };
  }

  private graphDelta(previous: GraphSnapshot, next: GraphSnapshot) {
    const beforeNodes = new Map(previous.nodes.map((node) => [node.id, node]));
    const beforeEdges = new Map(previous.edges.map((edge) => [edge.id, edge]));
    const summarize = (node: SpaceNode) => {
      const assetIds = node.content.kind === "image" ? [node.content.assetId]
        : node.content.kind === "document" ? [node.content.coverAssetId, ...node.content.embeddedAssetIds].filter(Boolean) as string[]
          : [node.content.imageAssetId].filter(Boolean) as string[];
      return {
        ...node,
        body: "",
        content: node.content.kind === "document" ? { ...node.content, markdown: "" } : node.content,
        assets: assetIds.map((id) => this.getAsset(id)).filter(Boolean),
      };
    };
    return {
      fromRevision: previous.revision,
      toRevision: next.revision,
      addedNodes: next.nodes.filter((node) => !beforeNodes.has(node.id)).map(summarize),
      updatedNodes: next.nodes.filter((node) => beforeNodes.has(node.id) && json(beforeNodes.get(node.id)) !== json(node)).map(summarize),
      archivedNodeIds: next.nodes.filter((node) => node.archived && !beforeNodes.get(node.id)?.archived).map((node) => node.id),
      addedEdges: next.edges.filter((edge) => !beforeEdges.has(edge.id)),
      updatedEdges: next.edges.filter((edge) => beforeEdges.has(edge.id) && json(beforeEdges.get(edge.id)) !== json(edge)),
      archivedEdgeIds: next.edges.filter((edge) => edge.archived && !beforeEdges.get(edge.id)?.archived).map((edge) => edge.id),
    };
  }

  replaceGraph(snapshot: GraphSnapshot, eventContext: { taskId?: string; canvasSessionId?: string } = {}) {
    const project = this.getProject(snapshot.projectId);
    if (!project) throw new Error(`PROJECT_NOT_FOUND:${snapshot.projectId}`);
    const previous = this.getGraph(snapshot.projectId);
    this.transaction(() => {
      this.db.prepare("DELETE FROM node WHERE project_id = ?").run(snapshot.projectId);
      this.db.prepare("DELETE FROM edge WHERE project_id = ?").run(snapshot.projectId);
      const nodeInsert = this.db.prepare("INSERT INTO node(id, project_id, data) VALUES (?, ?, ?)");
      const edgeInsert = this.db.prepare("INSERT INTO edge(id, project_id, data) VALUES (?, ?, ?)");
      for (const node of snapshot.nodes) {
        const validated = nodeSchema.parse(node);
        nodeInsert.run(validated.id, snapshot.projectId, json(validated));
      }
      for (const edge of snapshot.edges) edgeInsert.run(edge.id, snapshot.projectId, json(edge));
      const nextProject = { ...project, graphRevision: snapshot.revision, updatedAt: now() };
      this.db.prepare("UPDATE project SET data = ? WHERE id = ?").run(json(nextProject), snapshot.projectId);
      if (snapshot.revision !== previous.revision) this.appendProjectEvent({
        projectId: snapshot.projectId, taskId: eventContext.taskId, canvasSessionId: eventContext.canvasSessionId,
        kind: "graph.changed", graphRevision: snapshot.revision, payload: this.graphDelta(previous, snapshot),
      });
    });
  }

  getLayout(projectId: string, viewId: string) {
    const row = this.db.prepare("SELECT data FROM layout WHERE project_id = ? AND view_id = ?").get(projectId, viewId) as any;
    return row ? layoutDocumentSchema.parse(parse(row.data)) : null;
  }

  listLayouts(projectId: string) {
    return this.db.prepare("SELECT data FROM layout WHERE project_id = ? ORDER BY view_id").all(projectId)
      .map((row: any) => layoutDocumentSchema.parse(parse(row.data)));
  }

  ensureView(input: { projectId: string; viewId: string; viewType: LayoutDocument["viewType"]; strategy: LayoutDocument["strategy"] }) {
    const existing = this.getLayout(input.projectId, input.viewId);
    if (existing) return existing;
    const project = this.getProject(input.projectId);
    if (!project) throw new Error(`PROJECT_NOT_FOUND:${input.projectId}`);
    const graph = this.getGraph(input.projectId);
    const document = defaultLayout(project, input.viewId, input.viewType, input.strategy);
    document.graphRevision = graph.revision;
    graph.nodes.filter((node) => !node.archived).forEach((node, index) => {
      document.nodes[node.id] = {
        nodeId: node.id,
        x: (index % 4) * 292,
        y: Math.floor(index / 4) * 176,
        width: 220,
        height: 112,
        rotation: 0,
        zIndex: 0,
        pinned: false,
        hidden: false,
        collapsed: false,
      };
    });
    document.bounds = {
      x: 0,
      y: 0,
      width: graph.nodes.length ? Math.min(4, graph.nodes.length) * 292 - 72 : 0,
      height: graph.nodes.length ? Math.ceil(graph.nodes.length / 4) * 176 - 64 : 0,
    };
    return this.saveLayout(document, false);
  }

  saveLayout(document: LayoutDocument, archive = true, eventContext: { taskId?: string; canvasSessionId?: string; operations?: unknown[] } = {}) {
    const validated = layoutDocumentSchema.parse(document);
    const current = this.getLayout(document.projectId, document.viewId);
    this.transaction(() => {
      if (archive) {
      if (current) this.db.prepare("INSERT OR IGNORE INTO layout_history(project_id, view_id, revision, data) VALUES (?, ?, ?, ?)").run(current.projectId, current.viewId, current.layoutRevision, json(current));
      }
      this.db.prepare("INSERT INTO layout(project_id, view_id, revision, data) VALUES (?, ?, ?, ?) ON CONFLICT(project_id, view_id) DO UPDATE SET revision=excluded.revision, data=excluded.data").run(validated.projectId, validated.viewId, validated.layoutRevision, json(validated));
      if (!current || current.layoutRevision !== validated.layoutRevision) this.appendProjectEvent({
        projectId: validated.projectId, taskId: eventContext.taskId, canvasSessionId: eventContext.canvasSessionId,
        kind: "layout.changed", viewId: validated.viewId, layoutRevision: validated.layoutRevision,
        payload: { viewId: validated.viewId, fromRevision: current?.layoutRevision ?? 0, toRevision: validated.layoutRevision, operations: eventContext.operations ?? [], document: eventContext.operations?.length ? undefined : validated },
      });
    });
    return validated;
  }

  getAsset(assetId: string) {
    const row = this.db.prepare("SELECT data FROM asset WHERE id = ?").get(assetId) as any;
    return row ? assetSchema.parse(parse(row.data)) : null;
  }

  getAssetByHash(projectId: string, sha256: string) {
    const row = this.db.prepare("SELECT data FROM asset WHERE project_id = ? AND sha256 = ?").get(projectId, sha256) as any;
    return row ? assetSchema.parse(parse(row.data)) : null;
  }

  readAsset(assetId: string, thumbnail = false) {
    const asset = this.getAsset(assetId);
    if (!asset) throw new Error(`ASSET_NOT_FOUND:${assetId}`);
    const uri = thumbnail ? asset.thumbnailUri : asset.storageUri;
    const relative = uri.split("/files/")[1];
    if (!relative) throw new Error("ASSET_URI_INVALID");
    const target = resolve(this.dataDir, "assets", relative);
    if (!target.startsWith(resolve(this.dataDir, "assets"))) throw new Error("UNSAFE_ASSET_PATH");
    return { asset, data: readFileSync(target) };
  }

  async importImageAsset(input: { projectId: string; mimeType: Asset["mimeType"]; data: Uint8Array }) {
    if (!this.getProject(input.projectId)) throw new Error(`PROJECT_NOT_FOUND:${input.projectId}`);
    if (input.data.byteLength > 20 * 1024 * 1024) throw new Error("IMAGE_TOO_LARGE:Maximum image size is 20MB");
    const data = Buffer.from(input.data);
    const sha256 = createHash("sha256").update(data).digest("hex");
    const existing = this.getAssetByHash(input.projectId, sha256);
    if (existing) return { asset: existing, deduplicated: true };
    const image = sharp(data, { animated: false, limitInputPixels: 40_000_000 });
    const metadata = await image.metadata();
    const actualMime = ({ jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" } as const)[metadata.format as "jpeg" | "png" | "webp" | "gif"];
    if (!actualMime || actualMime !== input.mimeType) throw new Error("IMAGE_TYPE_MISMATCH:Only JPEG, PNG, WebP and GIF are supported");
    if (!metadata.width || !metadata.height) throw new Error("IMAGE_DIMENSIONS_MISSING");
    const id = randomUUID();
    const extension = actualMime === "image/jpeg" ? "jpg" : actualMime.split("/")[1];
    const originalName = `original/${sha256}.${extension}`;
    const thumbnailName = `thumbnails/${sha256}.webp`;
    writeFileSync(join(this.dataDir, "assets", originalName), data);
    const thumbnail = await sharp(data, { animated: false, limitInputPixels: 40_000_000 }).rotate().resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    writeFileSync(join(this.dataDir, "assets", thumbnailName), thumbnail);
    const asset = assetSchema.parse({
      id, projectId: input.projectId, kind: "image", mimeType: actualMime, size: data.byteLength, sha256,
      width: metadata.width, height: metadata.height,
      storageUri: `weaver://projects/${input.projectId}/assets/${id}/files/${originalName}`,
      thumbnailUri: `weaver://projects/${input.projectId}/assets/${id}/files/${thumbnailName}`,
      createdAt: now(),
    });
    this.db.prepare("INSERT INTO asset(id, project_id, sha256, data) VALUES (?, ?, ?, ?)").run(asset.id, asset.projectId, asset.sha256, json(asset));
    return { asset, deduplicated: false };
  }

  createContentNode(input: { projectId: string; viewId: string; type: string; title: string; content: NodeContent; x: number; y: number }) {
    const graph = this.getGraph(input.projectId);
    const layout = this.getLayout(input.projectId, input.viewId);
    if (!layout) throw new Error(`LAYOUT_NOT_FOUND:${input.viewId}`);
    if (input.content.kind === "image") {
      const asset = this.getAsset(input.content.assetId);
      if (!asset || asset.projectId !== input.projectId) throw new Error("ASSET_NOT_FOUND_OR_CROSS_PROJECT");
    }
    const timestamp = now();
    const node = nodeSchema.parse({ id: randomUUID(), projectId: input.projectId, type: input.type, title: input.title, body: input.content.kind === "document" ? input.content.markdown : "", contentKind: input.content.kind, content: nodeContentSchema.parse(input.content), properties: {}, archived: false, createdAt: timestamp, updatedAt: timestamp });
    this.replaceGraph(applyGraphOperations(graph, [{ type: "add-node", node }]));
    const frame = this.defaultNodeFrame(node, input.x, input.y);
    const nextLayout = structuredClone(layout);
    nextLayout.nodes[node.id] = frame;
    nextLayout.graphRevision = graph.revision + 1;
    nextLayout.layoutRevision += 1;
    nextLayout.updatedAt = timestamp;
    this.saveLayout(nextLayout);
    return { node, project: this.getProject(input.projectId), layout: nextLayout };
  }

  updateNodeContent(input: { projectId: string; nodeId: string; baseGraphRevision: number; title?: string; type?: string; content?: NodeContent }) {
    const graph = this.getGraph(input.projectId);
    if (graph.revision !== input.baseGraphRevision) throw new Error(`GRAPH_REVISION_CONFLICT:Expected ${input.baseGraphRevision}, current ${graph.revision}`);
    const current = graph.nodes.find((node) => node.id === input.nodeId);
    if (!current) throw new Error(`NODE_NOT_FOUND:${input.nodeId}`);
    const operations: Parameters<typeof applyGraphOperations>[1] = [];
    if (input.title !== undefined || input.type !== undefined) operations.push({ type: "update-node", nodeId: input.nodeId, patch: { title: input.title ?? current.title, type: input.type ?? current.type, updatedAt: now() } });
    if (input.content) {
      this.assertContentAssets(input.projectId, input.content);
      operations.push({ type: "set-node-content", nodeId: input.nodeId, content: nodeContentSchema.parse(input.content) });
    }
    if (!operations.length) return { node: current, project: this.getProject(input.projectId) };
    const next = applyGraphOperations(graph, operations);
    this.replaceGraph(next);
    return { node: next.nodes.find((node) => node.id === input.nodeId)!, project: this.getProject(input.projectId) };
  }

  attachAsset(input: { projectId: string; nodeId: string; assetId: string; role: "embedded" | "cover"; baseGraphRevision: number }) {
    const asset = this.getAsset(input.assetId);
    if (!asset || asset.projectId !== input.projectId) throw new Error("ASSET_NOT_FOUND_OR_CROSS_PROJECT");
    const graph = this.getGraph(input.projectId);
    if (graph.revision !== input.baseGraphRevision) throw new Error("GRAPH_REVISION_CONFLICT");
    const next = applyGraphOperations(graph, [{ type: "attach-asset", nodeId: input.nodeId, assetId: input.assetId, role: input.role }]);
    this.replaceGraph(next);
    return { node: next.nodes.find((node) => node.id === input.nodeId)!, project: this.getProject(input.projectId) };
  }

  private assertContentAssets(projectId: string, content: NodeContent) {
    const ids = content.kind === "image" ? [content.assetId] : content.kind === "document" ? [content.coverAssetId, ...content.embeddedAssetIds].filter(Boolean) as string[] : [content.imageAssetId].filter(Boolean) as string[];
    for (const id of ids) {
      const asset = this.getAsset(id);
      if (!asset || asset.projectId !== projectId) throw new Error(`ASSET_NOT_FOUND_OR_CROSS_PROJECT:${id}`);
    }
  }

  private defaultNodeFrame(node: SpaceNode, x: number, y: number) {
    let width = 280; let height = 160;
    if (node.content.kind === "document" && node.content.mode === "note") { width = 220; height = 112; }
    if (node.content.kind === "link") { width = 300; height = 180; }
    if (node.content.kind === "image") {
      const asset = this.getAsset(node.content.assetId)!;
      width = Math.max(180, Math.min(360, asset.width));
      height = Math.max(120, Math.min(300, width * asset.height / asset.width));
    }
    return { nodeId: node.id, x, y, width, height, rotation: 0, zIndex: 0, pinned: false, hidden: false, collapsed: false };
  }

  saveLayoutRun(input: { id?: string; projectId: string; viewId: string; taskId?: string; plan: unknown; candidates: LayoutCandidate[] }) {
    const id = input.id ?? randomUUID();
    const { id: _requestedId, ...runInput } = input;
    const data = { id, ...runInput, status: "preview", createdAt: now() };
    this.db.prepare("INSERT INTO layout_run(id, project_id, view_id, data) VALUES (?, ?, ?, ?)").run(id, input.projectId, input.viewId, json(data));
    return data;
  }

  getLayoutRun(id: string) {
    const row = this.db.prepare("SELECT data FROM layout_run WHERE id = ?").get(id) as any;
    return row ? parse<any>(row.data) : null;
  }

  applyLayoutCandidate(runId: string, candidateId: string) {
    const run = this.getLayoutRun(runId);
    if (!run) throw new Error(`LAYOUT_RUN_NOT_FOUND:${runId}`);
    const candidate = run.candidates.find((item: LayoutCandidate) => item.id === candidateId);
    if (!candidate) throw new Error(`LAYOUT_CANDIDATE_NOT_FOUND:${candidateId}`);
    if (candidate.metrics.hardViolations.length) throw new Error(`LAYOUT_HARD_VIOLATION:${candidate.metrics.hardViolations.join(",")}`);
    const current = this.getLayout(run.projectId, run.viewId);
    if (!current) throw new Error("LAYOUT_NOT_FOUND");
    if (current.layoutRevision !== run.plan.baseLayoutRevision) {
      if (run.taskId) this.updateAgentTask(run.taskId, { status: "stale", error: { code: "LAYOUT_REVISION_CONFLICT", message: `Expected layout r${run.plan.baseLayoutRevision}, current r${current.layoutRevision}` } });
      throw new Error("LAYOUT_REVISION_CONFLICT");
    }
    const next = { ...candidate.document, layoutRevision: current.layoutRevision + 1, graphRevision: this.getProject(run.projectId)?.graphRevision ?? candidate.document.graphRevision, updatedAt: now() };
    const task = run.taskId ? this.getAgentTask(run.taskId) : null;
    this.transaction(() => {
      this.saveLayout(next, true, { taskId: run.taskId, canvasSessionId: task?.canvasSessionId, operations: candidate.operations });
      run.status = "applied"; run.appliedCandidateId = candidateId; run.updatedAt = now();
      this.db.prepare("UPDATE layout_run SET data = ? WHERE id = ?").run(json(run), runId);
      if (run.taskId && task) this.updateAgentTask(run.taskId, { status: "completed", results: { ...task.results, layoutRunId: runId } });
    });
    return next;
  }

  rejectLayoutRun(runId: string) {
    const run = this.getLayoutRun(runId);
    if (!run) throw new Error(`LAYOUT_RUN_NOT_FOUND:${runId}`);
    if (run.status !== "preview") throw new Error(`LAYOUT_RUN_NOT_PENDING:${run.status}`);
    const task = run.taskId ? this.getAgentTask(run.taskId) : null;
    this.transaction(() => {
      run.status = "rejected"; run.updatedAt = now();
      this.db.prepare("UPDATE layout_run SET data = ? WHERE id = ?").run(json(run), runId);
      if (task) this.updateAgentTask(task.taskId, { status: "completed", results: { ...task.results, layoutRunId: runId } });
    });
    return run;
  }

  revertLayout(projectId: string, viewId: string) {
    const current = this.getLayout(projectId, viewId);
    if (!current) throw new Error("LAYOUT_NOT_FOUND");
    const row = this.db.prepare("SELECT data FROM layout_history WHERE project_id = ? AND view_id = ? ORDER BY revision DESC LIMIT 1").get(projectId, viewId) as any;
    if (!row) throw new Error("LAYOUT_HISTORY_EMPTY");
    const previous = layoutDocumentSchema.parse(parse(row.data));
    const restored = { ...previous, layoutRevision: current.layoutRevision + 1, updatedAt: now() };
    this.saveLayout(restored);
    return restored;
  }

  syncCanvasContext(snapshot: CanvasContextSnapshot) {
    const validated = canvasContextSnapshotSchema.parse(snapshot);
    const existing = this.db.prepare("SELECT sequence FROM canvas_session WHERE id = ?").get(validated.canvasSessionId) as any;
    if (existing && Number(existing.sequence) >= validated.sequence) throw new Error("STALE_CANVAS_SEQUENCE");
    this.db.prepare("INSERT INTO canvas_session(id, project_id, sequence, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET sequence=excluded.sequence, data=excluded.data").run(validated.canvasSessionId, validated.projectId, validated.sequence, json(validated));
    return validated;
  }

  getCanvasContext(sessionId: string) {
    const row = this.db.prepare("SELECT data FROM canvas_session WHERE id = ?").get(sessionId) as any;
    return row ? canvasContextSnapshotSchema.parse(parse(row.data)) : null;
  }

  resolveActiveCanvas(input: { canvasSessionId?: string; projectId?: string } = {}) {
    if (input.canvasSessionId) {
      const exact = this.getCanvasContext(input.canvasSessionId);
      if (!exact) throw new Error("NO_ACTIVE_CANVAS");
      if (input.projectId && exact.projectId !== input.projectId) throw new Error("CANVAS_PROJECT_MISMATCH");
      return exact;
    }
    const cutoff = Date.now() - 5 * 60_000;
    const contexts = (this.db.prepare("SELECT data FROM canvas_session ORDER BY json_extract(data, '$.updatedAt') DESC").all() as any[])
      .map((row) => canvasContextSnapshotSchema.parse(parse(row.data)))
      .filter((context) => !input.projectId || context.projectId === input.projectId)
      .filter((context) => Date.parse(context.presence?.lastSeenAt ?? context.updatedAt) >= cutoff);
    const focused = contexts.filter((context) => context.presence?.focused);
    const candidates = focused.length ? focused : contexts.filter((context) => context.presence?.visible !== false);
    if (!candidates.length) throw new Error("NO_ACTIVE_CANVAS");
    if (candidates.length > 1) throw new Error(`AMBIGUOUS_ACTIVE_CANVAS:${candidates.map((item) => item.projectId).join(",")}`);
    return candidates[0];
  }

  prepareAgentTask(input: { canvasSessionId: string; actionKey: string; userInstruction?: string }) {
    const context = this.getCanvasContext(input.canvasSessionId);
    if (!context) throw new Error(`CANVAS_SESSION_NOT_FOUND:${input.canvasSessionId}`);
    const timestamp = now();
    const intent = ["develop_selection", "layout_view", "develop_then_layout"].includes(input.actionKey) ? input.actionKey : input.actionKey === "layout_view" ? "layout_view" : "develop_selection";
    const task = agentTaskSchema.parse({
      taskId: randomUUID(), canvasSessionId: context.canvasSessionId, workspaceDir: context.workspaceDir, projectId: context.projectId,
      actionKey: input.actionKey, selectedNodeIds: context.selectedNodeIds, selectedEdgeIds: context.selectedEdgeIds,
      pinnedContextNodeIds: context.pinnedContextNodeIds, userInstruction: input.userInstruction, expectedGraphRevision: context.graphRevision,
      baseLayoutRevision: this.getLayout(context.projectId, context.viewId)?.layoutRevision ?? 0,
      contextResourceUri: `weaver://canvas-sessions/${context.canvasSessionId}/context`, attachmentResourceUris: [],
      intent, activeStage: intent === "layout_view" ? "layout" : "content", taskRevision: 0, results: {},
      status: "prepared", createdAt: timestamp, updatedAt: timestamp,
    });
    this.transaction(() => {
      this.db.prepare("INSERT INTO agent_task(id, project_id, data) VALUES (?, ?, ?)").run(task.taskId, task.projectId, json(task));
      this.appendProjectEvent({ projectId: task.projectId, canvasSessionId: task.canvasSessionId, taskId: task.taskId, kind: "task.updated", payload: task });
    });
    return task;
  }

  prepareAgentTaskFromActiveCanvas(input: { canvasSessionId?: string; projectId?: string; actionKey: string; userInstruction?: string }) {
    const context = this.resolveActiveCanvas(input);
    return this.prepareAgentTask({ canvasSessionId: context.canvasSessionId, actionKey: input.actionKey, userInstruction: input.userInstruction });
  }

  getAgentTask(taskId: string) {
    const row = this.db.prepare("SELECT data FROM agent_task WHERE id = ?").get(taskId) as any;
    return row ? agentTaskSchema.parse(parse(row.data)) : null;
  }

  listCanvasTasks(canvasSessionId: string, includeTerminal = false) {
    const terminal = new Set(["completed", "failed", "cancelled"]);
    return (this.db.prepare("SELECT data FROM agent_task WHERE json_extract(data, '$.canvasSessionId') = ? ORDER BY rowid DESC").all(canvasSessionId) as any[])
      .map((row) => agentTaskSchema.parse(parse(row.data)))
      .filter((task) => includeTerminal || !terminal.has(task.status));
  }

  listProjectTasks(projectId: string, includeTerminal = false) {
    const terminal = new Set(["completed", "failed", "cancelled"]);
    return (this.db.prepare("SELECT data FROM agent_task WHERE project_id = ? ORDER BY rowid DESC").all(projectId) as any[])
      .map((row) => agentTaskSchema.parse(parse(row.data)))
      .filter((task) => includeTerminal || !terminal.has(task.status));
  }

  updateAgentTask(taskId: string, patch: Partial<AgentTask>) {
    const current = this.getAgentTask(taskId);
    if (!current) throw new Error(`AGENT_TASK_NOT_FOUND:${taskId}`);
    const unchanged = Object.entries(patch).every(([key, value]) => json((current as any)[key]) === json(value));
    if (unchanged) return current;
    const next = agentTaskSchema.parse({ ...current, ...patch, taskRevision: current.taskRevision + 1, taskId: current.taskId, projectId: current.projectId, updatedAt: now() });
    this.transaction(() => {
      this.db.prepare("UPDATE agent_task SET data = ? WHERE id = ?").run(json(next), taskId);
      this.appendProjectEvent({ projectId: next.projectId, canvasSessionId: next.canvasSessionId, taskId, kind: "task.updated", payload: next });
    });
    return next;
  }

  submitChangeSet(changeSet: ChangeSet) {
    const validated = changeSetSchema.parse(changeSet);
    const project = this.getProject(validated.projectId);
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    const task = this.getAgentTask(validated.taskId);
    if (!task || task.projectId !== validated.projectId) throw new Error("AGENT_TASK_NOT_FOUND_OR_MISMATCH");
    if (project.graphRevision !== validated.baseGraphRevision) {
      this.updateAgentTask(task.taskId, { status: "stale", error: { code: "GRAPH_REVISION_CONFLICT", message: `Expected graph r${validated.baseGraphRevision}, current r${project.graphRevision}` } });
      throw new Error("GRAPH_REVISION_CONFLICT");
    }
    this.transaction(() => {
      this.db.prepare("INSERT INTO changeset(id, project_id, task_id, data) VALUES (?, ?, ?, ?)").run(validated.id, validated.projectId, validated.taskId, json(validated));
      this.updateAgentTask(validated.taskId, { status: "pending_review", results: { ...task.results, changeSetId: validated.id } });
    });
    return validated;
  }

  listChangeSets(projectId: string, status?: ChangeSet["status"]) {
    return this.db.prepare("SELECT data FROM changeset WHERE project_id = ? ORDER BY rowid DESC").all(projectId)
      .map((row: any) => changeSetSchema.parse(parse(row.data)))
      .filter((item) => !status || item.status === status);
  }

  getChangeSet(changeSetId: string) {
    const row = this.db.prepare("SELECT data FROM changeset WHERE id = ?").get(changeSetId) as any;
    return row ? changeSetSchema.parse(parse(row.data)) : null;
  }

  rejectChangeSet(changeSetId: string) {
    const current = this.getChangeSet(changeSetId);
    if (!current) throw new Error("CHANGESET_NOT_FOUND");
    if (current.status !== "pending") throw new Error(`CHANGESET_NOT_PENDING:${current.status}`);
    const rejected = { ...current, status: "rejected" as const, updatedAt: now() };
    this.transaction(() => {
      this.db.prepare("UPDATE changeset SET data = ? WHERE id = ?").run(json(rejected), changeSetId);
      this.updateAgentTask(current.taskId, { status: "completed" });
    });
    return rejected;
  }

  applyChangeSet(changeSetId: string) {
    const row = this.db.prepare("SELECT data FROM changeset WHERE id = ?").get(changeSetId) as any;
    if (!row) throw new Error("CHANGESET_NOT_FOUND");
    const changeSet = changeSetSchema.parse(parse(row.data));
    if (changeSet.status !== "pending") throw new Error(`CHANGESET_NOT_PENDING:${changeSet.status}`);
    const task = this.getAgentTask(changeSet.taskId);
    if (!task) throw new Error("AGENT_TASK_NOT_FOUND");
    const graph = this.getGraph(changeSet.projectId);
    if (graph.revision !== changeSet.baseGraphRevision) {
      this.updateAgentTask(changeSet.taskId, { status: "stale", error: { code: "GRAPH_REVISION_CONFLICT", message: `Expected graph r${changeSet.baseGraphRevision}, current r${graph.revision}` } });
      throw new Error("GRAPH_REVISION_CONFLICT");
    }
    for (const operation of changeSet.graphOperations) {
      if (operation.type === "add-node") this.assertContentAssets(changeSet.projectId, operation.node.content);
      if (operation.type === "set-node-content") this.assertContentAssets(changeSet.projectId, operation.content);
      if (operation.type === "attach-asset" || operation.type === "set-node-cover") {
        const assetId = operation.assetId;
        if (!assetId) continue;
        const asset = this.getAsset(assetId);
        if (!asset || asset.projectId !== changeSet.projectId) throw new Error(`ASSET_NOT_FOUND_OR_CROSS_PROJECT:${assetId}`);
      }
      if (operation.type === "update-node" && operation.patch.content) this.assertContentAssets(changeSet.projectId, nodeContentSchema.parse(operation.patch.content));
    }
    const nextGraph = changeSet.graphOperations.length ? applyGraphOperations(graph, changeSet.graphOperations) : graph;
    const byView = new Map<string, typeof changeSet.layoutOperations>();
    for (const operation of changeSet.layoutOperations) byView.set(operation.viewId, [...(byView.get(operation.viewId) ?? []), operation]);
    const addedNodes = nextGraph.nodes.filter((node) => !graph.nodes.some((current) => current.id === node.id));
    const context = this.getCanvasContext(task.canvasSessionId);
    if (addedNodes.length && context) {
      const activeLayout = this.getLayout(changeSet.projectId, context.viewId);
      if (!activeLayout) throw new Error(`LAYOUT_NOT_FOUND:${context.viewId}`);
      const existing = Object.values(activeLayout.nodes);
      const startX = existing.length ? Math.max(...existing.map((frame) => frame.x + frame.width)) + 72 : 0;
      const startY = existing.length ? Math.min(...existing.map((frame) => frame.y)) : 0;
      const placement = addedNodes.map((node, index) => ({
        type: "set-node-frame" as const, viewId: context.viewId, nodeId: node.id,
        frame: this.defaultNodeFrame(node, startX + (index % 3) * 300, startY + Math.floor(index / 3) * 190),
      }));
      byView.set(context.viewId, [...(byView.get(context.viewId) ?? []), ...placement]);
    }
    for (const [viewId] of byView) {
      const layout = this.getLayout(changeSet.projectId, viewId);
      if (!layout) throw new Error(`LAYOUT_NOT_FOUND:${viewId}`);
      const expected = changeSet.baseLayoutRevisions[viewId] ?? (context?.viewId === viewId ? task.baseLayoutRevision : undefined);
      if (expected === undefined || layout.layoutRevision !== expected) {
        this.updateAgentTask(changeSet.taskId, { status: "stale", error: { code: "LAYOUT_REVISION_CONFLICT", message: `Layout ${viewId} changed during review` } });
        throw new Error("LAYOUT_REVISION_CONFLICT");
      }
    }
    const applied = { ...changeSet, status: "applied" as const, updatedAt: now() };
    const layoutRevisions: Record<string, number> = {};
    this.transaction(() => {
      if (changeSet.graphOperations.length) this.replaceGraph(nextGraph, { taskId: task.taskId, canvasSessionId: task.canvasSessionId });
      for (const [viewId, operations] of byView) {
        const layout = structuredClone(this.getLayout(changeSet.projectId, viewId)!);
        for (const operation of operations) {
          if (operation.type !== "set-node-frame" || layout.nodes[operation.nodeId]) continue;
          if (!addedNodes.some((node) => node.id === operation.nodeId)) throw new Error(`LAYOUT_NODE_NOT_FOUND:${operation.nodeId}`);
          layout.nodes[operation.nodeId] = { nodeId: operation.nodeId, ...operation.frame, rotation: 0, zIndex: 0, pinned: false, hidden: false, collapsed: false };
        }
        const nextLayout = applyLayoutOperations(layout, operations);
        nextLayout.graphRevision = nextGraph.revision;
        this.saveLayout(nextLayout, true, { taskId: task.taskId, canvasSessionId: task.canvasSessionId, operations });
        layoutRevisions[viewId] = nextLayout.layoutRevision;
      }
      this.db.prepare("UPDATE changeset SET data = ? WHERE id = ?").run(json(applied), changeSetId);
      const mixed = task.intent === "develop_then_layout";
      this.updateAgentTask(changeSet.taskId, {
        status: mixed ? "ready_to_continue" : "completed",
        activeStage: mixed ? "layout" : task.activeStage,
        expectedGraphRevision: nextGraph.revision,
        results: { ...task.results, changeSetId },
      });
    });
    return { ...applied, graphRevision: nextGraph.revision, layoutRevisions, task: this.getAgentTask(changeSet.taskId) };
  }

  saveTaskAsset(taskId: string, fileName: string, data: Uint8Array) {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
    const target = join(this.dataDir, "assets", "tasks", taskId, safeName);
    mkdirSync(dirname(target), { recursive: true });
    if (!resolve(target).startsWith(resolve(this.dataDir))) throw new Error("UNSAFE_ASSET_PATH");
    writeFileSync(target, data);
    return { assetId: randomUUID(), path: target, resourceUri: `weaver://task-assets/${taskId}/${safeName}` };
  }

  publishArtifact(input: { projectId: string; type: string; title: string; content: unknown; sourceNodeIds: string[]; graphRevision: number }) {
    const project = this.getProject(input.projectId);
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    if (project.graphRevision !== input.graphRevision) throw new Error("GRAPH_REVISION_CONFLICT");
    const artifact = { id: randomUUID(), ...input, createdAt: now(), updatedAt: now() };
    this.db.prepare("INSERT INTO artifact(id, project_id, type, data) VALUES (?, ?, ?, ?)").run(artifact.id, artifact.projectId, artifact.type, json(artifact));
    return artifact;
  }

  getArtifact(artifactId: string) {
    const row = this.db.prepare("SELECT data FROM artifact WHERE id = ?").get(artifactId) as any;
    return row ? parse<any>(row.data) : null;
  }
}
