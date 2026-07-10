import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { canvasViewStateSchema, chatCanvasBindingSchema, layoutDocumentSchema, projectSchema, projectViewSchema, type CanvasViewState, type LayoutDocument, type ProjectView, type SpaceProject } from "@weaver/contracts";
import { friendlyViewName, json, now, parse, terminalTaskStatuses } from "./store-internal.js";
import { transaction } from "./migrations.js";
import { appendProjectEvent } from "./project-events.js";
import { getProject } from "./projects.js";
import { getLayout, saveLayout } from "./layout-templates.js";
import { listProjectTasks } from "./agent-tasks.js";
import { rejectTasks, saveChatCanvasBinding } from "./chat-canvas-binding.js";

export function listProjectViews(db: DatabaseSync, projectId: string, status?: ProjectView["status"]) {
  const rows = status
    ? db.prepare("SELECT data FROM project_view WHERE project_id = ? AND status = ?").all(projectId, status)
    : db.prepare("SELECT data FROM project_view WHERE project_id = ?").all(projectId);
  return (rows as any[]).map((row) => projectViewSchema.parse(parse(row.data))).sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    if (left.pinned && right.pinned) return (left.pinnedOrder ?? Number.MAX_SAFE_INTEGER) - (right.pinnedOrder ?? Number.MAX_SAFE_INTEGER);
    return Date.parse(right.lastOpenedAt) - Date.parse(left.lastOpenedAt) || left.name.localeCompare(right.name);
  });
}

export function getProjectView(db: DatabaseSync, projectId: string, viewId: string) {
  const row = db.prepare("SELECT data FROM project_view WHERE project_id = ? AND id = ?").get(projectId, viewId) as any;
  return row ? projectViewSchema.parse(parse(row.data)) : null;
}

export function putProjectView(db: DatabaseSync, view: ProjectView) {
  const validated = projectViewSchema.parse(view);
  db.prepare(`
    INSERT INTO project_view(id, project_id, status, pinned_order, data) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(project_id, id) DO UPDATE SET status=excluded.status, pinned_order=excluded.pinned_order, data=excluded.data
  `).run(validated.id, validated.projectId, validated.status, validated.pinnedOrder ?? null, json(validated));
  return validated;
}

export function bumpViewCatalog(db: DatabaseSync, projectId: string, input: { upsertedViews?: ProjectView[]; removedViewIds?: string[]; defaultViewId?: string }) {
  const project = getProject(db, projectId); if (!project) throw new Error("PROJECT_NOT_FOUND");
  const nextProject = projectSchema.parse({ ...project, defaultViewId: input.defaultViewId ?? project.defaultViewId, viewCatalogRevision: project.viewCatalogRevision + 1, updatedAt: now() });
  const delta = { projectId, fromRevision: project.viewCatalogRevision, toRevision: nextProject.viewCatalogRevision, upsertedViews: input.upsertedViews ?? [], removedViewIds: input.removedViewIds ?? [], defaultViewId: nextProject.defaultViewId };
  db.prepare("UPDATE project SET data = ? WHERE id = ?").run(json(nextProject), projectId);
  appendProjectEvent(db, { projectId, kind: "view.catalog.changed", payload: delta });
  return { project: nextProject, delta };
}

