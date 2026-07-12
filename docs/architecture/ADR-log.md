# Legacy Architecture Decision Record Log — Weaver Next

> **Status: Superseded as a set.** ADR-0001 through ADR-0027 document the retired
> Python/tree-first rebuild. Their row-level status is preserved for history but
> none is binding on the current implementation. See
> [`../adr/0001-codex-widget-semantic-graph.md`](../adr/0001-codex-widget-semantic-graph.md).
>
> Upstream truths: [`../PRD-Weaver-Redesign-2026.md`](../PRD-Weaver-Redesign-2026.md)
> and [`00-foundation.md`](00-foundation.md). The deprecated
> [`../rebuild-plan.md`](../rebuild-plan.md) is historical context only.

| ADR | Title | Status | Owner doc |
|-----|-------|--------|-----------|
| 0001 | API service language = Python (FastAPI), frontend = Next.js/TS | Accepted | 00 |
| 0002 | Domain core lives in Python; cross-language sync is schema-first codegen | Accepted | 00, 03 |
| 0003 | The core artifact is a branching tree, never a free-form canvas | Accepted | 00, 04 |
| 0004 | Per-branch context isolation is a pure, model-independent service (THE MOAT) | Accepted | 01 |
| 0005 | Branch is a derived value object — no branches table, no branch CRUD | Accepted | 00, 01, 03 |
| 0006 | Dead-end ancestors excluded from resolved context by default (target sacred) | Accepted | 01 |
| 0007 | One ModelProvider Protocol for API SDKs + CLI agents + FAKE | Accepted | 02 |
| 0008 | Permissions enforced in the API process by a default-deny PermissionGate | Accepted | 02 |
| 0009 | Secrets stored only as `api_key_ref` indirection (env/keyring/file), never inline | Accepted | 02, 03 |
| 0010 | AI proposes upstream; commits go through the same pure write path | Accepted | 01, 02 |
| 0011 | Repository-hidden persistence; SQLite local-first, Postgres swappable | Accepted | 07 |
| 0012 | Sources are optional grounding; retrieval widens evidence, never branch context | Accepted | 05 |
| 0013 | Sentence-level citation mapping is a pure function (P0 hard indicator) | Accepted | 05 |
| 0014 | The argument outline is an optional crystallization layer | Accepted | 06 |
| 0015 | Voice affects the DRAFT, not just chat (edge over NotebookLM Personas) | Accepted | 06 |
| 0016 | Multi-format Artifacts all derive from one Draft/Outline with provenance | Accepted | 06 |
| 0017 | Relations are an additive overlay, invisible to the moat | Accepted | 01, 08 |
| 0018 | Determinism: FAKE provider is the CI default; no test reaches a real model | Accepted | 00, 02 |
| 0019 | CrossLink (cross-project network) never participates in context resolution | Accepted | 08 |
| 0020 | Extensibility litmus: new backend/source/format = enum + adapter, zero core edits | Accepted | 08 |
| 0021 | `TokenEvent` is one closed-shape stream event (seq+request_id, eight types) owned by doc 02 | Accepted | 02 |
| 0022 | Draft generation is a single streaming `POST /projects/{pid}/drafts` (no two-step) | Accepted | 03 |
| 0023 | `ErrorCode` (doc 03) is the single source of truth; the frontend imports the generated union | Accepted | 03 |
| 0024 | Citation char offsets index the SOURCE canonical text; `answer_span`/`method`/`details` are stored columns | Accepted | 00, 07, 05, 03 |
| 0025 | `/think` auto-creates the answer node; `create_child` is the explicit preview switch | Accepted | 03, 01 |
| 0026 | Cross-cutting contract gaps closed before M2 (cancellation, idempotency, MetaView, BlobStore, embed dim, Voice-only-on-draft, fork transport) | Accepted | 03, 07, 02, 04 |
| 0027 | One `ProviderRegistry`, one `CrossLinkRepo` verb set, one `HonestyLabel` enum, one verb convention | Accepted | 02, 07, 01 |

---

## ADR-0001 — API service language = Python (FastAPI); frontend = Next.js/TS

**Context.** Product owner fixed a cross-language system. The initial
`architecture.md` sketch assumed a TS-owned core. Grounding (PDF parsing,
chunking, embeddings, Chinese tokenization) and all model/secret handling are
Python-native and live server-side.

**Decision.** The API service is **Python (FastAPI)**; the frontend is
**Next.js + TypeScript**. This is a binding given.

**Consequences.** A real cross-language seam exists (ADR-0002 governs it). Server
owns all model calls, retrieval, and secrets. The frontend cannot perform domain
work even if convenient. The old TS `packages/core`/`packages/retrieval` are
superseded.

**Status.** Accepted.

---

## ADR-0002 — Domain core lives in Python; cross-language sync is schema-first codegen

