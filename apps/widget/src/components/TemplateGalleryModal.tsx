import { Loader2, PanelLeftClose, Search, Sparkles, LayoutTemplate, X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { Layout, Project, ProjectView, TemplateValidation, VisualFamily, VisualTemplate } from "../types";
import { useI18n } from "../lib/i18n";

export function TemplateGalleryModal({
  templateGallery, setTemplateGallery, templateMode, project, templateFamily, setTemplateFamily, templateSearch, setTemplateSearch, filteredTemplates, projectViews, selectedTemplate, setSelectedTemplate, chooseVisualTemplate,
  visualPreviewItems, templateTitle, setTemplateTitle, templateGoal, setTemplateGoal, templateScenePackId, setTemplateScenePackId, templateViewName, setTemplateViewName, templateInstances, switchView, templateValidation, templatePreview, busy, applyVisualTemplate, duplicateViewConfirmed,
}: {
  templateGallery: boolean;
  setTemplateGallery: Dispatch<SetStateAction<boolean>>;
  templateMode: "project" | "view";
  project: Project | null;
  templateFamily: VisualFamily | "all";
  setTemplateFamily: Dispatch<SetStateAction<VisualFamily | "all">>;
  templateSearch: string;
  setTemplateSearch: Dispatch<SetStateAction<string>>;
  filteredTemplates: VisualTemplate[];
  projectViews: ProjectView[];
  selectedTemplate: VisualTemplate | null;
  setSelectedTemplate: Dispatch<SetStateAction<VisualTemplate | null>>;
  chooseVisualTemplate: (template: VisualTemplate) => void | Promise<void>;
  visualPreviewItems: Array<{ key: string; label: string; x: number; y: number }>;
  templateTitle: string;
  setTemplateTitle: Dispatch<SetStateAction<string>>;
  templateGoal: string;
  setTemplateGoal: Dispatch<SetStateAction<string>>;
  templateScenePackId: string;
  setTemplateScenePackId: Dispatch<SetStateAction<string>>;
  templateViewName: string;
  setTemplateViewName: Dispatch<SetStateAction<string>>;
  templateInstances: ProjectView[];
  switchView: (viewId: string) => void | Promise<void>;
  templateValidation: TemplateValidation | null;
  templatePreview: Layout | null;
  busy: boolean;
  applyVisualTemplate: () => void | Promise<void>;
  duplicateViewConfirmed: boolean;
}) {
  const { t } = useI18n();
  if (!templateGallery) return null;
  return <div className="template-gallery-backdrop" role="presentation"><section className="template-gallery" role="dialog" aria-modal="true" aria-label={t("visualGallery")}>
    <header><div><span>{t("visualSystem")}</span><h2>{templateMode === "project" ? t("createFromTemplate") : t("newVisualView")}</h2><p>{templateMode === "project" ? t("visualTemplateHint") : t("visualViewHint")}</p></div>{project ? <button aria-label={t("closeTemplateGallery")} onClick={() => setTemplateGallery(false)}><X size={19} /></button> : null}</header>
    <div className="template-gallery-body">
      <aside className="template-families"><button data-active={templateFamily === "all"} onClick={() => setTemplateFamily("all")}>{t("allVisuals")}</button>{(["canvas", "hierarchy", "relationship", "flow", "temporal", "board", "matrix", "table"] as VisualFamily[]).map((family) => <button key={family} data-active={templateFamily === family} onClick={() => setTemplateFamily(family)}>{family}</button>)}</aside>
      <section className="template-catalog"><label className="template-search"><Search size={15} /><input aria-label={t("searchTemplates")} placeholder={t("searchTemplates")} value={templateSearch} onChange={(event) => setTemplateSearch(event.target.value)} /></label><div className="template-grid">{filteredTemplates.map((template) => { const existingCount = projectViews.filter((view) => view.status === "active" && view.templateRef?.id === template.id).length; return <button key={template.id} className="template-card" data-selected={selectedTemplate?.id === template.id} onClick={() => void chooseVisualTemplate(template)}><div className="template-thumbnail" style={{ background: template.theme.canvas.backgroundColor, color: template.theme.nodeStyles.default?.accentColor }}><i /><i /><i /><i /><span>{template.projection.kind}</span></div><strong>{template.name}{existingCount ? <em>{existingCount} {t("existing")}</em> : null}</strong><small>{template.family} · {template.renderer}</small><p>{template.description}</p></button>; })}</div></section>
      <aside className="template-detail" data-selected={Boolean(selectedTemplate)}>{selectedTemplate ? <>
        <button className="template-detail-back" onClick={() => setSelectedTemplate(null)}><PanelLeftClose size={15} /> {t("backToTemplates")}</button>
        <div className="template-detail-preview" style={{ background: selectedTemplate.theme.canvas.backgroundColor, "--preview-accent": selectedTemplate.theme.nodeStyles.default?.accentColor } as React.CSSProperties}>{visualPreviewItems.map((item, index) => <div className={index === 0 ? "preview-root" : "preview-node"} key={item.key} style={{ left: item.x, top: item.y, transform: "translate(-50%, -50%)" }} title={item.label}>{item.label.slice(0, 18)}</div>)}</div>
        <span className="template-kind">{selectedTemplate.family} · {selectedTemplate.layoutPreset.strategy}</span><h3>{selectedTemplate.name}</h3><p>{selectedTemplate.description}</p>
        {templateMode === "project" ? <div className="template-form"><label>{t("projectTitle")}<input value={templateTitle} onChange={(event) => setTemplateTitle(event.target.value)} /></label><label>{t("goal")}<textarea value={templateGoal} onChange={(event) => setTemplateGoal(event.target.value)} placeholder={t("goalPlaceholder")} /></label><label>{t("scenePack")}<select value={templateScenePackId} onChange={(event) => setTemplateScenePackId(event.target.value)}>{selectedTemplate.compatibleScenePackIds.map((id) => <option key={id} value={id}>{id}</option>)}</select></label></div> : <>
          <div className="template-form"><label>{t("viewName")}<input value={templateViewName} onChange={(event) => setTemplateViewName(event.target.value)} placeholder={t("viewNamePlaceholder")} /></label></div>
          {templateInstances.length ? <div className="existing-template-views"><strong>{templateInstances.length} {t("existingViews")}</strong><p>{t("existingViewsHint")}</p>{templateInstances.map((view) => <button key={view.id} onClick={() => { setTemplateGallery(false); void switchView(view.id); }}><span>{view.name}</span><small>{t("open")}</small></button>)}</div> : null}
          <div className="template-readiness" data-ready={templateValidation?.ready}>{busy && !templateValidation ? t("checkingData") : templateValidation?.ready ? `${templateValidation.matchedNodeCount} ${t("dataReady")}` : templateValidation ? `${templateValidation.missingRequiredFields.length} ${t("valuesMissing")}` : t("selectToValidate")}{templateValidation?.missingRequiredFields.length ? <small>{t("missing")}: {[...new Set(templateValidation.missingRequiredFields.map((item) => item.propertyKey))].join(", ")}</small> : null}{templatePreview ? <small>{t("previewGenerated")}{templatePreview.graphRevision}</small> : null}</div>
        </>}
        <button className="use-template" onClick={() => void applyVisualTemplate()} disabled={busy || (templateMode === "view" && (!templateValidation?.ready || !templateViewName.trim()))}>{busy ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}{templateMode === "project" ? t("createProject") : templateInstances.length && !duplicateViewConfirmed ? t("createAnotherView") : t("createNewView")}</button>
      </> : <div className="template-empty"><LayoutTemplate size={38} /><strong>{t("selectTemplate")}</strong><p>{t("selectTemplateHint")}</p></div>}</aside>
    </div>
  </section></div>;
}
