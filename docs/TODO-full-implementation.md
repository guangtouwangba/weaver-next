# Weaver Next — Full Implementation TODO

> The complete task list to take the current clickable demo → the full vision in [`implementation-plan.md`](implementation-plan.md).
> Generated 2026-06-23 from [`gap-analysis-2026-06.md`](gap-analysis-2026-06.md). Ordered by the critical path: **fixes → E0 → E1 → (E12 ∥ E2) → E3 → E4 → E5 → E6 → P1 → P2**.
> Each `[ ]` is one deliverable. 🔧 backend · 🎨 frontend · 🧪 test · 🐞 bug-fix. Story ids (E0.1…) map back to the plan.

---

## ⚡ Phase −1 — Fix-now bugs (zero-dependency, do immediately)

These are defects in shipped code; none depend on unbuilt features.
- [x] 🐞 Resolver: keep a `dead_end` **target** in the chain (`n.id == target_node_id` guard) — `context/resolver.py:30` *(E2.6)*
- [x] 🐞 Resolver: add a `seen` set → raise `CYCLE_DETECTED` on cyclic `parent_id` (currently infinite-loops) — `resolver.py:28-32` *(E2.8)*
- [x] 🐞 Resolver: scope `excluded_dead_end_ids` to **on-chain ancestors**, not the whole forest — `resolver.py:22-24` *(E2.1/E2.5)*
- [x] 🐞 Resolver: when `include_dead_ends=True`, return **empty** `excluded_dead_end_ids` *(E2.7)*
- [x] 🐞 Fork on missing parent → return `NODE_NOT_FOUND`, not `[]/201` — `main.py:637` *(E2.11)*
- [x] 🐞 Draft: ungrounded draft must return `grounded=false` + zero citations — `main.py:483` *(E3.0)*
- [x] 🐞 Draft: stop falling back to hardcoded `node_demand/node_bundle` when `outline_id` set — `main.py:443` *(E4.4)*
- [x] 🐞 QuickNote promote: 404 on missing note instead of fabricating one — `main.py:617` *(E1.3)*
- [x] 🐞 Meta: `FeatureFlags` all default **false** (`cli_agents` currently True) — `main.py:17` *(E1.5)*
- [x] 🐞 Export: replace fragile `count('[^')//2` parity for `citations_preserved` — `main.py:699` *(E5.1)*
- [x] 🧪 Add a regression test per fix above.

---

## 🏗️ Phase 0 — E0 Repo & Skeleton (M0, gates everything)

### E0.1 — Monorepo tree
- [x] 🔧 Create missing `weaver_core/` subdirs: `tree/ relations/ crystallize/ draft/ citation/ model/ retrieval/ persistence/` (with `__init__`)
- [x] 🔧 Add deps to `apps/api/pyproject.toml`: SQLAlchemy 2.0, Alembic, `python-ulid`, pytest extras
- [x] 🎨 Add `apps/web/app/settings/page.tsx` placeholder
- [x] 🔧 Create `tooling/codegen/` and `tooling/docker/` dirs
- [x] 🔧 Makefile: add `contracts`, `contracts-emit`, `contracts-ts`, `lint`, `codegen` targets
- [x] 🧪 Structure test asserting canonical dirs from arch §5 exist; CI job: `apps/api` imports + `next build`

### E0.2 — OpenAPI → TS codegen
- [x] 🔧 `tooling/codegen/emit.py` — import FastAPI app → `app.openapi()` → `packages/contracts/openapi.json` (sorted keys, deterministic)
- [x] 🔧 `tooling/codegen/gen-ts.sh` — pin `openapi-typescript`; emit `generated/{openapi.gen.ts,client.gen.ts,errors.gen.ts}` with "DO NOT EDIT — generated" header
- [x] 🎨 `@weaver/contracts` re-exports generated types + `WeaverApiError`/`toApiError` + `ErrorCode` union; **delete the hand-written `src/index.ts` types**
- [x] 🧪 Run `make contracts` twice → byte-identical; assert seeded schema + header present