**Context.** Given ADR-0001, the domain core (tree, fork/backtrack/prune,
per-branch context resolution, relations, outline-from-branches, citation
mapping) could live in Python, be shared via codegen, or be a hybrid. The moat
must have exactly one implementation, or it will drift.

**Decision.** The authoritative domain logic lives **once, in Python**, in
`apps/api/weaver_core/`. TypeScript holds **no** domain rules — only rendering,
interaction, and a **generated** typed client. Sync is **schema-first**: Pydantic
v2 models are the source of truth for all wire shapes → FastAPI emits OpenAPI 3.1
→ checked-in `packages/contracts/openapi.json` → `openapi-typescript` (+ typed
client) → `@weaver/contracts`. A **CI drift guard** regenerates the contract and
fails on any diff. TS importing a domain type imports from `@weaver/contracts`,
never re-declares it. Enums are declared once in Python and flow through.

**Consequences.** The moat cannot be re-implemented (and silently broken)
client-side. Adding a Python schema/enum automatically widens TS and trips the
drift guard if uncommitted — making additivity a build-time guarantee.
*Constraint:* every wire shape and error code must originate in Python; any
hand-written TS type is a bug. View-only geometry/layout math is allowed in
`apps/web`. **Risk surfaced by the consistency review (now closed):** several docs
declared wire shapes independently (`TokenEvent`, `ErrorCode`, draft fields,
citation offsets); the **contract-freeze pass (2026-06-22, ADR-0021…ADR-0027)**
unified them so the drift guard is meaningful before M2.

**Status.** Accepted.

---

## ADR-0003 — The core artifact is a branching tree, never a free-form canvas

**Context.** The old Weaver was "NotebookLM + canvas"; manual node arrangement
became the central pain. The rebuild repositions to a branching thinking tool.

**Decision.** The backbone is a rooted forest (`parent_id`) with **automatic**
layout (D3 `d3-hierarchy` + `d3-flextree`, Reingold-Tilford). No force/physics,
no manual coordinates. Sibling order is server-assigned `order_index`; layout is
cached by `(nodeId, collapsed, contentHash)` so unchanged trees render
byte-identically (a fork must never reshuffle the user's mental map). Relations
(P1) are a purely additive top overlay that never alters layout.

**Consequences.** Deterministic, non-jittering placement; the tree cannot
degenerate into a hand-tidied canvas. Variable-height node cards require the
size-aware flextree variant. foreignObject (HTML-in-SVG) gives rich-card
ergonomics with SVG pan/zoom; its performance ceiling is an open M2 budget item.

**Status.** Accepted.

---

## ADR-0004 — Per-branch context isolation is a pure, model-independent service (THE MOAT)

**Context.** The product's moat is "按分支隔离上下文": given a node, the AI sees
only that node's ancestor chain, never sibling branches. It must be testable
without any model and impossible to widen at the model layer.

**Decision.** `resolve_branch_context` is a **Tier-A pure function**: no I/O, no
model, no clock, no randomness. It walks **only `parent_id` upward** over an
in-memory `NodeForest` snapshot and returns an auditable `BranchContext` value
object (chain + excluded ids + policy fingerprint), separate from `to_messages()`
which renders it for the provider. The DB read happens in Tier B (outside the
resolver). The provider receives only messages and has no access to the forest
(asserted by a spy-repo contract test). Built and tested first in M2.

**Consequences.** Sibling isolation is a **structural** property (an upward
parent walk can never reach siblings/descendants), not a runtime check. Every
context-producing path — retrieval (builds its query from `BranchContext`, not
the forest), draft generation, cross-project discovery — routes through this one
function, so context can never leak by construction. The value/render split lets
tests assert on `BranchContext` while downstream consumes `to_messages()`.

**Status.** Accepted.

---

## ADR-0005 — Branch is a derived value object — no branches table, no branch CRUD

**Context.** A persisted branch identity would be a second source of truth that
could drift from the node tree the moat depends on.

**Decision.** `Branch` is computed by `forest.branch_of()` from `parent_id`
lineage. There is **no** `BranchRepo`, no branches table, no branch CRUD route.
Branch id == head node id; branches are GET-only derived resources; the only
mutating branch verb is `promote` (into an outline). The client sends head node
IDs for intent (draft-from-branches, compare, promote) and lets the server derive
lineage; the client never treats Branch as an entity.

**Consequences.** The tree (`parent_id`) is the only structural truth; no
relation or branch row can inject a node into context. Slightly more derivation
work per request, accepted for single-user scale.

**Status.** Accepted.

---

## ADR-0006 — Dead-end ancestors excluded from resolved context by default; target node sacred

**Context.** Foundation open question (§3/§11). A dead-end ancestor is a premise
the user explicitly rejected (PRD §2.2 剪枝); feeding it into a descendant
re-pollutes the exact reasoning the moat protects.

**Decision.** Dead-end **ancestors** are EXCLUDED from resolved model context by
default. The **target** node is always kept even if `dead_end` (so you can reason
*about* a dead end). A per-call/project toggle `include_dead_end_ancestors`
(default `False`) flips it. Exclusions are auditable via `excluded_dead_end_ids`;
lineage stays intact for display.

**Consequences.** The "don't re-feed me what I rejected" guarantee is the
default; an opt-in escape hatch supports "show the AI what I already tried." Open:
a dead-end node *between* two live ancestors is dropped by default — principled
but possibly surprising; needs prototype validation.

**Status.** Accepted (default), with one open case flagged.

---

## ADR-0007 — One ModelProvider Protocol for API SDKs + CLI agents + FAKE

**Context.** Binding decision #2: a unified plugin abstraction must support direct
SDKs (Anthropic/OpenAI/Gemini) AND local CLI agents (Claude Code/Codex/Gemini
CLI/OpenCode), plus a deterministic test backend.

**Decision.** One `ModelProvider` Protocol covers `API_SDK`, `CLI_AGENT`, and
`FAKE` behind a single async-streaming `generate() -> AsyncIterator[TokenEvent]`.
Backends register via registry **builders**, never by changing the interface. The
provider **never resolves context** — it receives already-resolved messages and
has no repo/forest access. AI-proposed forks are structured generation over the
same `generate()` (`purpose='fork_proposal'` + `response_schema`), not a special
endpoint. The `ProviderRegistry` (owned by doc 02) is keyed by `(kind, provider)`,
takes builder callables, and injects a `SecretStore`.

**Consequences.** CLI agents can land later "with no interface change." Proposals
inherit the moat's isolation and FAKE determinism. *Constraint:* doc 08's
competing decorator/class registry conforms to doc 02's design (consistency item
C10, frozen in ADR-0027). `TokenEvent` is unified into one model + one exhaustive
8-member type enum (C1, frozen in ADR-0021).

