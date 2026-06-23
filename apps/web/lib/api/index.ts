import type {
  BackendHealthView,
  BackendView,
  BranchContext,
  DraftView,
  ExportView,
  ForestView,
  ForkProposal,
  PermissionSet,
  ProjectSummary,
  PromoteQuickNoteResponse,
  QuickNoteView,
  ThoughtNodeView,
} from "@weaver/contracts";

import { apiJson, apiText, pingApi } from "./client";
import { streamNdjson } from "./sse";

export type {
  BackendHealthView,
  BackendView,
  BranchContext,
  DraftView,
  ExportView,
  ForestView,
  ForkProposal,
  PermissionSet,
  ProjectSummary,
  PromoteQuickNoteResponse,
  QuickNoteView,
  ThoughtNodeView,
};
export type { ApiStatus } from "./client";
export { apiFetch, apiJson, apiText, pingApi } from "./client";
export { WeaverApiError } from "./errors";
export { decodeTokenEvent, streamNdjson, streamSse } from "./sse";
export type { TokenEvent } from "./sse";

export async function fetchProjects(): Promise<ProjectSummary[]> {
  return apiJson<ProjectSummary[]>("/api/v1/projects");
}

export async function fetchQuickNotes(): Promise<QuickNoteView[]> {
  return apiJson<QuickNoteView[]>("/api/v1/quicknotes");
}

export async function createProject(title: string): Promise<ProjectSummary> {
  return apiJson<ProjectSummary>("/api/v1/projects", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export async function createQuickNote(text: string): Promise<QuickNoteView> {
  return apiJson<QuickNoteView>("/api/v1/quicknotes", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export async function promoteQuickNote(quickNoteId: string): Promise<PromoteQuickNoteResponse> {
  return apiJson<PromoteQuickNoteResponse>(`/api/v1/quicknotes/${quickNoteId}/promote`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function fetchForest(projectId: string): Promise<ForestView> {
  return apiJson<ForestView>(`/api/v1/projects/${projectId}/nodes`);
}

export async function fetchNodeContext(nodeId: string): Promise<BranchContext> {
  return apiJson<BranchContext>(`/api/v1/nodes/${nodeId}/context`);
}

export async function createNode(
  projectId: string,
  payload: {
    parent_id: string | null;
    title: string;
    body: string;
    annotation?: string | null;
    tag?: string;
    kind?: "question_answer" | "ai_reasoning" | "user_thought";
  },
): Promise<ThoughtNodeView> {
  return apiJson<ThoughtNodeView>(`/api/v1/projects/${projectId}/nodes`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function proposeForks(nodeId: string): Promise<{ proposals: ForkProposal[] }> {
  try {
    let finalStructured: unknown = null;
    const streamed: ForkProposal[] = [];
    for await (const event of streamNdjson(`/api/v1/nodes/${nodeId}/fork/propose`, {
      method: "POST",
      headers: { Accept: "application/x-ndjson" },
      body: JSON.stringify({}),
    })) {
      if (event.type === "structured" && event.structured && "proposal" in event.structured) {
        streamed.push(event.structured.proposal as ForkProposal);
      }
      if (event.type === "done") {
        finalStructured = event.structured;
      }
    }
    if (finalStructured && typeof finalStructured === "object" && "proposals" in finalStructured) {
      return { proposals: (finalStructured as { proposals: ForkProposal[] }).proposals };
    }
    if (streamed.length) {
      return { proposals: streamed };
    }
  } catch {
    // Fall through to JSON compatibility path.
  }
  return apiJson<{ proposals: ForkProposal[] }>(`/api/v1/nodes/${nodeId}/fork/propose`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function forkNode(nodeId: string, proposal: ForkProposal): Promise<ThoughtNodeView[]> {
  return apiJson<ThoughtNodeView[]>(`/api/v1/nodes/${nodeId}/fork`, {
    method: "POST",
    body: JSON.stringify({
      branches: [
        {
          title: proposal.title,
          body: proposal.prompt,
          tag: proposal.suggested_label,
        },
      ],
    }),
  });
}

export async function generateDraft(
  projectId: string,
  payload: {
    source_branch_node_ids: string[];
    outline_id: string | null;
    voice: string;
    format: string;
  },
): Promise<DraftView> {
  return apiJson<DraftView>(`/api/v1/projects/${projectId}/drafts`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function createDraftExport(draftId: string): Promise<ExportView> {
  return apiJson<ExportView>(`/api/v1/drafts/${draftId}/exports`, {
    method: "POST",
    body: JSON.stringify({ target: "markdown" }),
  });
}

export async function downloadExportMarkdown(downloadUrl: string): Promise<string> {
  return apiText(downloadUrl);
}

export async function fetchBackends(): Promise<BackendView[]> {
  return apiJson<BackendView[]>("/api/v1/backends");
}

export async function updateBackend(
  backendId: string,
  payload: Partial<Pick<BackendView, "name" | "model" | "enabled" | "is_default" | "permissions">>,
): Promise<BackendView> {
  return apiJson<BackendView>(`/api/v1/backends/${backendId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function testBackendHealth(backendId: string): Promise<BackendHealthView> {
  return apiJson<BackendHealthView>(`/api/v1/backends/${backendId}/health`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}
