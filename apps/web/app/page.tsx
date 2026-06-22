"use client";

import {
  ArrowDownToLine,
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  CirclePlus,
  FileText,
  FolderKanban,
  GitBranch,
  Grid2X2,
  Loader2,
  Mail,
  Minus,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  Sparkles,
  Upload,
  Zap
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  ApiStatus,
  BackendHealthView,
  BackendView,
  BranchContext,
  DraftView,
  ForkProposal,
  ForestView,
  ProjectSummary,
  QuickNoteView,
  createProject,
  createQuickNote,
  fetchForest,
  fetchNodeContext,
  fetchProjects,
  fetchQuickNotes,
  fetchBackends,
  forkNode,
  createDraftExport,
  downloadExportMarkdown,
  generateDraft,
  pingApi,
  proposeForks,
  testBackendHealth,
  updateBackend,
  promoteQuickNote
} from "../lib/api";

type Screen = "workspace" | "think" | "draft" | "settings";
type Voice = "Academic" | "Casual" | "Professional";

const fallbackProjects: ProjectSummary[] = [
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

const fallbackQuickNotes: QuickNoteView[] = [
  { id: "note_substack", text: "Substack churn vs growth slowdown - separate them", created_at: "2h", promoted_project_id: null },
  { id: "note_attention", text: 'Is "attention recession" overhyped or real?', created_at: "yesterday", promoted_project_id: null },
  { id: "note_bundle", text: "Bundle economics: who captures the surplus?", created_at: "Jun 19", promoted_project_id: null }
];

const fallbackForest: ForestView = {
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
  ]
};

const fallbackDraft: DraftView = {
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

export default function Home() {
  const [screen, setScreen] = useState<Screen>("workspace");
  const [voice, setVoice] = useState<Voice>("Professional");
  const [apiStatus, setApiStatus] = useState<ApiStatus>({ ok: false, label: "Checking API" });
  const [workspaceStatus, setWorkspaceStatus] = useState<"loading" | "live" | "offline">("loading");
  const [workspaceProjects, setWorkspaceProjects] = useState<ProjectSummary[]>(fallbackProjects);
  const [workspaceQuickNotes, setWorkspaceQuickNotes] = useState<QuickNoteView[]>(fallbackQuickNotes);
  const [draftFormat, setDraftFormat] = useState("Article");
  const [captureText, setCaptureText] = useState("");
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    void refreshApi();
    void refreshWorkspace();
  }, []);

  async function refreshApi() {
    setIsTesting(true);
    const status = await pingApi();
    setApiStatus(status);
    setIsTesting(false);
  }

  async function refreshWorkspace() {
    try {
      const [projects, quickNotes] = await Promise.all([
        fetchProjects(),
        fetchQuickNotes()
      ]);
      setWorkspaceProjects(projects);
      setWorkspaceQuickNotes(quickNotes);
      setWorkspaceStatus("live");
    } catch {
      setWorkspaceStatus("offline");
      setWorkspaceProjects(fallbackProjects);
      setWorkspaceQuickNotes(fallbackQuickNotes);
    }
  }

  async function handleCreateProject() {
    try {
      const project = await createProject("Untitled branching question");
      setWorkspaceProjects((current) => [project, ...current]);
      setWorkspaceStatus("live");
    } catch {
      const project: ProjectSummary = {
        id: `local_project_${Date.now()}`,
        title: "Untitled branching question",
        status: "thinking",
        node_count: 1,
        branch_count: 1,
        updated_at: "local"
      };
      setWorkspaceProjects((current) => [project, ...current]);
      setWorkspaceStatus("offline");
    }
    setScreen("think");
  }

  async function handleCapture() {
    const text = captureText.trim();
    if (!text) return;
    try {
      const quickNote = await createQuickNote(text);
      setWorkspaceQuickNotes((current) => [quickNote, ...current]);
      setWorkspaceStatus("live");
    } catch {
      const quickNote: QuickNoteView = {
        id: `local_note_${Date.now()}`,
        text,
        created_at: "local",
        promoted_project_id: null
      };
      setWorkspaceQuickNotes((current) => [quickNote, ...current]);
      setWorkspaceStatus("offline");
    }
    setCaptureText("");
  }

  async function handlePromoteQuickNote(quickNoteId: string) {
    try {
      const result = await promoteQuickNote(quickNoteId);
      setWorkspaceProjects((current) => [result.project, ...current]);
      setWorkspaceQuickNotes((current) => current.map((note) => note.id === quickNoteId ? result.quicknote : note));
      setWorkspaceStatus("live");
    } catch {
      const source = workspaceQuickNotes.find((note) => note.id === quickNoteId);
      const project: ProjectSummary = {
        id: `local_project_${Date.now()}`,
        title: source?.text ?? "Promoted quick thought",
        status: "thinking",
        node_count: 1,
        branch_count: 1,
        updated_at: "local"
      };
      setWorkspaceProjects((current) => [project, ...current]);
      setWorkspaceQuickNotes((current) => current.map((note) => note.id === quickNoteId ? { ...note, promoted_project_id: project.id } : note));
      setWorkspaceStatus("offline");
    }
    setScreen("think");
  }

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