**Status.** Accepted.

---

## ADR-0008 — Permissions enforced in the API process by a default-deny PermissionGate

**Context.** The prototype Settings exposes per-backend toggles (auto-run
read-only commands / allow file edits / network access). Delegating safety to an
agent's own trust prompts is unsafe.

**Decision.** Permissions are enforced **in the API process** by a
`PermissionGate` per action, **default-deny**, inside a confined sandbox workdir —
not delegated to the agent's prompts. Inert for `API_SDK`/`FAKE`. SDK
function-calling that drives local tools must route through the **same** gate
(backend-kind agnostic). Unknown actions default to `REQUIRE_APPROVAL` with
conservative per-agent allowlists.

**Consequences.** OS-level confinement holds even if an agent ignores its own
prompts. Live enforcement is a Later (P1) deliverable; MVP ships the permission
*model*. Open: sandbox strength (confined workdir + default-deny network, with
container isolation opt-in); CLI streaming protocols are version-volatile
(recorded-fixture contract tests + capability probe).

**Status.** Accepted.

---

## ADR-0009 — Secrets stored only as `api_key_ref` indirection, never inline

**Context.** API keys must never appear in the DB, `openapi.json`, logs, or
`TokenEvent`s; argv is world-readable via `ps`.

**Decision.** Secrets are stored only as `api_key_ref` (`env:` / `keyring:` /
`file:`), resolved once at provider-build time by a `SecretStore`, injected into
CLI subprocess **env** (never argv), scoped by an env allowlist. The API exposes
only `has_api_key: bool`; `api_key` is write-only. A secret-leak contract test
asserts no `*View` ever returns it.

**Consequences.** The no-leak guarantee is enforceable, not aspirational. Backups
default to excluding secrets (re-enter on a new machine in MVP).

**Status.** Accepted.

---

## ADR-0010 — AI proposes upstream; commits go through the same pure write path

**Context.** AI-proposed forks, outline skeletons, and relation/gap suggestions
must not create a special, untested AI write path that could bypass invariants.

**Decision.** The AI only **proposes** (structured generation, upstream in the
model layer). All commits — human or AI — go through the **same pure functions**
(`fork` / `promote_to_point` / `add_relation`). There is no AI write path in the
core.

**Consequences.** One write path means invariants and unit tests cover both human
and AI mutations; proposal (model-touching, non-deterministic) stays cleanly
separated from commit (pure, deterministic).

**Status.** Accepted.

---

## ADR-0011 — Repository-hidden persistence; SQLite local-first, Postgres swappable

**Context.** Local-first single-user needs zero-setup; the deployment may later
move to Postgres. Persistence must not leak into routes or the domain core.

