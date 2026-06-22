from __future__ import annotations

from itertools import count
from typing import Literal

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from weaver_core.context.resolver import resolve_branch_context
from weaver_core.schemas.node import BranchContext, NodeForest, ThoughtNode


class FeatureFlags(BaseModel):
    relations: bool = False
    compare: bool = False
    multi_format: bool = False
    cli_agents: bool = True


class MetaView(BaseModel):
    build_version: str = "0.1.0"
    api_version: str = "v1"
    model_mode: Literal["fake", "real"] = "fake"
    default_backend_id: str | None = "backend_codex"
    features: FeatureFlags = Field(default_factory=FeatureFlags)


class ProjectSummary(BaseModel):
    id: str
    title: str
    status: Literal["drafting", "thinking", "shipped"]
    node_count: int
    branch_count: int
    updated_at: str


class ProjectCreate(BaseModel):
    title: str


class QuickNoteView(BaseModel):
    id: str
    text: str
    created_at: str
    promoted_project_id: str | None = None


class QuickNoteCreate(BaseModel):
    text: str


class PromoteQuickNoteRequest(BaseModel):
    project_title: str | None = None


class PromoteQuickNoteResponse(BaseModel):
    project: ProjectSummary
    quicknote: QuickNoteView


class BackendHealthView(BaseModel):
    id: str
    ok: bool
    detail: str | None = None
    latency_ms: int | None = None


class PermissionSet(BaseModel):
    auto_run_readonly: bool = False
    allow_file_edits: bool = False
    network_access: bool = False


class BackendCreate(BaseModel):
    name: str
    kind: Literal["api_sdk", "cli_agent", "fake"] = "cli_agent"
    provider: str
    model: str = "Default (CLI config)"
    api_key: str | None = None
    enabled: bool = True
    is_default: bool = False
    permissions: PermissionSet = Field(default_factory=PermissionSet)


class BackendUpdate(BaseModel):
    name: str | None = None
    model: str | None = None
    enabled: bool | None = None
    is_default: bool | None = None
    permissions: PermissionSet | None = None


class BackendView(BaseModel):
    id: str
    name: str
    kind: Literal["api_sdk", "cli_agent", "fake"]
    provider: str
    model: str
    version: str
    enabled: bool
    is_default: bool
    has_api_key: bool = False
    permissions: PermissionSet = Field(default_factory=PermissionSet)


class NodeView(BaseModel):
    id: str
    project_id: str
    parent_id: str | None
    title: str
    body: str
    status: str
    order_index: int
    tag: str
    x: int
    y: int


class ForestView(BaseModel):
    project_id: str
    nodes: list[NodeView]
    roots: list[str]
    children: dict[str, list[str]]
    focused_node_id: str | None = None


class ForkSpec(BaseModel):
    title: str
    body: str
    tag: str = "FORK"


class ForkRequest(BaseModel):
    branches: list[ForkSpec]


class ForkProposal(BaseModel):
    title: str
    prompt: str
    suggested_label: str


class ForkProposeResult(BaseModel):
    proposals: list[ForkProposal]


class DraftCitation(BaseModel):
    id: str
    source_label: str
    quote: str
    source_node_id: str
    deep_link: str


class DraftGenerateRequest(BaseModel):
    source_branch_node_ids: list[str] = Field(default_factory=list)
    outline_id: str | None = None
    voice: Literal["Academic", "Casual", "Professional"] = "Professional"
    format: str = "Article"


class DraftView(BaseModel):
    id: str
    project_id: str
    title: str
    voice: str
    format: str
    source_branch_node_ids: list[str]
    paragraphs: list[str]
    citations: list[DraftCitation]
    grounded: bool


class ExportCreate(BaseModel):
    target: Literal["markdown"] = "markdown"


class ExportView(BaseModel):
    id: str
    draft_id: str
    target: str
    citations_preserved: bool
    download_url: str