function Rail({ screen, setScreen }: { screen: Screen; setScreen: (screen: Screen) => void }) {
  const nav = [
    { id: "workspace" as Screen, icon: Grid2X2, label: "Workspace" },
    { id: "think" as Screen, icon: GitBranch, label: "Thinking tree" },
    { id: "draft" as Screen, icon: FileText, label: "Draft" }
  ];

  return (
    <aside className="rail">
      <button className="logo" onClick={() => setScreen("workspace")} aria-label="Weaver home">W</button>
      <div className="rail-nav">
        {nav.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id} className={`rail-button ${screen === item.id ? "active" : ""}`} onClick={() => setScreen(item.id)} title={item.label} aria-label={item.label}>
              <Icon size={18} />
            </button>
          );
        })}
      </div>
      <div className="rail-bottom">
        <button className={`rail-button ${screen === "settings" ? "active" : ""}`} onClick={() => setScreen("settings")} title="Settings" aria-label="Settings">
          <Settings2 size={18} />
        </button>
        <button className="avatar" aria-label="Account">JL</button>
      </div>
    </aside>
  );
}

function WorkspaceScreen({
  captureText,
  projects,
  quickNotes,
  status,
  onCapture,
  onCreateProject,
  onPromoteQuickNote,
  setCaptureText,
  setScreen
}: {
  captureText: string;
  projects: ProjectSummary[];
  quickNotes: QuickNoteView[];
  status: "loading" | "live" | "offline";
  onCapture: () => void;
  onCreateProject: () => void;
  onPromoteQuickNote: (quickNoteId: string) => void;
  setCaptureText: (value: string) => void;
  setScreen: (screen: Screen) => void;
}) {
  const visibleQuickNotes = quickNotes.filter((note) => !note.promoted_project_id);

  return (
    <section className="workspace-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">WORKSPACE</p>
          <h1>Good afternoon, Jordan.</h1>
          <p>You have {projects.length} thinking projects and {visibleQuickNotes.length} unsorted notes.</p>
        </div>
        <button className="primary-button" onClick={onCreateProject}>
          <Plus size={18} /> New project
        </button>
      </header>

      <section className="capture-panel">
        <div className="panel-title">
          <Mail size={15} />
          <strong>Quick capture</strong>
          <span className="mono-pill">{visibleQuickNotes.length} in inbox</span>
          <span className={`connection-pill ${status}`}>{status === "loading" ? "syncing" : status === "live" ? "api live" : "offline sample"}</span>
        </div>
        <div className="capture-row">
          <input
            value={captureText}
            onChange={(event) => setCaptureText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onCapture();
            }}
            placeholder="Drop a half-formed thought - sort it into a tree later..."
          />
          <button onClick={onCapture} disabled={!captureText.trim()}>Capture</button>
        </div>
        <div className="note-list">
          {visibleQuickNotes.map((note) => (
            <div className="note-row" key={note.id}>
              <span className="dot" />
              <span>{note.text}</span>
              <time>{note.created_at}</time>
              <button onClick={() => onPromoteQuickNote(note.id)}>Start a tree <ArrowRight size={14} /></button>
            </div>
          ))}
          {visibleQuickNotes.length === 0 ? (
            <div className="empty-row">Inbox clear. Capture a loose thought when one appears.</div>
          ) : null}
        </div>
      </section>

      <div className="section-head">
        <h2>Projects</h2>
        <span>sorted by recent</span>
      </div>
      <div className="project-grid">
        {projects.map((project, projectIndex) => (
          <button className="project-card" key={project.id} onClick={() => setScreen("think")}>
            <div className="project-card-top">
              <span className={`status ${project.status}`}>{project.status.toUpperCase()}</span>
              <time>{project.updated_at}</time>
            </div>
            <div className="sparkline" aria-hidden="true">
              {sparkBars(project, projectIndex).map((height, index) => <span key={`${project.id}-${index}`} className={index === 2 || index === 4 ? "accent" : ""} style={{ height }} />)}
            </div>
            <h3>{project.title}</h3>
            <p>{project.node_count} nodes&nbsp;&nbsp; {project.branch_count} branches</p>
          </button>
        ))}
      </div>
    </section>
  );
}