**Decision.** Persistence is behind **repository Protocols**
(`weaver_core/persistence/`), with SQLAlchemy implementations. **SQLite +
sqlite-vec is the local-first default**; **Postgres + pgvector** is a swap. No
queue/broker in MVP; ingestion is the only async-eligible path, backed by an
in-process asyncio job + a `jobs` table that can later back an external worker
without redesign. Backtrack is non-mutating (refocus only) so the forest stays
byte-identical. `updated_at` is app-maintained for dialect parity. All repos use
`create` (verb consistency — consistency item C12).

**Consequences.** Local users get a single-file store; production can scale the
store without touching domain code. The persistence-side coverage gaps are now
closed by the contract-freeze pass: `BlobStore` Protocol (G4), per-project
embedding-dimension lock (G5), and the idempotency-key store (G2) — all frozen in
ADR-0026.

**Status.** Accepted.

---

## ADR-0012 — Sources are optional grounding; retrieval widens evidence, never branch context

**Context.** PRD §4.1: sources are optional. Weaver is a branching thinking tool,
not a doc-Q&A product. Zero-source projects must be provably untouched by
retrieval.

**Decision.** Grounding is a fully bypassable, opt-in pipeline gated by a single
`GroundingService.is_grounded()`; the think loop inserts retrieval only when a
project has ≥1 ready Source, via interface injection (no module-load import of
retrieval by tree/moat/crystallize/draft). Retrieval **widens evidence, never
branch context**: the query is built from the resolved `BranchContext` (ancestor
chain only) plus the node prompt; retrieved chunks are injected into the
SYSTEM/grounding slot as numbered `[S#]` evidence, never as extra conversational
turns. The `VectorIndex` Protocol has a sqlite-vec default, a numpy flat fallback
(never hard-fails on a missing native extension), and a pgvector swap;
multilingual default embedder (bge-m3 class) with a deterministic FAKE embedder
for CI; content-hash embedding cache for resumable ingestion.

**Consequences.** Isolation is preserved by construction even with grounding on.
The product never imports retrieval when source-less. Open: default embedder
choice and per-project vs global dimension (G5).

**Status.** Accepted.

---

## ADR-0013 — Sentence-level citation mapping is a pure function (P0 hard indicator)

**Context.** Clickable-to-original sentence-level citations are the P0
NotebookLM-parity indicator and the highest-risk piece; Chinese citation spans
break under Latin splitters ("引用断链").

**Decision.** `map_citations` is **pure, synchronous, no-I/O, no-model**:
marker-primary (`[S#]`) with lexical/semantic alignment fallback, returning both
a **source char span** (jump-to-original) and an **answer span** (underline). One
shared sentence segmenter (`segment_sentences`) is used by **both** chunking and
citation mapping (preventing span drift), with a dedicated CJK branch
(`。！？；…` terminators, width normalization, char-level LCS). The mapper also
returns uncited answer sentences so the honesty flag (ADR owned by doc 01) can
mark them `inferred`.

**Consequences.** Heavily unit-testable in isolation, mirroring the moat's purity
discipline. **Resolved a P0 risk surfaced by the consistency review:** the
`Citation.char_start/end` coordinate space is now fixed canonically as offsets
into the **SOURCE canonical document** (consistency item C4, frozen in ADR-0024);
storage of `answer_span`/`method`/`confidence`/`details` is added to the DDL.
Honesty-label vocabulary is one closed set (C13, frozen in ADR-0027).

**Status.** Accepted; Citation shape frozen by ADR-0024.

---

## ADR-0014 — The argument outline is an optional crystallization layer

**Context.** PRD: a draft can be generated directly from selected branches,
bypassing the outline. The human sets the angle (人定角度).

**Decision.** `promote` is **deterministic text extraction** (annotation /
first-sentence claim seed), **not** a model call in MVP (optional model phrasing
is P1, never automatic). Both draft paths — direct-from-branches and via-outline
— share **one generator**; the only difference is how sections are derived in
step 1. The outline only reorders/groups claims; it never changes whether
citations survive.

**Consequences.** The outline is genuinely optional, structurally guaranteeing
"both paths preserve citations." Promote is unit-testable without a model. Open:
claim-seed quality in MVP (deterministic vs opt-in model phrasing).

**Status.** Accepted.

---

## ADR-0015 — Voice affects the DRAFT, not just chat (deliberate edge over NotebookLM Personas)

**Context.** Three prototype Voice presets (academic / casual / professional).
NotebookLM Personas only affect chat; affecting the draft is a deliberate
differentiator.

**Decision.** Voice is injected into the **draft-generation system prompt** via a
`VoiceSpec` table (directives + `citation_density` per tone), shaping
structure/hedging/person — not a post-filter, not chat-only. `citation_density`
modulates how citations *read* but never drops a citation row (the marker rule is
constant across voices → preservation regardless of tone). Voice "feed-a-sample"
(P1) runs style extraction at draft time, cached on the Voice row keyed by
`hash(sample_text)`, appended to (not replacing) the preset tone prompt.

