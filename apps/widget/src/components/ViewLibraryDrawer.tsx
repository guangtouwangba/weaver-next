import { Copy, Home, MoreHorizontal, PanelLeftClose, Pencil, Pin as PinIcon, Plus, Search, Trash2, Undo2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { Layout, Project, ProjectView } from "../types";

export type ViewRowActions = {
  project: Project | null;
  projectViews: ProjectView[];
  beginRename: (view: ProjectView) => void;
  pinProjectView: (view: ProjectView) => void | Promise<void>;
  duplicateProjectView: (view: ProjectView) => void | Promise<void>;
  setDefaultView: (view: ProjectView) => void | Promise<void>;
  trashProjectView: (view: ProjectView) => void | Promise<void>;
};

export function ViewActionsMenu({ view, project, projectViews, beginRename, pinProjectView, duplicateProjectView, setDefaultView, trashProjectView }: { view: ProjectView } & ViewRowActions) {
  return <div className="view-action-menu" role="menu" onClick={(event) => event.stopPropagation()}>
    <button onClick={() => beginRename(view)}><Pencil size={13} /> Rename</button>
    <button onClick={() => void pinProjectView(view)}><PinIcon size={13} /> {view.pinned ? "Unpin" : "Pin to top"}</button>
    <button onClick={() => void duplicateProjectView(view)}><Copy size={13} /> Duplicate</button>
    <button onClick={() => void setDefaultView(view)} disabled={project?.defaultViewId === view.id}><Home size={13} /> {project?.defaultViewId === view.id ? "Default View" : "Set as default"}</button>
    <button className="danger" onClick={() => void trashProjectView(view)} disabled={projectViews.filter((candidate) => candidate.status === "active").length <= 1}><Trash2 size={13} /> Move to Recycle Bin</button>
  </div>;
}

export function ViewLibraryRow({ view, options = {}, layout, project, projectViews, purgeConfirmId, renamingViewId, renameValue, setRenameValue, setRenamingViewId, viewMenuId, setViewMenuId, switchView, restoreProjectView, purgeProjectView, renameProjectView, beginRename, pinProjectView, duplicateProjectView, setDefaultView, trashProjectView }: {
  view: ProjectView;
  options?: { compact?: boolean };
  layout: Layout | null;
  purgeConfirmId: string | null;
  renamingViewId: string | null;
  renameValue: string;
  setRenameValue: Dispatch<SetStateAction<string>>;
  setRenamingViewId: Dispatch<SetStateAction<string | null>>;
  viewMenuId: string | null;
  setViewMenuId: Dispatch<SetStateAction<string | null>>;
  switchView: (viewId: string) => void | Promise<void>;
  restoreProjectView: (viewId: string) => void | Promise<void>;
  purgeProjectView: (view: ProjectView) => void | Promise<void>;
  renameProjectView: (viewId: string) => void | Promise<void>;
} & ViewRowActions) {
  const current = layout?.viewId === view.id;
  if (view.status === "trashed") return <div className="view-library-row trashed" key={`trash-${view.id}`}>
    <div className="view-miniature" data-type={view.viewType}><span /><span /><span /></div>
    <div className="view-row-copy"><strong>{view.name}</strong><small>{view.viewType} · deletes {view.purgeAfter ? new Date(view.purgeAfter).toLocaleDateString() : "in 30 days"}</small></div>
    <div className="view-row-actions"><button onClick={() => void restoreProjectView(view.id)}><Undo2 size={14} /> Restore</button><button className="danger" onClick={() => void purgeProjectView(view)}><Trash2 size={14} /> {purgeConfirmId === view.id ? "Confirm delete" : "Delete forever"}</button></div>
  </div>;
  return <div className="view-library-row" data-current={current} key={`${options.compact ? "compact" : "all"}-${view.id}`} onClick={() => void switchView(view.id)}>
    <div className="view-miniature" data-type={view.viewType}><span /><span /><span /></div>
    <div className="view-row-copy">{renamingViewId === view.id ? <input data-rename-view={view.id} value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Enter") void renameProjectView(view.id); if (event.key === "Escape") setRenamingViewId(null); }} onBlur={() => renameValue.trim() && renameValue !== view.name ? void renameProjectView(view.id) : setRenamingViewId(null)} /> : <><strong>{view.name}{project?.defaultViewId === view.id ? <Home size={11} /> : null}</strong><small>{view.viewType}{view.templateRef ? ` · ${view.templateRef.id}` : ""}{typeof view.nodeCount === "number" ? ` · ${view.nodeCount} nodes` : ""}</small></>}</div>
    <div className="view-row-actions" onClick={(event) => event.stopPropagation()}><button aria-label={view.pinned ? `Unpin ${view.name}` : `Pin ${view.name}`} onClick={() => void pinProjectView(view)}><PinIcon size={14} fill={view.pinned ? "currentColor" : "none"} /></button><button aria-label={`More actions for ${view.name}`} onClick={() => setViewMenuId(viewMenuId === view.id ? null : view.id)}><MoreHorizontal size={16} /></button>{viewMenuId === view.id ? <ViewActionsMenu view={view} project={project} projectViews={projectViews} beginRename={beginRename} pinProjectView={pinProjectView} duplicateProjectView={duplicateProjectView} setDefaultView={setDefaultView} trashProjectView={trashProjectView} /> : null}</div>
  </div>;
}

export function ViewLibraryDrawer(props: {
  viewLibrary: boolean;
  setViewLibrary: Dispatch<SetStateAction<boolean>>;
  viewQuery: string;
  setViewQuery: Dispatch<SetStateAction<string>>;
  fixedCatalogViews: ProjectView[];
  recentCatalogViews: ProjectView[];
  activeCatalogViews: ProjectView[];
  trashedCatalogViews: ProjectView[];
  openTemplateGallery: (mode: "project" | "view") => void | Promise<void>;
  layout: Layout | null;
  purgeConfirmId: string | null;
  renamingViewId: string | null;
  renameValue: string;
  setRenameValue: Dispatch<SetStateAction<string>>;
  setRenamingViewId: Dispatch<SetStateAction<string | null>>;
  viewMenuId: string | null;
  setViewMenuId: Dispatch<SetStateAction<string | null>>;
  switchView: (viewId: string) => void | Promise<void>;
  restoreProjectView: (viewId: string) => void | Promise<void>;
  purgeProjectView: (view: ProjectView) => void | Promise<void>;
  renameProjectView: (viewId: string) => void | Promise<void>;
} & ViewRowActions) {
  const { viewLibrary, setViewLibrary, viewQuery, setViewQuery, fixedCatalogViews, recentCatalogViews, activeCatalogViews, trashedCatalogViews, openTemplateGallery, ...rowProps } = props;
  if (!viewLibrary) return null;
  return <div className="view-library-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setViewLibrary(false); }}><aside className="view-library-drawer" aria-label="View Library">
    <header><div><span>PROJECT VIEWS</span><h2>All Views</h2></div><button aria-label="Close View Library" onClick={() => setViewLibrary(false)}><PanelLeftClose size={18} /></button></header>
    <label className="view-library-search"><Search size={15} /><input id="view-library-search" value={viewQuery} onChange={(event) => setViewQuery(event.target.value)} placeholder="Search views…" /></label>
    <div className="view-library-scroll">
      {fixedCatalogViews.length ? <section><h3><PinIcon size={12} /> Fixed <span>{fixedCatalogViews.length}</span></h3>{fixedCatalogViews.map((view) => <ViewLibraryRow key={`compact-${view.id}`} view={view} options={{ compact: true }} {...rowProps} />)}</section> : null}
      {!viewQuery && recentCatalogViews.length ? <section><h3>Recent <span>{recentCatalogViews.length}</span></h3>{recentCatalogViews.map((view) => <ViewLibraryRow key={`compact-${view.id}`} view={view} options={{ compact: true }} {...rowProps} />)}</section> : null}
      <section><h3>All Views <span>{activeCatalogViews.length}</span></h3>{activeCatalogViews.length ? activeCatalogViews.map((view) => <ViewLibraryRow key={`all-${view.id}`} view={view} {...rowProps} />) : <div className="view-library-empty">No Views match "{viewQuery}".</div>}</section>
      <section className="recycle-section"><h3><Trash2 size={12} /> Recycle Bin <span>{trashedCatalogViews.length}</span></h3>{trashedCatalogViews.length ? trashedCatalogViews.map((view) => <ViewLibraryRow key={`all-${view.id}`} view={view} {...rowProps} />) : <div className="view-library-empty">Deleted Views stay here for 30 days.</div>}</section>
    </div>
    <footer><span>⌘/Ctrl + Shift + V</span><button onClick={() => { setViewLibrary(false); void openTemplateGallery("view"); }}><Plus size={13} /> New visual view</button></footer>
  </aside></div>;
}
