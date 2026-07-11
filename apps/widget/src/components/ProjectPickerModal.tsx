import { FolderKanban, Plus } from "lucide-react";
import type { Project } from "../types";

export function ProjectPickerModal(props: {
  projectChoices: Project[] | null;
  chooseProject: (projectId: string) => void;
  startFromTemplateGallery: () => void | Promise<void>;
}) {
  const { projectChoices, chooseProject, startFromTemplateGallery } = props;
  if (!projectChoices) return null;
  return <div className="project-picker-backdrop" role="presentation"><section className="project-picker" role="dialog" aria-modal="true" aria-label="Choose a project">
    <header><span>WEAVER</span><h2>Choose a project</h2><p>This workspace has {projectChoices.length} projects. Pick one to open, or start a new one.</p></header>
    <div className="project-picker-list">
      {projectChoices.map((project) => <button key={project.id} className="project-picker-row" onClick={() => chooseProject(project.id)}>
        <FolderKanban size={16} />
        <div className="project-picker-copy">
          <strong>{project.title}</strong>
          {project.goal ? <small>{project.goal}</small> : null}
          <span>{project.scenePackId}{project.updatedAt ? ` · updated ${new Date(project.updatedAt).toLocaleDateString()}` : ""}</span>
        </div>
      </button>)}
    </div>
    <footer><button className="project-picker-new" onClick={() => void startFromTemplateGallery()}><Plus size={14} /> Start a new project instead</button></footer>
  </section></div>;
}