**Consequences.** "Voice affects the draft" is structurally true. The `VoiceSpec`
table is the single testable place tone→behavior is defined. Voice is now stated
explicitly as **draft-only** — never on `/think` answers (coverage gap G6, frozen
in ADR-0026); `Voice.style_directives`/`sample_hash` persistence is added to the
`voice_config` DDL (consistency item C6, frozen in ADR-0026).

**Status.** Accepted; C6/G6 frozen by ADR-0026.

---

## ADR-0016 — Multi-format Artifacts all derive from one Draft/Outline with provenance

**Context.** Anti-NotebookLM selling point: topic consistency across formats
(Article / Deck / X Thread / Video / Email) from a single source of claims.

**Decision.** Multi-format Artifacts (P1) all derive from **one** Draft/Outline
with `derived_from_hash` provenance. Format transforms may reshape but **may not
introduce claims or `source_node_ids`** absent from the source (the same
in-scope clamp as AI outline proposals). Staleness is flagged, never silently
regenerated. Draft generation streams via SSE (`TokenEvent`); citation marker →
`Citation` mapping is a **post-stream finalize** on the terminal `done` event
(marker resolution needs the full document). Hallucinated markers are dropped
into `uncited_claims`.

**Consequences.** Single source of claims is enforced, not hoped for; provenance
is explicit over magic. Open: citation fidelity for footnote-less formats
(x_thread/deck); stale-Artifact policy (auto-flag vs one-click re-derive-all).
`grounded`/`uncited_claims` fields are now added to the canonical Draft (00),
`DraftView` (03), and DDL (07) (consistency item C6, frozen in ADR-0026).

**Status.** Accepted; C6 frozen by ADR-0026.

---

## ADR-0017 — Relations are an additive overlay, invisible to the moat

**Context.** PRD §2.3: the tree is the backbone; cross-branch links
(merge/connection/contradiction) are an overlay, never backbone edges. A relation
must never inject a node into resolved context.

**Decision.** The Relations overlay is **additive-only and invisible to the
moat** — `resolve_branch_context` never reads `Relation` rows; removing all
relations yields an identical tree. True content "merge" requires an explicit
AI-synthesized fork (single parent + a connection relation), not a context merge.

**Consequences.** Because the moat is defined purely over `parent_id`, no relation
can widen context by construction. Open: confirm the structural encoding of
"合并这两枝洞察 → AI 综合成新节点" matches the desired UX.

**Status.** Accepted.

---

## ADR-0018 — Determinism: FAKE provider is the CI default; no test reaches a real model

**Context.** Model-touching paths (think, fork proposals, drafts, citations, CLI
permissions) must be reproducible in CI.

**Decision.** **FAKE is first-class and deterministic**: env-selected
(`WEAVER_MODEL_MODE=fake`) as the CI default; selects events by `(purpose,
stable-hash(messages))`; emits schema-valid structured output, scripted
citations, scripted per-category `tool_calls`, and injectable errors/exit codes.
A FAKE embedder keeps retrieval ordering reproducible.

**Consequences.** Every model-touching path is reproducible without a real
backend or network. Requires the unified `TokenEvent` taxonomy (consistency item
C1) to be the single contract FAKE emits.

**Status.** Accepted.

---

## ADR-0019 — CrossLink (cross-project network) never participates in context resolution

**Context.** P2 vision: a cross-project thinking network. Widening a node's
resolved context with cross-project edges would silently break the moat — the
exact pain Weaver sells against.

**Decision.** `CrossLink` is an **additive cross-project overlay that NEVER
participates in `resolve_branch_context`**. Cross-project context is always
explicit, user-initiated, and resolved per-project (the moat per side) — never an
implicit lineage extension. AI-discovered and user-created links share one schema
(`created_by` + `status` suggested/accepted/dismissed; `dismissed` is sticky). AI
discovery is an **offline batch job** reusing the structured-generation path,
never in the think-loop hot path. The same `VectorIndex` serves grounded
retrieval and discovery; the network uses a small `cross_links` edge table (not a
graph DB); `build_network_graph` is a pure in-memory read-model assembler.

**Consequences.** The network is navigation, not context bleed. Single-user scale
doesn't justify a graph DB. Open: discovery scope/cost, ungrounded-project
discoverability, transcription engine policy.

**Status.** Accepted (P2).

---

## ADR-0020 — Extensibility litmus: new backend/source/format = enum + adapter, zero core edits

**Context.** The foundation already chose the plugin abstractions; additivity
needs to be a build-time guarantee, not a hope.

**Decision.** One litmus test governs extensibility: a new `ModelBackend` /
`SourceKind` / `ArtifactFormat` / `structure_template` must be only (a) a new enum
value + new adapter/schema, (b) **zero edits** to `weaver_core` domain
(moat/tree/crystallize/citation/draft), (c) flowing to TS purely via schema-first
codegen. All ingestion (PDF/URL/browser capture/video) normalizes to a shared
`SourceBlock[]` via a `SourceIngestor` seam, so everything downstream
(chunk → embed → citation) is kind-agnostic; media citations carry a `media_ref`
(timestamp/page) reusing the existing citation mapper. Enforced by an
import-isolation pytest guard ("core does not import extensions").

