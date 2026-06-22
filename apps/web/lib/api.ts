export type ApiStatus = {
  ok: boolean;
  label: string;
  detail?: string;
};

export type ProjectSummary = {
  id: string;
  title: string;
  status: "drafting" | "thinking" | "shipped";
  node_count: number;
  branch_count: number;
  updated_at: string;
};

export type QuickNoteView = {
  id: string;
  text: string;
  created_at: string;
  promoted_project_id: string | null;
};

export type ThoughtNodeView = {
  id: string;
  project_id: string;
  parent_id: string | null;
  title: string;
  body: string;
  status: string;
  order_index: number;
  tag: string;
  x: number;
  y: number;
};

export type ForestView = {
  project_id: string;
  nodes: ThoughtNodeView[];
  roots: string[];
  children: Record<string, string[]>;
  focused_node_id: string | null;
};

export type BranchContext = {
  target_node_id: string;
  chain: Array<{ node_id: string; title: string; body: string }>;
  excluded_dead_end_ids: string[];
  grounding_enabled: boolean;
  policy_fingerprint: string;
};

export type ForkProposal = {
  title: string;
  prompt: string;
  suggested_label: string;
};

export type DraftCitation = {
  id: string;
  source_label: string;
  quote: string;
  source_node_id: string;
  deep_link: string;
};

export type DraftView = {
  id: string;
  project_id: string;
  title: string;
  voice: "Academic" | "Casual" | "Professional" | string;
  format: string;
  source_branch_node_ids: string[];
  paragraphs: string[];
  citations: DraftCitation[];
  grounded: boolean;
};

export type ExportView = {
  id: string;
  draft_id: string;
  target: "markdown" | string;
  citations_preserved: boolean;
  download_url: string;
};

export type PermissionSet = {
  auto_run_readonly: boolean;
  allow_file_edits: boolean;
  network_access: boolean;
};

export type BackendView = {
  id: string;
  name: string;
  kind: "api_sdk" | "cli_agent" | "fake";
  provider: string;
  model: string;
  version: string;
  enabled: boolean;
  is_default: boolean;
  has_api_key: boolean;
  permissions: PermissionSet;
};

export type BackendHealthView = {
  id: string;
  ok: boolean;
  detail: string | null;
  latency_ms: number | null;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  });
  if (!res.ok) {
    throw new Error(`API request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function pingApi(): Promise<ApiStatus> {
  try {
    const res = await fetch(`${API_BASE}/ping`, { cache: "no-store" });
    if (!res.ok) {
      return { ok: false, label: `API ${res.status}` };
    }
    const data = (await res.json()) as { status?: string; service?: string };
    return {
      ok: data.status === "ok",
      label: data.status === "ok" ? "API connected" : "API degraded",
      detail: data.service
    };
  } catch {
    return { ok: false, label: "API offline" };
  }
}

export async function fetchProjects(): Promise<ProjectSummary[]> {
  return apiJson<ProjectSummary[]>("/api/v1/projects");
}

export async function fetchQuickNotes(): Promise<QuickNoteView[]> {
  return apiJson<QuickNoteView[]>("/api/v1/quicknotes");
}

export async function createProject(title: string): Promise<ProjectSummary> {
  return apiJson<ProjectSummary>("/api/v1/projects", {
    method: "POST",
    body: JSON.stringify({ title })
  });
}

export async function createQuickNote(text: string): Promise<QuickNoteView> {
  return apiJson<QuickNoteView>("/api/v1/quicknotes", {
    method: "POST",
    body: JSON.stringify({ text })
  });
}

export async function promoteQuickNote(quickNoteId: string): Promise<{
  project: ProjectSummary;
  quicknote: QuickNoteView;
}> {
  return apiJson(`/api/v1/quicknotes/${quickNoteId}/promote`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function fetchForest(projectId: string): Promise<ForestView> {
  return apiJson<ForestView>(`/api/v1/projects/${projectId}/nodes`);
}

export async function fetchNodeContext(nodeId: string): Promise<BranchContext> {
  return apiJson<BranchContext>(`/api/v1/nodes/${nodeId}/context`);
}

export async function proposeForks(nodeId: string): Promise<{ proposals: ForkProposal[] }> {
  return apiJson<{ proposals: ForkProposal[] }>(`/api/v1/nodes/${nodeId}/fork/propose`, {
    method: "POST",
    body: JSON.stringify({})
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
          tag: proposal.suggested_label
        }
      ]
    })
  });
}

export async function generateDraft(
  projectId: string,
  payload: {
    source_branch_node_ids: string[];
    outline_id: string | null;
    voice: string;
    format: string;
  }
): Promise<DraftView> {
  return apiJson<DraftView>(`/api/v1/projects/${projectId}/drafts`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function createDraftExport(draftId: string): Promise<ExportView> {
  return apiJson<ExportView>(`/api/v1/drafts/${draftId}/exports`, {
    method: "POST",
    body: JSON.stringify({ target: "markdown" })
  });
}

export async function downloadExportMarkdown(downloadUrl: string): Promise<string> {
  const res = await fetch(`${API_BASE}${downloadUrl}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Export download failed: ${res.status}`);
  }
  return res.text();
}

export async function fetchBackends(): Promise<BackendView[]> {
  return apiJson<BackendView[]>("/api/v1/backends");
}

export async function updateBackend(
  backendId: string,
  payload: Partial<Pick<BackendView, "name" | "model" | "enabled" | "is_default" | "permissions">>
): Promise<BackendView> {
  return apiJson<BackendView>(`/api/v1/backends/${backendId}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export async function testBackendHealth(backendId: string): Promise<BackendHealthView> {
  return apiJson<BackendHealthView>(`/api/v1/backends/${backendId}/health`, {
    method: "POST",
    body: JSON.stringify({})
  });
}
