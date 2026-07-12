# Weaver Next — Gap Analysis (current code vs implementation plan)

> **历史分析（已废弃）**：这是 2026-06 的旧架构快照，不用于判断当前 Codex Widget 实现。当前事实源见 [`architecture-current.md`](architecture-current.md)。

> Generated 2026-06-23. Compares `commit 3ae29a8 "feat: implement branching thinking MVP"` against [`implementation-plan.md`](implementation-plan.md).
> Method: 8 agents, one per epic group, each read its plan slice + the actual code and judged every story.
> Status legend: ✅ done · 🟡 partial (exists but in-memory mock / missing persistence·tests·spec) · ⬜ not started.

## TL;DR

The current build is a **clickable, full-journey demo**: Dashboard → Thinking Tree → Draft → Export → Settings all work in the UI, backed by an **in-memory mock FastAPI** (module-level lists, hardcoded seed data) and **hand-written** TS contracts. The load-bearing foundation — codegen + drift guard, FAKE provider, error/SSE contract, SQLAlchemy persistence, the real moat depth, and the streaming `/think` loop — is essentially absent.

**MVP (E0–E5, 60 stories): 0 done · 26 partial · 34 not-started ≈ 15–18% complete.**
**P1/P2 (E6–E10, 22 stories): 0 done.**

| Epic | Page | ✅/🟡/⬜ | % | One-line |
|---|---|---|---|---|
| **E0** Repo & Skeleton | — | 0 / 1 / 6 | ~22% | Skeleton + mock exist; codegen, FAKE, error/SSE, secrets, conftest all missing |
| **E1** Project & persistence | Dashboard | 0 / 3 / 2 | ~12% | No SQLAlchemy/Alembic/UoW/idempotency; CRUD faked in memory |
| **E12** Settings & model-config | Settings | 0 / 4 / 1 | ~35% | Backend CRUD/health/default work in memory; no secret store, no PermissionGate, no Voice |
| **E2** Thinking-tree moat ① | Tree | 0 / 9 / 2 | ~38% | Resolver + schemas exist (with bugs); no ContextPolicy, no Branch, no tree/ops |
| **E2** Thinking-tree moat ② | Tree | 0 / 2 / 9 | ~8% | **No `/think` streaming, no ModelProvider, no FAKE, no D3** — the core is absent |
| **E3** Source grounding | Tree | 0 / 1 / 10 | ~4% | No `/sources`, no ingest/chunk/embed/retrieve/citation; only a static sidebar |
| **E4** Crystallize + Draft | Draft | 0 / 4 / 4 | ~12% | Draft+export happy path (mock); no outline/promote/reorder, no real Voice/citations |
| **E5** Export | Draft | 0 / 2 / 0 | ~55% | Markdown export works (mock); only one happy-path smoke, path B missing |
| **E6** Deployment & ops | — | 0 / 0 / 5 | 0% | No Docker/env/Postgres/backup/jobs |
| **E7–E10** P1/P2 | — | 0 / 0 / 17 | 0% | None of compare/relations/multi-format/network exist |

---

## E0 — Repo & Skeleton  (~22%)
- 🟡 **E0.1** Monorepo tree — has apps/web, apps/api, contracts, Makefile. **Missing**: `weaver_core/{tree,relations,crystallize,draft,citation,model,retrieval,persistence}` subdirs; SQLAlchemy/Alembic/ulid in pyproject; `app/settings/page.tsx`; `tooling/{docker}`; Makefile `contracts`/`lint`/`codegen` targets; structure test; CI.
- ⬜ **E0.2** OpenAPI→TS codegen — contracts are **hand-written** (the exact anti-pattern). No `make contracts*`, no `openapi.json`, no `generated/`, no `WeaverApiError`.
- ⬜ **E0.3** CI drift guard — no `check-drift.sh`, no `.github/`.
- ⬜ **E0.4** FAKE ModelProvider — no `weaver_core/model/` at all (only a cosmetic `kind="fake"` settings row).
- ⬜ **E0.5** Error envelope + SSE — uses bare `HTTPException(detail="STR")`, not `{error:{code,message,details}}`; no SSE plumbing anywhere.
- ⬜ **E0.6** Config + secret store — no `SecretStore`, no config module; api_key plaintext is simply dropped, no ref.
- ⬜ **E0.7** Deterministic conftest — no `conftest.py`, no seeded ULID/clock, no FAKE wiring.

