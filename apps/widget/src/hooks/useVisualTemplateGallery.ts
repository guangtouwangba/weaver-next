import { useMemo, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { callTool, createMutationId, isLocalDevelopment } from "../mcp-client";
import { findTemplateInstances } from "../sync";
import type { Bootstrap, ChatBindingBootstrap, GraphNode, Layout, Project, ProjectView, TemplateValidation, VisualFamily, VisualTemplate } from "../types";

// Domain G: visual template gallery (project-from-template and view-from-template flows).
export function useVisualTemplateGallery(params: {
  bootstrap: Bootstrap;
  setBootstrap: Dispatch<SetStateAction<Bootstrap>>;
  project: Project | null;
  graphNodes: GraphNode[];
  projectViews: ProjectView[];
  ensureBindingTarget: (projectId: string, viewId: string) => Promise<ChatBindingBootstrap | undefined>;
  bindingRef: MutableRefObject<ChatBindingBootstrap | undefined>;
  setStatus: Dispatch<SetStateAction<string>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setActiveViewId: Dispatch<SetStateAction<string>>;
  resetLayoutRun: () => void;
  // Domain F's create-menu setter — openTemplateGallery closes the top-bar "Create" menu when opened, as in the original component.
  setCreateMenu: Dispatch<SetStateAction<boolean>>;
  templateGallery: boolean;
  setTemplateGallery: Dispatch<SetStateAction<boolean>>;
  templateMode: "project" | "view";
  setTemplateMode: Dispatch<SetStateAction<"project" | "view">>;
  templates: VisualTemplate[];
  setTemplates: Dispatch<SetStateAction<VisualTemplate[]>>;
}) {
  const { bootstrap, setBootstrap, project, graphNodes, projectViews, ensureBindingTarget, bindingRef, setStatus, setBusy, setActiveViewId, resetLayoutRun, setCreateMenu, templateGallery, setTemplateGallery, templateMode, setTemplateMode, templates, setTemplates } = params;

  const [templateFamily, setTemplateFamily] = useState<VisualFamily | "all">("all");
  const [templateSearch, setTemplateSearch] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<VisualTemplate | null>(null);
  const [templateValidation, setTemplateValidation] = useState<TemplateValidation | null>(null);
  const [templatePreview, setTemplatePreview] = useState<Layout | null>(null);
  const [templateTitle, setTemplateTitle] = useState("New Weaver space");
  const [templateGoal, setTemplateGoal] = useState("");
  const [templateScenePackId, setTemplateScenePackId] = useState("free-brainstorming");
  const [templateViewName, setTemplateViewName] = useState("");
  const [duplicateViewConfirmed, setDuplicateViewConfirmed] = useState(false);

  async function openTemplateGallery(mode: "project" | "view") {
    setCreateMenu(false); setTemplateMode(mode); setTemplateGallery(true); setSelectedTemplate(null); setTemplateValidation(null); setTemplatePreview(null); setTemplateSearch(""); setTemplateFamily("all");
    setBusy(true);
    try { setTemplates(await callTool<VisualTemplate[]>("weaver_read_catalog", { workspaceDir: bootstrap.workspaceDir, resource: "template.list", ...(mode === "view" && project ? { scenePackId: project.scenePackId } : {}) })); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function chooseVisualTemplate(template: VisualTemplate) {
    setSelectedTemplate(template); setTemplateScenePackId(templateMode === "view" && project ? project.scenePackId : template.defaultScenePackId); setTemplateViewName(template.name); setDuplicateViewConfirmed(false); setTemplateValidation(null); setTemplatePreview(null);
    if (templateMode !== "view" || !project) return;
    setBusy(true);
    try {
      const [validation, preview] = await Promise.all([
        callTool<TemplateValidation>("weaver_read_catalog", { workspaceDir: bootstrap.workspaceDir, resource: "template.validate", projectId: project.id, templateId: template.id, version: template.version }),
        callTool<Layout>("weaver_read_catalog", { workspaceDir: bootstrap.workspaceDir, resource: "template.preview", projectId: project.id, templateId: template.id, version: template.version, baseGraphRevision: project.graphRevision, viewName: template.name }),
      ]);
      setTemplateValidation(validation); setTemplatePreview(preview);
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function applyVisualTemplate() {
    if (!selectedTemplate || !bootstrap.workspaceDir) return;
    setBusy(true);
    try {
      if (templateMode === "project") {
        const currentBinding = bindingRef.current;
        const created = await callTool<{ project: Project; binding?: ChatBindingBootstrap }>("weaver_catalog_action", { action: "create_project_from_template", mutationId: createMutationId(), workspaceDir: bootstrap.workspaceDir, title: templateTitle.trim() || selectedTemplate.name, goal: templateGoal, scenePackId: templateScenePackId, templateId: selectedTemplate.id, version: selectedTemplate.version, leaseId: !isLocalDevelopment ? currentBinding?.leaseId : undefined, bindingRevision: !isLocalDevelopment ? currentBinding?.bindingRevision : undefined });
        const nextBinding = created.binding ? { ...created.binding, projectId: created.project.id, viewId: created.project.defaultViewId } : undefined;
        bindingRef.current = nextBinding;
        setActiveViewId(""); setBootstrap((current) => ({ ...current, projectId: created.project.id, chatBinding: nextBinding })); setStatus(`Created ${created.project.title} from ${selectedTemplate.name}`);
      } else if (project) {
        if (!templateValidation?.ready) throw new Error("VISUAL_TEMPLATE_DATA_NOT_READY");
        if (templateInstances.length && !duplicateViewConfirmed) { setDuplicateViewConfirmed(true); setStatus("Review existing Views before creating another copy"); return; }
        const next = await callTool<Layout & { chatBinding?: ChatBindingBootstrap }>("weaver_catalog_action", { action: "create_view_from_template", mutationId: createMutationId(), workspaceDir: bootstrap.workspaceDir, projectId: project.id, templateId: selectedTemplate.id, version: selectedTemplate.version, baseGraphRevision: project.graphRevision, viewName: templateViewName.trim() || selectedTemplate.name });
        if (next.chatBinding) { bindingRef.current = next.chatBinding; setBootstrap((current) => ({ ...current, chatBinding: next.chatBinding })); }
        else await ensureBindingTarget(project.id, next.viewId);
        setActiveViewId(next.viewId); setStatus(`Created visual view · ${next.viewName}`);
      }
      setTemplateGallery(false); setSelectedTemplate(null); resetLayoutRun();
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  const filteredTemplates = useMemo(() => templates.filter((item) => (templateFamily === "all" || item.family === templateFamily) && `${item.name} ${item.description}`.toLowerCase().includes(templateSearch.toLowerCase())), [templateFamily, templateSearch, templates]);
  const templateInstances = useMemo(() => selectedTemplate ? findTemplateInstances(projectViews, selectedTemplate.id) : [], [projectViews, selectedTemplate]);
  const visualPreviewItems = useMemo(() => {
    if (templatePreview) {
      const entries = graphNodes.slice(0, 10).map((node) => ({ key: node.id, label: node.title, frame: templatePreview.nodes[node.id] })).filter((item) => item.frame);
      if (entries.length) { const xs = entries.map((item) => item.frame.x); const ys = entries.map((item) => item.frame.y); const minX = Math.min(...xs); const minY = Math.min(...ys); const width = Math.max(1, Math.max(...xs) - minX); const height = Math.max(1, Math.max(...ys) - minY); return entries.map((item) => ({ key: item.key, label: item.label, x: 12 + (item.frame.x - minX) / width * 176, y: 18 + (item.frame.y - minY) / height * 145 })); }
    }
    return selectedTemplate?.starterBlueprint.nodes.slice(0, 7).map((node, index) => ({ key: node.key, label: node.role, x: index === 0 ? 100 : 100 + Math.cos((index - 1) * Math.PI * 2 / Math.max((selectedTemplate.starterBlueprint.nodes.length - 1), 1)) * 76, y: index === 0 ? 90 : 90 + Math.sin((index - 1) * Math.PI * 2 / Math.max((selectedTemplate.starterBlueprint.nodes.length - 1), 1)) * 62 })) ?? [];
  }, [graphNodes, selectedTemplate, templatePreview]);

  return {
    templateFamily, setTemplateFamily, templateSearch, setTemplateSearch, selectedTemplate, setSelectedTemplate, templateValidation, templatePreview, templateTitle, setTemplateTitle, templateGoal, setTemplateGoal, templateScenePackId, setTemplateScenePackId, templateViewName, setTemplateViewName, duplicateViewConfirmed,
    filteredTemplates, templateInstances, visualPreviewItems,
    openTemplateGallery, chooseVisualTemplate, applyVisualTemplate,
  };
}