**Consequences.** From the chunker onward, a podcast is indistinguishable from a
PDF; the moat/tree/crystallize/draft never learn new source kinds exist. New
capabilities reuse the same VectorIndex and jobs table — no new infrastructure.

**Status.** Accepted.

---

## ADR-0021 — `TokenEvent` is a single closed-shape stream event owned by doc 02 (seq+request_id, eight types)

**Context.** `TokenEvent` was declared three incompatible ways (00/02 closed set;
02 added `seq`/`request_id`; 03 dropped them and added `proposal`/`progress`; 05
added `ingest_progress`). It is the SSE wire contract and a codegen drift-guard
input, so divergence breaks both the contract test and the generated client.

**Decision.** Doc 02 is the sole owner. Canonical shape:
`{type, data, seq:int, request_id:str|None}`. Closed `type` enum = exactly
`token, tool_call, tool_result, citation, proposal, progress, done, error`.
`progress` subsumes ingestion progress (`ingest_progress` is deleted everywhere).
`proposal` carries one fork/outline proposal. `seq` is mandatory (monotonic per
stream); `request_id` optional. Docs 03 and 05 reference it by name and never
re-declare its field set or invent new `type` members.

**Consequences.** One SSE schema flows to TS; the FE can switch exhaustively over
event types. Ingestion progress and AI proposals reuse existing event types (no
new endpoints/types). 05's `IngestProgress` maps onto `progress` event data.
`seq` enables ordering/dedupe; `request_id` enables cancel + idempotency
correlation.

**Status.** Accepted 2026-06-22.

---

## ADR-0022 — Draft generation is a single streaming `POST /projects/{pid}/drafts` (no two-step create-then-generate)

**Context.** Doc 03 specified a two-step flow (`POST /drafts` create record, then
`POST /drafts/{id}/generate` stream) while 04/06 assumed a single streaming
`POST /drafts`; the request schema name also diverged (`DraftGenerateRequest` vs
`DraftRequest`).

**Decision.** Canonical = one single streaming endpoint
`POST /projects/{pid}/drafts` (SSE `TokenEvent`) that creates the Draft and
streams generation; the terminal `done` carries the draft id + `DraftView`.
Unified request schema = `DraftGenerateRequest` with exactly one source path
required (`outline_id` XOR non-empty `source_branch_node_ids`, else
`DRAFT_SOURCE_AMBIGUOUS`). The two-step generate and the record-only `DraftCreate`
are removed; `PATCH /drafts/{id}` remains for manual edits. 06 renames
`DraftRequest`→`DraftGenerateRequest` and drops bare `POST /drafts`.

**Consequences.** Simpler local-first flow matching the FE assumption. The
two-step's only benefit (pre-stream id for idempotency) is covered by the
`Idempotency-Key` mechanism + the id returned in `done`. Manual empty drafts are
out of MVP scope.

**Status.** Accepted 2026-06-22.

---

## ADR-0023 — `ErrorCode` (doc 03) is the single source of truth; the frontend imports the generated union

**Context.** Doc 03's `ErrorCode` is codegen'd into the TS error union, yet 04
hand-rolled an `AppErrorCode` union with codes the API never sends (`VALIDATION`,
`BACKEND_UNAVAILABLE`, `GROUNDING_FAILED`, `UNKNOWN`), 02 raised
`BACKEND_DISABLED`, and 08 raised `UNKNOWN_BACKEND` plus other codes — none of
which were in 03.

**Decision.** 03's `ErrorCode` is the sole enum. Added `BACKEND_DISABLED`,
`UNKNOWN_BACKEND` (distinct from `BACKEND_NOT_FOUND`), and 08's P2/extensibility
codes (`CROSSLINK_NOT_FOUND`, `CROSSLINK_SELF_LINK`, `UNSUPPORTED_SOURCE_KIND`,
`UNKNOWN_ARTIFACT_FORMAT`, `UNKNOWN_TEMPLATE`, `DISCOVERY_NO_EMBEDDINGS`). 04
deletes its hand-rolled union and imports the generated `ErrorCode`; `AppError`/
`toAppError` keep working typed against the generated union. 02/08 reference by
name. 04's prose code names are corrected (`VALIDATION`→`VALIDATION_FAILED`,
`BACKEND_UNAVAILABLE`→`NO_DEFAULT_BACKEND`/`BACKEND_DISABLED`,
`GROUNDING_FAILED`→`GROUNDING_UNAVAILABLE`, drop `UNKNOWN` for a catch-all
`INTERNAL`).