function sparkBars(project: ProjectSummary, index: number) {
  const seed = project.node_count + project.branch_count + index;
  return [0, 1, 2, 3, 4, 5, 6].map((slot) => 12 + ((seed * (slot + 3)) % 32));
}

function ProjectTopbar({
  active,
  branchCount,
  nodeCount,
  onExport,
  onRegenerate,
  setScreen,
  voice
}: {
  active: "think" | "draft";
  branchCount?: number;
  nodeCount?: number;
  onExport?: () => void;
  onRegenerate?: () => void;
  setScreen: (screen: Screen) => void;
  voice?: Voice;
}) {
  return (
    <header className="project-topbar">
      <div>
        <h1>Subscription fatigue & independent media</h1>
        <p>{active === "think" ? `${nodeCount ?? 7} visible nodes - ${branchCount ?? 3} branches` : "Article - 119 words"}</p>
      </div>
      <div className="topbar-actions">
        <div className="segmented">
          <button className={active === "think" ? "active" : ""} onClick={() => setScreen("think")}>Think</button>
          <button className={active === "draft" ? "active" : ""} onClick={() => setScreen("draft")}>Draft</button>
        </div>
        {voice ? <span className="voice-indicator">VOICE <strong>{voice}</strong></span> : <span className="voice-indicator">VOICE <strong>Professional</strong></span>}
        {active === "think" ? (
          <button className="primary-button" onClick={() => setScreen("draft")}>Draft from branches <ArrowRight size={16} /></button>
        ) : (
          <>
            <button className="ghost-button" onClick={onRegenerate}><RefreshCw size={15} /> Regenerate</button>
            <button className="primary-button" onClick={onExport}><ArrowDownToLine size={16} /> Export .md</button>
          </>
        )}
      </div>
    </header>
  );
}