## E1 — Project model & persistence  (~12%)
- ⬜ **E1.1** Repo Protocols + UoW + Alembic — **zero** SQLAlchemy/Alembic; routes mutate module-level lists directly.
- 🟡 **E1.2** Project CRUD — list+create only. **Missing**: PATCH/DELETE, soft-delete, cursor pagination, ULID ids, real timestamps, `grounding_enabled`, `PROJECT_NOT_FOUND`.
  - 🐞 counts hardcoded to 1 on create; `_refresh_project_counts` not called → can drift.
- 🟡 **E1.3** QuickNote inbox + promote — list+create+promote (mock). **Spec deviation**: promote should create a node in an *existing* project & set `promoted_node_id` atomically; instead it creates a *new* project. No file-to-project, no `unfiled=true`, no `VALIDATION_FAILED`, no atomicity.
  - 🐞 promote on a missing note id fabricates a note + project instead of 404.
- ⬜ **E1.4** Idempotency-key store — nothing (`grep idempotency` = 0 hits).
- 🟡 **E1.5** `/meta` + `/healthz` — both exist & shaped right. **Bug/gap**: `FeatureFlags.cli_agents=True` violates "all flags false in MVP"; `model_mode` hardcoded not env-driven; FE never reads `features.*` to gate UI.

## E12 — Settings & model-config  (~35%)
- 🟡 **E12.1** Backend CRUD — full CRUD in memory. **Missing**: real persistence (`model_backend` DDL), secret store / `api_key_ref`, `UNKNOWN_BACKEND`/`BACKEND_DISABLED` codes.
- 🟡 **E12.2** Permission toggles — UI + round-trip exist. **Missing the core deliverable**: `weaver_core/model/cli/permission.py` `PermissionGate` (classify + authorize truth table) and its pure unit test.
- 🟡 **E12.3** Default backend — global default works (Python loop). **Missing**: `BackendRepo.set_default` + DB one-default index, **per-project override** (no project PATCH), `ProviderRegistry.default_for` chain, `NO_DEFAULT_BACKEND`.
  - 🐞 PATCH `is_default=false` on the current default can leave zero defaults.
- 🟡 **E12.4** Test-connection — endpoint returns hardcoded health. **Missing**: real `provider.health()` delegation; disabled returns `ok:false/200` instead of `BACKEND_DISABLED`.
- ⬜ **E12.5** Voice presets — only a *draft-screen* voice selector exists. No `voice_config` persistence, no `project.voice_default`, no Settings Voice panel.

## E2 ① — moat: resolver + schemas + tree ops  (~38%)
- 🟡 **E2.1** `resolve_branch_context` — pure & working, but signature takes loose kwargs not a `ContextPolicy`; no import-lint test.
  - 🐞 `excluded_dead_end_ids` is computed **forest-wide**, not chain-scoped (off-chain dead-ends leak in).
