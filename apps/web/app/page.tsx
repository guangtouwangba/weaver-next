"use client";

import { useMemo } from "react";
import { Rail } from "../components/Rail";
import { WorkspaceScreen } from "../components/WorkspaceScreen";
import { ThinkingTree } from "../components/thinking-tree/ThinkingTree";
import { DraftScreen } from "../components/draft/DraftScreen";
import { SettingsScreen } from "../components/settings/SettingsScreen";
import { useWorkspaceHome } from "../hooks/useWorkspaceHome";

export default function Home() {
  const {
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
    handleCreateProject,
    handleCapture,
    handlePromoteQuickNote
  } = useWorkspaceHome();

  const main = useMemo(() => {
    if (screen === "think") return <ThinkingTree setScreen={setScreen} />;
    if (screen === "draft") return <DraftScreen voice={voice} setVoice={setVoice} draftFormat={draftFormat} setDraftFormat={setDraftFormat} />;
    if (screen === "settings") return <SettingsScreen apiStatus={apiStatus} isTesting={isTesting} onTest={refreshApi} />;
    return (
      <WorkspaceScreen
        captureText={captureText}
        projects={workspaceProjects}
        quickNotes={workspaceQuickNotes}
        status={workspaceStatus}
        onCapture={handleCapture}
        onCreateProject={handleCreateProject}
        onPromoteQuickNote={handlePromoteQuickNote}
        setCaptureText={setCaptureText}
        setScreen={setScreen}
      />
    );
  }, [screen, voice, draftFormat, captureText, apiStatus, isTesting, workspaceProjects, workspaceQuickNotes, workspaceStatus]);

  return (
    <div className="app-shell">
      <Rail screen={screen} setScreen={setScreen} />
      <main className={`main ${screen}`}>{main}</main>
    </div>
  );
}