**Consequences.** One Python enum → one generated TS union → exhaustive,
drift-guarded FE switches. No path to a hand-written drifting client error type.
Adding a code in Python automatically widens the TS union and fails the build if
not regenerated.

**Status.** Accepted 2026-06-22.

---

## ADR-0024 — Citation char offsets index the SOURCE canonical text; `answer_span`/`method`/`details` are stored columns

**Context.** 05 said `Citation.char_start/end` index the SOURCE canonical text
while 07/00 phrasing implied the Chunk text — two coordinate spaces for one
field, which silently breaks the P0 click-to-original. 05's `answer_span`/
`method`/`confidence`/`details` had no DDL home and 03 didn't surface them.

**Decision.** 00 fixes `char_start/end` to the source canonical document
coordinate space (chunk spans are a window into the same space). 07's `citation`
table gains `answer_span JSON`, `method TEXT CHECK(method IN ('marker','lexical',
'semantic','none'))`, `details JSON` (incl. staleness), keeping `confidence REAL`;
07's `chunk` DDL comment is corrected to say chunk offsets also index the source
canonical text. 05's `CitationDraft` maps 1:1 to those columns. 03 surfaces
`method` + optional `answer_span` on `CitationRef`/`CitationAnchor`. 06 corrects
its "offset into the Chunk text" recap.

**Consequences.** Click-to-original (incl. PDF page / video timecode) resolves
deterministically against one coordinate space across node answers, drafts, and
exports. The mapper's full output round-trips through storage and the wire without
lossy encoding. The FE can underline the supported answer span and style by trust
method.

**Status.** Accepted 2026-06-22.

---

## ADR-0025 — `/think` auto-creates the answer node; `create_child` is the explicit preview switch

**Context.** `/think` answer-node creation was described three ways: 03
`create_child=True` + persist on `done`; 01 "persisted only on accept" (preview);
04 optimistic child at submit — affecting idempotency, the returned `node_id`, and
the FE flow.

**Decision.** Default `create_child=True`: `/think` creates and persists the
answer node (with citations) in one transaction at the `done` boundary.
`create_child=False` is the non-committing preview (stream runs, nothing
persisted, `done.node_id=null`). 01 §8 references `create_child` as the switch; 04
treats its optimistic placeholder child as view-only until `done` returns the real
`node_id` (or discards it for previews).

**Consequences.** One persistence model resolves the idempotency and returned-id
ambiguity. Preview is supported without a second endpoint. The FE knows exactly
when its optimistic child becomes a real server node.

**Status.** Accepted 2026-06-22.

---

## ADR-0026 — Cross-cutting contract gaps closed before M2: cancellation, idempotency store, MetaView, BlobStore, per-project embedding dim, Voice-only-on-draft, AI-fork transport

**Context.** Seven coverage gaps (G1–G7) left the cross-language seam
under-specified: SSE cancellation transport, `Idempotency-Key` store/semantics,
`GET /meta` schema, `BlobStore` Protocol, embedding-dimension consistency,
whether Voice applies to `/think`, and end-to-end AI-proposed-fork transport. C6
(Draft `grounded`/`uncited_claims` + `Voice.style_directives`) and C7
(pre-generation segment count) are gap-adjacent and resolved with the same pass.

**Decision.** Resolve each concretely:
- **G1 cancellation** = client disconnect (FastAPI cancels the asyncio task →
  provider `finally` teardown) + explicit `DELETE /streams/{request_id}`; both →
  `STREAM_INTERRUPTED`; `request_id` maps to 02's `GenerateRequest.request_id` and
  is echoed on every `TokenEvent`.
- **G2 idempotency** = a defined mechanism on mutating/streaming POSTs backed by an
  `idempotency_key` table in 07 (`key, request_fingerprint, result_ref, status,
  created_at, expires_at` + sweep index); 24h window; same key+fingerprint →
  first persisted result (streams refetch by id, no token re-stream); same key +
  different fingerprint → `IDEMPOTENCY_REPLAY` (409).
- **G3 MetaView** = `MetaView{build_version, api_version, default_backend_id?,
  model_mode, features}` with an explicit boolean `FeatureFlags` model (off in
  MVP); 04 gates UI on `features.*` by exact field name.
- **G4 BlobStore** = content-addressed `BlobStore` Protocol
  (`put/get/delete/url_for`, `blob://sha256/<hex>`), `FileBlobStore` default under
  `WEAVER_DATA_DIR/blobs/`, included in the backup tarball; `raw_ref`/
  `payload_ref`/artifact payloads are BlobStore refs.
- **G5 embedding dim** = per-project, locked at first ingest (`embedder_id`/
  `embedding_dim` on `project`); per-dim `vec_chunks_{dim}` table; `EMBEDDING_DIM`
  is default-for-new-projects only; changing an embedder requires a
  `reembed_source` job.