PROJECTS = [
    ProjectSummary(
        id="proj_subscription_fatigue",
        title="Subscription fatigue & independent media",
        status="drafting",
        node_count=7,
        branch_count=3,
        updated_at="2h ago",
    ),
    ProjectSummary(
        id="proj_tools_for_thought",
        title='Why "tools for thought" keep failing',
        status="thinking",
        node_count=12,
        branch_count=5,
        updated_at="yesterday",
    ),
    ProjectSummary(
        id="proj_engagement_metrics",
        title="The case against engagement metrics",
        status="shipped",
        node_count=9,
        branch_count=4,
        updated_at="Jun 14",
    ),
]

QUICKNOTES = [
    QuickNoteView(
        id="note_substack",
        text="Substack churn vs growth slowdown - separate them",
        created_at="2h",
    ),
    QuickNoteView(
        id="note_attention",
        text='Is "attention recession" overhyped or real?',
        created_at="yesterday",
    ),
    QuickNoteView(
        id="note_bundle",
        text="Bundle economics: who captures the surplus?",
        created_at="Jun 19",
    ),
]

PROJECT_ID_COUNTER = count(4)
QUICKNOTE_ID_COUNTER = count(4)
NODE_ID_COUNTER = count(8)
DRAFT_ID_COUNTER = count(1)
EXPORT_ID_COUNTER = count(1)
DRAFTS: dict[str, DraftView] = {}
EXPORTS: dict[str, str] = {}
EXPORT_META: dict[str, ExportView] = {}
BACKEND_ID_COUNTER = count(5)
BACKENDS = [
    BackendView(
        id="backend_claude",
        name="Claude Code",
        kind="cli_agent",
        provider="anthropic",
        model="Default (CLI config)",
        version="2.1.185",
        enabled=True,
        is_default=False,
    ),
    BackendView(
        id="backend_codex",
        name="Codex CLI",
        kind="cli_agent",
        provider="openai",
        model="Default (CLI config)",
        version="codex-cli 0.130.0",
        enabled=True,
        is_default=True,
        permissions=PermissionSet(auto_run_readonly=True),
    ),
    BackendView(
        id="backend_gemini",
        name="Gemini CLI",
        kind="cli_agent",
        provider="google",
        model="Default (CLI config)",
        version="gemini-cli detected",
        enabled=True,
        is_default=False,
    ),
    BackendView(
        id="backend_fake",
        name="Fake Provider",
        kind="fake",
        provider="weaver",
        model="deterministic",
        version="ci-safe",
        enabled=True,
        is_default=False,
    ),
]

THOUGHT_NODES = [
    ThoughtNode(
        id="node_root",
        project_id="proj_subscription_fatigue",
        parent_id=None,
        title="Is subscription fatigue actually killing independent media?",
        body="Root question: separate newsletter growth slowdown from churn and attention scarcity.",
        order_index=0,
        tag="ROOT QUESTION",
        x=52,
        y=10,
    ),
    ThoughtNode(
        id="node_supply",
        project_id="proj_subscription_fatigue",
        parent_id="node_root",
        title="Is it a supply problem - too many newsletters chasing the same inboxes?",
        body="Supply-side read: publishers may have over-expanded similar paid products.",
        order_index=0,
        tag="SUPPLY-SIDE",
        x=28,
        y=28,
    ),
    ThoughtNode(
        id="node_demand",
        project_id="proj_subscription_fatigue",
        parent_id="node_root",
        title="Is it a demand problem - reader attention is finite and saturating?",
        body="Demand-side read: the scarce resource may be waking hours, not wallet capacity.",
        order_index=1,
        tag="DEMAND-SIDE",
        x=60,
        y=32,
    ),
    ThoughtNode(
        id="node_pricing",
        project_id="proj_subscription_fatigue",
        parent_id="node_root",
        title="Is it a pricing problem - are paid tiers simply mispriced?",
        body="Pricing may matter, but it is probably not the binding constraint.",
        status="dead_end",
        order_index=2,
        tag="PRICING",
        x=76,
        y=28,
    ),
    ThoughtNode(
        id="node_bundle",
        project_id="proj_subscription_fatigue",
        parent_id="node_supply",
        title="Bundling could pool audiences instead of splitting them.",
        body="Bundling turns fragmented paid attention into a shared audience surface.",
        order_index=0,
        tag="SUPPLY-SIDE",
        x=18,
        y=48,
    ),
    ThoughtNode(
        id="node_free",
        project_id="proj_subscription_fatigue",
        parent_id="node_supply",
        title="Ad-supported free tiers re-expand the top of the funnel.",
        body="A free tier can rebuild habit before asking for conversion.",
        order_index=1,
        tag="SUPPLY-SIDE",
        x=42,
        y=48,
    ),
    ThoughtNode(
        id="node_attention",
        project_id="proj_subscription_fatigue",
        parent_id="node_demand",
        title="Attention is zero-sum: a subscription competes with sleep.",
        body="Every new subscription competes not with a wallet but with waking hours.",
        order_index=0,
        tag="DEMAND-SIDE",
        x=60,
        y=48,
    ),
]


