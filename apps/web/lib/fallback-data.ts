import {
  BackendView,
  DraftView,
  ForestView,
  ProjectSummary,
  QuickNoteView,
  ThoughtNodeView
} from "./api";

export const fallbackProjects: ProjectSummary[] = [
  {
    id: "proj_subscription_fatigue",
    status: "drafting",
    updated_at: "2h ago",
    title: "Subscription fatigue & independent media",
    node_count: 7,
    branch_count: 3
  },
  {
    id: "proj_tools_for_thought",
    status: "thinking",
    updated_at: "yesterday",
    title: 'Why "tools for thought" keep failing',
    node_count: 12,
    branch_count: 5
  },
  {
    id: "proj_engagement_metrics",
    status: "shipped",
    updated_at: "Jun 14",
    title: "The case against engagement metrics",
    node_count: 9,
    branch_count: 4
  },
  {
    id: "proj_open_source_ai",
    status: "thinking",
    updated_at: "Jun 9",
    title: "Is open-source AI a moat or a meme?",
    node_count: 5,
    branch_count: 2
  }
];

export const fallbackQuickNotes: QuickNoteView[] = [
  { id: "note_substack", text: "Substack churn vs growth slowdown - separate them", created_at: "2h", promoted_project_id: null },
  { id: "note_attention", text: 'Is "attention recession" overhyped or real?', created_at: "yesterday", promoted_project_id: null },
  { id: "note_bundle", text: "Bundle economics: who captures the surplus?", created_at: "Jun 19", promoted_project_id: null }
];

export function withNodeDefaults(node: Omit<ThoughtNodeView, "kind" | "collapsed"> & Partial<Pick<ThoughtNodeView, "kind" | "collapsed">>): ThoughtNodeView {
  return {
    ...node,
    kind: node.kind ?? "user_thought",
    collapsed: node.collapsed ?? false
  };
}

export const fallbackForest: ForestView = {
  project_id: "proj_subscription_fatigue",
  focused_node_id: "node_demand",
  roots: ["node_root"],
  children: {
    node_root: ["node_supply", "node_demand", "node_pricing"],
    node_supply: ["node_bundle", "node_free"],
    node_demand: ["node_attention"],
    node_pricing: [],
    node_bundle: [],
    node_free: [],
    node_attention: []
  },
  nodes: [
    { id: "node_root", project_id: "proj_subscription_fatigue", parent_id: null, tag: "ROOT QUESTION", x: 52, y: 10, title: "Is subscription fatigue actually killing independent media?", body: "Root question.", status: "open", order_index: 0 },
    { id: "node_supply", project_id: "proj_subscription_fatigue", parent_id: "node_root", tag: "SUPPLY-SIDE", x: 28, y: 28, title: "Is it a supply problem - too many newsletters chasing the same inboxes?", body: "Supply-side branch.", status: "open", order_index: 0 },
    { id: "node_demand", project_id: "proj_subscription_fatigue", parent_id: "node_root", tag: "DEMAND-SIDE", x: 60, y: 32, title: "Is it a demand problem - reader attention is finite and saturating?", body: "Demand-side branch.", status: "open", order_index: 1 },
    { id: "node_pricing", project_id: "proj_subscription_fatigue", parent_id: "node_root", tag: "PRICING", x: 76, y: 28, title: "Is it a pricing problem - are paid tiers simply mispriced?", body: "Pricing branch.", status: "dead_end", order_index: 2 },
    { id: "node_bundle", project_id: "proj_subscription_fatigue", parent_id: "node_supply", tag: "SUPPLY-SIDE", x: 18, y: 48, title: "Bundling could pool audiences instead of splitting them.", body: "Bundling branch.", status: "open", order_index: 0 },
    { id: "node_free", project_id: "proj_subscription_fatigue", parent_id: "node_supply", tag: "SUPPLY-SIDE", x: 42, y: 48, title: "Ad-supported free tiers re-expand the top of the funnel.", body: "Free tier branch.", status: "open", order_index: 1 },
    { id: "node_attention", project_id: "proj_subscription_fatigue", parent_id: "node_demand", tag: "DEMAND-SIDE", x: 60, y: 48, title: "Attention is zero-sum: a subscription competes with sleep.", body: "Attention branch.", status: "open", order_index: 0 }
  ].map(withNodeDefaults)
};

export const fallbackDraft: DraftView = {
  id: "draft_sample",
  project_id: "proj_subscription_fatigue",
  title: "Subscription Fatigue Is Real - But It's Not What You Think",
  voice: "Professional",
  format: "Article",
  source_branch_node_ids: ["node_attention", "node_bundle"],
  grounded: true,
  paragraphs: [
    "Subscription fatigue is real - but the word \"fatigue\" quietly misdescribes the problem, and the misnaming is expensive.",
    "The signups haven't stopped. What slowed is the conversion from free to paid - a signature of saturation and churn, not collapse. Read that way, the problem is competition for a fixed resource, and the fixed resource isn't money.",
    "It's time. The binding constraint on media has shifted from wallets to waking hours. A reader can absorb another $7 a month; their evening cannot absorb another hour."
  ],
  citations: [
    {
      id: "c1",
      source_label: "State of Email Newsletters 2026",
      quote: "Net-new paid conversions slowed year over year.",
      source_node_id: "node_attention",
      deep_link: "weaver://source/node_attention#char=0-54"
    },
    {
      id: "c2",
      source_label: "The Attention Recession",
      quote: "The binding constraint is waking hours.",
      source_node_id: "node_bundle",
      deep_link: "weaver://source/node_bundle#char=0-40"
    }
  ]
};

export function fallbackBackends(): BackendView[] {
  return [
    {
      id: "backend_claude",
      name: "Claude Code",
      kind: "cli_agent",
      provider: "anthropic",
      model: "Default (CLI config)",
      version: "2.1.185",
      enabled: true,
      is_default: false,
      has_api_key: false,
      permissions: { auto_run_readonly: false, allow_file_edits: false, network_access: false }
    },
    {
      id: "backend_codex",
      name: "Codex CLI",
      kind: "cli_agent",
      provider: "openai",
      model: "Default (CLI config)",
      version: "codex-cli 0.130.0",
      enabled: true,
      is_default: true,
      has_api_key: false,
      permissions: { auto_run_readonly: true, allow_file_edits: false, network_access: false }
    }
  ];
}
