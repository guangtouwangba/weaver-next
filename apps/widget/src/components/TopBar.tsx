import { Lock, MoreHorizontal, Pin as PinIcon, Plus, Unlock, Library } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { ViewActionsMenu, type ViewRowActions } from "./ViewLibraryDrawer";
import { ProjectSwitcher } from "./ProjectSwitcher";
import type { Layout, Project, ProjectView } from "../types";
import { useI18n } from "../lib/i18n";

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
  streamState: "connecting" | "online" | "offline" | "polling";
  reconnect: () => void;
  linkComposer: boolean;
  setLinkComposer: Dispatch<SetStateAction<boolean>>;
  linkUrl: string;
  setLinkUrl: Dispatch<SetStateAction<string>>;
  createLink: () => void | Promise<void>;
  selection: string[];
  standaloneDemo: boolean;
  togglePinned: () => void | Promise<void>;
  workspaceDir?: string;
  chooseProject: (projectId: string) => void;
  startFromTemplateGallery: () => void | Promise<void>;
  projectRevision?: number; layoutRevision?: number; catalogRevision?: number; bindingRevision?: number;
} & ViewRowActions) {
  const { project, status, switcherViews, layout, draggedViewId, setDraggedViewId, reorderPinnedViews, switchView, busy, viewMenuId, setViewMenuId, setViewLibrary, projectViews, openTemplateGallery, streamState, reconnect, linkComposer, setLinkComposer, linkUrl, setLinkUrl, createLink, selection, standaloneDemo, togglePinned, beginRename, pinProjectView, duplicateProjectView, setDefaultView, trashProjectView, workspaceDir, chooseProject, startFromTemplateGallery, projectRevision, layoutRevision, catalogRevision, bindingRevision } = props;
  const { t, locale, setLocale } = useI18n();
  return <header className="topbar">
    <ProjectSwitcher project={project} status={status} workspaceDir={workspaceDir} standaloneDemo={standaloneDemo} busy={busy} chooseProject={chooseProject} startFromTemplateGallery={startFromTemplateGallery} />
    <nav className="view-tabs" aria-label={t("projectViews")}>{switcherViews.map((view) => <div className="view-tab" data-active={layout?.viewId === view.id} data-dragging={draggedViewId === view.id} draggable={view.pinned} onDragStart={() => view.pinned && setDraggedViewId(view.id)} onDragOver={(event) => view.pinned && event.preventDefault()} onDrop={() => void reorderPinnedViews(view.id)} onDragEnd={() => setDraggedViewId(null)} key={view.id}><button onClick={() => void switchView(view.id)} disabled={busy}>{view.pinned ? <PinIcon size={10} fill="currentColor" /> : null}{view.name}</button><button className="view-tab-more" aria-label={`${t("moreActions")} ${view.name}`} onClick={() => setViewMenuId(viewMenuId === `tab:${view.id}` ? null : `tab:${view.id}`)}><MoreHorizontal size={13} /></button>{viewMenuId === `tab:${view.id}` ? <ViewActionsMenu view={view} project={project} projectViews={projectViews} beginRename={beginRename} pinProjectView={pinProjectView} duplicateProjectView={duplicateProjectView} setDefaultView={setDefaultView} trashProjectView={trashProjectView} /> : null}</div>)}<button className="all-views-button" onClick={() => setViewLibrary(true)} disabled={!project}><Library size={12} /> {t("allViews")} <span>{projectViews.filter((view) => view.status === "active").length}</span></button><button className="new-view" aria-label={t("newVisualView")} onClick={() => void openTemplateGallery("view")} disabled={!project || busy}><Plus size={12} /></button></nav>
    <div className="top-actions">
      <span className="revision-strip">G{projectRevision ?? 0} · L{layoutRevision ?? 0} · C{catalogRevision ?? 0} · B{bindingRevision ?? 0}</span>
      <button className="stream-status" data-state={streamState} onClick={() => streamState === "offline" && reconnect()} title={streamState === "offline" ? t("reconnect") : t("live")}><span /> {streamState === "online" || streamState === "polling" ? t("live") : streamState === "connecting" ? t("connecting") : t("reconnect")}</button>
      <button className="locale-toggle" onClick={() => setLocale(locale === "zh-CN" ? "en-US" : "zh-CN")}>{t("language")}</button>
      {linkComposer ? <div className="create-anchor"><div className="create-menu toolbar-link-composer"><div className="link-composer"><label htmlFor="link-url">{t("publicUrl")}</label><input id="link-url" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setLinkComposer(false); if (event.key === "Enter") void createLink(); }} placeholder="https://…" autoFocus /><button onClick={() => void createLink()} disabled={!linkUrl.trim() || busy}>{t("createLink")}</button></div></div></div> : null}
      <button onClick={() => void togglePinned()} disabled={!selection.length || standaloneDemo}>{selection.some((id) => layout?.nodes[id]?.pinned) ? <Unlock size={15} /> : <Lock size={15} />} {selection.some((id) => layout?.nodes[id]?.pinned) ? t("unpin") : t("pin")}</button>
    </div>
  </header>;
}