function ThinkingTree({ setScreen }: { setScreen: (screen: Screen) => void }) {
  const [forest, setForest] = useState<ForestView>(fallbackForest);
  const [focusedNodeId, setFocusedNodeId] = useState("node_demand");
  const [context, setContext] = useState<BranchContext | null>(null);
  const [proposals, setProposals] = useState<ForkProposal[]>([]);
  const [treeStatus, setTreeStatus] = useState<"loading" | "live" | "offline">("loading");

  const focusedNode = forest.nodes.find((node) => node.id === focusedNodeId) ?? forest.nodes[0];

  useEffect(() => {
    void loadForest();
  }, []);

  useEffect(() => {
    if (!focusedNode?.id) return;
    void loadContextAndProposals(focusedNode.id);
  }, [focusedNode?.id]);

  async function loadForest(focusId = focusedNodeId) {
    try {
      const nextForest = await fetchForest("proj_subscription_fatigue");
      setForest(nextForest);
      setFocusedNodeId(focusId || nextForest.focused_node_id || nextForest.roots[0] || "node_root");
      setTreeStatus("live");
    } catch {
      setForest(fallbackForest);
      setTreeStatus("offline");
    }
  }

  async function loadContextAndProposals(nodeId: string) {
    try {
      const [nextContext, nextProposals] = await Promise.all([
        fetchNodeContext(nodeId),
        proposeForks(nodeId)
      ]);
      setContext(nextContext);
      setProposals(nextProposals.proposals);
      setTreeStatus("live");
    } catch {
      setContext({
        target_node_id: nodeId,
        chain: [
          { node_id: "node_root", title: "Is subscription fatigue actually killing independent media?", body: "Root question." },
          { node_id: nodeId, title: focusedNode?.title ?? "Focused branch", body: focusedNode?.body ?? "" }
        ],
        excluded_dead_end_ids: [],
        grounding_enabled: false,
        policy_fingerprint: "offline"
      });
      setProposals([
        {
          title: "Pressure-test this branch",
          prompt: "What evidence would make this branch false?",
          suggested_label: "COUNTERPOINT"
        },
        {
          title: "Split the next assumption",
          prompt: "What should be separated before drafting from this branch?",
          suggested_label: "FORK"
        }
      ]);
      setTreeStatus("offline");
    }
  }

  async function acceptProposal(proposal: ForkProposal) {
    try {
      const created = await forkNode(focusedNode.id, proposal);
      const createdId = created[0]?.id ?? focusedNode.id;
      await loadForest(createdId);
      setFocusedNodeId(createdId);
    } catch {
      const localId = `local_node_${Date.now()}`;
      setForest((current) => ({
        ...current,
        focused_node_id: localId,
        children: {
          ...current.children,
          [focusedNode.id]: [...(current.children[focusedNode.id] ?? []), localId],
          [localId]: []
        },
        nodes: [
          ...current.nodes,
          {
            id: localId,
            project_id: focusedNode.project_id,
            parent_id: focusedNode.id,
            title: proposal.title,
            body: proposal.prompt,
            status: "open",
            order_index: (current.children[focusedNode.id] ?? []).length,
            tag: proposal.suggested_label,
            x: Math.min(90, focusedNode.x + 14),
            y: Math.min(72, focusedNode.y + 18)
          }
        ]
      }));
      setFocusedNodeId(localId);
      setTreeStatus("offline");
    }
  }

  const edgePaths = forest.nodes
    .filter((node) => node.parent_id)
    .map((node) => {
      const parent = forest.nodes.find((candidate) => candidate.id === node.parent_id);
      if (!parent) return null;
      const midY = (parent.y + node.y) / 2;
      return {
        id: `${parent.id}-${node.id}`,
        active: node.id === focusedNodeId || parent.id === focusedNodeId,
        d: `M${parent.x} ${parent.y + 8} C${parent.x} ${midY} ${node.x} ${midY} ${node.x} ${node.y}`
      };
    })
    .filter(Boolean) as Array<{ id: string; active: boolean; d: string }>;
  const branchCount = forest.nodes.filter((node) => (forest.children[node.id] ?? []).length === 0).length;

  return (
    <section className="think-page">
      <ProjectTopbar active="think" nodeCount={forest.nodes.length} branchCount={branchCount} setScreen={setScreen} />
      <div className="think-layout">
        <aside className="sources-panel">
          <div className="side-title">
            <strong>Sources</strong>
            <span className="mono-pill">OPTIONAL</span>
          </div>
          <p>Grounding is optional. With sources, answers carry sentence-level citations.</p>
          <SourceCard icon="P" title="State of Email New..." meta="PDF - 42 pages" cites="2 cited" />
          <SourceCard icon="A" title="The Attention Reces..." meta="theargument.com - article" cites="1 cited" expanded />
          <SourceCard icon="Q" title="Interview - B. Reed..." meta="Quick note - captured Jun 18" cites="0 cited" />
          <button className="import-box"><Upload size={15} /> Import URL / PDF / paste</button>
        </aside>
        <section className="tree-canvas">
          <svg className="edges" viewBox="0 0 100 70" preserveAspectRatio="none" aria-hidden="true">
            {edgePaths.map((edge) => <path key={edge.id} d={edge.d} className={edge.active ? "strong" : ""} />)}
          </svg>
          {forest.nodes.map((node) => (
            <button key={node.id} className={`tree-node ${node.id === focusedNodeId ? "active" : ""} ${node.status === "dead_end" ? "dead" : ""}`} style={{ left: `${node.x}%`, top: `${node.y}%` }} onClick={() => setFocusedNodeId(node.id)}>
              <span>{node.tag}</span>
              <strong>{node.title}</strong>
              <small>{node.status === "dead_end" ? "dead end" : "AI inference"} - {(forest.children[node.id] ?? []).length} forks</small>
            </button>
          ))}
          <div className="zoom-controls"><Minus size={14} /><span>61%</span><Plus size={14} /><span>Fit</span></div>
          <div className="composer">
            <span>CONTINUING FROM {focusedNode?.title.slice(0, 54)}</span>
            <div>
              <input placeholder="Ask the next question on this branch..." />
              <button className="ghost-button"><GitBranch size={15} /> Fork</button>
              <button className="send-button"><Send size={18} /></button>
            </div>
          </div>
        </section>
        <aside className="node-detail">
          <span className="status thinking">PROMISING</span>
          <span className="detail-tag">{focusedNode?.tag}</span>
          <span className={`connection-pill ${treeStatus}`}>{treeStatus === "loading" ? "syncing tree" : treeStatus === "live" ? "api live" : "offline sample"}</span>
          <h2>{focusedNode?.title}</h2>
          <div className="context-box">
            <Check size={15} />
            <strong>Isolated context - {context?.chain.length ?? 0} nodes</strong>
          </div>
          <ul className="lineage">
            {(context?.chain ?? []).map((message) => (
              <li key={message.node_id} className={message.node_id === focusedNodeId ? "active" : ""}>{message.title}</li>
            ))}
          </ul>
          <p className="detail-copy">The AI on this branch sees only this lineage - sibling branches stay out of its context. That's the moat.</p>
          <p className="eyebrow">THREAD</p>
          <p>{focusedNode?.body}</p>
          <div className="hint">Not grounded - AI inference. Add a source to pressure-test it.</div>
          <div className="suggestions">
            <strong><Sparkles size={15} /> Weaver suggests splitting this</strong>
            {proposals.map((proposal) => (
              <button key={`${proposal.suggested_label}-${proposal.title}`} onClick={() => void acceptProposal(proposal)}>
                <Plus size={16} /> <span>{proposal.prompt}</span>
              </button>
            ))}
          </div>
          <button className="detail-action"><Upload size={15} /> Promote to argument point</button>
          <button className="detail-action muted"><Bot size={15} /> Mark dead end</button>
        </aside>
      </div>
    </section>
  );
}