- **G6 Voice** = draft-only; `/think` answers use a neutral register with NO
  `VoiceTone`; `ThinkRequest` has no `voice` field (intentional, contract-frozen).
- **G7 fork transport** = one `ForkProposal{prompt, rationale, suggested_label?}`
  (03 owns the wire shape; 02's `ProposedFork` maps 1:1); two delivery paths —
  inline `proposal` `TokenEvent`s + `done.fork_proposals`, OR
  `POST /nodes/{id}/fork/propose` → `ForkProposeResult`; accept via
  `POST /nodes/{id}/fork`. The `proposal` `TokenEvent` type (ADR-0021) is the
  single transport for both fork and outline proposals.
- **C6** = 00's `Draft` gains `grounded`/`uncited_claims` (mirrored in 03
  `DraftView` + 07 DDL); `Voice.style_directives`/`sample_hash` cached on 07
  `voice_config`.
- **C7** = an early `progress`-type `TokenEvent` (`stage:'context_resolved'`,
  `context_segment_count`, `branch_node_ids`) is the first `/think` frame;
  `context_segment_count` also on `ThinkResultMeta`.

**Consequences.** The drift-guard becomes meaningful before M2 because every wire
shape (events, errors, meta, citations, draft route) is fully specified.
Local-first single-user assumptions keep the solutions minimal (no resumable SSE,
no broker, on-disk content-addressed blobs, per-project dims). 02/03/04 share one
`ForkProposal` shape and one `proposal` `TokenEvent` type.

**Status.** Accepted 2026-06-22.

---

## ADR-0027 — One `ProviderRegistry`, one `CrossLinkRepo` verb set, one `HonestyLabel` enum, one verb convention

**Context.** Medium/low contradictions remained at the seam: two provider-registry
designs (02 class with `(kind,provider)` key vs 08 module-level decorator keyed by
provider only), `CrossLinkRepo` verb drift (`add` vs `create`), honesty-label
vocabulary drift (`user_judgment`/`grounded` vs `author_judgment`/
`weakly-grounded`), and colon-style verbs in 06/08 violating the 00 §1.5 sub-path
convention.

**Decision.** 02's `ProviderRegistry` class (composite `(kind,provider)` key,
`register_builder`, `get`, `default_for`) is canonical; 08 deletes its module-level
`_REGISTRY`/`@register_provider`/`build_provider` and conforms via
`registry.register_builder(...)`; `get` raises `UNKNOWN_BACKEND`/`BACKEND_DISABLED`
/`BACKEND_NOT_FOUND`. `CrossLinkRepo` standardizes on `create` (07 carries the full
P2 method set `create/get/list_for_project/list_network/update_status/delete`; 08
conforms). 01 owns a closed `HonestyLabel` enum `{user_judgment, inferred,
grounded, weakly_grounded}` (underscore); 06 fixes `author_judgment`→
`user_judgment`, 05 uses `weakly_grounded`. All colon verbs become sub-paths
(`…/outline/propose`, `…/blocks/{id}/op`).

**Consequences.** One registry call site (correctly disambiguating SDK `gemini`
from CLI `gemini_cli`), one repo verb matching all siblings, one honesty
vocabulary that codegens cleanly with exhaustive FE switches, and a uniform REST
verb convention across all docs.

**Status.** Accepted 2026-06-22.

---

### Decisions still open (not yet ADR-ready)

> The contract-seam items (C1–C13, G1–G7) are **resolved** by the 2026-06-22
> contract-freeze pass (ADR-0021…ADR-0027) and are no longer listed here. The
> README "Open Questions & Known Inconsistencies" section carries the full
> resolution ledger. What remains below are genuinely open product-judgment / UX
> knobs and later-milestone questions — none block M2 codegen.

- **Prototype/UX knobs:** AI-proposed-fork cadence (how many directions, when to
  offer); tree-scale ceiling (auto-merge / auto-focus / summarization lifecycle);
  claim-seed quality in MVP (deterministic vs opt-in model phrasing);
  `draft_anchor` robustness under heavy edits; N-way compare cap; transient-fold
  vs persisted-collapsed conflict rule; dead-end node *between* two live ancestors
  (principled-but-surprising default — needs prototype validation).
- **Performance / tuning:** foreignObject (HTML-in-SVG) performance ceiling
  (M2 budget, windowing/canvas fallback?); `INLINE_TOKEN_BUDGET` default tuning;
  default embedder choice (bge-m3 vs bge-small-zh).
- **Later-milestone policy:** P2 discovery scope/cost control;
  ungrounded-project discoverability; transcription engine (local Whisper vs API);
  multi-format citation fidelity for footnote-less formats; stale-Artifact policy;
  re-ingest citation policy (flag stale vs auto-heal); secrets-in-backups (lean:
  re-enter for MVP); resumable SSE / `Last-Event-ID` (lean: skip in MVP).