### E0.3 — CI drift guard
- [x] 🔧 `tooling/codegen/check-drift.sh` = `make contracts` + `git diff --exit-code` (msg: "contracts stale, run `make contracts`")
- [x] 🔧 Wire into CI (`.github/workflows/`)
- [ ] 🧪 Mutate a schema in a throwaway branch → red build; revert → green

### E0.4 — FAKE ModelProvider
- [x] 🔧 `model/provider.py` — `ModelProvider` Protocol, `GenerateRequest`, `ChatMessage`, `TokenEvent` (closed 8-member type enum + `seq`/`request_id`), `BackendHealth`
- [x] 🔧 `model/fake.py` — `FakeProvider` + `FakeScript.from_env` (deterministic on `purpose` + hash(system+messages+schema))
- [x] 🔧 `model/registry.py` — `ProviderRegistry` keyed by `(kind,provider)`, `default_for` with FAKE fallback under `WEAVER_MODEL_MODE=fake`
- [x] 🧪 Terminal-event invariant (exactly one `done` xor `error`); determinism (identical stream); schema-valid structured output; scripted `citation`/`tool_call`/`error` events

### E0.5 — Error envelope + SSE
- [x] 🔧 `weaver_api/errors.py` — `ErrorCode` enum + `STATUS` map + `WeaverError` + exception handler → `{error:{code,message,details}}`
- [x] 🔧 `weaver_api/sse.py` — `TokenEvent`→SSE/NDJSON framing, `: ping` keep-alive, terminal-event guarantee
- [x] 🔧 `weaver_api/schemas_common.py` — `Page`/`Created`/`Ok`/`ErrorEnvelope`
- [x] 🎨 `lib/api/{client.ts,sse.ts,errors.ts}` — bearer+base-URL fetch, TokenEvent decoder, envelope→`WeaverApiError`
- [x] 🧪 Trigger ≥1 `ErrorCode` → assert envelope+status; SSE NDJSON schema test on a FAKE stream

### E0.6 — Config + secret store
- [x] 🔧 `persistence/secrets.py` — `SecretStore` Protocol + `FileSecretStore` (0600, gitignored) + `EnvSecretStore`
- [x] 🔧 Config module reading `DATABASE_URL,VECTOR_BACKEND,WEAVER_DATA_DIR,SECRET_STORE,MODEL_MODE,WEAVER_BEARER_TOKEN` w/ defaults
- [x] 🔧 Add `secrets.json` to `.gitignore`
- [x] 🧪 `SecretStore` round-trip (put→ref→resolve); plaintext never serialized; file perms 0600

### E0.7 — Deterministic conftest
- [x] 🔧 `apps/api/tests/conftest.py` — wire FAKE by default + injectable seeded ULID/clock factory; CI sets `MODEL_MODE=fake`
- [x] 🧪 Meta-test: `registry.default_for` resolves FAKE under test env; id factory deterministic across two fixture builds

---

## 🗄️ Phase 1 — E1 Project model & persistence (M1, Dashboard)

### E1.1 — Repos + UoW + Alembic
- [x] 🔧 `persistence/protocols.py` — `ProjectRepo,NodeRepo,QuickNoteRepo,BackendRepo,IdempotencyRepo` (return Pydantic, never ORM rows)
- [x] 🔧 `persistence/engine.py` (SQLite WAL pragmas) + `models.py` (dialect-portable ORM) + `unit_of_work.py` (async commit/rollback ctx mgr + per-request dep)
- [x] 🔧 Alembic init + first migration emitting MVP DDL
- [x] 🧪 Repo CRUD round-trip on temp SQLite (ULID PK, timestamps advance); `alembic upgrade head` == `metadata.create_all`; thin-route AST guard (no SQLAlchemy import in routes)

### E1.2 — Project CRUD (replace mock)
- [ ] 🔧 `ProjectRepo` SQLite impl (cursor pagination, `grounding_enabled` derived query, soft-delete)
- [ ] 🔧 `routes/projects.py` (thin) — POST/GET-list/GET/PATCH(`title`,`voice_default`,`default_backend_id`)/DELETE; `PROJECT_NOT_FOUND`
- [ ] 🔧 `Project*` schemas (`ProjectCreate/View/Summary/Update`) with ULID + real timestamps
- [ ] 🎨 Dashboard project list + New-project form on typed client + empty-state (wire to real API)
- [ ] 🧪 Contract test per route vs OpenAPI; `PROJECT_NOT_FOUND` envelope; soft-delete hides from list