function SourceCard({ icon, title, meta, cites, expanded = false }: { icon: string; title: string; meta: string; cites: string; expanded?: boolean }) {
  return (
    <div className={`source-card ${expanded ? "expanded" : ""}`}>
      <div className="source-row">
        <span className="source-icon">{icon}</span>
        <div><strong>{title}</strong><p>{meta}</p></div>
        <span className="cite-pill">{cites}</span>
      </div>
      {expanded ? <div className="quote-block">The binding constraint on media is no longer money but waking hours.<br /><br />Every new subscription competes not with a wallet but with sleep.</div> : null}
    </div>
  );
}

function DraftScreen({ voice, setVoice, draftFormat, setDraftFormat }: { voice: Voice; setVoice: (voice: Voice) => void; draftFormat: string; setDraftFormat: (format: string) => void }) {
  const formats = ["Article", "Deck", "X Thread", "Video", "Newsletter"];
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

  return (
    <section className="draft-page">
      <ProjectTopbar active="draft" setScreen={() => undefined} voice={voice} onRegenerate={regenerateDraft} onExport={exportMarkdown} />
      <div className="draft-tabs">
        <span className="eyebrow">OUTPUT</span>
        {formats.map((format) => (
          <button key={format} className={draftFormat === format ? "active" : ""} disabled={format === "Newsletter"} onClick={() => setDraftFormat(format)}>
            {format === "Article" ? <FileText size={14} /> : null}
            {format}
            {draftFormat === format ? <Check size={14} /> : null}
          </button>
        ))}
        <span className="source-promise">
          {draftStatus === "generating" ? "Generating from branch context" : draftStatus === "exported" ? "Markdown export ready" : draftStatus === "live" ? "API draft live" : "Same source - same Voice - citations carried"}
        </span>
      </div>
      <div className="draft-layout">
        <aside className="outline-panel">
          <div className="side-title"><strong>Argument outline</strong><span className="mono-pill">OPTIONAL</span></div>
          <p>The shared spine. Every format renders from these points - change them once and all outputs follow.</p>
          <OutlinePoint number="01" tag="DEMAND-SIDE" text="Attention is zero-sum: a subscription competes with sleep, not money." target="P 2" />
          <OutlinePoint number="02" tag="SUPPLY-SIDE" text="Bundling could pool audiences instead of splitting them." target="P 3" />
          <div className="outline-empty">Reorder to shape the narrative. AI can propose a skeleton.</div>
        </aside>
        <article className="article-view">
          <p className="eyebrow">{draft.format.toUpperCase()} - WOVEN FROM YOUR BRANCHES</p>
          <h1>{draft.title}</h1>
          {draft.paragraphs.map((paragraph, index) => (
            <p key={`${draft.id}-${index}`} className={index === 0 ? "lead" : ""}>
              {paragraph}
              {index > 0 && index <= draft.citations.length ? <sup>{index}</sup> : null}
            </p>
          ))}
          <hr />
          <p className="eyebrow">FOOTNOTES</p>
          <ol className="footnotes">
            {draft.citations.map((citation) => (
              <li key={citation.id}>{citation.source_label} - {citation.quote}</li>
            ))}
          </ol>
          {exportPreview ? (
            <pre className="export-preview">{exportPreview.slice(0, 1400)}</pre>
          ) : null}
        </article>
        <div className="voice-dock">
          {(["Academic", "Casual", "Professional"] as Voice[]).map((item) => (
            <button key={item} className={voice === item ? "active" : ""} onClick={() => setVoice(item)}>{item}</button>
          ))}
        </div>
      </div>
    </section>
  );
}

