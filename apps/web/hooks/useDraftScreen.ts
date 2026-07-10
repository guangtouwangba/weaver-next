import { useState } from "react";
import { fallbackDraft } from "../lib/fallback-data";
import { DraftView, createDraftExport, downloadExportMarkdown, generateDraft } from "../lib/api";
import { Voice } from "../lib/types";

export function useDraftScreen(voice: Voice, draftFormat: string) {
  const [draft, setDraft] = useState<DraftView>(fallbackDraft);
  const [draftStatus, setDraftStatus] = useState<"sample" | "generating" | "live" | "exported" | "offline">("sample");
  const [exportPreview, setExportPreview] = useState("");

  async function regenerateDraft() {
    setDraftStatus("generating");
    try {
      const nextDraft = await generateDraft("proj_subscription_fatigue", {
        source_branch_node_ids: ["node_attention", "node_bundle"],
        outline_id: null,
        voice,
        format: draftFormat
      });
      setDraft(nextDraft);
      setExportPreview("");
      setDraftStatus("live");
    } catch {
      setDraftStatus("offline");
    }
  }

  async function exportMarkdown() {
    try {
      const liveDraft = draft.id === "draft_sample" ? await generateDraft("proj_subscription_fatigue", {
        source_branch_node_ids: ["node_attention", "node_bundle"],
        outline_id: null,
        voice,
        format: draftFormat
      }) : draft;
      if (liveDraft.id !== draft.id) setDraft(liveDraft);
      const exportView = await createDraftExport(liveDraft.id);
      const markdown = await downloadExportMarkdown(exportView.download_url);
      setExportPreview(markdown);
      setDraftStatus("exported");
    } catch {
      setDraftStatus("offline");
    }
  }

  return {
    draft,
    draftStatus,
    exportPreview,
    regenerateDraft,
    exportMarkdown
  };
}