### E1.3 — QuickNote inbox + promote
- [ ] 🔧 `QuickNoteRepo` SQLite impl; `routes/quicknotes.py` — POST, GET(`?unfiled=true`), PATCH(file-to-project)
- [ ] 🔧 `POST /quicknotes/{id}/promote` — create a `ThoughtNode` in the target project + set `promoted_node_id`, **atomic via UoW**; `VALIDATION_FAILED` when no project_id
- [ ] 🎨 Dashboard QuickNote inbox: capture box, filed/unfiled list, file-to-project, promote-to-node
- [ ] 🧪 Per-route contract tests; atomicity test (forced failure → neither node nor `promoted_node_id` written)

### E1.4 — Idempotency-key store
- [ ] 🔧 `idempotency_key` DDL + `IdempotencyRepo` (`get/put/sweep_expired`); service-layer guard for mutating POSTs (same key+fingerprint → first result; diff → `IDEMPOTENCY_REPLAY` 409); startup sweep
- [ ] 🧪 First-result replay; replay conflict; `sweep_expired` deleted-count

### E1.5 — `/meta` + `/healthz`
- [ ] 🔧 `routes/meta.py` — `MetaView{build_version,api_version,default_backend_id?,model_mode,features}`; `model_mode` from env; flags all-false
- [ ] 🎨 Read `MetaView.features.*` to gate `relations`/`compare` affordances by exact-name flag
- [ ] 🧪 `MetaView` validates; `healthz` public; flags default false

---

## ⚙️ Phase 2a — E12 Settings & model-config (M2, Settings)

### E12.1 — Backend CRUD + secret store
- [ ] 🔧 `BackendRepo` SQLite impl (`model_backend` DDL + embedded `permissions` JSON + `ux_backend_one_default`)
- [ ] 🔧 `routes/backends.py` — POST/GET/PATCH/DELETE; write raw `api_key`→secret store as `api_key_ref` (never echoed; only `has_api_key`)
- [ ] 🔧 `UNKNOWN_BACKEND` (422) at resolve, `BACKEND_DISABLED` (403) on use
- [ ] 🎨 Settings `BackendList.tsx` (list/add/edit/remove)
- [ ] 🧪 Secret-leak test (no `*View` ever contains key); `UNKNOWN_BACKEND`/`BACKEND_DISABLED` envelopes

### E12.2 — PermissionGate (the real deliverable)
- [x] 🔧 `model/cli/permission.py` — `PermissionGate`, `ActionCategory`, `Decision`, `classify()` (ls→readonly, write→edit, curl→network, ambiguous→unknown) + `authorize()` truth table; `PermissionSet` defaults all-false
- [x] 🎨 Settings `PermissionToggles.tsx` — three switches, shown only for `cli_agent`
- [x] 🧪 Full `(category × permission)` authorize truth table + default-deny; action classification

### E12.3 — Default backend (global + per-project)
- [ ] 🔧 `BackendRepo.set_default` (clears prior, enforced by partial unique index); `ProviderRegistry.default_for` chain (project → global → FAKE) → `NO_DEFAULT_BACKEND` (422)
- [ ] 🔧 Project `default_backend_id` override via PATCH /projects/{id}
- [ ] 🎨 Settings default picker + project backend override
- [ ] 🧪 `set_default` clears prior; partial-unique rejects two defaults; `default_for` fallback incl. FAKE; `NO_DEFAULT_BACKEND`

### E12.4 — Test-connection
- [ ] 🔧 `POST /backends/{id}/health` delegating to `registry.get(id).health()`; map failures to `BackendHealthView` (not 5xx); `BACKEND_DISABLED`/`BACKEND_NOT_FOUND`
- [ ] 🎨 Settings "Test connection" per row (ok/latency/detail)
- [ ] 🧪 `BackendHealthView` validates; FAKE→ok; disabled/missing → correct code (no network)