function OutlinePoint({ number, tag, text, target }: { number: string; tag: string; text: string; target: string }) {
  return (
    <div className="outline-point">
      <span>{number}</span>
      <small>{tag}</small>
      <p>{text}</p>
      <div><span>{target}</span><span>1 source</span></div>
    </div>
  );
}

function SettingsScreen({ apiStatus, isTesting, onTest }: { apiStatus: ApiStatus; isTesting: boolean; onTest: () => void }) {
  const [backends, setBackends] = useState<BackendView[]>([]);
  const [selectedId, setSelectedId] = useState("backend_codex");
  const [health, setHealth] = useState<Record<string, BackendHealthView>>({});
  const [settingsStatus, setSettingsStatus] = useState<"loading" | "live" | "offline">("loading");

  useEffect(() => {
    void loadBackends();
  }, []);

  async function loadBackends() {
    try {
      const nextBackends = await fetchBackends();
      setBackends(nextBackends);
      setSelectedId(nextBackends.find((backend) => backend.is_default)?.id ?? nextBackends[0]?.id ?? "backend_codex");
      setSettingsStatus("live");
    } catch {
      setBackends([]);
      setSettingsStatus("offline");
    }
  }

  async function setDefaultBackend(backendId: string) {
    const updated = await updateBackend(backendId, { is_default: true });
    setBackends((current) => current.map((backend) => ({ ...backend, is_default: backend.id === updated.id })));
    setSelectedId(updated.id);
  }

  async function testBackend(backendId: string) {
    const result = await testBackendHealth(backendId);
    setHealth((current) => ({ ...current, [backendId]: result }));
  }

  async function togglePermission(backend: BackendView, key: keyof BackendView["permissions"]) {
    const updatedPermissions = {
      ...backend.permissions,
      [key]: !backend.permissions[key]
    };
    const updated = await updateBackend(backend.id, { permissions: updatedPermissions });
    setBackends((current) => current.map((item) => item.id === backend.id ? updated : item));
  }

  const selected = backends.find((backend) => backend.id === selectedId) ?? backends[0];
  const defaultBackend = backends.find((backend) => backend.is_default);

  return (
    <section className="settings-page">
      <p className="eyebrow">SETTINGS</p>
      <h1>Project & model</h1>
      <section className="settings-card">
        <h2>Model</h2>
        <p>Used for branch answers and draft generation.</p>
        <SettingRow title="Reasoning model" description="Drives forking, merge detection, gap-finding.">
          <button className="select-button">{defaultBackend?.name ?? "No backend"} <ChevronDown size={13} /></button>
        </SettingRow>
        <SettingRow title="Context isolation per branch" description="Each branch only inherits its ancestor lineage.">
          <button className="toggle on" aria-label="Context isolation on"><span /></button>
        </SettingRow>
      </section>
      <section className="settings-card">
        <div className="settings-heading">
          <div><h2>Coding agents <span className="mono-pill">{backends.length || 4} detected</span> <span className={`connection-pill ${settingsStatus}`}>{settingsStatus === "live" ? "api live" : settingsStatus === "loading" ? "syncing" : "offline sample"}</span></h2><p>Weaver found these CLIs on your machine. Connect one to run agentic tasks straight from a branch.</p></div>
          <button className="ghost-button" onClick={() => void loadBackends()}><RefreshCw size={15} /> Rescan</button>
        </div>
        {(backends.length ? backends : fallbackBackends()).map((backend) => (
          backend.id === selected?.id ? (
            <div className="agent-expanded" key={backend.id}>
              <AgentRow backend={backend} health={health[backend.id]} onSelect={() => setSelectedId(backend.id)} onTest={() => void testBackend(backend.id)} />
              <SettingRow title="Model" description='Model list comes from this CLI. "Default" keeps the CLI own setting.'>
                <span className="live-pill">{health[backend.id]?.ok ? `${health[backend.id]?.latency_ms}ms` : "Live from CLI"}</span>
              </SettingRow>
              <button className="wide-select">{backend.model} <ChevronDown size={13} /></button>
              <label>Reasoning effort</label>
              <button className="wide-select">Default <ChevronDown size={13} /></button>
              {backend.kind === "cli_agent" ? (
                <div className="permission-grid">
                  <PermissionToggle label="Auto-run read-only" active={backend.permissions.auto_run_readonly} onClick={() => void togglePermission(backend, "auto_run_readonly")} />
                  <PermissionToggle label="Allow file edits" active={backend.permissions.allow_file_edits} onClick={() => void togglePermission(backend, "allow_file_edits")} />
                  <PermissionToggle label="Network access" active={backend.permissions.network_access} onClick={() => void togglePermission(backend, "network_access")} />
                </div>
              ) : null}
              <div className="agent-actions">
                <button onClick={() => void setDefaultBackend(backend.id)}>{backend.is_default ? "Default backend" : "Set as default"}</button>
                <button onClick={onTest} className={apiStatus.ok ? "ok" : ""}>
                  {isTesting ? <Loader2 size={15} className="spin" /> : <Zap size={15} />}
                  {apiStatus.label}
                </button>
              </div>
              {health[backend.id] ? <p className="health-line">{health[backend.id].detail}</p> : null}
            </div>
          ) : (
            <AgentRow key={backend.id} backend={backend} health={health[backend.id]} onSelect={() => setSelectedId(backend.id)} onTest={() => void testBackend(backend.id)} />
          )
        ))}
        {!backends.length && settingsStatus === "offline" ? (
          <div className="outline-empty">Backend API offline. The screen is showing the prototype sample state.</div>
        ) : null}
      </section>
    </section>
  );
}

