import { useEffect, useState } from "react";
import { fallbackProjects, fallbackQuickNotes } from "../lib/fallback-data";
import {
  ApiStatus,
  ProjectSummary,
  QuickNoteView,
  createProject,
  createQuickNote,
  fetchProjects,
  fetchQuickNotes,
  pingApi,
  promoteQuickNote
} from "../lib/api";
import { Screen, Voice } from "../lib/types";

export function useWorkspaceHome() {
  const [screen, setScreen] = useState<Screen>("workspace");
  const [voice, setVoice] = useState<Voice>("Professional");
  const [apiStatus, setApiStatus] = useState<ApiStatus>({ ok: false, label: "Checking API" });
  const [workspaceStatus, setWorkspaceStatus] = useState<"loading" | "live" | "offline">("loading");
  const [workspaceProjects, setWorkspaceProjects] = useState<ProjectSummary[]>(fallbackProjects);
  const [workspaceQuickNotes, setWorkspaceQuickNotes] = useState<QuickNoteView[]>(fallbackQuickNotes);
  const [draftFormat, setDraftFormat] = useState("Article");
  const [captureText, setCaptureText] = useState("");
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    void refreshApi();
    void refreshWorkspace();
  }, []);

  async function refreshApi() {
    setIsTesting(true);
    const status = await pingApi();
    setApiStatus(status);
    setIsTesting(false);
  }

  async function refreshWorkspace() {
    try {
      const [projects, quickNotes] = await Promise.all([
        fetchProjects(),
        fetchQuickNotes()
      ]);
      setWorkspaceProjects(projects);
      setWorkspaceQuickNotes(quickNotes);
      setWorkspaceStatus("live");
    } catch {
      setWorkspaceStatus("offline");
      setWorkspaceProjects(fallbackProjects);
      setWorkspaceQuickNotes(fallbackQuickNotes);
    }
  }

  async function handleCreateProject() {
    try {
      const project = await createProject("Untitled branching question");
      setWorkspaceProjects((current) => [project, ...current]);
      setWorkspaceStatus("live");
    } catch {
      const project: ProjectSummary = {
        id: `local_project_${Date.now()}`,
        title: "Untitled branching question",
        status: "thinking",
        node_count: 1,
        branch_count: 1,
        updated_at: "local"
      };
      setWorkspaceProjects((current) => [project, ...current]);
      setWorkspaceStatus("offline");
    }
    setScreen("think");
  }

  async function handleCapture() {
    const text = captureText.trim();
    if (!text) return;
    try {
      const quickNote = await createQuickNote(text);
      setWorkspaceQuickNotes((current) => [quickNote, ...current]);
      setWorkspaceStatus("live");
    } catch {
      const quickNote: QuickNoteView = {
        id: `local_note_${Date.now()}`,
        text,
        created_at: "local",
        promoted_project_id: null
      };
      setWorkspaceQuickNotes((current) => [quickNote, ...current]);
      setWorkspaceStatus("offline");
    }
    setCaptureText("");
  }

  async function handlePromoteQuickNote(quickNoteId: string) {
    try {
      const result = await promoteQuickNote(quickNoteId);
      setWorkspaceProjects((current) => [result.project, ...current]);
      setWorkspaceQuickNotes((current) => current.map((note) => note.id === quickNoteId ? result.quicknote : note));
      setWorkspaceStatus("live");
    } catch {
      const source = workspaceQuickNotes.find((note) => note.id === quickNoteId);
      const project: ProjectSummary = {
        id: `local_project_${Date.now()}`,
        title: source?.text ?? "Promoted quick thought",
        status: "thinking",
        node_count: 1,
        branch_count: 1,
        updated_at: "local"
      };
      setWorkspaceProjects((current) => [project, ...current]);
      setWorkspaceQuickNotes((current) => current.map((note) => note.id === quickNoteId ? { ...note, promoted_project_id: project.id } : note));
      setWorkspaceStatus("offline");
    }
    setScreen("think");
  }

  return {
    screen,
    setScreen,
    voice,
    setVoice,
    apiStatus,
    workspaceStatus,
    workspaceProjects,
    workspaceQuickNotes,
    draftFormat,
    setDraftFormat,
    captureText,
    setCaptureText,
    isTesting,
    refreshApi,
    refreshWorkspace,
    handleCreateProject,
    handleCapture,
    handlePromoteQuickNote
  };
}