### E12.5 — Voice presets
- [ ] 🔧 `voice_config` DDL (`tone`,`instructions`) persistence; `project.voice_default` on `ProjectUpdate`
- [ ] 🎨 Settings Voice presets panel (tone select + instructions)
- [ ] 🧪 `voice_config` round-trip; `voice_default` validates vs `VoiceTone`; assert `ThinkRequest` has **no** `voice` field

---

## 🌳 Phase 2b — E2 Thinking-tree moat (M2, the moat)

### E2.1 / E2.2 — Resolver + schemas (harden)
- [x] 🔧 `context/policy.py` — `ContextPolicy(include_dead_end_ancestors=False)` + `fingerprint()` + `apply_depth_window` (identity in MVP)
- [x] 🔧 Refactor `resolve_branch_context(node_id, forest, policy)` to take `ContextPolicy`; raise domain `NODE_NOT_FOUND`
- [x] 🔧 `schemas/{node,context}.py` — add `Branch` + `forest.branch_of`, `with_node/with_nodes/descendants`; enum-literal `status`; `ContextMessage.kind/role/provenance`
- [x] 🧪 T-CTX-1 (byte-identical determinism, stable fingerprint) + T-CTX-11 (import-lint: no DB/model/clock/rng); T-CONTRACT-1 round-trip + enum-drift; `branch_of` ordering+depth

### E2.3–E2.8 — Moat guarantee tests
- [ ] 🧪 T-CTX-2 (deep tree: `chain ⊆ lineage`, ∅ off-path) · T-CTX-3 (dual-sibling isolation) · T-CTX-4/7 (dead-end exclusion) · T-CTX-5 (dead-end target kept; whole-chain-dead-except-target) · T-CTX-6 (toggle re-includes + empties excluded) · T-CTX-8 (cycle) · T-CTX-9 (collapsed invisible) · T-CTX-10 (relations invisible)
- [x] 🔧 Add `collapsed` field to `ThoughtNode` (so T-CTX-9 is exercisable; resolver must ignore it)

### E2.9 — Render to messages
- [x] 🔧 `context/render.py::to_messages(BranchContext, system?)` — per-`kind` role/content mapping + `node_id` provenance + optional leading system msg (pure)
- [x] 🧪 Each `kind`→expected role/content/provenance; annotation appended for `user_thought`; no model import

### E2.10 / E2.11 — Tree ops (pure)
- [x] 🔧 `tree/ops.py::fork` (pure, injected `new_id`/`now`, returns new immutable forest) + `_next_order_index`; `tree/forest.py` helpers; `tree/validate.py` invariants (I1/I2/I4)
- [ ] 🔧 `tree_service` + routes: `POST /projects/{pid}/nodes` (NodeCreate→NodeView) + `POST /nodes/{id}/fork` (ForkRequest→list[NodeView], idempotency-key)
- [ ] 🎨 Composer to add root/child node (question or thought+annotation), optimistic insert; `NodeActions` fork + annotate; relayout-on-settle
- [ ] 🧪 T-TREE-1/2/3 (insert child dense-order + input unchanged; new root + multi-root; determinism) + T-TREE-4 (N forks → N siblings); contract + `INVALID_TREE_OP` envelope

### E2.12 — Backtrack
- [x] 🔧 `POST /nodes/{id}/backtrack` → `BranchView` (root→node), **no structural mutation**
- [ ] 🎨 `FocusStore.backtrack(nodeId)` greys off-path nodes; `ancestorPathIds` view-only highlight
- [ ] 🧪 T-TREE-7 (forest byte-identical); FE: off-path greyed, `ancestorPathIds` ordered

### E2.13 — Prune (dead-end + fold, no delete)
- [x] 🔧 `tree/ops.py::prune/unprune` (mark subtree `dead_end` + `collapsed`, no delete) + `set_state` state machine → `ILLEGAL_STATE_TRANSITION`; `POST /nodes/{id}/prune`
- [ ] 🎨 Prune affordance → greyed + collapsed rendering
- [x] 🧪 T-TREE-5/6/8