export function catalogViewFromLayout(db: DatabaseSync, layout: LayoutDocument, createdBy: ProjectView["createdBy"] = "user") {
  const existing = getProjectView(db, layout.projectId, layout.viewId);
  const project = getProject(db, layout.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND");
  const timestamp = now();
  const view = putProjectView(db, {
    id: layout.viewId, projectId: layout.projectId, name: friendlyViewName(layout), viewType: layout.viewType, templateRef: layout.templateRef,
    status: existing?.status ?? "active", pinned: existing?.pinned ?? layout.viewId === project.defaultViewId,
    pinnedOrder: existing?.pinnedOrder ?? (layout.viewId === project.defaultViewId ? 0 : undefined), createdBy: existing?.createdBy ?? createdBy,
    createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp, lastOpenedAt: existing?.lastOpenedAt ?? timestamp,
    trashedAt: existing?.trashedAt, purgeAfter: existing?.purgeAfter,
  });
  const bumped = bumpViewCatalog(db, layout.projectId, { upsertedViews: [view] });
  return { view, ...bumped };
}

export function assertCatalogRevision(project: SpaceProject, baseCatalogRevision: number) {
  if (project.viewCatalogRevision !== baseCatalogRevision) throw new Error("VIEW_CATALOG_REVISION_CONFLICT");
}

export function renameProjectView(db: DatabaseSync, input: { projectId: string; viewId: string; name: string; baseCatalogRevision: number }) {
  return transaction(db, () => {
    const project = getProject(db, input.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); assertCatalogRevision(project, input.baseCatalogRevision);
    const current = getProjectView(db, input.projectId, input.viewId); if (!current || current.status !== "active") throw new Error("VIEW_NOT_FOUND");
    const name = input.name.trim(); if (!name) throw new Error("VIEW_NAME_REQUIRED");
    const view = putProjectView(db, { ...current, name, updatedAt: now() });
    const layout = getLayout(db, input.projectId, input.viewId); if (layout) db.prepare("UPDATE layout SET data = ? WHERE project_id = ? AND view_id = ?").run(json({ ...layout, viewName: name }), input.projectId, input.viewId);
    return { view, ...bumpViewCatalog(db, input.projectId, { upsertedViews: [view] }) };
  });
}

export function pinProjectView(db: DatabaseSync, input: { projectId: string; viewId: string; pinned: boolean; baseCatalogRevision: number }) {
  return transaction(db, () => {
    const project = getProject(db, input.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); assertCatalogRevision(project, input.baseCatalogRevision);
    const current = getProjectView(db, input.projectId, input.viewId); if (!current || current.status !== "active") throw new Error("VIEW_NOT_FOUND");
    if (current.pinned === input.pinned) return { view: current, project, delta: { projectId: project.id, fromRevision: project.viewCatalogRevision, toRevision: project.viewCatalogRevision, upsertedViews: [], removedViewIds: [], defaultViewId: project.defaultViewId } };
    const nextOrder = input.pinned ? Math.max(-1, ...listProjectViews(db, input.projectId, "active").filter((view) => view.pinned).map((view) => view.pinnedOrder ?? -1)) + 1 : undefined;
    const view = putProjectView(db, { ...current, pinned: input.pinned, pinnedOrder: nextOrder, updatedAt: now() });
    return { view, ...bumpViewCatalog(db, input.projectId, { upsertedViews: [view] }) };
  });
}

export function reorderPinnedViews(db: DatabaseSync, input: { projectId: string; viewIds: string[]; baseCatalogRevision: number }) {
  return transaction(db, () => {
    const project = getProject(db, input.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); assertCatalogRevision(project, input.baseCatalogRevision);
    const pinned = listProjectViews(db, input.projectId, "active").filter((view) => view.pinned);
    if (new Set(input.viewIds).size !== input.viewIds.length || input.viewIds.length !== pinned.length || pinned.some((view) => !input.viewIds.includes(view.id))) throw new Error("PINNED_VIEW_ORDER_INVALID");
    const views = input.viewIds.map((viewId, index) => putProjectView(db, { ...pinned.find((view) => view.id === viewId)!, pinnedOrder: index, updatedAt: now() }));
    return { views, ...bumpViewCatalog(db, input.projectId, { upsertedViews: views }) };
  });
}

export function setDefaultProjectView(db: DatabaseSync, input: { projectId: string; viewId: string; baseCatalogRevision: number }) {
  return transaction(db, () => {
    const project = getProject(db, input.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); assertCatalogRevision(project, input.baseCatalogRevision);
    const view = getProjectView(db, input.projectId, input.viewId); if (!view || view.status !== "active") throw new Error("VIEW_NOT_FOUND");
    if (project.defaultViewId === input.viewId) return { view, project, delta: { projectId: project.id, fromRevision: project.viewCatalogRevision, toRevision: project.viewCatalogRevision, upsertedViews: [], removedViewIds: [], defaultViewId: project.defaultViewId } };
    return { view, ...bumpViewCatalog(db, input.projectId, { defaultViewId: input.viewId }) };
  });
}

export function searchProjectViews(db: DatabaseSync, projectId: string, query: string, status: ProjectView["status"] = "active") {
  const normalized = query.trim().toLocaleLowerCase();
  return listProjectViews(db, projectId, status).filter((view) => !normalized || `${view.name} ${view.viewType} ${view.templateRef?.id ?? ""}`.toLocaleLowerCase().includes(normalized));
}

export function trashProjectView(db: DatabaseSync, input: { projectId: string; viewId: string; fallbackViewId?: string; baseCatalogRevision: number }) {
  return transaction(db, () => {
    const project = getProject(db, input.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); assertCatalogRevision(project, input.baseCatalogRevision);
    const current = getProjectView(db, input.projectId, input.viewId); if (!current || current.status !== "active") throw new Error("VIEW_NOT_FOUND");
    const active = listProjectViews(db, input.projectId, "active"); if (active.length <= 1) throw new Error("LAST_ACTIVE_VIEW");
    const fallback = (input.fallbackViewId ? active.find((view) => view.id === input.fallbackViewId) : undefined) ?? active.find((view) => view.id !== input.viewId);
    if (!fallback || fallback.id === input.viewId) throw new Error("VIEW_FALLBACK_REQUIRED");
    const timestamp = now(); const purgeAfter = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();
    const view = putProjectView(db, { ...current, status: "trashed", pinned: false, pinnedOrder: undefined, trashedAt: timestamp, purgeAfter, updatedAt: timestamp });
    const tasks = listProjectTasks(db, input.projectId, true).filter((task) => task.viewId === input.viewId && !terminalTaskStatuses.has(task.status));
    rejectTasks(db, tasks, "VIEW_TRASHED", "The task View was moved to the recycle bin");
    const bindingRows = db.prepare("SELECT data FROM chat_canvas_binding").all() as any[];
    for (const row of bindingRows) {
      const binding = chatCanvasBindingSchema.parse(parse(row.data));
      if (binding.projectId !== input.projectId || binding.viewId !== input.viewId) continue;
      const next = saveChatCanvasBinding(db, { ...binding, viewId: fallback.id, canvasSessionId: undefined, bindingRevision: binding.bindingRevision + 1, status: "opening", lastSeenAt: timestamp });
      appendProjectEvent(db, { projectId: input.projectId, canvasSessionId: binding.canvasSessionId, kind: "chat.binding.changed", payload: { bindingRevision: next.bindingRevision, status: "detached", fallbackViewId: fallback.id, reason: "VIEW_TRASHED" } });
    }
    return { view, fallbackView: fallback, ...bumpViewCatalog(db, input.projectId, { upsertedViews: [view], defaultViewId: project.defaultViewId === input.viewId ? fallback.id : project.defaultViewId }) };
  });
}

export function restoreProjectView(db: DatabaseSync, input: { projectId: string; viewId: string; baseCatalogRevision: number }) {
  return transaction(db, () => {
    const project = getProject(db, input.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); assertCatalogRevision(project, input.baseCatalogRevision);
    const current = getProjectView(db, input.projectId, input.viewId); if (!current || current.status !== "trashed") throw new Error("VIEW_NOT_TRASHED");
    const view = putProjectView(db, { ...current, status: "active", trashedAt: undefined, purgeAfter: undefined, updatedAt: now() });
    return { view, ...bumpViewCatalog(db, input.projectId, { upsertedViews: [view] }) };
  });
}

export function purgeProjectView(db: DatabaseSync, input: { projectId: string; viewId: string; baseCatalogRevision: number }) {
  return transaction(db, () => {
    const project = getProject(db, input.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); assertCatalogRevision(project, input.baseCatalogRevision);
    const current = getProjectView(db, input.projectId, input.viewId); if (!current || current.status !== "trashed") throw new Error("VIEW_NOT_TRASHED");
    db.prepare("DELETE FROM project_view WHERE project_id = ? AND id = ?").run(input.projectId, input.viewId);
    db.prepare("DELETE FROM layout WHERE project_id = ? AND view_id = ?").run(input.projectId, input.viewId);
    db.prepare("DELETE FROM layout_history WHERE project_id = ? AND view_id = ?").run(input.projectId, input.viewId);
    db.prepare("DELETE FROM layout_run WHERE project_id = ? AND view_id = ?").run(input.projectId, input.viewId);
    db.prepare("DELETE FROM canvas_view_state WHERE view_id = ?").run(input.viewId);
    return { view: current, ...bumpViewCatalog(db, input.projectId, { removedViewIds: [input.viewId] }) };
  });
}

export function duplicateProjectView(db: DatabaseSync, input: { projectId: string; viewId: string; name?: string; baseCatalogRevision: number }) {
  return transaction(db, () => {
    const project = getProject(db, input.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND"); assertCatalogRevision(project, input.baseCatalogRevision);
    const sourceView = getProjectView(db, input.projectId, input.viewId); if (!sourceView || sourceView.status !== "active") throw new Error("VIEW_NOT_FOUND");
    const source = getLayout(db, input.projectId, input.viewId); if (!source) throw new Error("LAYOUT_NOT_FOUND");
    const viewId = `${source.viewType}-${randomUUID().slice(0, 8)}`; const name = input.name?.trim() || `${sourceView.name} copy`;
    const layout = layoutDocumentSchema.parse({ ...source, viewId, viewName: name, layoutRevision: 1, createdBy: "user", updatedAt: now() });
    saveLayout(db, layout, false);
    const catalog = catalogViewFromLayout(db, layout, "user");
    return { layout, ...catalog };
  });
}

export function saveCanvasViewState(db: DatabaseSync, input: CanvasViewState) {
  const state = canvasViewStateSchema.parse(input);
  db.prepare("INSERT INTO canvas_view_state(canvas_session_id, view_id, data) VALUES (?, ?, ?) ON CONFLICT(canvas_session_id, view_id) DO UPDATE SET data=excluded.data").run(state.canvasSessionId, state.viewId, json(state));
  return state;
}

export function getCanvasViewState(db: DatabaseSync, canvasSessionId: string, viewId: string) {
  const row = db.prepare("SELECT data FROM canvas_view_state WHERE canvas_session_id = ? AND view_id = ?").get(canvasSessionId, viewId) as any;
  return row ? canvasViewStateSchema.parse(parse(row.data)) : null;
}
