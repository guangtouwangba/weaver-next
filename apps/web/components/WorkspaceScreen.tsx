import { ArrowRight, Mail, Plus } from "lucide-react";
import { ProjectSummary, QuickNoteView } from "../lib/api";
import { Screen } from "../lib/types";

export function WorkspaceScreen({
  captureText,
  projects,
  quickNotes,
  status,
  onCapture,
  onCreateProject,
  onPromoteQuickNote,
  setCaptureText,
  setScreen
}: {
  captureText: string;
  projects: ProjectSummary[];
  quickNotes: QuickNoteView[];
  status: "loading" | "live" | "offline";
  onCapture: () => void;
  onCreateProject: () => void;
  onPromoteQuickNote: (quickNoteId: string) => void;
  setCaptureText: (value: string) => void;
  setScreen: (screen: Screen) => void;
}) {
  const visibleQuickNotes = quickNotes.filter((note) => !note.promoted_project_id);

  return (
    <section className="workspace-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">WORKSPACE</p>
          <h1>Good afternoon, Jordan.</h1>
          <p>You have {projects.length} thinking projects and {visibleQuickNotes.length} unsorted notes.</p>
        </div>
        <button className="primary-button" onClick={onCreateProject}>
          <Plus size={18} /> New project
        </button>
      </header>

      <section className="capture-panel">
        <div className="panel-title">
          <Mail size={15} />
          <strong>Quick capture</strong>
          <span className="mono-pill">{visibleQuickNotes.length} in inbox</span>
          <span className={`connection-pill ${status}`}>{status === "loading" ? "syncing" : status === "live" ? "api live" : "offline sample"}</span>
        </div>
        <div className="capture-row">
          <input
            value={captureText}
            onChange={(event) => setCaptureText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onCapture();
            }}
            placeholder="Drop a half-formed thought - sort it into a tree later..."
          />
          <button onClick={onCapture} disabled={!captureText.trim()}>Capture</button>
        </div>
        <div className="note-list">
          {visibleQuickNotes.map((note) => (
            <div className="note-row" key={note.id}>
              <span className="dot" />
              <span>{note.text}</span>
              <time>{note.created_at}</time>
              <button onClick={() => onPromoteQuickNote(note.id)}>Start a tree <ArrowRight size={14} /></button>
            </div>
          ))}
          {visibleQuickNotes.length === 0 ? (
            <div className="empty-row">Inbox clear. Capture a loose thought when one appears.</div>
          ) : null}
        </div>
      </section>

      <div className="section-head">
        <h2>Projects</h2>
        <span>sorted by recent</span>
      </div>
      <div className="project-grid">
        {projects.map((project, projectIndex) => (
          <button className="project-card" key={project.id} onClick={() => setScreen("think")}>
            <div className="project-card-top">
              <span className={`status ${project.status}`}>{project.status.toUpperCase()}</span>
              <time>{project.updated_at}</time>
            </div>
            <div className="sparkline" aria-hidden="true">
              {sparkBars(project, projectIndex).map((height, index) => <span key={`${project.id}-${index}`} className={index === 2 || index === 4 ? "accent" : ""} style={{ height }} />)}
            </div>
            <h3>{project.title}</h3>
            <p>{project.node_count} nodes&nbsp;&nbsp; {project.branch_count} branches</p>
          </button>
        ))}
      </div>
    </section>
  );
}

function sparkBars(project: ProjectSummary, index: number) {
  const seed = project.node_count + project.branch_count + index;
  return [0, 1, 2, 3, 4, 5, 6].map((slot) => 12 + ((seed * (slot + 3)) % 32));
}
