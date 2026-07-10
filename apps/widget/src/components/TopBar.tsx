import { FileText, ImagePlus, Link2, LayoutTemplate, Lock, MoreHorizontal, Pin as PinIcon, Plus, RotateCcw, Sparkles, Unlock, Library } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { ViewActionsMenu, type ViewRowActions } from "./ViewLibraryDrawer";
import type { Layout, Project, ProjectView } from "../types";

export function TopBar(props: {
  project: Project | null;
  status: string;
  switcherViews: ProjectView[];
  layout: Layout | null;
  draggedViewId: string | null;
  setDraggedViewId: Dispatch<SetStateAction<string | null>>;
  reorderPinnedViews: (targetViewId: string) => void | Promise<void>;
  switchView: (viewId: string) => void | Promise<void>;
  busy: boolean;
  viewMenuId: string | null;
  setViewMenuId: Dispatch<SetStateAction<string | null>>;
  setViewLibrary: Dispatch<SetStateAction<boolean>>;
  projectViews: ProjectView[];
  openTemplateGallery: (mode: "project" | "view") => void | Promise<void>;
  streamState: "connecting" | "online" | "offline";
  reconnect: () => void;
  createMenu: boolean;
  setCreateMenu: Dispatch<SetStateAction<boolean>>;
  linkComposer: boolean;
  setLinkComposer: Dispatch<SetStateAction<boolean>>;
  createArticle: () => void | Promise<void>;
  chooseImage: (action: "node" | "cover" | "embedded") => void;
  linkUrl: string;
  setLinkUrl: Dispatch<SetStateAction<string>>;
  createLink: () => void | Promise<void>;
  selection: string[];
  standaloneDemo: boolean;
  togglePinned: () => void | Promise<void>;
  revertLayout: () => void | Promise<void>;
} & ViewRowActions) {
  const { project, status, switcherViews, layout, draggedViewId, setDraggedViewId, reorderPinnedViews, switchView, busy, viewMenuId, setViewMenuId, setViewLibrary, projectViews, openTemplateGallery, streamState, reconnect, createMenu, setCreateMenu, linkComposer, setLinkComposer, createArticle, chooseImage, linkUrl, setLinkUrl, createLink, selection, standaloneDemo, togglePinned, revertLayout, beginRename, pinProjectView, duplicateProjectView, setDefaultView, trashProjectView } = props;
  return <header className="topbar">
    <div className="brand"><span>W</span><div><strong title={project?.title ?? "Weaver"}>{project?.title ?? "Weaver"}</strong><small>{status}</small></div></div>
    <nav className="view-tabs" aria-label="Project views">{switcherViews.map((view) => <div className="view-tab" data-active={layout?.viewId === view.id} data-dragging={draggedViewId === view.id} draggable={view.pinned} onDragStart={() => view.pinned && setDraggedViewId(view.id)} onDragOver={(event) => view.pinned && event.preventDefault()} onDrop={() => void reorderPinnedViews(view.id)} onDragEnd={() => setDraggedViewId(null)} key={view.id}><button onClick={() => void switchView(view.id)} disabled={busy}>{view.pinned ? <PinIcon size={10} fill="currentColor" /> : null}{view.name}</button><button className="view-tab-more" aria-label={`More actions for ${view.name}`} onClick={() => setViewMenuId(viewMenuId === view.id ? null : view.id)}><MoreHorizontal size={13} /></button>{viewMenuId === view.id ? <ViewActionsMenu view={view} project={project} projectViews={projectViews} beginRename={beginRename} pinProjectView={pinProjectView} duplicateProjectView={duplicateProjectView} setDefaultView={setDefaultView} trashProjectView={trashProjectView} /> : null}</div>)}<button className="all-views-button" onClick={() => setViewLibrary(true)} disabled={!project}><Library size={12} /> All Views <span>{projectViews.filter((view) => view.status === "active").length}</span></button><button className="new-view" aria-label="New visual view" onClick={() => void openTemplateGallery("view")} disabled={!project || busy}><Plus size={12} /></button></nav>
    <div className="top-actions">
      <button className="stream-status" data-state={streamState} onClick={() => streamState === "offline" && reconnect()} title={streamState === "offline" ? "Reconnect live sync" : "SSE live sync status"}><span /> {streamState === "online" ? "Live" : streamState === "connecting" ? "Connecting" : "Reconnect"}</button>
      <div className="create-anchor"><button className="create-button" onClick={() => { setCreateMenu(!createMenu); setLinkComposer(false); }}><Plus size={15} /> Create</button>
        {createMenu ? <div className="create-menu" role="menu"><button onClick={() => void openTemplateGallery("project")}><LayoutTemplate size={17} /><span><strong>Project from template</strong><small>Create starter structure and visual</small></span></button><button onClick={() => void openTemplateGallery("view")} disabled={!project}><Sparkles size={17} /><span><strong>New visual view</strong><small>Project current content without changing it</small></span></button><button onClick={() => void createArticle()} disabled={!project}><FileText size={17} /><span><strong>Article</strong><small>Write in the side editor</small></span></button><button onClick={() => chooseImage("node")} disabled={!project}><ImagePlus size={17} /><span><strong>Image</strong><small>Upload or paste</small></span></button><button onClick={() => setLinkComposer(true)} disabled={!project}><Link2 size={17} /><span><strong>Link</strong><small>Save a rich preview</small></span></button>{linkComposer ? <div className="link-composer"><label htmlFor="link-url">Public URL</label><input id="link-url" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void createLink(); }} placeholder="https://…" autoFocus /><button onClick={() => void createLink()} disabled={!linkUrl.trim() || busy}>Create link</button></div> : null}</div> : null}
      </div>
      <button onClick={() => void togglePinned()} disabled={!selection.length || standaloneDemo}>{selection.some((id) => layout?.nodes[id]?.pinned) ? <Unlock size={15} /> : <Lock size={15} />} {selection.some((id) => layout?.nodes[id]?.pinned) ? "Unpin" : "Pin"}</button>
      <button onClick={revertLayout} disabled={busy || standaloneDemo}><RotateCcw size={15} /> Undo layout</button>
    </div>
  </header>;
}