### E2.14 — Fold/expand
- [x] 🔧 `tree/ops.py::set_collapsed` (pure flag flip); `PATCH /nodes/{id}` (`NodeUpdate.collapsed`)
- [ ] 🎨 Two-level `NodeCard` disclosure + debounced `FoldStore` flush
- [ ] 🧪 T-TREE-10; FE fold test

### E2.15 / E2.16 — Provider Protocol + FAKE (mostly from E0.4)
- [x] 🔧 Confirm `model/provider.py` + `registry.py` complete (register_builder/default_for + `BACKEND_NOT_FOUND/DISABLED/UNKNOWN_BACKEND`)
- [x] 🔧 `FakeProvider` + `FakeScript` deterministic, schema-valid `done.structured`, scripted error injection
- [x] 🧪 Provider contract suite: terminal-event, seq ordering, no-context-widening spy

### E2.17 — AI-proposed forks (real)
- [x] 🔧 `model/schemas/fork_proposal.py` + `provider.generate(purpose='fork_proposal', response_schema)`; `POST /nodes/{id}/fork/propose` streams `proposal` TokenEvents w/ authoritative `done.structured`
- [x] 🎨 Wire propose → accept-as-fork (already partially wired) to real stream
- [x] 🧪 Structured proposals; isolation (proposals only see ancestor chain)

### E2.18 — Streaming `/think` (THE core)
- [ ] 🔧 `tree_service.think`: resolve → `to_messages` → `provider.generate` → persist child at `done`; `POST /nodes/{id}/think` SSE (one terminal `done` xor `error`); pre-stream vs in-stream error split; cancel (`DELETE /streams/{request_id}`) + idempotency
- [ ] 🎨 `lib/api/sse.ts` consume; Tree composer "ask the next question" streams onto the branch
- [ ] 🧪 Contract/SSE (FAKE): `branch_node_ids == ancestor chain`; child persisted with isolated context

### E2.19 — "Reading your N branches" frame
- [ ] 🔧 Emit early `progress` TokenEvent (`stage:context_resolved`, `context_segment_count`, `branch_node_ids`) before any token
- [ ] 🎨 Render "Reading your N branches" from **server** count (never client-computed)
- [ ] 🧪 SSE: first frame is `progress` with count == chain length

### E2.20 — D3 auto-layout
- [ ] 🔧 Ensure `GET /projects/{pid}/nodes`→`ForestView` carries `order_index`/parent edges (drop hardcoded x/y from domain)
- [ ] 🎨 `components/tree/TreeCanvas` + `useTreeLayout` (d3-hierarchy/d3-flextree) + `useViewport` (d3-zoom clamp k∈[0.15,2.5]) + Edges layer + multi-root super-root + node-state styling; add d3/vitest deps
- [ ] 🧪 Deterministic layout from `parent_id`/`order_index`; viewport clamp; Vitest boundary guard

### E2.21 — Honesty labels
- [ ] 🔧 `schemas/enums.py::HonestyLabel` (user_judgment|inferred|grounded|weakly_grounded) + `honesty.py::honesty_label()` derived from `node.kind`/grounding/citations; add `kind` to `ThoughtNode`; flow `is_inferred` into `ContextMessage`
- [ ] 🎨 Render canonical labels from contracts
- [ ] 🧪 T-HON-1..4

### E2.22 — M2 e2e smoke
- [ ] 🧪 Contract smoke (FAKE): create → fork two siblings → think on each → assert each branch excludes the other → propose → accept → child created isolated; + M2 Playwright browser smoke

---

## 📚 Phase 3 — E3 Optional source grounding (M3, Tree sources)