function fallbackBackends(): BackendView[] {
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

function PermissionToggle({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button className={`permission-toggle ${active ? "active" : ""}`} onClick={onClick}>
      <span>{label}</span>
      <span className={`mini-switch ${active ? "on" : ""}`} />
    </button>
  );
}

function SettingRow({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <div><strong>{title}</strong><p>{description}</p></div>
      {children}
    </div>
  );
}

function AgentRow({
  backend,
  health,
  onSelect,
  onTest
}: {
  backend: BackendView;
  health?: BackendHealthView;
  onSelect: () => void;
  onTest: () => void;
}) {
  const vendor = `${backend.provider[0]?.toUpperCase() ?? ""}${backend.provider.slice(1)} ${backend.kind === "cli_agent" ? "official CLI" : "provider"}`;
  return (
    <div className="agent-row">
      <button className="agent-icon" onClick={onSelect}>{backend.name.startsWith("Claude") ? "*" : backend.kind === "fake" ? "F" : ">_"}</button>
      <button className="agent-copy" onClick={onSelect}>
        <strong>{backend.name}</strong><span> - {vendor}</span><p>{backend.version}</p>
      </button>
      {backend.is_default ? <span className="mono-pill">DEFAULT</span> : <button onClick={onTest}>{health?.ok ? "OK" : "Test"}</button>}
    </div>
  );
}