- 🟡 **E2.2** Schemas — `ThoughtNode/NodeForest/BranchContext` exist. **Missing**: `Branch` + `branch_of`, `with_node/with_nodes/descendants`, enum-literal status, `ContextMessage.kind/role/provenance`, round-trip test.
- 🟡 **E2.3 / E2.4** Ancestor-only / sibling isolation — structurally hold, but tests are single shallow cases (no deep cousin / dual-sibling T-CTX-2/3).
- 🟡 **E2.5** Dead-end excluded by default — works, but no `ContextPolicy`/`policy.py`; same forest-wide bug as E2.1.
- ⬜ **E2.6** Target-is-sacred — **not implemented**. 🐞 a `dead_end` *target* is wrongly dropped from the chain (no `n.id == node_id` guard).
- 🟡 **E2.7** `include_dead_end_ancestors` toggle — bool works & changes fingerprint. 🐞 when ON, `excluded_dead_end_ids` is **not emptied** as spec requires.
- 🟡 **E2.8** Immune to fold/relations + cycle guard — immune to fold/relations (they don't exist yet). 🐞 **no cycle guard → infinite loop** on a cyclic forest (needs `CYCLE_DETECTED`).
- ⬜ **E2.9** `to_messages` render — no `render.py`; rendering is inline in the draft mock.
- 🟡 **E2.10** Add node — fork appends to a module list; no pure `tree/ops.fork`, no immutability, no `POST /projects/{pid}/nodes`, no injected id/now.
- 🟡 **E2.11** Fork N children — works. 🐞 fork on missing parent returns `[] / 201` instead of `NODE_NOT_FOUND/INVALID_TREE_OP`; no idempotency.

## E2 ② — moat: model provider + streaming /think + D3  (~8%)
- ⬜ **E2.12** Backtrack — no route, no `BranchView`, no FocusStore.
- ⬜ **E2.13** Prune (dead-end + fold, no delete) — no route, no `collapsed` field, no state machine.
- ⬜ **E2.14** Fold/expand — no `collapsed` field, no PATCH node.
- ⬜ **E2.15** `ModelProvider` Protocol + `TokenEvent` + registry — none.
- ⬜ **E2.16** FAKE provider — none (cosmetic settings row only).
- 🟡 **E2.17** AI-proposed forks — endpoint exists but returns **hardcoded** proposals; no structured generation, no SSE.
- ⬜ **E2.18** **Streaming `/think`** — **does not exist.** The product's core loop (resolve → render → stream → persist) is absent; draft fakes it with string templates.
- ⬜ **E2.19** "Reading your N branches" frame — depends on E2.18.
- 🟡 **E2.20** D3 auto-layout — a tree view renders, but positions come from **hardcoded x/y in seed data**, not D3. No `TreeCanvas`/`useTreeLayout`/zoom/edges; no d3/vitest deps.
- ⬜ **E2.21** Honesty labels — no `HonestyLabel`, no `kind` on node.
- ⬜ **E2.22** M2 e2e smoke — none (depends on /think + FAKE).

## E3 — Optional source grounding  (~4%)
- 🟡 **E3.0** Works with zero sources — mock runs without Source rows. 🐞 but `_generate_draft` always emits citations and sets `grounded=true`, violating "ungrounded → zero citations / grounded=false".
- ⬜ **E3.1–E3.10** GroundingService, segmenter, text/URL/PDF ingest, heading-aware chunker, embeddings + VectorIndex (FAKE+flat), retrieval-without-widening, sentence-level citations (CJK-safe), clickable chips, honesty marking, streaming ingest progress — **all absent**. Only static `SourceCard` demo cards exist.

## E4 — Crystallize + Draft  (~15%)
- ⬜ **E4.1** Promote → deterministic outline — no outline domain/endpoints.
- ⬜ **E4.2** Reorder + narrative roles — no routes; `OutlinePoint` UI is static.
- 🟡 **E4.3** Draft from branch heads — works & **does use `resolve_branch_context`** (moat respected). **Missing**: SSE stream, FAKE provider (sections are f-strings + hardcoded title/lead/close).
- ⬜ **E4.4** Draft via outline — 🐞 with `outline_id` set + empty branches, silently drafts from **hardcoded `node_demand/node_bundle`** instead of the outline.
- 🟡 **E4.5** Voice changes draft — voice is string-interpolated into mock prose; no `VOICE_SPECS`/system prompt, no marker rule, no density modulation. (enum is TitleCase vs spec.)
- 🟡 **E4.6** Citations carried into draft — citations are **fabricated from branch-head body**, not real source spans. 🐞 `deep_link` points at the node body (`0..len`), not canonical source offsets. No marker injection, no popover/jump-to-source.
- 🟡 **E4.7** Read/edit draft — GET works; **no PATCH** (read-only), `paragraphs[]` not a block AST with ids.
- ⬜ **E4.8** AI outline skeleton (P1 stub) — no reserved route.

## E5 — Export  (~55%)
- 🟡 **E5.1** Markdown export with footnotes — works (mock). **Missing**: BlobStore/content-addressed `payload_ref`, AST renderer, draft-scoped citation repo; deep-link still points at node not source.
  - 🐞 `citations_preserved` uses a fragile `count('[^')//2` parity that can mis-report.
- 🟡 **E5.2** End-to-end smoke — one happy-path (direct path A) only. **Missing**: path B (outline), FAKE guarantee, Voice-via-prompt assertion, deep-link resolvability, browser smoke.

## E6–E10 — Deployment/ops + P1/P2  (0%)
All ⬜ not-started: **E6** Docker Compose / env template / Postgres+pgvector / backup-restore / jobs+blob store; **E7** compare / relations / AI-merge / gap-scan / AI-outline / narrative-check; **E8** browser-capture / transcripts / highlight→node / big-doc jobs; **E9** multi-format / per-format citations / stale-flagging / paragraph-ops / PNG-SVG-DOCX; **E10** crosslinks / network view / AI discovery / additive seams / template library / fact-check+publish.

---

## Correctness bugs in what already exists (fix-now candidates)

These are real defects in shipped code, independent of the missing features:

1. **Resolver: dead-end target dropped** (`context/resolver.py:30`) — resolving a `dead_end` target excludes it from the chain. Add a `n.id == target_node_id` keep-guard. *(E2.6)*
2. **Resolver: no cycle guard** (`resolver.py:28-32`) — a cyclic `parent_id` chain loops forever. Add a `seen` set raising `CYCLE_DETECTED`. *(E2.8)*
3. **Resolver: `excluded_dead_end_ids` is forest-wide** (`resolver.py:22-24`) — should be the on-chain ancestors only. *(E2.1/E2.5)*
4. **Resolver: toggle doesn't clear excluded** — with `include_dead_ends=True`, `excluded_dead_end_ids` should be empty. *(E2.7)*
5. **Fork on missing parent → `[]/201`** (`main.py:637-638`) — should be `NODE_NOT_FOUND`. *(E2.11)*
6. **Draft always "grounded"** (`main.py:483`) — ungrounded draft still returns `grounded=true` + citations. *(E3.0)*
7. **Outline path drafts wrong content** (`main.py:443`) — `outline_id` falls back to hardcoded node ids. *(E4.4)*
8. **QuickNote promote: no existence check** (`main.py:617-623`) — fabricates a note instead of 404. *(E1.3)*
9. **`FeatureFlags.cli_agents=True`** (`main.py:17`) — violates all-false MVP. *(E1.5)*
10. **`citations_preserved` fragile parity** (`main.py:699`). *(E5.1)*

## Recommended sequencing

The plan's critical path is `E0 → E1 → (E12 ∥ E2) → E3 → E4 → E5 → E6`, and **E0 is the gate**. The demo skipped E0/E1 and built the UI happy-path on a mock, so the next move is to lay the foundation and replace the mock incrementally — not add more features.

1. **E0.2/0.3** — stop hand-writing contracts; generate from OpenAPI + drift guard. *(prevents type drift)*
2. **E0.4/0.5** — FAKE provider + error envelope/SSE. *(prerequisite for `/think` and deterministic tests)*
3. **E1.1** — SQLAlchemy repos + UoW + Alembic; migrate the module-level lists.
4. **Fix the resolver bugs (#1–#4) + add `ContextPolicy` and the T-CTX test suite**, then build **E2.18 streaming `/think`** — the actual core feature.

Resolver bugs #1–#4 are self-contained and depend on nothing else — safe to fix immediately.