- [ ] 🧪 **E3.0** Zero-source smoke: think/fork/draft/export all work with no Source rows; `GroundingService.is_grounded` gate; retrieval never exercised (spy)
- [ ] 🔧 **E3.1** `retrieval/service.py::GroundingService` facade (`ingest_source/retrieve/map_citations/is_grounded`) + canonical `segment_sentences(text,lang)` (CJK/Latin terminators, exact-offset round-trip) + 🧪 property test
- [ ] 🔧 **E3.2** `POST /projects/{pid}/sources` text/markdown — `Source`/`Chunk` models, `SourceView`, `ingest/parsers/text.py`, `BlobStore`; inline → `status=ready`; 🎨 paste-text UI; 🧪 contract/parser
- [ ] 🔧 **E3.3** URL fetch+extract (`parsers/url.py`, readability→markdown) + PDF upload (`parsers/pdf.py`, per-page char offsets/`page_map`); `UNSUPPORTED_SOURCE`(415)/`INGEST_FAILED`(422); 🎨 upload UI; 🧪
- [ ] 🔧 **E3.4** `chunking/chunker.py` — heading-aware, sentence-snapped, overlap, tiny-tail merge, `respect_sections` full coverage, CJK token counts, `ChunkConfig`; 🧪 chunker tests
- [ ] 🔧 **E3.5** Embeddings + `VectorIndex` — FAKE deterministic embedder (blake2s) + content-hash cache, per-project `embedder_id`/`embedding_dim`, `vec_chunks_{dim}`, flat≡sqlite_vec ranking, project filter, `delete_source`; 🧪 contract
- [ ] 🔧 **E3.6** Retriever (vector recall + flat fallback) → `[S1..Sk]` grounding block in system slot via `assemble_messages`; **must not widen moat**; 🧪 retrieve never reads siblings (repo spy)
- [ ] 🔧 **E3.7** `citation/{mapper,align}.py` — `map_citations` (marker-primary + lexical/semantic fallback), `best_substring_span` (char-LCS, CJK width-fold/zero-width strip), `dedupe_overlaps`, persist `Citation` rows w/ SOURCE-space offsets/method/confidence; 🧪 golden zh fixtures
- [ ] 🔧🎨 **E3.8** `CitationRef` on `NodeView` + `?include=citations` + `citation` TokenEvent + `GET /sources/{id}/chunks`; `CitationPopover` "Jump to source" + trust styling + answer-span underline; 🧪 M3 browser smoke
- [ ] 🔧🎨 **E3.9** Honesty marking: uncited→`inferred`, low-conf→`weakly_grounded`; dimmed rendering; 🧪
- [ ] 🔧🎨 **E3.10** Stream ingestion progress (monotonic PARSE/CHUNK/EMBED/INDEX `progress` TokenEvent), resumable pipeline, re-ingest replace-in-place + citation staleness; sidebar progress/stale badge; 🧪

---

## ✍️ Phase 4 — E4 Crystallize + Draft (M4, Draft)

- [ ] 🔧 **E4.1** `Outline`/`OutlinePoint` models + pure `build_outline_point` (single/multi-node claim seed, source_node_ids dedup); `POST /branches/{head}/promote` + `POST /outlines/{id}/points` (create-new-when-null); 🧪
- [ ] 🔧🎨 **E4.2** Bulk reorder → dense `order_index` (idempotent permutation) + `PATCH /outline-points/{id}` `narrative_role`; drag-reorder + role tagging UI; 🧪 permutation→dense
- [ ] 🔧 **E4.3** Draft from branch heads as **SSE stream** via FAKE provider (`branch_to_section`), real persistence (not module dict), keep XOR `DRAFT_SOURCE_AMBIGUOUS`; 🎨 stream consumption; 🧪 NDJSON/TokenEvent schema
- [ ] 🔧 **E4.4** Outline-driven path: `outline_point_to_section`, `Draft.source_branch_node_ids = ∪ point.source_node_ids`; 🧪 both paths yield identical Draft shape
- [ ] 🔧 **E4.5** `VOICE_SPECS` + `build_voice_system_prompt` (academic/casual/professional directives + citation_density + marker-preservation rule); 🧪 per-voice directives
- [ ] 🔧🎨 **E4.6** Carry **real** node-answer citations into draft: `[#c{id}]` marker injection, `map_markers_to_citations`, draft-scoped `Citation` rows, `draft_anchor`, `uncited_claims` for hallucinated markers, fuzzy re-anchor; `CitationPopover` jump-to-source; 🧪 carry-through + anchor survival
- [ ] 🔧🎨 **E4.7** `PATCH /drafts/{id}` (`DraftUpdate`) + block AST with stable `block_id`s; preserve untouched blocks, re-anchor edited blocks, surface 失效引用; rich-text editor + save; 🧪
- [ ] 🔧 **E4.8** Reserved/feature-gated `POST /projects/{pid}/outline/propose` stub (`OUTLINE_PROPOSAL_SCHEMA`, SSE terminal-done); 🧪 route registered + gated

