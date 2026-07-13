import { useEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { callTool } from "../mcp-client";
import { excerpt } from "../lib/graph-view";
import type { Bootstrap, DocumentContent, EditorDraft, GraphNode, Layout, LinkContent, Manifest, NodeContent, Project } from "../types";

type SaveState = "saved" | "dirty" | "saving" | "conflict";
type CanvasMutationResult = { project: Project; layout: Layout; node: GraphNode };
type ImportAssetResult = { assetId: string };

// Domain F: document editor (create/open/save articles, images, links; markdown editor state).
export function useDocumentEditor(params: {
  standaloneDemo: boolean;
  bootstrap: Bootstrap;
  project: Project | null;
  layout: Layout | null;
  manifest: Manifest | null;
  graphNodes: GraphNode[];
  graphNodesRef: MutableRefObject<GraphNode[]>;
  setProject: Dispatch<SetStateAction<Project | null>>;
  setLayout: Dispatch<SetStateAction<Layout | null>>;
  setGraphNodes: Dispatch<SetStateAction<GraphNode[]>>;
  setStatus: Dispatch<SetStateAction<string>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  load: () => Promise<void>;
  previewCache: MutableRefObject<Record<string, string>>;
  setAssetPreviews: Dispatch<SetStateAction<Record<string, string>>>;
  screenToFlowPosition: (point: { x: number; y: number }) => { x: number; y: number };
}) {
  const { standaloneDemo, bootstrap, project, layout, manifest, graphNodes, graphNodesRef, setProject, setLayout, setGraphNodes, setStatus, setBusy, load, previewCache, setAssetPreviews, screenToFlowPosition } = params;

  const [createMenu, setCreateMenu] = useState(false);
  const [linkComposer, setLinkComposer] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [activeDocument, setActiveDocument] = useState<GraphNode | null>(null);
  const [activeViewer, setActiveViewer] = useState<GraphNode | null>(null);
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [editorMode, setEditorMode] = useState<"write" | "preview">("write");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const fileInput = useRef<HTMLInputElement>(null);
  const imageAction = useRef<"node" | "cover" | "embedded">("node");
  const editorTextArea = useRef<HTMLTextAreaElement>(null);
  const saveStateRef = useRef<SaveState>(saveState);
  const activeDocumentRef = useRef<GraphNode | null>(null);

  useEffect(() => { saveStateRef.current = saveState; }, [saveState]);
  useEffect(() => { activeDocumentRef.current = activeDocument; }, [activeDocument]);

  function canvasCenter() { return screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }); }
  function defaultSemanticType() { return manifest?.scenePack.nodeTypes[0]?.key ?? "idea"; }

  function createDemoNode(title: string, content: NodeContent, preview?: string) {
    if (!project || !layout) return null;
    const id = crypto.randomUUID(); const timestamp = new Date().toISOString(); const point = canvasCenter();
    const node: GraphNode = { id, projectId: project.id, type: defaultSemanticType(), title, contentKind: content.kind, content, properties: {}, archived: false, createdAt: timestamp, updatedAt: timestamp };
    const width = content.kind === "link" ? 300 : content.kind === "image" ? 320 : 280; const height = content.kind === "image" ? 220 : content.kind === "link" ? 180 : 160;
    if (content.kind === "image" && preview) { previewCache.current[content.assetId] = preview; setAssetPreviews({ ...previewCache.current }); node.assets = [{ id: content.assetId, width, height, mimeType: "image/png", thumbnailUri: "" }]; }
    setGraphNodes((current) => [...current, node]); setProject({ ...project, graphRevision: project.graphRevision + 1 }); setLayout({ ...layout, graphRevision: project.graphRevision + 1, layoutRevision: layout.layoutRevision + 1, nodes: { ...layout.nodes, [id]: { nodeId: id, x: point.x, y: point.y, width, height, pinned: false } } });
    return node;
  }

  async function createNoteAt(point: { x: number; y: number }) {
    if (!project || !layout) return null;
    const content: DocumentContent = { kind: "document", mode: "note", markdown: "", excerpt: "", embeddedAssetIds: [] };
    if (standaloneDemo) return createDemoNode("Untitled note", content);
    try {
      const output = await callTool<CanvasMutationResult>("weaver_canvas_action", { action: "create_node", workspaceDir: bootstrap.workspaceDir, projectId: project.id, viewId: layout.viewId, semanticType: defaultSemanticType(), title: "Untitled note", content, x: point.x, y: point.y });
      setProject(output.project); setLayout(output.layout); await load(); await openDocument(output.node.id, output.node); return output.node;
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); return null; }
  }

  async function createArticle() {
    if (!project || !layout) return; setCreateMenu(false); const content: DocumentContent = { kind: "document", mode: "article", markdown: "", excerpt: "", embeddedAssetIds: [] };
    if (standaloneDemo) { const node = createDemoNode("Untitled article", content); if (node) openDocument(node.id, node); return; }
    const point = canvasCenter(); const output = await callTool<CanvasMutationResult>("weaver_canvas_action", { action: "create_node", workspaceDir: bootstrap.workspaceDir, projectId: project.id, viewId: layout.viewId, semanticType: defaultSemanticType(), title: "Untitled article", content, x: point.x, y: point.y }); setProject(output.project); setLayout(output.layout); await load(); await openDocument(output.node.id, output.node);
  }

  function chooseImage(action: "node" | "cover" | "embedded") { imageAction.current = action; fileInput.current?.click(); }
  async function fileBase64(file: File) { return new Promise<string>((resolveValue, reject) => { const reader = new FileReader(); reader.onload = () => resolveValue(String(reader.result).split(",", 2)[1] ?? ""); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); }); }

  async function importImageFile(file: File, action = imageAction.current) {
    if (!project || !layout) return;
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) { setStatus("Choose a JPEG, PNG, WebP, or GIF image."); return; }
    if (file.size > 20 * 1024 * 1024) { setStatus("Image is larger than the 20MB limit."); return; }
    setBusy(true);
    try {
      if (standaloneDemo) { const preview = URL.createObjectURL(file); if (action === "node") createDemoNode(file.name, { kind: "image", assetId: crypto.randomUUID(), alt: file.name, caption: "" }, preview); else if (activeDocument?.content.kind === "document" && draft) { const assetId = crypto.randomUUID(); previewCache.current[assetId] = preview; setAssetPreviews({ ...previewCache.current }); setDraft({ ...draft, coverAssetId: action === "cover" ? assetId : draft.coverAssetId, embeddedAssetIds: action === "embedded" ? [...draft.embeddedAssetIds, assetId] : draft.embeddedAssetIds }); setSaveState("dirty"); } return; }
      const imported = await callTool<ImportAssetResult>("weaver_import_asset", { source: "bytes", workspaceDir: bootstrap.workspaceDir, projectId: project.id, mimeType: file.type, base64: await fileBase64(file) });
      if (action === "node") { const point = canvasCenter(); await callTool("weaver_canvas_action", { action: "create_node", workspaceDir: bootstrap.workspaceDir, projectId: project.id, viewId: layout.viewId, semanticType: defaultSemanticType(), title: file.name.replace(/\.[^.]+$/, ""), content: { kind: "image", assetId: imported.assetId, alt: file.name, caption: "" }, x: point.x, y: point.y }); await load(); }
      else if (activeDocument) { const output = await callTool<CanvasMutationResult>("weaver_canvas_action", { action: "attach_asset", workspaceDir: bootstrap.workspaceDir, projectId: project.id, nodeId: activeDocument.id, assetId: imported.assetId, role: action, baseGraphRevision: project.graphRevision }); setProject(output.project); await openDocument(activeDocument.id); await load(); }
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = ""; }
  }

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => { const target = event.target as HTMLElement | null; if (target?.closest("input, textarea, [contenteditable='true']")) return; const image = [...(event.clipboardData?.items ?? [])].find((item) => item.type.startsWith("image/"))?.getAsFile(); if (image) { event.preventDefault(); void importImageFile(image, "node"); } };
    window.addEventListener("paste", onPaste); return () => window.removeEventListener("paste", onPaste);
  }, [project, layout, standaloneDemo]);

  async function createLink() {
    if (!project || !layout || !linkUrl.trim()) return;
    let url: URL; try { url = new URL(linkUrl.trim()); if (!["http:", "https:"].includes(url.protocol)) throw new Error(); } catch { setStatus("Enter a public HTTP or HTTPS URL."); return; }
    setBusy(true);
    try {
      const content: LinkContent = { kind: "link", url: url.href, title: url.hostname, description: "", domain: url.hostname, enrichmentStatus: "pending" };
      if (standaloneDemo) createDemoNode(url.hostname, { ...content, title: `Reference from ${url.hostname}`, description: "Development preview link card.", enrichmentStatus: "ready" });
      else { const point = canvasCenter(); const created = await callTool<CanvasMutationResult>("weaver_canvas_action", { action: "create_node", workspaceDir: bootstrap.workspaceDir, projectId: project.id, viewId: layout.viewId, semanticType: defaultSemanticType(), title: url.hostname, content, x: point.x, y: point.y }); try { await callTool("weaver_canvas_action", { action: "enrich_link", workspaceDir: bootstrap.workspaceDir, projectId: project.id, nodeId: created.node.id, baseGraphRevision: created.project.graphRevision }); } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); } await load(); }
      setLinkUrl(""); setLinkComposer(false); setCreateMenu(false);
    } finally { setBusy(false); }
  }

  async function openDocument(nodeId: string, knownNode?: GraphNode) {
    const summary = knownNode ?? graphNodes.find((node) => node.id === nodeId); if (!summary || summary.contentKind !== "document") return;
    try { const full = standaloneDemo ? summary : (await callTool<{ node: GraphNode }>("weaver_read_graph", { resource: "node", workspaceDir: bootstrap.workspaceDir, projectId: summary.projectId, nodeId })).node; const content = full.content as DocumentContent; setActiveDocument(full); setDraft({ title: full.title, semanticType: full.type, markdown: content.markdown ?? "", excerpt: content.excerpt, coverAssetId: content.coverAssetId, embeddedAssetIds: content.embeddedAssetIds }); setSaveState("saved"); setEditorMode("write"); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  }

  async function openNodeViewer(nodeId: string) {
    const summary = graphNodesRef.current.find((node) => node.id === nodeId); if (!summary) return;
    try {
      const node = summary.contentKind === "document" && !standaloneDemo
        ? (await callTool<{ node: GraphNode }>("weaver_read_graph", { resource: "node", workspaceDir: bootstrap.workspaceDir, projectId: summary.projectId, nodeId })).node
        : summary;
      setActiveViewer(node);
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  }

  async function saveDocument() {
    if (!activeDocument || !draft || !project || activeDocument.content.kind !== "document" || saveState === "saving") return true;
    const content: DocumentContent = { kind: "document", mode: activeDocument.content.mode, markdown: draft.markdown, excerpt: excerpt(draft.markdown), coverAssetId: draft.coverAssetId, embeddedAssetIds: draft.embeddedAssetIds };
    if (standaloneDemo) { const updated = { ...activeDocument, title: draft.title, type: draft.semanticType, content, updatedAt: new Date().toISOString() }; setActiveDocument(updated); setGraphNodes((current) => current.map((node) => node.id === updated.id ? updated : node)); setProject({ ...project, graphRevision: project.graphRevision + 1 }); saveStateRef.current = "saved"; setSaveState("saved"); return true; }
    setSaveState("saving");
    try { const output = await callTool<CanvasMutationResult>("weaver_canvas_action", { action: "update_node", workspaceDir: bootstrap.workspaceDir, projectId: project.id, nodeId: activeDocument.id, baseGraphRevision: project.graphRevision, title: draft.title, semanticType: draft.semanticType, content }); setProject(output.project); setActiveDocument(output.node); setGraphNodes((current) => current.map((node) => node.id === output.node.id ? { ...node, title: output.node.title, type: output.node.type, content: { ...output.node.content, markdown: "" } } : node)); saveStateRef.current = "saved"; setSaveState("saved"); setStatus(`Article saved · graph r${output.project.graphRevision}`); return true; }
    catch (error) { const message = error instanceof Error ? error.message : String(error); const nextState = message.includes("GRAPH_REVISION_CONFLICT") ? "conflict" : "dirty"; saveStateRef.current = nextState; setSaveState(nextState); setStatus(message); return false; }
  }

  useEffect(() => { if (saveState !== "dirty" || !draft) return; const timer = window.setTimeout(() => void saveDocument(), 800); return () => window.clearTimeout(timer); }, [draft, saveState]);

  function editDraft(patch: Partial<EditorDraft>) { setDraft((current) => current ? { ...current, ...patch } : current); setSaveState("dirty"); }
  function formatMarkdown(prefix: string, suffix = "") { const textarea = editorTextArea.current; if (!textarea || !draft) return; const start = textarea.selectionStart; const end = textarea.selectionEnd; const selected = draft.markdown.slice(start, end); editDraft({ markdown: `${draft.markdown.slice(0, start)}${prefix}${selected}${suffix}${draft.markdown.slice(end)}` }); requestAnimationFrame(() => { textarea.focus(); textarea.setSelectionRange(start + prefix.length, end + prefix.length); }); }

  return {
    createMenu, setCreateMenu, linkComposer, setLinkComposer, linkUrl, setLinkUrl, activeDocument, setActiveDocument, activeViewer, setActiveViewer, draft, editorMode, setEditorMode, saveState, setSaveState,
    fileInput, editorTextArea, saveStateRef, activeDocumentRef,
    createNoteAt, createArticle, chooseImage, importImageFile, createLink, openDocument, openNodeViewer, saveDocument, editDraft, formatMarkdown,
  };
}
