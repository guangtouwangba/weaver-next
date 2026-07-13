import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

import { useProjectBootstrap } from "./hooks/useProjectBootstrap";
import { useCanvasBindingSync } from "./hooks/useCanvasBindingSync";
import { useCanvasGraph } from "./hooks/useCanvasGraph";
import { useDocumentEditor } from "./hooks/useDocumentEditor";
import { useCanvasEventStream } from "./hooks/useCanvasEventStream";
import { useViewCatalog } from "./hooks/useViewCatalog";
import { useVisualTemplateGallery } from "./hooks/useVisualTemplateGallery";
import { useCanvasViewport } from "./hooks/useCanvasViewport";
import { useModelContextSync } from "./hooks/useModelContextSync";
import { useDisplayMode } from "./hooks/useDisplayMode";

import { TopBar } from "./components/TopBar";
import { ViewLibraryDrawer } from "./components/ViewLibraryDrawer";
import { CanvasStage, type CanvasApi } from "./components/CanvasStage";
import { TemplateGalleryModal } from "./components/TemplateGalleryModal";
import { ProjectPickerModal } from "./components/ProjectPickerModal";
import { NodeViewerModal } from "./components/NodeViewerModal";
import { DocumentEditorPanel } from "./components/DocumentEditorPanel";
import { InlineLauncher } from "./components/InlineLauncher";
import { loadCanvasSessionId } from "./lib/canvas-session";
import { I18nProvider, useI18n } from "./lib/i18n";
import { alignNodes, distributeNodes } from "./lib/canvas-tools";
import type { CanvasEdge, CanvasNode, CanvasViewport } from "./lib/canvas-model";

import type { Candidate, ProjectView, VisualTemplate } from "./types";

declare global { interface Window { openai?: { toolOutput?: Record<string, unknown> }; __weaverRoot?: ReturnType<typeof createRoot>; __weaverEmbeddedBuildId?: string } }