---

## 📤 Phase 5 — E5 Export (M5, Draft)

- [ ] 🔧 **E5.1** `render_ast_to_markdown(citation_style='footnote')` + `append_citation_footnotes` from draft-scoped citation repo; `BlobStore` content-addressed `payload_ref` (`blob://sha256/...`) on `ExportView`; deep-links resolve to **source** spans; 🧪
- [ ] 🧪 **E5.2** Full-loop smoke both paths: path A (branch) + path B (promote→outline→reorder→draft); FAKE only; Voice-via-prompt assertion; footnote==citation parity; resolvable `weaver://source` deep-link; M5 Playwright

---

## 🚢 Phase 6 — E6 Deployment & ops (M6)

- [ ] 🔧 **E6.1** `tooling/docker/docker-compose.yml` (api+web) + `api.Dockerfile`/`web.Dockerfile` + entrypoint (`alembic upgrade head` → uvicorn); healthcheck on `/api/v1/health`; single `weaver-data` volume; 🧪 deploy smoke
- [ ] 🔧 **E6.2** `.env.example` (DATABASE_URL, VECTOR_BACKEND, WEAVER_DATA_DIR, EMBEDDING_DIM, WEAVER_BEARER_TOKEN, SECRET_STORE*, MODEL_MODE, POSTGRES_PASSWORD) + config loader; refuse start when bearer token missing; 🧪
- [ ] 🔧 **E6.3** Postgres+pgvector: compose `db` profile, guarded `CREATE EXTENSION vector` migration, `VectorIndex` Protocol + 3 impls (PgVector/SqliteVec/NumpyFlat) + factory on `VECTOR_BACKEND`; 🧪 parametrized sqlite/postgres suite
- [ ] 🔧 **E6.4** `make backup` (VACUUM INTO + WAL checkpoint + blob tarball, secrets excluded) + `make restore FILE=…` + `GET /projects/{id}/export?format=json` (forest/relations/sources/outlines/drafts/citations); 🧪 round-trip
- [ ] 🔧 **E6.5** `persistence/jobs.py` (`Job`, `JobRepo`, `InProcessJobRunner` idempotent `ux_job_live`, resumable cursor, startup re-queue) + `persistence/blobs.py` (`BlobStore`+`FileBlobStore` sha256 dedupe); 🧪 jobs/blob

---

## 🔬 P1 — E7 Advanced thinking
- [ ] 🔧🎨 **E7.1** Compare endpoint (two ancestor chains via resolver) + `ComparePanel` (cap=2, scroll-synced) gated on `features.compare`; 🧪 cap + isolation
- [ ] 🔧🎨 **E7.2** `Relation` schema + `relations/ops.py` (`NODE_NOT_FOUND`/`SELF_RELATION`, additivity I8) + service + `POST /relations` + Layer-2 `RelationOverlay` (no layout shift); 🧪 additivity + moat-invisibility
- [ ] 🔧🎨 **E7.3** AI merge: per-branch resolve → structured synthesis → `tree.fork(kind=ai_reasoning)` + `add_relation(merge)`; preview/accept UI; 🧪 single parent + relation row + isolation
- [ ] 🔧🎨 **E7.4** Gap/counterexample scan: `relation_scan` structured gen + `RelationProposal` + `validate_and_clamp` + accept→`add_relation(contradiction)`; node markers; 🧪 clamp/isolation
- [ ] 🔧🎨 **E7.5** AI outline skeleton: `crystallize/propose.py::propose_outline` + schema + per-head resolve + `validate_and_clamp` + pure `promote_to_point` + SSE route + accept/edit UI; 🧪
- [ ] 🔧🎨 **E7.6** Narrative/logic-jump check (advisory, non-blocking) + dismissible warning strip; 🧪 weak-ordering/no-roles

