import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { chatCanvasBindingSchema, nodeSchema, projectSchema, type LayoutDocument, type ScenePack, type SpaceProject } from "@weaver/contracts";
import { defaultLayout, json, now, parse } from "./store-internal.js";
import { transaction } from "./migrations.js";
import { getGraph, replaceGraph } from "./graph.js";
import { getLayout, saveLayout } from "./layout-templates.js";
import { catalogViewFromLayout } from "./view-catalog.js";
import { getChatCanvasBinding, openChatCanvasBinding } from "./chat-canvas-binding.js";

export function listProjects(db: DatabaseSync): SpaceProject[] {
  return db.prepare("SELECT data FROM project ORDER BY json_extract(data, '$.updatedAt') DESC").all().map((row: any) => projectSchema.parse(parse(row.data)));
}

export function getProject(db: DatabaseSync, projectId: string) {
  const row = db.prepare("SELECT data FROM project WHERE id = ?").get(projectId) as any;
  return row ? projectSchema.parse(parse(row.data)) : null;
}

export function patchProject(db: DatabaseSync, projectId: string, patch: Partial<SpaceProject>) {
  const current = getProject(db, projectId);
  if (!current) throw new Error(`PROJECT_NOT_FOUND:${projectId}`);
  const next = projectSchema.parse({ ...current, ...patch, id: current.id, createdAt: current.createdAt, updatedAt: now() });
  db.prepare("UPDATE project SET data = ? WHERE id = ?").run(json(next), projectId);
  return next;
}

export function createProject(db: DatabaseSync, dataDir: string, input: { title: string; goal: string; scenePack: ScenePack; automationLevel?: SpaceProject["automationLevel"]; createdFromTemplate?: { id: string; version: string }; writeSnapshots?: boolean }) {
  const timestamp = now();
  const project = projectSchema.parse({
    id: randomUUID(), title: input.title, goal: input.goal, scenePackId: input.scenePack.id, scenePackVersion: input.scenePack.version,
    automationLevel: input.automationLevel ?? "collaborative", defaultViewId: `${input.scenePack.defaultView}-default`, graphRevision: 0, createdAt: timestamp, updatedAt: timestamp,
    createdFromTemplate: input.createdFromTemplate,
  });
  db.prepare("INSERT INTO project(id, data) VALUES (?, ?)").run(project.id, json(project));
  const layout = defaultLayout(project, project.defaultViewId, input.scenePack.defaultView, input.scenePack.defaultStrategy as LayoutDocument["strategy"]);
  transaction(db, () => { saveLayout(db, layout, false); catalogViewFromLayout(db, layout); });
  const created = getProject(db, project.id)!;
  if (input.writeSnapshots !== false) writeProjectSnapshots(dataDir, created, input.scenePack);
  return created;
}

export function createSeededProject(db: DatabaseSync, dataDir: string, input: { title: string; goal: string; scenePack: ScenePack; automationLevel?: SpaceProject["automationLevel"]; chatSessionKey?: string }) {
  let project!: SpaceProject;
  transaction(db, () => {
    project = createProject(db, dataDir, { title: input.title, goal: input.goal, scenePack: input.scenePack, automationLevel: input.automationLevel, writeSnapshots: false });
    const timestamp = now();
    const markdown = project.goal || project.title;
    const root = nodeSchema.parse({ id: randomUUID(), projectId: project.id, type: input.scenePack.nodeTypes[0].key, title: markdown, content: { kind: "document", mode: "note", markdown, excerpt: markdown, embeddedAssetIds: [] }, properties: {}, archived: false, createdAt: timestamp, updatedAt: timestamp });
    replaceGraph(db, { projectId: project.id, revision: 1, nodes: [root], edges: [] });
    project = getProject(db, project.id)!;
    const layout = getLayout(db, project.id, project.defaultViewId)!;
    layout.graphRevision = 1;
    layout.nodes[root.id] = { nodeId: root.id, x: 0, y: 0, width: input.scenePack.nodeTypes[0].defaultWidth, height: input.scenePack.nodeTypes[0].defaultHeight, rotation: 0, zIndex: 0, pinned: false, hidden: false, collapsed: false };
    layout.bounds = { x: 0, y: 0, width: input.scenePack.nodeTypes[0].defaultWidth, height: input.scenePack.nodeTypes[0].defaultHeight };
    saveLayout(db, layout, false);
    if (input.chatSessionKey) openChatCanvasBinding(db, { chatSessionKey: input.chatSessionKey, projectId: project.id, viewId: project.defaultViewId });
  });
  writeProjectSnapshots(dataDir, project, input.scenePack);
  return { project, graph: getGraph(db, project.id), layout: getLayout(db, project.id, project.defaultViewId)!, binding: input.chatSessionKey ? getChatCanvasBinding(db, input.chatSessionKey) : undefined };
}

export function writeProjectSnapshots(dataDir: string, project: SpaceProject, scenePack: ScenePack) {
  writeFileSync(join(dataDir, "scene-pack.snapshot.json"), `${JSON.stringify(scenePack, null, 2)}\n`, "utf8");
  writeFileSync(join(dataDir, "project.json"), `${JSON.stringify(project, null, 2)}\n`, "utf8");
}

export function deletePristineProject(db: DatabaseSync, input: { projectId: string; creationMutationId: string }) {
  return transaction(db, () => {
    const project = getProject(db, input.projectId);
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    const laterMutation = db.prepare("SELECT 1 FROM canvas_mutation WHERE project_id = ? AND id <> ? LIMIT 1").get(input.projectId, input.creationMutationId);
    const externalStateTables = ["asset", "agent_task", "changeset", "artifact", "layout_run"];
    if (laterMutation || externalStateTables.some((table) => Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE project_id = ?`).get(input.projectId) as { count: number }).count) > 0)) {
      throw new Error("UNDO_REVISION_CONFLICT");
    }
    const viewIds = (db.prepare("SELECT id FROM project_view WHERE project_id = ?").all(input.projectId) as Array<{ id: string }>).map((row) => row.id);
    for (const viewId of viewIds) db.prepare("DELETE FROM canvas_view_state WHERE view_id = ?").run(viewId);
    const bindings = db.prepare("SELECT chat_session_key, data FROM chat_canvas_binding").all() as Array<{ chat_session_key: string; data: string }>;
    for (const row of bindings) {
      if (chatCanvasBindingSchema.parse(JSON.parse(row.data)).projectId === input.projectId) db.prepare("DELETE FROM chat_canvas_binding WHERE chat_session_key = ?").run(row.chat_session_key);
    }
    for (const table of ["project_event", "changeset_revert", "changeset", "agent_task", "artifact", "asset", "canvas_session", "project_view", "layout_history", "layout", "edge", "node", "project_write_lease"]) {
      db.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(input.projectId);
    }
    db.prepare("DELETE FROM project WHERE id = ?").run(input.projectId);
    return { deleted: true, projectId: input.projectId };
  });
}
