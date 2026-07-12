import { useEffect, useMemo, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { callTool, isLocalDevelopment } from "../mcp-client";
import { applyViewCatalogDelta, selectSwitcherViews } from "../sync";
import type { Bootstrap, ChatBindingBootstrap, Layout, Project, ProjectView } from "../types";

type CatalogActionResult = { project: Project; view: ProjectView; delta: { fromRevision: number; toRevision: number; upsertedViews: ProjectView[]; removedViewIds: string[]; defaultViewId?: string }; binding?: ChatBindingBootstrap; fallbackView: ProjectView };

// Domain E: view catalog / view library / view switcher.
export function useViewCatalog(params: {
  standaloneDemo: boolean;
  bootstrap: Bootstrap;
  project: Project | null;
  layout: Layout | null;
  projectRef: MutableRefObject<Project | null>;
  setProject: Dispatch<SetStateAction<Project | null>>;
  setStatus: Dispatch<SetStateAction<string>>;
  ensureBindingTarget: (projectId: string, viewId: string) => Promise<ChatBindingBootstrap | undefined>;
  bindingRef: MutableRefObject<ChatBindingBootstrap | undefined>;
  setBootstrap: Dispatch<SetStateAction<Bootstrap>>;
  load: () => Promise<void>;
  activeViewId: string;
  setActiveViewId: Dispatch<SetStateAction<string>>;
  projectViews: ProjectView[];
  setProjectViews: Dispatch<SetStateAction<ProjectView[]>>;
  projectViewsRef: MutableRefObject<ProjectView[]>;
  viewToast: { message: string; undoViewId?: string } | null;
  setViewToast: Dispatch<SetStateAction<{ message: string; undoViewId?: string } | null>>;
  resetLayoutRun: () => void;
  saveStateRef: MutableRefObject<"saved" | "dirty" | "saving" | "conflict">;
  saveDocument: () => Promise<boolean>;
  syncContext: () => Promise<boolean | undefined>;
  setSelection: Dispatch<SetStateAction<string[]>>;
}) {
  const { standaloneDemo, bootstrap, project, layout, projectRef, setProject, setStatus, ensureBindingTarget, bindingRef, setBootstrap, load, activeViewId, setActiveViewId, projectViews, setProjectViews, projectViewsRef, viewToast, setViewToast, resetLayoutRun, saveStateRef, saveDocument, syncContext, setSelection } = params;

  const [viewLibrary, setViewLibrary] = useState(false);
  const [viewQuery, setViewQuery] = useState("");
  const [viewMenuId, setViewMenuId] = useState<string | null>(null);
  const [renamingViewId, setRenamingViewId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [purgeConfirmId, setPurgeConfirmId] = useState<string | null>(null);
  const [draggedViewId, setDraggedViewId] = useState<string | null>(null);

  useEffect(() => { projectViewsRef.current = projectViews; }, [projectViews, projectViewsRef]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "v" && project) { event.preventDefault(); setViewLibrary(true); requestAnimationFrame(() => document.querySelector<HTMLInputElement>("#view-library-search")?.focus()); }
      if (event.key === "Escape") { setViewLibrary(false); setViewMenuId(null); }
    };
    window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown);
  }, [project]);

  useEffect(() => { if (!viewToast) return; const timer = window.setTimeout(() => setViewToast(null), 6_000); return () => window.clearTimeout(timer); }, [viewToast, setViewToast]);

  function catalogLeaseArgs() { const binding = bindingRef.current; return !isLocalDevelopment && binding ? { leaseId: binding.leaseId, bindingRevision: binding.bindingRevision } : {}; }

  function applyCatalogResult(output: { project: Project; delta: { fromRevision: number; toRevision: number; upsertedViews: ProjectView[]; removedViewIds: string[]; defaultViewId?: string } }) {
    const currentProject = projectRef.current; if (!currentProject) return;
    if (output.delta.toRevision <= currentProject.viewCatalogRevision) return;
    try {
      const next = applyViewCatalogDelta({ revision: currentProject.viewCatalogRevision, views: projectViewsRef.current, defaultViewId: currentProject.defaultViewId }, output.delta);
      projectViewsRef.current = next.views; setProjectViews(next.views);
      const nextProject = { ...currentProject, ...output.project, defaultViewId: next.defaultViewId, viewCatalogRevision: next.revision }; projectRef.current = nextProject; setProject(nextProject);
    } catch { void load(); }
  }

  async function renameProjectView(viewId: string) {
    if (!project || !renameValue.trim()) return;
    try { const output = await callTool<CatalogActionResult>("weaver_catalog_action", { action: "rename_view", workspaceDir: bootstrap.workspaceDir, projectId: project.id, viewId, name: renameValue.trim(), baseCatalogRevision: project.viewCatalogRevision, ...catalogLeaseArgs() }); applyCatalogResult(output); setRenamingViewId(null); setViewMenuId(null); setStatus(`Renamed View to ${output.view.name}`); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  }

  async function pinProjectView(view: ProjectView) {
    if (!project) return;
    try { const output = await callTool<CatalogActionResult>("weaver_catalog_action", { action: "pin_view", workspaceDir: bootstrap.workspaceDir, projectId: project.id, viewId: view.id, pinned: !view.pinned, baseCatalogRevision: project.viewCatalogRevision, ...catalogLeaseArgs() }); applyCatalogResult(output); setViewMenuId(null); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  }

  async function setDefaultView(view: ProjectView) {
    if (!project) return;
    try { const output = await callTool<CatalogActionResult>("weaver_catalog_action", { action: "set_default_view", workspaceDir: bootstrap.workspaceDir, projectId: project.id, viewId: view.id, baseCatalogRevision: project.viewCatalogRevision, ...catalogLeaseArgs() }); applyCatalogResult(output); setViewMenuId(null); setStatus(`${view.name} is now the default View`); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  }

  async function reorderPinnedViews(targetViewId: string) {
    if (!project || !draggedViewId || draggedViewId === targetViewId) return;
    const ordered = fixedCatalogViews.map((view) => view.id); const from = ordered.indexOf(draggedViewId); const to = ordered.indexOf(targetViewId);
    if (from < 0 || to < 0) return;
    ordered.splice(to, 0, ordered.splice(from, 1)[0]);
    try { const output = await callTool<CatalogActionResult>("weaver_catalog_action", { action: "reorder_views", workspaceDir: bootstrap.workspaceDir, projectId: project.id, viewIds: ordered, baseCatalogRevision: project.viewCatalogRevision, ...catalogLeaseArgs() }); applyCatalogResult(output); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setDraggedViewId(null); }
  }

  async function trashProjectView(view: ProjectView) {
    if (!project) return;
    try {
      const fallback = projectViews.find((candidate) => candidate.status === "active" && candidate.id !== view.id);
      const output = await callTool<CatalogActionResult>("weaver_catalog_action", { action: "trash_view", workspaceDir: bootstrap.workspaceDir, projectId: project.id, viewId: view.id, fallbackViewId: fallback?.id, baseCatalogRevision: project.viewCatalogRevision, ...catalogLeaseArgs() });
      if (output.binding) { bindingRef.current = output.binding; setBootstrap((current) => ({ ...current, chatBinding: output.binding })); }
      applyCatalogResult(output); setViewMenuId(null); setViewToast({ message: `Moved "${view.name}" to Recycle Bin`, undoViewId: view.id });
      if (layout?.viewId === view.id) { resetLayoutRun(); setActiveViewId(output.fallbackView.id); }
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  }

  async function restoreProjectView(viewId: string) {
    const currentProject = projectRef.current; if (!currentProject) return;
    try { const output = await callTool<CatalogActionResult>("weaver_catalog_action", { action: "restore_view", workspaceDir: bootstrap.workspaceDir, projectId: currentProject.id, viewId, baseCatalogRevision: currentProject.viewCatalogRevision, ...catalogLeaseArgs() }); applyCatalogResult(output); setViewToast({ message: `Restored "${output.view.name}"` }); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  }

  async function purgeProjectView(view: ProjectView) {
    if (!project) return;
    if (purgeConfirmId !== view.id) { setPurgeConfirmId(view.id); return; }
    try { const output = await callTool<CatalogActionResult>("weaver_catalog_action", { action: "purge_view", workspaceDir: bootstrap.workspaceDir, projectId: project.id, viewId: view.id, baseCatalogRevision: project.viewCatalogRevision, ...catalogLeaseArgs() }); applyCatalogResult(output); setPurgeConfirmId(null); setViewToast({ message: `Permanently deleted "${view.name}"` }); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  }

  async function duplicateProjectView(view: ProjectView) {
    if (!project) return;
    try { const output = await callTool<CatalogActionResult>("weaver_catalog_action", { action: "duplicate_view", workspaceDir: bootstrap.workspaceDir, projectId: project.id, viewId: view.id, name: `${view.name} copy`, baseCatalogRevision: project.viewCatalogRevision, ...catalogLeaseArgs() }); applyCatalogResult(output); setViewMenuId(null); await switchView(output.view.id); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  }

  async function switchView(viewId: string) {
    if (viewId === layout?.viewId) { setViewLibrary(false); return; }
    if (standaloneDemo) { setStatus(`Development preview · ${viewId}`); setViewLibrary(false); return; }
    if (!project) return;
    try {
      if (saveStateRef.current === "dirty" || saveStateRef.current === "conflict") { const saved = await saveDocument(); if (!saved) return; }
      await syncContext(); await ensureBindingTarget(project.id, viewId);
      const openedAt = new Date().toISOString(); setProjectViews((current) => current.map((view) => view.id === viewId ? { ...view, lastOpenedAt: openedAt } : view));
      resetLayoutRun(); setSelection([]); setActiveViewId(viewId); setViewLibrary(false);
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  }

  function beginRename(view: ProjectView) { setRenamingViewId(view.id); setRenameValue(view.name); setViewMenuId(null); setViewLibrary(true); requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-rename-view="${view.id}"]`)?.focus()); }

  const switcherViews = useMemo(() => selectSwitcherViews(projectViews, layout?.viewId ?? activeViewId), [activeViewId, layout?.viewId, projectViews]);
  const activeCatalogViews = useMemo(() => projectViews.filter((view) => view.status === "active" && (!viewQuery.trim() || `${view.name} ${view.viewType} ${view.templateRef?.id ?? ""}`.toLowerCase().includes(viewQuery.toLowerCase()))), [projectViews, viewQuery]);
  const trashedCatalogViews = useMemo(() => projectViews.filter((view) => view.status === "trashed" && (!viewQuery.trim() || view.name.toLowerCase().includes(viewQuery.toLowerCase()))), [projectViews, viewQuery]);
  const fixedCatalogViews = useMemo(() => activeCatalogViews.filter((view) => view.pinned).sort((left, right) => (left.pinnedOrder ?? 999) - (right.pinnedOrder ?? 999)), [activeCatalogViews]);
  const recentCatalogViews = useMemo(() => [...activeCatalogViews].sort((left, right) => Date.parse(right.lastOpenedAt) - Date.parse(left.lastOpenedAt)).slice(0, 5), [activeCatalogViews]);

  return {
    viewLibrary, setViewLibrary, viewQuery, setViewQuery, viewMenuId, setViewMenuId, renamingViewId, setRenamingViewId, renameValue, setRenameValue, purgeConfirmId, draggedViewId, setDraggedViewId,
    switcherViews, activeCatalogViews, trashedCatalogViews, fixedCatalogViews, recentCatalogViews,
    renameProjectView, pinProjectView, setDefaultView, reorderPinnedViews, trashProjectView, restoreProjectView, purgeProjectView, duplicateProjectView, switchView, beginRename,
  };
}