## P1 — E8 Capture & rich sources
- [ ] 🔧🎨 **E8.1** Browser extension capture (URL/text→canonical) + `Source` lifecycle w/ content-addressed `raw_ref` + capture UI gated on `features.browser_capture`; 🧪 idempotent recapture
- [ ] 🔧🎨 **E8.2** Video/podcast transcripts (whisper-class parser, timestamped offsets, `Chunk.section` timecodes, citation→`t=`); import UI; 🧪
- [ ] 🔧🎨 **E8.3** Reading-view highlight → start node (`ForkSpec(parent_id=None)` w/ source-span provenance); 🧪 fork-creates-root
- [ ] 🔧🎨 **E8.4** Large-doc ingest job (asyncio over jobs table, `respect_sections` full coverage, MMR, resumable embed cache, streamed progress) + job-progress UI; 🧪 coverage/resumability

## P1 — E9 Multi-format output
- [ ] 🔧🎨 **E9.1** `ArtifactFormat` enum + `ArtifactRenderer` registry + `Artifact` (stamp `derived_from_hash`) + `POST /drafts/{id}/artifacts` SSE + multi-format preview switcher; 🧪 in-scope/theme-consistency
- [ ] 🔧🎨 **E9.2** Per-format `NarrativeRole` renderers (deck/x_thread/video_script beats) + citation routing (footnote vs sources-block); 🧪 role-mapping/citation-parity
- [ ] 🔧🎨 **E9.3** Stale-artifact flagging (`derived_from_hash` compare, badge + explicit regenerate, never auto); 🧪 hash-stability/staleness
- [ ] 🔧🎨 **E9.4** Paragraph ops: draft AST `block_id`s + `ParaOp` enum + `run_paragraph_op` (block-local) + citation re-anchor + `stronger_evidence` retrieval + `POST /drafts/{id}/blocks/{block_id}/op` + block menu; 🧪 block_id preservation/no-sibling-mutation
- [ ] 🔧🎨 **E9.5** Export tree/outline PNG/SVG (FE D3 render posted back) + DOCX (server `MarkdownAST`→Word footnotes) + `Export` record w/ `payload_ref`; 🧪 footnote-parity/blob-ref

## P2 — E10 Cross-project network & extensibility
- [ ] 🔧🎨 **E10.1** `CrossLink` schema + `CrossLinkRepo` (edge table) + CRUD routes (`CROSSLINK_SELF_LINK`/`CROSSLINK_NOT_FOUND`) + network drag-to-link UI; 🧪 CRUD/error
- [ ] 🔧🎨 **E10.2** Pure `build_network_graph` (link collapse, suggested filtering, deterministic order) + cursor-paginated `GET /network` + read-and-jump project graph (exhaustive `CrossLinkKind` switch); 🧪 collapse/render
- [ ] 🔧🎨 **E10.3** AI discovery job (cross-project vector search `project_id != self` → symmetric dedupe → structured classify) + suggested/dismissed lifecycle + staleness + inbox UI; 🧪 **moat-preservation** (CrossLink invisible to `resolve_branch_context`)
- [ ] 🔧🧪 **E10.4** Four additive registries (Source/provider/format/template) w/ canonical ErrorCodes + `GET /backends/registry` + additive-import-guard test + enum-completeness + drift guard
- [ ] 🔧🎨 **E10.5** `StructureTemplate` (论说文/分析报告/故事化) + `register_template` + crystallizer orders points by roles + `GET /templates` (`UNKNOWN_TEMPLATE`) + picker UI; 🧪 ordering/registry
- [ ] 🔧🎨 **E10.6** Fact-check pass over draft citations (flag unsupported, never fabricate) + additive publisher target + report panel + publish UI; 🧪 unsupported-claim/citation-parity

---

### Progress snapshot (start)
MVP (E0–E5): **0 done · 26 partial · 34 not-started**. P1/P2 (E6–E10): **0 / 22**.
First three blocks to clear: **Phase −1 bug-fixes** → **E0.2–E0.5** (codegen + FAKE + error/SSE) → **E1.1** (persistence). After those, the moat work (E2.18 `/think`) is unblocked.