app = FastAPI(title="Weaver Next API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _forest(project_id: str) -> NodeForest:
    return NodeForest.build(project_id, THOUGHT_NODES)


def _node_view(node: ThoughtNode) -> NodeView:
    return NodeView(**node.model_dump())


def _forest_view(project_id: str, focused_node_id: str | None = None) -> ForestView:
    forest = _forest(project_id)
    return ForestView(
        project_id=project_id,
        nodes=[_node_view(node) for node in forest.nodes.values()],
        roots=forest.roots,
        children=forest.children,
        focused_node_id=focused_node_id or (forest.roots[0] if forest.roots else None),
    )


def _find_node(node_id: str) -> ThoughtNode | None:
    return next((node for node in THOUGHT_NODES if node.id == node_id), None)


def _refresh_project_counts(project_id: str) -> None:
    project_nodes = [node for node in THOUGHT_NODES if node.project_id == project_id]
    child_parent_ids = {node.parent_id for node in project_nodes if node.parent_id}
    branch_count = len([node for node in project_nodes if node.id not in child_parent_ids])
    for project in PROJECTS:
        if project.id == project_id:
            project.node_count = len(project_nodes)
            project.branch_count = max(branch_count, 1 if project_nodes else 0)
            project.updated_at = "now"
            return


def _make_child_node(parent: ThoughtNode, spec: ForkSpec, order_index: int) -> ThoughtNode:
    sibling_offset = (order_index - 1) * 16
    return ThoughtNode(
        id=f"node_{next(NODE_ID_COUNTER)}",
        project_id=parent.project_id,
        parent_id=parent.id,
        title=spec.title.strip() or "Untitled fork",
        body=spec.body.strip() or spec.title.strip() or "Untitled fork",
        order_index=order_index,
        tag=spec.tag.strip().upper() or "FORK",
        x=max(10, min(90, parent.x + sibling_offset)),
        y=min(72, parent.y + 18),
    )


def _project_title(project_id: str) -> str:
    project = next((item for item in PROJECTS if item.id == project_id), None)
    return project.title if project else "Weaver draft"


def _generate_draft(project_id: str, payload: DraftGenerateRequest) -> DraftView:
    has_branches = bool(payload.source_branch_node_ids)
    has_outline = bool(payload.outline_id)
    if has_branches == has_outline:
        raise HTTPException(
            status_code=422,
            detail="DRAFT_SOURCE_AMBIGUOUS: set either source_branch_node_ids or outline_id",
        )

    branch_ids = payload.source_branch_node_ids or ["node_demand", "node_bundle"]
    forest = _forest(project_id)
    sections: list[str] = []
    citations: list[DraftCitation] = []
    for index, node_id in enumerate(branch_ids, start=1):
        context = resolve_branch_context(node_id, forest)
        if not context.chain:
            continue
        head = context.chain[-1]
        ancestor_titles = [message.title for message in context.chain[:-1]]
        setup = " -> ".join(ancestor_titles) if ancestor_titles else _project_title(project_id)
        sections.append(
            f"{head.title} {head.body} In {payload.voice.lower()} voice, this section is grounded only in its own branch path: {setup}."
        )
        citations.append(
            DraftCitation(
                id=f"c{index}",
                source_label=f"Branch context - {head.title[:42]}",
                quote=head.body,
                source_node_id=head.node_id,
                deep_link=f"weaver://source/{head.node_id}#char=0-{len(head.body)}",
            )
        )

    if not sections:
        sections.append("No branch material was available yet. Add or select a branch to generate a draft.")

    draft = DraftView(
        id=f"draft_{next(DRAFT_ID_COUNTER)}",
        project_id=project_id,
        title="Subscription Fatigue Is Real - But It Is Not What You Think",
        voice=payload.voice,
        format=payload.format,
        source_branch_node_ids=branch_ids,
        paragraphs=[
            "Subscription fatigue is real, but the phrase hides the more useful diagnosis.",
            *sections,
            "The practical move is to stop treating price as the only constraint and design around attention as the scarce resource.",
        ],
        citations=citations,
        grounded=bool(citations),
    )
    DRAFTS[draft.id] = draft
    return draft


def _render_markdown(draft: DraftView) -> str:
    body = [f"# {draft.title}", ""]
    for index, paragraph in enumerate(draft.paragraphs):
        suffix = f" [^{index}]" if index and index <= len(draft.citations) else ""
        body.append(f"{paragraph}{suffix}")
        body.append("")
    if draft.citations:
        body.append("## Footnotes")
        body.append("")
        for index, citation in enumerate(draft.citations, start=1):
            body.append(
                f"[^{index}]: {citation.source_label} - \"{citation.quote}\" ({citation.deep_link})"
            )
    return "\n".join(body).strip() + "\n"


def _find_backend(backend_id: str) -> BackendView | None:
    return next((backend for backend in BACKENDS if backend.id == backend_id), None)


def _set_default_backend(backend_id: str) -> None:
    for backend in BACKENDS:
        backend.is_default = backend.id == backend_id


@app.get("/ping")
def ping() -> dict[str, str]:
    return {"status": "ok", "service": "weaver-api"}


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/v1/meta", response_model=MetaView)
def meta() -> MetaView:
    return MetaView()


@app.get("/api/v1/projects", response_model=list[ProjectSummary])
def list_projects() -> list[ProjectSummary]:
    return PROJECTS


@app.post("/api/v1/projects", response_model=ProjectSummary, status_code=201)
def create_project(payload: ProjectCreate) -> ProjectSummary:
    project = ProjectSummary(
        id=f"proj_{next(PROJECT_ID_COUNTER)}",
        title=payload.title.strip() or "Untitled thinking project",
        status="thinking",
        node_count=1,
        branch_count=1,
        updated_at="now",
    )
    PROJECTS.insert(0, project)
    THOUGHT_NODES.append(
        ThoughtNode(
            id=f"node_{next(NODE_ID_COUNTER)}",
            project_id=project.id,
            parent_id=None,
            title=project.title,
            body="Start a new branching thought from this seed.",
            order_index=0,
            tag="ROOT QUESTION",
            x=52,
            y=16,
        )
    )
    return project


@app.get("/api/v1/projects/{project_id}/nodes", response_model=ForestView)
def get_project_nodes(project_id: str) -> ForestView:
    return _forest_view(project_id)


@app.get("/api/v1/quicknotes", response_model=list[QuickNoteView])
def list_quicknotes() -> list[QuickNoteView]:
    return QUICKNOTES


@app.post("/api/v1/quicknotes", response_model=QuickNoteView, status_code=201)
def create_quicknote(payload: QuickNoteCreate) -> QuickNoteView:
    quicknote = QuickNoteView(
        id=f"note_{next(QUICKNOTE_ID_COUNTER)}",
        text=payload.text.strip() or "Untitled thought",
        created_at="now",
    )
    QUICKNOTES.insert(0, quicknote)
    return quicknote


@app.post(
    "/api/v1/quicknotes/{quicknote_id}/promote",
    response_model=PromoteQuickNoteResponse,
    status_code=201,
)
def promote_quicknote(
    quicknote_id: str,
    payload: PromoteQuickNoteRequest | None = None,
) -> PromoteQuickNoteResponse:
    quicknote = next((note for note in QUICKNOTES if note.id == quicknote_id), None)
    title = payload.project_title if payload and payload.project_title else None
    project = ProjectSummary(
        id=f"proj_{next(PROJECT_ID_COUNTER)}",
        title=(title or quicknote.text if quicknote else "Promoted quick thought").strip(),
        status="thinking",
        node_count=1,
        branch_count=1,
        updated_at="now",
    )
    PROJECTS.insert(0, project)
    THOUGHT_NODES.append(
        ThoughtNode(
            id=f"node_{next(NODE_ID_COUNTER)}",
            project_id=project.id,
            parent_id=None,
            title=project.title,
            body=quicknote.text if quicknote else project.title,
            order_index=0,
            tag="ROOT QUESTION",
            x=52,
            y=16,
        )
    )
    if quicknote:
        quicknote.promoted_project_id = project.id
    else:
        quicknote = QuickNoteView(
            id=quicknote_id,
            text=project.title,
            created_at="now",
            promoted_project_id=project.id,
        )
    return PromoteQuickNoteResponse(project=project, quicknote=quicknote)


@app.get("/api/v1/nodes/{node_id}/context", response_model=BranchContext)
def get_node_context(node_id: str) -> BranchContext:
    node = _find_node(node_id)
    project_id = node.project_id if node else "proj_subscription_fatigue"
    return resolve_branch_context(node_id, _forest(project_id))


@app.post("/api/v1/nodes/{node_id}/fork", response_model=list[NodeView], status_code=201)
def fork_node(node_id: str, payload: ForkRequest) -> list[NodeView]:
    parent = _find_node(node_id)
    if not parent:
        return []
    existing_children = [node for node in THOUGHT_NODES if node.parent_id == parent.id]
    created: list[ThoughtNode] = []
    for offset, branch in enumerate(payload.branches):
        created_node = _make_child_node(
            parent,
            branch,
            order_index=len(existing_children) + offset,
        )
        THOUGHT_NODES.append(created_node)
        created.append(created_node)
    _refresh_project_counts(parent.project_id)
    return [_node_view(node) for node in created]


@app.post("/api/v1/nodes/{node_id}/fork/propose", response_model=ForkProposeResult)
def propose_forks(node_id: str) -> ForkProposeResult:
    node = _find_node(node_id)
    project_id = node.project_id if node else "proj_subscription_fatigue"
    context = resolve_branch_context(node_id, _forest(project_id))
    theme = context.chain[-1].title if context.chain else "this branch"
    return ForkProposeResult(
        proposals=[
            ForkProposal(
                title="Pressure-test the strongest assumption",
                prompt=f"What evidence would make '{theme}' false?",
                suggested_label="COUNTERPOINT",
            ),
            ForkProposal(
                title="Split timing from willingness",
                prompt="Is the bottleneck reader willingness, available time, or habit formation?",
                suggested_label="DEMAND-SIDE",
            ),
        ]
    )


@app.post("/api/v1/projects/{project_id}/drafts", response_model=DraftView, status_code=201)
def generate_project_draft(project_id: str, payload: DraftGenerateRequest) -> DraftView:
    return _generate_draft(project_id, payload)


@app.get("/api/v1/drafts/{draft_id}", response_model=DraftView)
def get_draft(draft_id: str) -> DraftView:
    draft = DRAFTS.get(draft_id)
    if not draft:
        raise HTTPException(status_code=404, detail="DRAFT_NOT_FOUND")
    return draft


@app.post("/api/v1/drafts/{draft_id}/exports", response_model=ExportView, status_code=201)
def create_export(draft_id: str, payload: ExportCreate) -> ExportView:
    draft = DRAFTS.get(draft_id)
    if not draft:
        raise HTTPException(status_code=404, detail="DRAFT_NOT_FOUND")
    markdown = _render_markdown(draft)
    export_id = f"export_{next(EXPORT_ID_COUNTER)}"
    view = ExportView(
        id=export_id,
        draft_id=draft.id,
        target=payload.target,
        citations_preserved=len(draft.citations) == markdown.count("[^") // 2,
        download_url=f"/api/v1/exports/{export_id}/download",
    )
    EXPORTS[export_id] = markdown
    EXPORT_META[export_id] = view
    return view


@app.get("/api/v1/exports/{export_id}", response_model=ExportView)
def get_export(export_id: str) -> ExportView:
    view = EXPORT_META.get(export_id)
    if not view:
        raise HTTPException(status_code=404, detail="EXPORT_NOT_FOUND")
    return view


@app.get("/api/v1/exports/{export_id}/download")
def download_export(export_id: str) -> Response:
    markdown = EXPORTS.get(export_id)
    if markdown is None:
        raise HTTPException(status_code=404, detail="EXPORT_NOT_FOUND")
    return Response(content=markdown, media_type="text/markdown")


@app.get("/api/v1/backends", response_model=list[BackendView])
def list_backends() -> list[BackendView]:
    return BACKENDS


@app.post("/api/v1/backends", response_model=BackendView, status_code=201)
def create_backend(payload: BackendCreate) -> BackendView:
    backend = BackendView(
        id=f"backend_{next(BACKEND_ID_COUNTER)}",
        name=payload.name.strip() or payload.provider,
        kind=payload.kind,
        provider=payload.provider,
        model=payload.model,
        version="manual",
        enabled=payload.enabled,
        is_default=False,
        has_api_key=bool(payload.api_key),
        permissions=payload.permissions,
    )
    BACKENDS.append(backend)
    if payload.is_default:
        _set_default_backend(backend.id)
    return backend


@app.get("/api/v1/backends/{backend_id}", response_model=BackendView)
def get_backend(backend_id: str) -> BackendView:
    backend = _find_backend(backend_id)
    if not backend:
        raise HTTPException(status_code=404, detail="BACKEND_NOT_FOUND")
    return backend


@app.patch("/api/v1/backends/{backend_id}", response_model=BackendView)
def update_backend(backend_id: str, payload: BackendUpdate) -> BackendView:
    backend = _find_backend(backend_id)
    if not backend:
        raise HTTPException(status_code=404, detail="BACKEND_NOT_FOUND")
    if payload.name is not None:
        backend.name = payload.name
    if payload.model is not None:
        backend.model = payload.model
    if payload.enabled is not None:
        backend.enabled = payload.enabled
    if payload.permissions is not None:
        backend.permissions = payload.permissions
    if payload.is_default is True:
        _set_default_backend(backend.id)
    elif payload.is_default is False and backend.is_default:
        backend.is_default = False
    return backend


@app.delete("/api/v1/backends/{backend_id}", status_code=204)
def delete_backend(backend_id: str) -> Response:
    backend = _find_backend(backend_id)
    if not backend:
        raise HTTPException(status_code=404, detail="BACKEND_NOT_FOUND")
    BACKENDS.remove(backend)
    if backend.is_default and BACKENDS:
        BACKENDS[0].is_default = True
    return Response(status_code=204)


@app.post("/api/v1/backends/{backend_id}/health", response_model=BackendHealthView)
def backend_health(backend_id: str) -> BackendHealthView:
    backend = _find_backend(backend_id)
    if not backend:
        raise HTTPException(status_code=404, detail="BACKEND_NOT_FOUND")
    if not backend.enabled:
        return BackendHealthView(
            id=backend_id,
            ok=False,
            detail="Backend disabled",
            latency_ms=0,
        )
    return BackendHealthView(
        id=backend_id,
        ok=True,
        detail=f"{backend.name} reachable via {backend.kind}",
        latency_ms=18 if backend.kind == "fake" else 42,
    )