function WeaverWidget() {
  const { t } = useI18n();
  const query = new URLSearchParams(location.search);
  const standaloneDemo = query.get("demo") === "1";
  const inlinePreview = import.meta.env.DEV && standaloneDemo && query.get("inline") === "1";
  const { displayMode, openFullscreen } = useDisplayMode();

  // Cross-cutting state that two or more domain hooks both need to read *and* write —
  // lifted to the composition root (same style as the cross-cutting refs) so the domain
  // hooks below can be constructed in a straight line without circular dependencies.
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [edges, setEdges] = useState<CanvasEdge[]>([]);
  const [assetPreviews, setAssetPreviews] = useState<Record<string, string>>({});
  const previewCache = useRef<Record<string, string>>({});
  const [selection, setSelection] = useState<string[]>([]);
  const [anchorNodeId, setAnchorNodeId] = useState<string>();
  const draggingNodeId = useRef<string | null>(null);
  const viewport = useRef<CanvasViewport>({ x: 0, y: 0, zoom: 1 });
  const canvasApiRef = useRef<CanvasApi | null>(null);
  const getViewport = useCallback(() => canvasApiRef.current?.getViewport() ?? viewport.current, []);
  const setViewport = useCallback((next: CanvasViewport, options?: { duration?: number }) => canvasApiRef.current?.setViewport(next, options) ?? Promise.resolve(false), []);
  const fitView = useCallback((options?: Record<string, unknown>) => canvasApiRef.current?.fitView(options as Parameters<CanvasApi["fitView"]>[0]) ?? Promise.resolve(false), []);
  const screenToFlowPosition = useCallback((point: { x: number; y: number }) => canvasApiRef.current?.screenToWorld(point) ?? point, []);
  const stream = useRef<EventSource | null>(null);
  const sessionId = useRef(loadCanvasSessionId());
  const [activeViewId, setActiveViewId] = useState("");
  const [projectViews, setProjectViews] = useState<ProjectView[]>([]);
  const projectViewsRef = useRef<ProjectView[]>([]);
  const [viewToast, setViewToast] = useState<{ message: string; undoViewId?: string } | null>(null);
  const [templateGallery, setTemplateGallery] = useState(false);
  const [templateMode, setTemplateMode] = useState<"project" | "view">("view");
  const [templates, setTemplates] = useState<VisualTemplate[]>([]);

  const bootstrapHook = useProjectBootstrap({
    standaloneDemo, activeViewId, setActiveViewId, setProjectViews, setNodes, setEdges, setSelection, previewCache, setAssetPreviews, setTemplateMode, setTemplateGallery, setTemplates, sessionId, fitView, setViewport,
  });
  const { bootstrap, setBootstrap, project, setProject, manifest, setManifest, layout, setLayout, graphNodes, setGraphNodes, graphEdges, setGraphEdges, status, setStatus, busy, setBusy, projectRef, layoutRef, graphNodesRef, graphEdgesRef, bindingRef, pendingInitialFitView, pendingViewportRestore, projectChoices, chooseProject, startFromTemplateGallery, load, ensureBindingTarget, hydratePreviews } = bootstrapHook;

  const { syncContext, accessState, setAccessState, claimError, retryClaim, takeOver } = useCanvasBindingSync({
    standaloneDemo, project, layout, bootstrap, bindingRef, setStatus, selection, anchorNodeId, nodes, viewport, sessionId, stream, pendingInitialFitView, pendingViewportRestore,
  });

  const { persistNodeFrame, persistSelectionFrames, persistNodeResize: _persistNodeResize, persistEdgeRoute, linkNodes, duplicateSelection, groupSelection, archiveNodes, togglePinned, toggleCanvasTheme, handleSelectionChange } = useCanvasGraph({
    standaloneDemo, setNodes, setEdges, graphNodes, graphEdges, assetPreviews, draggingNodeId, selection, setSelection, bootstrap, project, layout, setLayout, layoutRef, projectRef, setStatus, load,
  });
  const canvasViewport = useCanvasViewport({ nodes, selection, viewId: layout?.viewId, viewport, pendingInitialFitView, pendingViewportRestore, fitView, getViewport, setViewport, onViewportReady: () => { window.setTimeout(() => void syncContext(), 0); } });

  const documentEditor = useDocumentEditor({
    standaloneDemo, bootstrap, project, layout, manifest, graphNodes, graphNodesRef, setProject, setLayout, setGraphNodes, setStatus, setBusy, load, previewCache, setAssetPreviews, screenToFlowPosition,
  });
  const { setCreateMenu, linkComposer, setLinkComposer, linkUrl, setLinkUrl, activeDocument, setActiveDocument, activeViewer, setActiveViewer, draft, editorMode, setEditorMode, saveState, setSaveState, fileInput, editorTextArea, saveStateRef, activeDocumentRef, createNoteAt, createArticle, chooseImage, importImageFile, createLink, openDocument, openNodeViewer, saveDocument, editDraft, formatMarkdown } = documentEditor;

  const eventStream = useCanvasEventStream({
    authority: { standaloneDemo, bootstrap, project, layout, accessState },
    state: { setProject, setLayout, setGraphNodes, setGraphEdges, setManifest, setStatus, setBusy, setBootstrap, setSaveState, setProjectViews, setViewToast, setActiveViewId, setAccessState },
    refs: { projectRef, layoutRef, graphNodesRef, graphEdgesRef, bindingRef, saveStateRef, activeDocumentRef, draggingNodeId, projectViewsRef, sessionId, stream },
    effects: { load, hydratePreviews, syncContext, openNodeViewer },
  });
  const { streamState, activeTask, candidates, changePreview, staleTask, candidateIndex, setCandidateIndex, cancelActiveTask, applyChangeSet, rejectChangeSet, applyCandidate, rejectLayout, revertLayout, resetLayoutRun, reconnect } = eventStream;

  useModelContextSync({ standaloneDemo, selection, anchorNodeId, nodes: graphNodes });

  const viewCatalog = useViewCatalog({
    standaloneDemo, bootstrap, project, layout, projectRef, setProject, setStatus, ensureBindingTarget, bindingRef, setBootstrap, load, activeViewId, setActiveViewId, projectViews, setProjectViews, projectViewsRef, viewToast, setViewToast, resetLayoutRun, saveStateRef, saveDocument, syncContext, setSelection,
  });
  const { viewLibrary, setViewLibrary, viewQuery, setViewQuery, viewMenuId, setViewMenuId, renamingViewId, renameValue, setRenameValue, setRenamingViewId, purgeConfirmId, draggedViewId, setDraggedViewId, switcherViews, activeCatalogViews, trashedCatalogViews, fixedCatalogViews, recentCatalogViews, renameProjectView, pinProjectView, setDefaultView, reorderPinnedViews, trashProjectView, restoreProjectView, purgeProjectView, duplicateProjectView, switchView, beginRename } = viewCatalog;

  const templateGalleryHook = useVisualTemplateGallery({
    bootstrap, setBootstrap, project, graphNodes, projectViews, ensureBindingTarget, bindingRef, setStatus, setBusy, setActiveViewId, resetLayoutRun, setCreateMenu, templateGallery, setTemplateGallery, templateMode, setTemplateMode, templates, setTemplates,
  });
  const { templateFamily, setTemplateFamily, templateSearch, setTemplateSearch, selectedTemplate, setSelectedTemplate, templateValidation, templatePreview, templateTitle, setTemplateTitle, templateGoal, setTemplateGoal, templateScenePackId, setTemplateScenePackId, templateViewName, setTemplateViewName, duplicateViewConfirmed, filteredTemplates, templateInstances, visualPreviewItems, openTemplateGallery, chooseVisualTemplate, applyVisualTemplate } = templateGalleryHook;

  const displayedNodes = useMemo(() => { const candidate = (candidates as Candidate[])[candidateIndex]; if (!candidate) return nodes; return nodes.map((node) => ({ ...node, position: { x: candidate.document.nodes[node.id]?.x ?? node.position.x, y: candidate.document.nodes[node.id]?.y ?? node.position.y } })); }, [candidateIndex, candidates, nodes]);

  function arrangeSelection(kind: "align" | "distribute", axis: "horizontal" | "vertical") {
    const selected = nodes.filter((node) => selection.includes(node.id));
    const arranged = kind === "align" ? alignNodes(selected, axis === "horizontal" ? "center-y" : "center-x") : distributeNodes(selected, axis);
    const byId = new Map(arranged.map((node) => [node.id, node]));
    setNodes((current) => current.map((node) => byId.get(node.id) ?? node));
    void persistSelectionFrames(arranged);
  }

  useEffect(() => {
    if (!selection.length) { setAnchorNodeId(undefined); return; }
    if (!anchorNodeId || !selection.includes(anchorNodeId)) setAnchorNodeId(selection[0]);
  }, [anchorNodeId, selection]);

  if (displayMode === "inline" || inlinePreview) return <InlineLauncher projectTitle={project?.title} status={status} labels={{ currentSpace: t("currentSpace"), spaceFallback: t("weaverSpace"), brandSubtitle: t("semanticCanvas"), reopen: t("reopenWeaver"), collapsed: t("canvasCollapsed"), hint: t("reopenCanvasHint") }} onOpen={() => {
    if (inlinePreview) { query.delete("inline"); location.search = query.toString(); return; }
    void openFullscreen();
  }} />;

  return <main className="weaver-shell" data-editor-open={Boolean(activeDocument)} data-display-mode={displayMode} data-schema-reset={Boolean(bootstrap.schemaReset)}>
    <TopBar
      project={project} status={status} switcherViews={switcherViews} layout={layout} draggedViewId={draggedViewId} setDraggedViewId={setDraggedViewId} reorderPinnedViews={reorderPinnedViews} switchView={switchView} busy={busy}
      viewMenuId={viewMenuId} setViewMenuId={setViewMenuId} setViewLibrary={setViewLibrary} projectViews={projectViews} openTemplateGallery={openTemplateGallery} streamState={streamState} reconnect={reconnect}
      linkComposer={linkComposer} setLinkComposer={setLinkComposer} linkUrl={linkUrl} setLinkUrl={setLinkUrl} createLink={createLink}
      selection={selection} standaloneDemo={standaloneDemo} togglePinned={togglePinned}
      beginRename={beginRename} pinProjectView={pinProjectView} duplicateProjectView={duplicateProjectView} setDefaultView={setDefaultView} trashProjectView={trashProjectView}
      workspaceDir={bootstrap.workspaceDir} chooseProject={chooseProject} startFromTemplateGallery={startFromTemplateGallery}
      projectRevision={project?.graphRevision} layoutRevision={layout?.layoutRevision} catalogRevision={project?.viewCatalogRevision} bindingRevision={bindingRef.current?.bindingRevision}
    />
    {bootstrap.schemaReset ? <div className="schema-reset-notice" role="status">{t("schemaResetNotice")} <code>{t("backupLabel")}: {bootstrap.schemaReset.backupName}</code></div> : null}
    <section className="workspace-stage">
      {!standaloneDemo && (accessState === "build-mismatch" || accessState === "detached" || (project && accessState !== "active")) ? <div className="canvas-access-blocker" role="alert">
        <strong>{accessState === "claiming" ? t("canvasConnecting") : accessState === "claim-failed" ? t("canvasConnectFailed") : accessState === "duplicate" ? t("canvasDuplicate") : accessState === "build-mismatch" ? t("buildMismatch") : t("canvasDetached")}</strong>
        <p>{accessState === "claiming" ? t("claimingHelp") : accessState === "claim-failed" ? `${t("errorCode")}: ${claimError ?? "CANVAS_CLAIM_FAILED"}. ${t("retryHelp")}` : accessState === "duplicate" ? t("duplicateHelp") : accessState === "build-mismatch" ? `${window.__weaverEmbeddedBuildId ?? "unknown"} / ${bootstrap.widgetBuildId ?? "unknown"} / ${bootstrap.workspaceWidgetBuildId ?? "unknown"}. ${t("buildMismatchHelp")}` : t("detachedHelp")}</p>
        {accessState === "claim-failed" ? <button type="button" onClick={retryClaim}>{t("reconnect")}</button> : null}
        {accessState === "duplicate" ? <button type="button" onClick={() => void takeOver()}>{t("takeOver")}</button> : null}
      </div> : null}
      <ViewLibraryDrawer
        viewLibrary={viewLibrary} setViewLibrary={setViewLibrary} viewQuery={viewQuery} setViewQuery={setViewQuery} fixedCatalogViews={fixedCatalogViews} recentCatalogViews={recentCatalogViews} activeCatalogViews={activeCatalogViews} trashedCatalogViews={trashedCatalogViews} openTemplateGallery={openTemplateGallery}
        layout={layout} purgeConfirmId={purgeConfirmId} renamingViewId={renamingViewId} renameValue={renameValue} setRenameValue={setRenameValue} setRenamingViewId={setRenamingViewId} viewMenuId={viewMenuId} setViewMenuId={setViewMenuId}
        switchView={switchView} restoreProjectView={restoreProjectView} purgeProjectView={purgeProjectView} renameProjectView={renameProjectView} project={project} projectViews={projectViews}
        beginRename={beginRename} pinProjectView={pinProjectView} duplicateProjectView={duplicateProjectView} setDefaultView={setDefaultView} trashProjectView={trashProjectView}
      />
      <CanvasStage
        standaloneDemo={standaloneDemo} projectId={project?.id} canvasSessionId={sessionId.current} buildId={window.__weaverEmbeddedBuildId ?? bootstrap.widgetBuildId} graphNodes={graphNodes} graphEdges={graphEdges} displayedNodes={displayedNodes} edges={edges} setNodes={setNodes} layout={layout} canvasApiRef={canvasApiRef} viewportState={canvasViewport.state} miniMapOpen={canvasViewport.miniMapOpen} setMiniMapOpen={canvasViewport.setMiniMapOpen} beginViewportInteraction={canvasViewport.beginInteraction} handleViewportMoveEnd={canvasViewport.handleMoveEnd} zoomBy={canvasViewport.zoomBy} fitAll={canvasViewport.fitAll} focusSelection={canvasViewport.focusSelection} toggleCanvasTheme={toggleCanvasTheme} onNodeClick={setAnchorNodeId} handleSelectionChange={handleSelectionChange} archiveNodes={archiveNodes}
        draggingNodeId={draggingNodeId} viewport={viewport} setStatus={setStatus} syncContext={syncContext} persistNodeFrame={persistNodeFrame} persistSelectionFrames={persistSelectionFrames} persistEdgeRoute={persistEdgeRoute} linkNodes={linkNodes} availableEdgeTypes={manifest?.scenePack.edgeTypes ?? []} createNoteAtScreen={(point) => { void createNoteAt(screenToFlowPosition(point)); }} createArticle={createArticle} chooseImage={() => chooseImage("node")} openLinkComposer={() => setLinkComposer(true)} duplicateSelection={duplicateSelection} alignSelection={(axis) => arrangeSelection("align", axis)} distributeSelection={(axis) => arrangeSelection("distribute", axis)} revertLayout={revertLayout} groupSelection={groupSelection} openNodeViewer={openNodeViewer} bindingRef={bindingRef} selection={selection}
        activeTask={activeTask} cancelActiveTask={cancelActiveTask} changePreview={changePreview} rejectChangeSet={rejectChangeSet} applyChangeSet={applyChangeSet}
        candidates={candidates} candidateIndex={candidateIndex} setCandidateIndex={setCandidateIndex} rejectLayout={rejectLayout} applyCandidate={applyCandidate}
        staleTask={staleTask} viewToast={viewToast} setViewToast={setViewToast} restoreProjectView={restoreProjectView}
      />
      <ProjectPickerModal projectChoices={projectChoices} chooseProject={chooseProject} startFromTemplateGallery={startFromTemplateGallery} />
      <TemplateGalleryModal
        templateGallery={templateGallery} setTemplateGallery={setTemplateGallery} templateMode={templateMode} project={project} templateFamily={templateFamily} setTemplateFamily={setTemplateFamily} templateSearch={templateSearch} setTemplateSearch={setTemplateSearch}
        filteredTemplates={filteredTemplates} projectViews={projectViews} selectedTemplate={selectedTemplate} setSelectedTemplate={setSelectedTemplate} chooseVisualTemplate={chooseVisualTemplate} visualPreviewItems={visualPreviewItems}
        templateTitle={templateTitle} setTemplateTitle={setTemplateTitle} templateGoal={templateGoal} setTemplateGoal={setTemplateGoal} templateScenePackId={templateScenePackId} setTemplateScenePackId={setTemplateScenePackId}
        templateViewName={templateViewName} setTemplateViewName={setTemplateViewName} templateInstances={templateInstances} switchView={switchView} templateValidation={templateValidation} templatePreview={templatePreview} busy={busy}
        applyVisualTemplate={applyVisualTemplate} duplicateViewConfirmed={duplicateViewConfirmed}
      />
      <NodeViewerModal activeViewer={activeViewer} setActiveViewer={setActiveViewer} openDocument={openDocument} assetPreviews={assetPreviews} />
      <DocumentEditorPanel
        activeDocument={activeDocument} draft={draft} saveState={saveState} setActiveDocument={setActiveDocument} load={load} openDocument={openDocument} manifest={manifest} editDraft={editDraft}
        editorMode={editorMode} setEditorMode={setEditorMode} chooseImage={chooseImage} formatMarkdown={formatMarkdown} editorTextArea={editorTextArea} saveDocument={saveDocument}
      />
    </section>
    <input ref={fileInput} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importImageFile(file); }} />
  </main>;
}

const root = window.__weaverRoot ?? createRoot(document.getElementById("root")!);
window.__weaverRoot = root;
root.render(<React.StrictMode><I18nProvider><WeaverWidget /></I18nProvider></React.StrictMode>);
