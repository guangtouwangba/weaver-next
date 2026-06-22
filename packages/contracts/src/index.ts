export type ProjectStatus = "drafting" | "thinking" | "shipped";

export type FeatureFlags = {
  relations: boolean;
  compare: boolean;
  multi_format: boolean;
  cli_agents: boolean;
};

export type MetaView = {
  build_version: string;
  api_version: string;
  model_mode: "fake" | "real";
  default_backend_id: string | null;
  features: FeatureFlags;
};

export type ProjectSummary = {
  id: string;
  title: string;
  status: ProjectStatus;
  node_count: number;
  branch_count: number;
  updated_at: string;
};

export type ProjectCreate = {
  title: string;
};

export type QuickNoteView = {
  id: string;
  text: string;
  created_at: string;
  promoted_project_id: string | null;
};

export type QuickNoteCreate = {
  text: string;
};

export type PromoteQuickNoteResponse = {
  project: ProjectSummary;
  quicknote: QuickNoteView;
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

export type DraftGenerateRequest = {
  source_branch_node_ids: string[];
  outline_id: string | null;
  voice: "Academic" | "Casual" | "Professional";
  format: string;
};

export type DraftView = {
  id: string;
  project_id: string;
  title: string;
  voice: string;
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
