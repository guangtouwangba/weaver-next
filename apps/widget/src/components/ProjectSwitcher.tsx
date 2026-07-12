import { Check, ChevronDown, FolderKanban, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { callTool } from "../mcp-client";
import type { Project } from "../types";
import { useI18n } from "../lib/i18n";

/**
 * The top-left project title, upgraded from a static label into a switcher. The
 * data path (weaver_switch_chat_canvas via chooseProject) already existed; this is
 * the missing always-available entry point to it — before, the project picker only
 * appeared once at cold start. Opening the dropdown re-lists projects fresh so a
 * project created in another chat shows up without a reload.
 */
export function ProjectSwitcher(props: {
  project: Project | null;
  status: string;
  workspaceDir?: string;
  standaloneDemo: boolean;
  busy: boolean;
  chooseProject: (projectId: string) => void;
  startFromTemplateGallery: () => void | Promise<void>;
}) {
  const { project, status, workspaceDir, standaloneDemo, busy, chooseProject, startFromTemplateGallery } = props;
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  const title = project?.title ?? "Weaver";
  // The demo and pre-bootstrap states have no backend to switch against — keep the
  // plain label so nothing looks clickable when it can't do anything.
  const switchable = !standaloneDemo && Boolean(workspaceDir);

  const refresh = useCallback(async () => {
    if (!workspaceDir) return;
    setError(null);
    try { setProjects(await callTool<Project[]>("weaver_read_catalog", { workspaceDir, resource: "project.list" })); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, [workspaceDir]);

  const toggle = useCallback(() => {
    setOpen((value) => {
      const next = !value;
      if (next) void refresh();
      return next;
    });
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (!anchorRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  if (!switchable) {
    return <div className="brand"><span>W</span><div><strong title={title}>{title}</strong><small>{status}</small></div></div>;
  }

  const pick = (projectId: string) => { setOpen(false); if (projectId !== project?.id) chooseProject(projectId); };
  const newProject = () => { setOpen(false); void startFromTemplateGallery(); };

  return <div className="brand brand-switch" ref={anchorRef}>
    <span>W</span>
    <button className="brand-title" onClick={toggle} disabled={busy} aria-haspopup="menu" aria-expanded={open}>
      <div><strong title={title}>{title}</strong><small>{status}</small></div>
      <ChevronDown size={14} className="brand-chevron" data-open={open} />
    </button>
    {open ? <div className="project-switcher-menu" role="menu">
      <div className="project-switcher-list">
        {projects === null && !error ? <div className="project-switcher-empty">{t("loadingProjects")}</div> : null}
        {error ? <div className="project-switcher-empty">{error}</div> : null}
        {projects?.map((item) => <button key={item.id} className="project-switcher-row" role="menuitemradio" aria-checked={item.id === project?.id} onClick={() => pick(item.id)}>
          <FolderKanban size={15} />
          <div className="project-switcher-copy"><strong>{item.title}</strong>{item.goal ? <small>{item.goal}</small> : null}</div>
          {item.id === project?.id ? <Check size={15} className="project-switcher-current" /> : null}
        </button>)}
      </div>
      <button className="project-switcher-new" onClick={newProject}><Plus size={14} /> {t("newProject")}</button>
    </div> : null}
  </div>;
}
