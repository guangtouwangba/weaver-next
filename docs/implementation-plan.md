# Weaver Next — Implementation Plan & Backlog

> **Scope:** FULL VISION (P0 MVP through P1/P2), broken into deliverable, verifiable **user stories** with **frontend / backend / test** cards.
> **Grounded in:** the architecture set in [`architecture/`](architecture/) (00–08, README, ADR-log) and the [PRD](PRD-Weaver-Redesign-2026.md) (source of truth). Every card cites the doc section it derives from.
> **Page designs:** the 🎨 Frontend cards build to [`design/page-designs.md`](design/page-designs.md) — per-screen layout/components/states extracted from the `weaver.html` prototype (with screenshots).
> **Status:** Draft v1 (2026-06-22). Estimates are single-developer t-shirt sizes, not commitments.

## How to read this

Each **Epic** = a delivery slice tied to a milestone (M0–M6) or a post-MVP phase (P1/P2).
Each **Story** is independently demoable and verifiable, and carries three cards:

- 🔧 **Backend** — services / routes / schemas / DDL (Python `weaver_core` + FastAPI `weaver_api`)
- 🎨 **Frontend** — components / state / interactions (Next.js + D3), or `— none` if N/A
- 🧪 **Test** — unit / contract / e2e + exact assertions; **every story has a test card**

Each story also lists **Acceptance** (Given/When/Then), **Deps** (other story IDs), and **Est** (`S` ≤1d · `M` 2–3d · `L` 4–5d).

**ID scheme:** `E<epic>.<story>` are *stable identifiers*, not a reading sequence — `E12` (Settings) sits at M2 by delivery order, so the numbers are not strictly ascending. **FAKE** = the deterministic fake model provider; **all tests run model-free in CI** (no network, seeded ids/clock).

## Roadmap

| Phase | M | Epic | Page | What ships |
|------|---|------|------|------------|
| **MVP** | M0 | **E0** Repo & Skeleton | — | monorepo, schema-first codegen + drift guard, FAKE provider, error/SSE plumbing, config/secrets |
| | M1 | **E1** Project model & persistence | Dashboard | Project + QuickNote CRUD, repository layer (SQLite), UoW, idempotency store |
| | M2 | **E12** Settings & model-config | Settings | model backends (SDK + CLI agents), PermissionGate toggles, Voice presets, default backend |
| | M2 ⭐ | **E2** Thinking-tree core (the moat) | Thinking Tree | `resolve_branch_context` (built+tested first), fork/backtrack/prune/fold, ModelProvider, streaming `/think`, D3 auto-layout |
| | M3 | **E3** Optional source grounding | Thinking Tree (sources) | ingest text/URL/PDF, chunk/embed/retrieve, sentence-level clickable citations; zero-source path still works |
| | M4 | **E4** Crystallize + Draft | Draft | deterministic promote → optional outline, draft from branches OR outline, Voice-to-draft, citations carried through |
| | M5 | **E5** Export | Draft | citation-preserving Markdown export + full-loop e2e smoke |
| | M6 | **E6** Deployment & ops | — | Docker Compose (SQLite default / Postgres+pgvector), env template, backup/restore, jobs + blob store |
| **P1** | — | **E7** Advanced thinking | Thinking Tree | compare panel, cross-branch relations + AI merge, gap/counterexample scan, AI outline skeleton, narrative check |
| | — | **E8** Capture & rich sources | Sources | browser-extension capture, video/podcast transcription, highlight→node, large-doc full coverage |
| | — | **E9** Multi-format output | Draft | Deck/X-Thread/Newsletter/Video/Email from ONE draft, paragraph-level AI ops, PNG/SVG/DOCX export |
| **P2** | — | **E10** Cross-project network & extensibility | Network | CrossLink overlay, AI discovery, structure-template library, fact-check, one-click publish |

## Critical path & sequencing

1. **E0 gates everything** — without codegen+drift guard, FAKE provider, and the error/SSE contract, no other epic can be built or tested model-free.
2. **The moat is built first inside M2** — `E2.1 resolve_branch_context` is a pure, unit-tested function delivered *before* any model-touching story (E2.15+). Sibling-isolation (E2.4) and dead-end-exclusion (E2.5) are standalone test cards.
3. **E12 (Settings) is needed before the `/think` loop talks to a *real* backend** — but E2 runs end-to-end on FAKE without it, so E12 and E2 can proceed in parallel.
4. **MVP chain:** E0 → E1 → (E12 ∥ E2) → E3 → E4 → E5 → E6 (package).
5. **P1/P2 depend on MVP epics** — each post-MVP card names its upstream MVP story; none may widen the moat (`resolve_branch_context` stays untouched; CrossLinks/relations are overlays with explicit guard tests).

---

## Epic E0 — Repo & Skeleton
**Milestone:** M0 | **Priority:** P0 | **Page:** — | **Goal:** Stand up the cross-language monorepo with the schema-first contract pipeline, drift guard, FAKE provider, base error/SSE plumbing, and config/secrets scaffolding — so every later epic builds on a frozen, drift-protected seam. *(ref: README §"Build sequence" M0; 00 §5, §1.1)*

### Story E0.1 — As a developer, I want the monorepo tree scaffolded (apps/web, apps/api, packages/contracts, tooling, Makefile), so that every team has its declared home and imports resolve.
- **Acceptance**
  - Given a fresh clone, When I inspect the tree, Then `apps/web/`, `apps/api/weaver_api/`, `apps/api/weaver_core/{schemas,tree,context,relations,crystallize,draft,citation,model,retrieval,persistence}/`, `packages/contracts/`, `tooling/{codegen,docker}/`, root `Makefile`, `AGENTS.md` exist per 00 §5.
  - Given the Makefile, When I run `make` with no target, Then `contracts`, `test`, `lint`, `dev`, `codegen` targets are listed.
  - Given `apps/api`, When I run `pip install -e .`, Then `weaver_core` and `weaver_api` import cleanly (empty `__init__` modules acceptable).
- 🔧 **Backend** — create `apps/api/pyproject.toml` (FastAPI, Pydantic v2, SQLAlchemy 2.0, Alembic, pytest, ulid deps); create the `weaver_core`/`weaver_api` package skeleton matching the repo tree. *(ref: 00 §5)*
- 🎨 **Frontend** — scaffold `apps/web` (Next.js App Router) with `app/{layout.tsx,page.tsx,settings/page.tsx}` placeholders + `package.json` depending on `@weaver/contracts`; load Geist/Geist Mono. *(ref: 04 §1, §1.1)*
- 🧪 **Test** — CI job asserts `apps/api` imports and `apps/web` builds (`next build`); a structure test asserts the canonical directories from 00 §5 exist. *(ref: 00 §7)*
- **Deps:** [] | **Est:** M

### Story E0.2 — As a frontend dev, I want TS types + a typed client generated from the API's OpenAPI schema, so that I never hand-write a domain type.
- **Acceptance**
  - Given the FastAPI app with ≥1 route, When I run `make contracts-emit`, Then `packages/contracts/openapi.json` (OpenAPI 3.1, deterministic/sorted keys) is written.
  - Given `openapi.json`, When I run `make contracts-ts`, Then `packages/contracts/generated/{openapi.gen.ts,client.gen.ts,errors.gen.ts}` are produced with a "DO NOT EDIT — generated" header.
  - Given `make contracts`, When run twice, Then the second run produces a byte-identical diff (determinism).
- 🔧 **Backend** — `tooling/codegen/` emit script importing the FastAPI app → `app.openapi()`; pin `openapi-typescript`/generator versions. *(ref: 03 §7.1)*
- 🎨 **Frontend** — `@weaver/contracts` package re-exports generated types + `WeaverApiError`/`toApiError`; `errors.gen.ts` re-exports the `ErrorCode` union. *(ref: 03 §5.3)*
- 🧪 **Test** — run `make contracts` and assert generated files contain the seeded schema(s) and the generated-header line; assert idempotent re-run. *(ref: 00 §7)*
- **Deps:** [E0.1, E0.5] | **Est:** M

### Story E0.3 — As a maintainer, I want a CI drift guard, so that stale contracts (uncommitted regen) turn the build red.
- **Acceptance**
  - Given an unchanged repo, When `tooling/codegen/check-drift.sh` runs in CI, Then it regenerates and `git diff --exit-code` passes.
  - Given a Pydantic shape change without regen, When CI runs, Then the job exits 1 with message "contracts stale, run `make contracts` and commit".
  - Given a new `ErrorCode` added in Python without regen, Then the drift guard fails (proving the TS union widens from the same source).
- 🔧 **Backend** — `tooling/codegen/check-drift.sh` = `make contracts` + `git diff --exit-code` on `openapi.json` and `generated/`; wire into CI. *(ref: 03 §7.2)*
- 🎨 **Frontend** — — none
- 🧪 **Test** — CI integration test: mutate a schema in a throwaway branch, assert red build; revert → green. *(ref: 03 §7.2; 00 §7)*
- **Deps:** [E0.2] | **Est:** S

### Story E0.4 — As a CI runner, I want a deterministic FAKE ModelProvider selected by env, so that no test reaches a real model or network.
- **Acceptance**
  - Given `WEAVER_MODEL_MODE=fake`, When `registry.default_for(project)` is called with no configured default, Then it returns `FakeProvider`.
  - Given identical `GenerateRequest` (purpose + hash of system+messages+response_schema), When `FakeProvider.generate` runs twice, Then byte-identical `TokenEvent` streams are produced, each terminating with exactly one `done` xor one `error`.
  - Given `response_schema` set, When FAKE runs, Then `done.data.structured` validates against that schema.
- 🔧 **Backend** — `weaver_core/model/provider.py` (Protocol, `GenerateRequest`, `TokenEvent` with closed 8-member type enum + `seq`/`request_id`); `weaver_core/model/fake.py` (`FakeProvider` + `FakeScript.from_env`); `weaver_core/model/registry.py` (`ProviderRegistry` keyed by `(kind,provider)`, `default_for` FAKE fallback). *(ref: 02 §1.1–1.3, §2.1, §8)*
- 🎨 **Frontend** — — none
- 🧪 **Test** — unit: terminal-event invariant; determinism (same request ⇒ identical stream); schema-valid structured output; scripted `citation`/`tool_call`/`error` events; `default_for` FAKE under `WEAVER_MODEL_MODE=fake`. *(ref: 02 §9, §8)*
- **Deps:** [E0.1] | **Est:** M

### Story E0.5 — As an API consumer, I want the base error envelope, ErrorCode enum, and SSE plumbing, so that every later route streams/fails through one frozen contract.
- **Acceptance**
  - Given any non-2xx, When a `WeaverError(code, message, details)` is raised, Then the response is `{error:{code,message,details}}` with the HTTP status from the §5.2 table.
  - Given a streaming endpoint driven by FAKE, When consumed as NDJSON, Then every line is a valid `TokenEvent`, `type` is in the documented set, and the stream ends with exactly one `done` or `error`.
  - Given the mid-stream `error` event, Then its `data` is byte-for-byte the same `ErrorBody` shape as the non-stream envelope.
- 🔧 **Backend** — `weaver_api/errors.py` (`ErrorCode` enum + `STATUS` map + exception handler), `weaver_api/sse.py` (TokenEvent→SSE/NDJSON framing, `: ping` keep-alive, terminal-event guarantee), `weaver_api/schemas_common.py` (`Page`/`Created`/`Ok`/`ErrorEnvelope`). *(ref: 03 §1.1, §4.1–4.4, §5)*
- 🎨 **Frontend** — `lib/api/{client.ts,sse.ts,errors.ts}` thin wrappers: bearer+base-URL fetch, TokenEvent decoder, envelope→`WeaverApiError`. *(ref: 04 §1; 03 §5.3)*
- 🧪 **Test** — contract: trigger ≥1 `ErrorCode` → assert envelope shape + status; SSE schema test on a FAKE-backed stub stream (NDJSON form). *(ref: 03 §8.1–8.3)*
- **Deps:** [E0.1, E0.4] | **Est:** M

### Story E0.6 — As an operator, I want app config + secret-store scaffolding, so that backend API keys are stored by ref and never inline.
- **Acceptance**
  - Given a config loader, When the process starts, Then `DATABASE_URL`, `VECTOR_BACKEND`, `WEAVER_DATA_DIR`, `SECRET_STORE`, `MODEL_MODE`, `WEAVER_BEARER_TOKEN` are read with the documented defaults.
  - Given `SecretStore.put(name, value)`, When called, Then it returns a ref and the plaintext value never appears in any serialized config, log, or `openapi.json`.
  - Given a `FileSecretStore`, Then `secrets.json` is written mode-0600 and gitignored.
- 🔧 **Backend** — `weaver_core/persistence/secrets.py` (`SecretStore` Protocol + `FileSecretStore`/`EnvSecretStore`); a config module reading the env template keys. *(ref: 07 §7.2, §7.3; 02 §4)*
- 🎨 **Frontend** — — none
- 🧪 **Test** — unit: `SecretStore` round-trip (put→ref→resolve); assert plaintext never serialized; file perms 0600. *(ref: 02 §9 "Secret handling"; 07 §7.3)*
- **Deps:** [E0.1] | **Est:** S

### Story E0.7 — As a developer, I want a per-milestone CI determinism contract wired, so that the test suite always runs against FAKE with seeded ULIDs/clock.
- **Acceptance**
  - Given `conftest.py`, When the suite runs, Then the FAKE provider is wired by default and an injectable clock/id-factory produces reproducible ULIDs.
  - Given any test, When it would touch a network/model, Then it fails fast (no real egress) because `MODEL_MODE=fake` is enforced.
- 🔧 **Backend** — `apps/api/tests/conftest.py` wiring FAKE + seeded id/clock factory; CI sets `MODEL_MODE=fake`. *(ref: 00 §7; 02 §8 "Selection by env"; 07 §9.5)*
- 🎨 **Frontend** — — none
- 🧪 **Test** — meta-test asserting `registry.default_for` resolves FAKE under the test env and that the id factory is deterministic across two fixture builds. *(ref: 00 §7; 03 §8.3)*
- **Deps:** [E0.4] | **Est:** S

---

## Epic E1 — Project model & persistence base
**Milestone:** M1 | **Priority:** P0 | **Page:** Dashboard | **Goal:** Ship Project + QuickNote CRUD over repository Protocols + SQLite impls with a Unit-of-Work and idempotency-key store, surfaced by a Dashboard (project list, new project, quick-note inbox). *(ref: README §M1; 00 §1.3, §1.6; 07 §3, §9.1)*

### Story E1.1 — As a backend dev, I want repository Protocols and a SQLAlchemy UoW, so that services depend only on interfaces and multi-repo ops commit atomically.
- **Acceptance**
  - Given `weaver_core/persistence/protocols.py`, Then `ProjectRepo`, `NodeRepo`, `QuickNoteRepo`, `BackendRepo`, `IdempotencyRepo` (+ remaining aggregates declared) exist returning domain/Pydantic models, never ORM rows.
  - Given a `SqlAlchemyUnitOfWork`, When used as an async context manager, Then it commits on success and rolls back on exception; a FastAPI dependency yields one UoW per request.
  - Given any `weaver_api/routes/*` module, When AST-scanned, Then it imports no SQLAlchemy session directly. *(thin-route guard)*
- 🔧 **Backend** — `protocols.py`, `unit_of_work.py`, `engine.py` (SQLite WAL pragmas + factory), `models.py` (ORM, dialect-portable), Alembic init + first migration emitting the MVP DDL. *(ref: 07 §3, §3.1, §4.1–4.2, §4.4)*
- 🎨 **Frontend** — — none
- 🧪 **Test** — repo CRUD round-trip on SQLite temp file (ULID PK stable, `created_at`/`updated_at` set, `updated_at` advances); `alembic upgrade head` schema matches `metadata.create_all`; thin-route AST guard. *(ref: 07 §9.1, §9.4; 03 §8.1)*
- **Deps:** [E0.1, E0.6] | **Est:** L

### Story E1.2 — As a user, I want Project CRUD, so that I can create, list, read, update, and delete thinking topics.
- **Acceptance**
  - Given `POST /projects` with `ProjectCreate`, Then a `ProjectView` is returned with a new ULID and `grounding_enabled=false` (derived).
  - Given `GET /projects`, Then a cursor page of `ProjectSummary` (with `node_count`, derived `grounding_enabled`, `updated_at`) is returned, sorted stably by ULID.
  - Given `PATCH /projects/{id}` updating `title`/`voice_default`/`default_backend_id`, Then `ProjectView` reflects the change; Given `DELETE /projects/{id}`, Then it soft-deletes (cascade semantics per DDL) and returns `Ok`.
  - Given a missing id, Then `PROJECT_NOT_FOUND` (404).
- 🔧 **Backend** — `ProjectRepo` SQLite impl (incl. `grounding_enabled` derived query + `list` cursor pagination); `weaver_api/routes/projects.py` (thin); Pydantic `Project*` schemas. *(ref: 03 §2.2 Projects, §3.1; 07 §2.3 project DDL, §3)*
- 🎨 **Frontend** — Dashboard project list + "New project" form calling the typed client; empty-state. *(ref: 04 §1 `app/page.tsx`)*
- 🧪 **Test** — contract test per route (shape validates vs OpenAPI; enums in set); `PROJECT_NOT_FOUND` envelope+status; soft-delete hides from default list. *(ref: 03 §8.1; 07 §9.1)*
- **Deps:** [E1.1] | **Est:** M

### Story E1.3 — As a user, I want a QuickNote inbox with CRUD + promote, so that I can capture 速记 and later turn one into a starting node.
- **Acceptance**
  - Given `POST /quicknotes` (optionally `project_id=null`), Then a `QuickNoteView` is created; `GET /quicknotes?unfiled=true` lists unfiled notes.
  - Given `PATCH /quicknotes/{id}` filing it to a project, Then the note's `project_id` updates.
  - Given `POST /quicknotes/{id}/promote` with a `project_id`, Then a starting `ThoughtNode` is created and `promoted_node_id` is set — in one transaction (note update + node create commit atomically).
  - Given promote on an unfiled note without `project_id`, Then `VALIDATION_FAILED` (422).
- 🔧 **Backend** — `QuickNoteRepo` SQLite impl; `routes/quicknotes.py`; promote uses the UoW for the atomic note-update + node-create. *(ref: 03 §2.2 QuickNotes, §3.11; 07 §2.3 quick_note DDL, §3.1)*
- 🎨 **Frontend** — Dashboard QuickNote inbox: capture box, list (filed/unfiled), file-to-project, "promote to node". *(ref: 04 §1 `app/page.tsx` "projects + QuickNote inbox")*
- 🧪 **Test** — contract tests for each route; atomicity test: a forced failure during promote leaves neither the node nor the `promoted_node_id` written. *(ref: 03 §8.1; 07 §9.1, §3.1)*
- **Deps:** [E1.1, E1.2] | **Est:** M

### Story E1.4 — As an API client, I want the idempotency-key store backing safe retries, so that re-POSTing a mutating request with the same key returns the first result rather than duplicating work.
- **Acceptance**
  - Given a `POST` carrying `Idempotency-Key` with the same key + same request fingerprint within 24h, Then the first persisted result is returned (no duplicate row).
  - Given the same key + a different fingerprint, Then `IDEMPOTENCY_REPLAY` (409).
  - Given a startup/periodic sweep, Then `idempotency_key` rows past `expires_at` are deleted.
- 🔧 **Backend** — `idempotency_key` DDL + `IdempotencyRepo` SQLite impl (`get`/`put`/`sweep_expired`); a service-layer guard usable by mutating POSTs; sweep hook at startup. *(ref: 03 §1 Idempotency row, §4.7; 07 §2.3 idempotency_key, §3 IdempotencyRepo, §6.2 sweep)*
- 🎨 **Frontend** — — none
- 🧪 **Test** — unit: same key+fingerprint → first result; different fingerprint → `IDEMPOTENCY_REPLAY`; `sweep_expired` removes expired rows and returns the deleted count. *(ref: 03 §4.7; 07 §9 persistence)*
- **Deps:** [E1.1] | **Est:** M

### Story E1.5 — As a frontend, I want `GET /meta` and `GET /healthz`, so that I can gate P1/P2 UI on typed feature flags and confirm liveness.
- **Acceptance**
  - Given `GET /healthz` (no auth), Then liveness 200.
  - Given `GET /api/v1/meta`, Then a `MetaView{build_version, api_version, default_backend_id?, model_mode, features}` is returned with `FeatureFlags` all `false` in MVP.
  - Given the frontend, When `features.relations`/`features.compare` are false, Then those affordances are hidden by exact-name flag reads.
- 🔧 **Backend** — `routes/meta.py` (`MetaView` + `FeatureFlags`); `model_mode` reflects `MODEL_MODE`. *(ref: 03 §2.2 Meta, §3.12)*
- 🎨 **Frontend** — read `MetaView.features.*` to gate optional UI on Dashboard/Settings. *(ref: 04 §1; 03 §3.12)*
- 🧪 **Test** — contract: `MetaView` validates; `healthz` is public (no auth); flags default false. *(ref: 03 §8.1)*
- **Deps:** [E1.1, E0.5] | **Est:** S

---

## Epic E12 — Settings & model-config
**Milestone:** M2 (cross-cutting; needed before the think loop uses a real backend) | **Priority:** P0 | **Page:** Settings | **Goal:** Let the single user configure model backends (API SDK + local CLI agents), per-backend PermissionGate toggles, Voice presets, default-backend selection, and test-connection — with API keys stored by ref and never returned. *(ref: README §M2; 02 §2, §4, §5; 03 §2.2 backends, §3.11; 04 §1 settings)*

### Story E12.1 — As a user, I want backend CRUD (SDK or CLI), so that I can register the models I bring.
- **Acceptance**
  - Given `POST /backends` with `BackendCreate` (kind `api_sdk|cli_agent|fake`, provider, optional `api_key`), Then a `BackendView` is returned and the raw `api_key` is stored via the secret store as `api_key_ref` — never echoed.
  - Given `GET /backends/{id}` or any `*View`, Then no response ever contains the key, only `has_api_key: bool`.
  - Given `PATCH /backends/{id}`, Then name/model/endpoint/permissions/enabled update; Given `DELETE`, Then the backend is removed.
  - Given an unknown `(kind, provider)` with no registered builder used at resolve time, Then `UNKNOWN_BACKEND` (422); a disabled backend used for generation → `BACKEND_DISABLED` (403).
- 🔧 **Backend** — `BackendRepo` SQLite impl (`model_backend` DDL incl. embedded `permissions` JSON + `ux_backend_one_default`); `routes/backends.py`; secret-store write on create/update. *(ref: 03 §2.2 backends, §3.11 (secret rule); 07 §2.3 model_backend, §3 BackendRepo; 02 §2.2, §4)*
- 🎨 **Frontend** — Settings `BackendList.tsx`: list/add/edit/remove backends. *(ref: 04 §1 `settings/`)*
- 🧪 **Test** — secret-leak test: create with `api_key`, assert no `*View` (list/read/after-update) ever contains it, only `has_api_key:true`; `UNKNOWN_BACKEND`/`BACKEND_DISABLED` envelopes. *(ref: 03 §8.1 secret-leak; 02 §9 secret handling, registry)*
- **Deps:** [E1.1, E0.6, E0.4] | **Est:** M

### Story E12.2 — As a user, I want per-CLI-backend permission toggles (auto-run readonly / file edits / network), so that I decide what a local agent may do.
- **Acceptance**
  - Given a CLI backend, When I set the three `PermissionSet` booleans in Settings, Then they persist on `model_backend.permissions` and round-trip in `BackendView`.
  - Given a fresh backend, Then `PermissionSet` defaults all-`false` (least privilege).
  - Given an API_SDK or FAKE backend, Then the toggles are inert/hidden (permissions ignored).
  - Given the `PermissionGate` authorize logic, Then readonly→ALLOW iff `auto_run_readonly` (else REQUIRE_APPROVAL), edit→ALLOW iff `allow_file_edits` (else DENY), network→ALLOW iff `network_access` (else DENY), unknown→REQUIRE_APPROVAL.
- 🔧 **Backend** — `weaver_core/model/cli/permission.py` (`PermissionGate`, `ActionCategory`, `Decision`, classify + authorize truth table) — built/tested even though no CLI agent ships in MVP. *(ref: 02 §5.1–5.2, §10 "permission model"; 00 §1.2)*
- 🎨 **Frontend** — Settings `PermissionToggles.tsx` (three switches, shown only for `cli_agent` kind). *(ref: 04 §1 `settings/PermissionToggles.tsx`)*
- 🧪 **Test** — pure unit: full `(category × permission)` authorize truth table + default-deny on empty `PermissionSet`; classification of representative actions (`ls`→readonly, `write`→edit, `curl`→network, ambiguous→unknown). *(ref: 02 §9 PermissionGate)*
- **Deps:** [E12.1] | **Est:** M

### Story E12.3 — As a user, I want to select a default backend (global and per-project), so that the think loop knows which model to use.
- **Acceptance**
  - Given `PATCH /backends/{id}` with `is_default=true`, Then `BackendRepo.set_default` clears any prior default atomically (one-default invariant enforced by the partial unique index).
  - Given `PATCH /projects/{id}` with `default_backend_id`, Then the project overrides the global default.
  - Given `registry.default_for(project)`, Then it resolves `project.default_backend_id` → global `is_default` → FAKE (when `MODEL_MODE=fake`); with none configured in real mode → `NO_DEFAULT_BACKEND` (422).
- 🔧 **Backend** — `BackendRepo.set_default` (clears others); `ProviderRegistry.default_for` resolution order; raise `NO_DEFAULT_BACKEND`. *(ref: 02 §2.1 `default_for`; 03 §5.1 `NO_DEFAULT_BACKEND`; 07 §3 BackendRepo, §2.3 `ux_backend_one_default`)*
- 🎨 **Frontend** — Settings default-backend picker; project settings backend override. *(ref: 04 §1 settings)*
- 🧪 **Test** — unit: `set_default` clears prior default; partial unique index rejects two defaults on direct insert; `default_for` fallback chain incl. FAKE; `NO_DEFAULT_BACKEND` envelope. *(ref: 07 §9.1 one-default invariant; 02 §9 registry)*
- **Deps:** [E12.1] | **Est:** S

### Story E12.4 — As a user, I want a test-connection (health probe) per backend, so that I can verify a backend before relying on it.
- **Acceptance**
  - Given `POST /backends/{id}/health`, Then it calls `ModelProvider.health()` and returns `BackendHealthView{id, ok, detail?, latency_ms?}`.
  - Given an API_SDK backend, Then health validates key/reachability; Given FAKE, Then `ok=true` always.
  - Given a disabled/missing backend, Then `BACKEND_DISABLED`/`BACKEND_NOT_FOUND` respectively (no real call attempted).
- 🔧 **Backend** — `routes/backends.py` health endpoint delegating to `registry.get(id).health()`; map provider failures to `BackendHealthView` (not a 5xx for an `ok:false` probe). *(ref: 03 §2.2 `/backends/{id}/health`, §3.11 `BackendHealthView`; 02 §1.3 `health`)*
- 🎨 **Frontend** — Settings "Test connection" button per backend row showing ok/latency/detail. *(ref: 04 §1 settings)*
- 🧪 **Test** — contract: `BackendHealthView` validates; FAKE → ok; disabled/missing → correct error code (driven by FAKE/stub, no network). *(ref: 03 §8.1; 02 §9 registry)*
- **Deps:** [E12.1, E12.3] | **Est:** S

### Story E12.5 — As a user, I want Voice presets configured, so that I can set defaults/instructions for the academic/casual/professional tones applied to drafts.
- **Acceptance**
  - Given the Settings Voice section, When I pick a project `voice_default` (academic/casual/professional), Then it persists via `PATCH /projects/{id}` and is the draft default.
  - Given a `voice_config` row, Then `tone` + optional `instructions` persist and round-trip (MVP scope: enum + instructions; `sample_text`/`style_directives` are P1 placeholders only).
  - Given Voice config, Then it is never offered as a `/think` field (Voice is draft-only — no `voice` on `ThinkRequest`).
- 🔧 **Backend** — `voice_config` DDL persistence (MVP fields: `tone`, `instructions`); `project.voice_default` already on `ProjectUpdate`. *(ref: 07 §2.3 voice_config; 03 §3.1 `voice_default`; 00 §0 / §2.2 Voice; 03 §3.3 (no voice on ThinkRequest))*
- 🎨 **Frontend** — Settings Voice presets panel (tone select + instructions); reflects per-project `voice_default`. *(ref: 04 §1 settings; 04 §1 `draft/VoiceSelector.tsx` for downstream use)*
- 🧪 **Test** — unit/contract: `voice_config` round-trip; `project.voice_default` PATCH validates against `VoiceTone` enum; assert `ThinkRequest` schema has no `voice` field. *(ref: 07 §9.1; 03 §8.1, §3.3)*
- **Deps:** [E1.2] | **Est:** S

---

## Epic E2 — Thinking-tree core (the moat)
**Milestone:** M2 | **Priority:** P0 | **Page:** Thinking Tree | **Goal:** Build and test the per-branch context resolver (the moat) first, then the forest model, tree operations, the model-provider abstraction, the streaming `/think` loop, and the D3 auto-layout render — proving per-branch isolation end-to-end.

### Story E2.1 — As a domain author, I want `resolve_branch_context` to exist as a pure, model-independent function so that the moat is built and unit-tested before anything calls a model.
- **Acceptance**
  - Given a `NodeForest` snapshot and a `node_id`, When `resolve_branch_context(node_id, forest, policy)` is called, Then it returns a `BranchContext` whose `chain` is the ordered lineage `[root, …, node_id]` after policy filtering, with `target_node_id`, `excluded_dead_end_ids`, `grounding_enabled`, and `policy_fingerprint` populated.
  - Given an unknown `node_id`, When called, Then it raises a `NODE_NOT_FOUND` domain error and performs no I/O.
  - Given the resolver module, When its imports are inspected, Then it imports no DB/model/clock/random module (purity).
- 🔧 **Backend** — implement `weaver_core/context/resolver.py::resolve_branch_context` as Tier-A pure: validate target, walk strictly up via `parent_id`, reverse to `[root..target]`, build `BranchContext`; no I/O/model/clock/random; *(ref: 01 §5.1, §5.2; §0 Tier A)*
- 🎨 **Frontend** — none
- 🧪 **Test** — `tests/unit/test_context_resolver.py` T-CTX-1 (purity/determinism: two calls → byte-identical `BranchContext`, stable `policy_fingerprint`) and import-lint T-CTX-11 that no DB/model/clock/rng symbols are reachable; FAKE not needed (no model); *(ref: 01 §11.1 T-CTX-1, T-CTX-11)*
- **Deps:** [E2.2] | **Est:** M

### Story E2.2 — As a domain author, I want the `ThoughtNode`/`NodeForest`/`Branch`/`BranchContext` schemas so that the pure core has a frozen, indexed snapshot to operate on.
- **Acceptance**
  - Given a list of `ThoughtNode`s, When `NodeForest.build(project_id, nodes)` runs, Then `nodes`/`children`/`roots` are populated and every `children[*]` and `roots` is sorted by `(order_index, id)` deterministically.
  - Given a built forest, When `forest.branch_of(head_id)` is called, Then it returns a `Branch` with ordered `node_ids [root..head]` and `depth == len(node_ids)`; no `branches` table or `BranchRepo` exists.
  - Given any schema, When round-tripped through Pydantic, Then serialize/deserialize is lossless and enums match foundation §2.3 string literals.
- 🔧 **Backend** — define `weaver_core/schemas/{node,context}.py` (`ThoughtNode`, `NodeForest` + `build`/`with_node`/`with_nodes`/`descendants`/`branch_of`, `Branch`, `ContextMessage`, `BranchContext`); frozen-snapshot semantics (pure fns return new forests); *(ref: 01 §2.1, §2.2, §2.3)*
- 🎨 **Frontend** — none (FE imports generated types only); *(ref: 04 §3)*
- 🧪 **Test** — unit: `NodeForest.build` deterministic sibling/root ordering; `branch_of` ordering + depth; T-CONTRACT-1 round-trip + enum-literal drift guard; *(ref: 01 §11.4 T-CONTRACT-1)*
- **Deps:** [] | **Est:** M

### Story E2.3 — As a thinker, I want the resolved context to contain ONLY my ancestor chain so that no sibling, cousin, or descendant can leak into what the model sees.
- **Acceptance**
  - Given a deep tree, When `resolve(target)` runs, Then `chain` ids are exactly a subsequence of `[root..target]` and contain no sibling/cousin/descendant id.
- 🔧 **Backend** — covered by E2.1 resolver (upward `parent_id` walk only — structural guarantee, not a runtime check); *(ref: 01 §5.1 ancestor-only, §5.4 isolation proof)*
- 🎨 **Frontend** — none
- 🧪 **Test** — `tests/unit/test_context_resolver.py` T-CTX-2: build a multi-level tree with branching siblings/cousins, assert `set(chain_ids) ⊆ lineage_ids` and `∩` with off-path ids is empty; *(ref: 01 §11.1 T-CTX-2)*
- **Deps:** [E2.1] | **Est:** S

### Story E2.4 — As a thinker, I want sibling branches B and C to be fully isolated so that reasoning on one is never polluted by the other (THE guarantee).
- **Acceptance**
  - Given siblings B and C under parent A, When `resolve(B)` and `resolve(C)` are computed, Then both share prefix `[root..A]`, `C ∉ resolve(B).chain`, and `B ∉ resolve(C).chain`.
- 🔧 **Backend** — none new (property of E2.1's upward-only walk); *(ref: 01 §5.4 — "siblings can never leak", mermaid)*
- 🎨 **Frontend** — none
- 🧪 **Test** — `tests/unit/test_context_resolver.py` T-CTX-3 (explicit sibling-isolation card): assert shared `[root..A]` prefix + mutual exclusion of B/C; *(ref: 01 §11.1 T-CTX-3; §5.4)*
- **Deps:** [E2.1] | **Est:** S

### Story E2.5 — As a thinker, I want pruned (dead-end) ancestors excluded from model context by default so that a rejected premise never re-pollutes a descendant's reasoning.
- **Acceptance**
  - Given default policy and a `dead_end` ancestor on the chain, When `resolve(target)` runs, Then that ancestor id is in `excluded_dead_end_ids` and absent from `chain`.
  - Given root→A(open)→B(dead_end)→C(open)→target with default policy, When resolved, Then `chain == [A, C, target]` (B excluded).
- 🔧 **Backend** — implement dead-end policy step in resolver + `weaver_core/context/policy.py::ContextPolicy` (`include_dead_end_ancestors=False` default, `fingerprint()`, `apply_depth_window` identity in MVP); *(ref: 01 §5.3 decision + edge cases, §5.2 step 3)*
- 🎨 **Frontend** — none (dead-end ancestors stay visible/greyed in tree; only model context excludes them); *(ref: 01 §5.3 rationale 2)*
- 🧪 **Test** — `tests/unit/test_context_resolver.py` T-CTX-4 (explicit dead-end-exclusion card: dead-end ancestor in `excluded_dead_end_ids`, not in `chain`) + T-CTX-7 (dead-end-between-live-nodes → `[A,C,target]`); *(ref: 01 §11.1 T-CTX-4, T-CTX-7)*
- **Deps:** [E2.1] | **Est:** S

### Story E2.6 — As a thinker asking about a failed branch, I want the target node itself always kept (even if dead_end) so that I can reason about why it failed or salvage it.
- **Acceptance**
  - Given a `dead_end` target, When resolved, Then the target is present in `chain` regardless of state.
  - Given a chain where every ancestor is `dead_end` except the target, When resolved with default policy, Then `chain == [target]`.
- 🔧 **Backend** — "target is sacred" branch in resolver step 3 (skip exclusion when `n.id == node_id`); *(ref: 01 §5.2 step 3, §5.3 rule 3 + edge cases)*
- 🎨 **Frontend** — none
- 🧪 **Test** — T-CTX-5 (dead-end target kept) + the whole-chain-dead-except-target edge case; *(ref: 01 §11.1 T-CTX-5; §5.3)*
- **Deps:** [E2.5] | **Est:** S

### Story E2.7 — As a power user, I want an `include_dead_end_ancestors` toggle so that I can optionally show the AI everything I tried (so it won't re-suggest dead ends).
- **Acceptance**
  - Given `ContextPolicy(include_dead_end_ancestors=True)`, When resolved, Then dead-end ancestors are back in `chain` and `excluded_dead_end_ids` is empty.
  - Given two policies, When fingerprinted, Then the toggle changes `policy_fingerprint` (reproducibility).
- 🔧 **Backend** — honor toggle in resolver; policy precedence (per-request → project → default); *(ref: 01 §5.3 escape hatch, §5.3 policy precedence)*
- 🎨 **Frontend** — none in this story (wired via `/think` `include_dead_ends` in E2.18)
- 🧪 **Test** — T-CTX-6 (toggle ON re-includes ancestors, empties `excluded`); fingerprint differs across policies; *(ref: 01 §11.1 T-CTX-6)*
- **Deps:** [E2.5] | **Est:** S

### Story E2.8 — As a domain author, I want the moat immune to fold state and relation overlays so that view hints and cross-branch links can never widen context.
- **Acceptance**
  - Given any ancestor with `collapsed` flipped, When resolved, Then `chain` is unchanged.
  - Given any `Relation` added to the forest, When `resolve_branch_context` is called, Then output is unchanged (relations are not read at all).
  - Given a forged cyclic forest, When resolved, Then `CYCLE_DETECTED` is raised (defense-in-depth vs I2).
- 🔧 **Backend** — resolver ignores `collapsed` and never reads `Relation`; cycle guard `seen` set; *(ref: 01 §4.5 collapsed invisible to moat, §6 relations invisible to moat, §5.2 step 2 cycle guard)*
- 🎨 **Frontend** — none
- 🧪 **Test** — T-CTX-9 (collapsed invisible), T-CTX-10 (relations invisible), T-CTX-8 (cycle guard raises); *(ref: 01 §11.1 T-CTX-8/9/10)*
- **Deps:** [E2.1] | **Est:** S

### Story E2.9 — As the provider boundary, I want `to_messages(BranchContext)` to render the resolved chain into provider-agnostic `ContextMessage[]` so that the model receives only the resolved chain, purely.
- **Acceptance**
  - Given a `BranchContext`, When `to_messages(system?)` runs, Then each node renders per `kind` (`question_answer`→user prompt + assistant content; `ai_reasoning`→assistant; `user_thought`→user incl. annotation) with `node_id` provenance, no model call.
  - Given an optional `system`, When provided, Then a leading `role="system"` message is prepended.
- 🔧 **Backend** — `weaver_core/context/render.py::to_messages` (pure); `_infer_flag` hook reserved for honesty; *(ref: 01 §5.6, §2.3)*
- 🎨 **Frontend** — none
- 🧪 **Test** — unit: each `kind` maps to expected role/content/provenance; annotation appended for `user_thought`; pure (no model import); *(ref: 01 §5.6; §11 Testing)*
- **Deps:** [E2.2] | **Est:** S

### Story E2.10 — As a thinker, I want to add a node (a written thought + annotation, or a seed question) so that I can start or extend a branch by hand.
- **Acceptance**
  - Given `ForkSpec(parent_id=None, …)`, When `fork(forest, spec, new_id, now)` runs, Then a new root is created (multiple roots allowed) and the input forest is unchanged (immutability).
  - Given `ForkSpec(parent_id=X, …)`, When forked, Then a child is inserted under X with a dense `order_index` and invariants (I1, I2, I4) hold.
  - Given identical `new_id`/`now`, When forked twice, Then the produced node is identical (no randomness/clock inside `fork`).
- 🔧 **Backend** — `weaver_core/tree/ops.py::fork` (pure transform, injected `new_id`/`now`), `_next_order_index`, `tree/forest.py` index helpers, `tree/validate.py` invariant asserts; `POST /projects/{pid}/nodes` Tier-B wiring via `tree_service`; *(ref: 01 §4.2 fork, §3 invariants I1/I2/I4; 03 §2.2 `POST /projects/{pid}/nodes`, §3.2 `NodeCreate`/`NodeView`)*
- 🎨 **Frontend** — composer to add a root/child node (question or written thought + annotation), optimistic insert into forest query; `NodeActions` annotate; *(ref: 04 §5.4 NodeCard kind/annotation, §1 components/node)*
- 🧪 **Test** — unit T-TREE-1 (insert child, dense order, input unchanged), T-TREE-2 (new root + multi-root I5), T-TREE-3 (determinism); contract: `POST /projects/{pid}/nodes` body→`NodeView` validates OpenAPI; *(ref: 01 §11.2 T-TREE-1/2/3; 03 §8.1)*
- **Deps:** [E2.2] | **Est:** M

### Story E2.11 — As a thinker, I want to explicitly fork N child branches from a node so that I can split a thought into distinct directions.
- **Acceptance**
  - Given `ForkRequest{branches:[…N]}` on node X, When `POST /nodes/{id}/fork` runs, Then N sibling children are created under X with stable `(order_index, id)` order and returned as `list[NodeView]`.
  - Given a fork on a missing parent, When attempted, Then `INVALID_TREE_OP` / `NODE_NOT_FOUND` is returned (no stream).
- 🔧 **Backend** — `tree_service` calls pure `fork` N times under one parent; route `POST /nodes/{id}/fork` (`ForkRequest`→`list[NodeView]`); idempotency-key supported; *(ref: 01 §4.2 multi-fork; 03 §2.2 `/nodes/{id}/fork`, §3.4 `ForkSpec`/`ForkRequest`, §4.7 idempotency)*
- 🎨 **Frontend** — `NodeActions` fork affordance creating siblings; relayout after settle (authoritative-on-settle); *(ref: 04 §5.4 NodeActions, §2 mutations authoritative-on-settle)*
- 🧪 **Test** — unit T-TREE-4 (N forks → N siblings, stable order); contract: `/nodes/{id}/fork` shape + `INVALID_TREE_OP` envelope/status; *(ref: 01 §11.2 T-TREE-4; 03 §8.1, §5.2)*
- **Deps:** [E2.10] | **Est:** S

### Story E2.12 — As a thinker, I want to backtrack (refocus) an old node without moving anything so that the old branch stays as a record, just defocused.
- **Acceptance**
  - Given any old node, When `POST /nodes/{id}/backtrack` runs, Then the forest is byte-identical (no structural mutation) and a `BranchView` (root→…→node) is returned ready for the next think turn.
- 🔧 **Backend** — Tier-B convenience returning focused node's `Branch` + readiness; no node moved (refocus is view-state); route `POST /nodes/{id}/backtrack`→`BranchView`; *(ref: 01 §4.1 backtrack = no structural mutation, §4.4 note; 03 §2.2 `/nodes/{id}/backtrack`, §3.5 `BranchView`)*
- 🎨 **Frontend** — `FocusStore.backtrack(nodeId)`: refocus old node, grey every node off its ancestor path (not removed); `ancestorPathIds` view-only highlight; *(ref: 04 §5.3 focus+backtrack, §2.1 FocusStore)*
- 🧪 **Test** — unit T-TREE-7 (backtrack non-mutation: forest byte-identical, returns branch+context); FE unit: backtracking greys off-path nodes, `ancestorPathIds` returns root→focus in order; *(ref: 01 §11.2 T-TREE-7; 04 §10.1 Focus/backtrack)*
- **Deps:** [E2.10] | **Est:** S

### Story E2.13 — As a thinker, I want to prune a branch (mark dead-end, fold + grey) without deleting it so that "tried, doesn't work" stays as a record.
- **Acceptance**
  - Given `POST /nodes/{id}/prune`, When run, Then the subtree head + descendants get `state=dead_end` and `collapsed=true`, node count is unchanged, and the subtree stays walkable (I6).
  - Given `unprune` on a dead-end head, When run, Then the head returns to `open` and children keep their own states.
- 🔧 **Backend** — `tree/ops.py::prune` (mark subtree, no delete) + `unprune`; `set_state` state machine (I7); route `POST /nodes/{id}/prune` (`PruneRequest`→`NodeView`); *(ref: 01 §4.3 prune, §4.4 state machine, §3 I6/I7; 03 §2.2 `/nodes/{id}/prune`, §3.5 `PruneRequest`)*
- 🎨 **Frontend** — `dead_end` chip + default collapsed/greyed; `NodeState` rendering; prune action in `NodeActions`; *(ref: 04 §5.4 node states, §9 dead_end auto-collapse)*
- 🧪 **Test** — unit T-TREE-5 (prune no-delete, count unchanged, subtree walkable), T-TREE-6 (unprune reopens head only), T-TREE-8 (illegal `dead_end→promising` raises `ILLEGAL_STATE_TRANSITION`); FE: dead_end renders greyed+collapsed; *(ref: 01 §11.2 T-TREE-5/6/8; 04 §10.1 Node states)*
- **Deps:** [E2.10] | **Est:** M

### Story E2.14 — As a thinker, I want to fold/expand a node so that I can collapse to a one-line gist or expand to the full Q&A — without ever changing what a node sees.
- **Acceptance**
  - Given `set_collapsed(node, true/false)`, When run, Then only `collapsed` flips; `state` and structure are untouched.
  - Given a collapsed node in the UI, When rendered, Then it shows one-line gist; expanded shows full prompt + content + annotation + citations; the subtree is hidden from layout when collapsed.
- 🔧 **Backend** — `tree/ops.py::set_collapsed` (pure flag flip, view hint persisted) + `PATCH /nodes/{id}` collapsed; *(ref: 01 §4.5 fold/expand; 03 §2.2 `PATCH /nodes/{id}`, §3.2 `NodeUpdate`)*
- 🎨 **Frontend** — two-level disclosure in `NodeCard`; `FoldStore` transient override flushed via `PATCH /nodes/:id` on idle (debounce); fold is layout-affecting (hides subtree); *(ref: 04 §5.2 fold/expand, §2 transient override, §4.2 fold hides subtree)*
- 🧪 **Test** — unit T-TREE-10 (set_collapsed flips only collapsed); FE: toggle collapses subtree in layout + renders one-liner; transient override survives a refetch; *(ref: 01 §11.2 T-TREE-10; 04 §10.1 Fold/expand)*
- **Deps:** [E2.10] | **Est:** M

### Story E2.15 — As the system, I want a `ModelProvider` Protocol + `TokenEvent` taxonomy + registry so that backends are swappable behind one streaming interface that can never widen context.
- **Acceptance**
  - Given a `GenerateRequest`, When `provider.generate(req)` is consumed, Then it yields `TokenEvent`s in `seq` order terminating with exactly one `done` xor one `error` (never both/neither).
  - Given a provider during `generate`, When inspected, Then it reads no repos/forest (cannot widen context).
  - Given a `backend_id`, When `registry.get(...)` resolves it, Then it raises `BACKEND_NOT_FOUND` / `BACKEND_DISABLED` / `UNKNOWN_BACKEND` appropriately.
- 🔧 **Backend** — `weaver_core/model/provider.py` (`ModelProvider`, `GenerateRequest`, `ChatMessage`, closed 8-member `TokenEvent` type enum, `PermissionSet`, `BackendHealth`); `model/registry.py::ProviderRegistry` with `register_builder((kind,provider))` + `default_for`; *(ref: 02 §0 binding rule, §1.1–§1.3, §2.1 registry, §1.2 TokenEvent C1)*
- 🎨 **Frontend** — none (FE imports `TokenEvent` from contracts; exhaustive switch lands in E2.20); *(ref: 04 §6 closed type set)*
- 🧪 **Test** — provider contract suite: terminal-event invariant, `seq` strictly increasing/`token` before `done`, no-context-widening via spy repos seeing zero calls; registry resolution + error codes; *(ref: 02 §9 provider contract suite, registry tests)*
- **Deps:** [E2.2] | **Est:** L

### Story E2.16 — As CI, I want a deterministic FAKE provider (default in CI) so that every model-touching test is byte-stable without a real model or network.
- **Acceptance**
  - Given the same `GenerateRequest`, When `FakeProvider.generate` runs twice, Then it yields a byte-identical `TokenEvent` stream (deterministic on `(purpose, hash(messages))`).
  - Given `response_schema` set, When run, Then terminal `done.structured` validates against that schema.
  - Given a script with an `error` event, When run, Then exactly one terminal `error` is emitted (failure injection).
- 🔧 **Backend** — `weaver_core/model/fake.py::FakeProvider` + `FakeScript`; `WEAVER_MODEL_MODE=fake` makes `registry.default_for`→FAKE; schema-valid structured synthesis; scripted citation/tool_call/error; *(ref: 02 §8 FAKE design, §2.1 default_for fallback)*
- 🎨 **Frontend** — none
- 🧪 **Test** — unit: determinism (same req → identical stream), schema-valid structured output, scripted error; `conftest.py` wires FAKE by default; *(ref: 02 §9 FAKE provider tests, §8; 03 §8.3 determinism)*
- **Deps:** [E2.15] | **Est:** M

### Story E2.17 — As a thinker, I want AI-proposed forks via structured generation so that the AI can suggest N distinct directions worth splitting out, seen only through my ancestor chain.
- **Acceptance**
  - Given a node, When `propose_forks` runs, Then it resolves context via the moat (same isolation), calls `generate(purpose="fork_proposal", response_schema=…)`, and returns a schema-valid `ForkProposalResult{should_fork, directions[]}`.
  - Given the stream, When proposals are emitted, Then each rides a `proposal` `TokenEvent` and the authoritative result is on terminal `done.structured`; FE-facing fields are the canonical `ForkProposal{prompt, rationale, suggested_label?}`.
  - Given `POST /nodes/{id}/fork/propose`, When streamed, Then terminal `done` carries `ForkProposeResult{proposals}`.
  - Given an accepted proposal, When `POST /nodes/{id}/fork` is called with it, Then it commits via the ordinary deterministic `fork` (no special AI-fork path).
- 🔧 **Backend** — `model/schemas/fork_proposal.py` (`ProposedFork`→`ForkProposal` 1:1, `ForkProposalResult`); `tree/` service `propose_forks` using resolver + `assemble_request`; route `POST /nodes/{id}/fork/propose` (SSE); inline `proposal` events on `/think`; *(ref: 02 §7.1–§7.3 structured gen, isolation, accept-via-fork; 01 §4.2 AI-proposed fork; 03 §2.2 `/fork/propose`, §3.4 `ForkProposal`/`ForkProposeResult` G7, §1.2 `proposal` C1)*
- 🎨 **Frontend** — non-modal "N directions worth thinking about separately" strip; each proposal one-click Accept→`/nodes/:id/fork`; consumes `proposal` events or `done.fork_proposals`/`ForkProposeResult.proposals`; `StreamStore.forkProposals`; *(ref: 04 §6.1 fork-proposal accept UI, §2.1 StreamStore)*
- 🧪 **Test** — backend: FAKE structured path returns schema-valid `ForkProposalResult`; isolation (proposal sees only ancestor chain); accept commits a child via pure `fork`; FE: `proposal` events render N proposals, Accept calls fork; *(ref: 02 §9 structured/contract, smoke; 04 §10.1 Fork proposals)*
- **Deps:** [E2.11, E2.16] | **Est:** L

### Story E2.18 — As a thinker, I want a streaming `/think` endpoint that resolves my branch context and streams the answer so that asking at a node extends that branch with an isolated, server-resolved context.
- **Acceptance**
  - Given pre-flight failures (auth/validation/node-not-found/no-backend/context-resolution), When `POST /nodes/{id}/think` is called, Then a normal HTTP 4xx/5xx envelope is returned and NO stream is opened.
  - Given success, When streamed, Then the route resolves context (moat) before the provider, opens SSE, streams `token`s, and ends with exactly one `done` or `error`.
  - Given `create_child=True` (default), When `done` is reached, Then the answer node + citations are persisted in one transaction and `done.node_id` is the real id; given `create_child=False`, Then nothing is persisted and `done.node_id=null`.
  - Given a client disconnect or `DELETE /streams/{request_id}`, When the stream is aborted, Then the provider task is cancelled and nothing is persisted.
- 🔧 **Backend** — `tree_service.think` wiring resolver→`to_messages`→`provider.generate`→persist-at-done (pure `fork` when `create_child`); thin route `POST /nodes/{id}/think` (`ThinkRequest`→SSE `TokenEvent`); pre-stream vs in-stream error split; cancel + idempotency; *(ref: 01 §8 think loop + `create_child` C11; 02 §1.3 cancellable generate; 03 §3.3 `ThinkRequest`/`ThinkResultMeta`, §4.1/§4.3/§4.5/§4.6/§4.7)*
- 🎨 **Frontend** — optimistic placeholder child at submit; SSE→`StreamStore.append`; reconcile to `done.node_id` (or discard if null); Resume on `STREAM_INTERRUPTED`; `include_dead_ends` threads E2.7 toggle; *(ref: 04 §6 streaming think loop, §2.1 StreamStore)*
- 🧪 **Test** — contract/SSE (NDJSON, FAKE): every line a valid `TokenEvent`, terminal `done` xor `error`, `done.data` matches `ThinkResultMeta`, `branch_node_ids` equals the target's ancestor chain (moat at the API boundary); contract: `GET /nodes/{id}/context` `ordered_node_ids` = ancestor chain with no sibling ids; FE: tokens stream into optimistic child, error keeps partial + Resume; *(ref: 03 §8.1/§8.2 SSE schema + moat assertions; 04 §10.1 Streaming)*
- **Deps:** [E2.1, E2.9, E2.10, E2.16] | **Est:** L

### Story E2.19 — As a thinker, I want an early "Reading your N branches" signal so that before any token I see, honestly, how many ancestor segments the AI will read.
- **Acceptance**
  - Given a `/think` stream, When it starts, Then the FIRST SSE frame is a `progress` `TokenEvent` with `data={stage:'context_resolved', context_segment_count:int, branch_node_ids:[…]}`, emitted before any `token`.
  - Given the composer at the focused node, When the count arrives, Then it renders "Reading your N branches" from the server value — never client-computed.
  - Given `GET /nodes/{id}/context`, When called, Then it returns the read-only moat preview (`ordered_node_ids`, `messages`, `excluded_dead_end_ids`) for inspection.
- 🔧 **Backend** — emit early `context_resolved` `progress` frame from `/think` carrying `context_segment_count`+`branch_node_ids` (C7); `GET /nodes/{id}/context` GET/pure surface of `resolve_branch_context`; *(ref: 03 §3.3 C7 early-count note, §4.1/§4.2 first-frame, §3.5 `BranchContextView`; 01 §5.6)*
- 🎨 **Frontend** — "Reading your N branches" affordance fed by the early `progress` frame (also on terminal `done`); never recompute the ancestor set client-side; *(ref: 04 §5.4 + C7, §0 hard rule, §6 first-frame)*
- 🧪 **Test** — SSE: assert first emitted frame is `progress` with `context_segment_count` matching the resolver's chain length and `branch_node_ids` equal to the ancestor chain; FE unit: early `progress` frame sets the label count; *(ref: 03 §8.2; 04 §10.1 Streaming early-progress)*
- **Deps:** [E2.18] | **Est:** M

### Story E2.20 — As a thinker, I want the tree auto-laid-out with D3 (pan/zoom, focus highlight, node-state styling) so that the structure is a deterministic, no-canvas view of my `parent_id` lineage.
- **Acceptance**
  - Given a forest snapshot, When `useTreeLayout` runs, Then layout is deterministic (same forest+sizes+fold → identical coordinates), siblings are ordered by `order_index`, a collapsed node hides its subtree, and a multi-root forest places all roots under a dropped synthetic super-root.
  - Given pan/zoom, When the user wheels/drags, Then the viewport transforms (clamped `k∈[0.15,2.5]`) and no node is ever moved.
  - Given focus, When a node is focused, Then it + its ancestor path highlight and off-path nodes dim; node cards render `kind` chrome + `open/promising/dead_end` chip.
- 🔧 **Backend** — `GET /projects/{pid}/nodes`→`ForestView` (no geometry; edges implied by `parent_id`); *(ref: 03 §2.2 `/projects/{pid}/nodes`, §3.2 `ForestView`)*
- 🎨 **Frontend** — `components/tree/` `TreeCanvas` (SVG layers), `useTreeLayout` (`d3-hierarchy`+`d3-flextree`, size-aware, stable via `order_index`), `useViewport` (`d3-zoom`), `Edges`, `NodeCard` (`foreignObject`), focus/backtrack highlight layer; exhaustive `TokenEvent.type` switch in `lib/api/sse.ts`; TanStack Query (server) + Zustand (view) split; *(ref: 04 §4.1 layout choice, §4.2 stability, §4.3 layers, §5.1 pan/zoom, §5.3 focus, §5.4 NodeCard, §2 state split, §6 closed-enum switch)*
- 🧪 **Test** — FE unit (Vitest): `useTreeLayout` determinism + `order_index` order + collapsed hides subtree + multi-root placement; node-state chips render correctly; boundary guard test (no module under `lib/`/`stores/`/`components/` imports a model client or assembles "context messages"); M2 Playwright smoke: open project → ask at root → fork → backtrack (greyed) → fold/expand → see "Reading your N branches" (FAKE); *(ref: 04 §10.1 Layout/Node states/Boundary guard, §10.3 M2 smoke)*
- **Deps:** [E2.10, E2.18] | **Est:** L

### Story E2.21 — As a domain author, I want derived honesty labels (`HonestyLabel`) on node answers and context messages so that "回看思维树" honestly shows what is mine vs AI-inferred vs source-backed.
- **Acceptance**
  - Given a `user_thought` node, When labeled, Then `HonestyLabel.USER_JUDGMENT` regardless of grounding.
  - Given AI content + ungrounded (or grounded but no citations), When labeled, Then `INFERRED`; given AI + grounded + has_citations, Then `GROUNDED`.
  - Given a labeled answer, When rendered into context, Then the flag flows into `ContextMessage.is_inferred`.
- 🔧 **Backend** — `weaver_core/honesty.py::honesty_label` (pure, derived from `node.kind`, `grounding_enabled`, `has_citations`); closed `HonestyLabel` enum owned in `schemas/enums.py` (C13: `user_judgment|inferred|grounded|weakly_grounded`); *(ref: 01 §9 honesty marking + C13 enum)*
- 🎨 **Frontend** — node/draft bodies render the canonical `HonestyLabel` members from contracts; never a locally-spelled vocabulary; *(ref: 04 §3.1 honesty C13, §8 no-source mode)*
- 🧪 **Test** — unit T-HON-1 (`user_thought`→`user_judgment`), T-HON-2 (AI+ungrounded→`inferred`), T-HON-3 (grounded+cites→`grounded`; grounded+no cites→`inferred`), T-HON-4 (flag flows into `ContextMessage.is_inferred`); *(ref: 01 §11.4 T-HON-1..4)*
- **Deps:** [E2.2, E2.9] | **Est:** S

### Story E2.22 — As a release gate, I want an M2 end-to-end smoke (FAKE) so that the moat is proven through the service: two sibling branches stay isolated through `/think`.
- **Acceptance**
  - Given a project, When create → fork two sibling branches → `think` on each (FAKE) → assert each branch's resolved context excludes the other sibling → propose forks → accept one → child node created with isolated context, Then all assertions pass with no real model/network.
- 🔧 **Backend** — `tests/contract/test_think_loop_smoke.py` mirroring the core loop through the Tier-B service + FAKE; *(ref: 01 §11.5 smoke)*
- 🎨 **Frontend** — M2 Playwright browser smoke (shared with E2.20); *(ref: 04 §10.3 M2)*
- 🧪 **Test** — assert per-branch context excludes the other sibling end-to-end; AI-proposed fork accepted commits via `fork`; FAKE provider throughout; *(ref: 01 §11.5; 02 §9 Smoke; 03 §8.4)*
- **Deps:** [E2.17, E2.18, E2.20] | **Est:** M

---

## Epic E3 — Optional source grounding
**Milestone:** M3 | **Priority:** P0 (grounding optional, but the feature itself is P0) | **Page:** Thinking Tree (source sidebar) | **Goal:** Let a project optionally ingest sources (text/Markdown, URL, PDF) and ground node answers with sentence-level, click-to-original citations — while the tree, moat, and drafts keep working fully with **zero** sources.

### Story E3.0 — As a thinker, I want the entire tree (think → fork → prune → crystallize → draft) to work with zero sources, so that grounding is never a precondition.
- **Acceptance**
  - Given a project with **no `Source` rows**, When I run a full think→fork→prune→promote→draft loop, Then it succeeds and **no** `retrieval/` code (embed/retrieve/map_citations) is exercised (assert via `GroundingService` spy).
  - Given a grounded project's `is_grounded()` returns false, When `/think` runs, Then no retrieval step is inserted and the answer node persists with `citations = []`.
  - Given an ungrounded draft, When generated, Then it produces **zero** `Citation` rows and `DraftView.grounded = false`.
- 🔧 **Backend** — `GroundingService.is_grounded(project_id)` is the **sole** gate; `grounding_enabled` derived (`EXISTS source WHERE status='ready'`), never stored; no `tree/context/crystallize/draft` module imports `retrieval/` at load; retrieval injected as an optional no-op service. *(ref: 05 §0, §1.1, §9; 07 §2.3 project DDL grounding_enabled derived)*
- 🎨 **Frontend** — source sidebar renders an empty/"add a source" state; node cards show no citation chips when ungrounded. *(ref: 04 §0, §8 no-source mode)*
- 🧪 **Test** — **zero-source smoke** (§9.4): full loop with no Source asserts `GroundingService` retrieve/embed never called; contract: ungrounded `/think` answer returns `citations=[]`. *(ref: 05 §9, §10.3; 03 §8.4)*
- **Deps:** [E2.18] | **Est:** M

### Story E3.1 — As a developer, I want a single `GroundingService` facade and the canonical segmenter, so that the bypass is explicit and chunking + citation mapping never drift.
- **Acceptance**
  - Given `GroundingService` Protocol (`ingest_source`, `retrieve`, `map_citations`, `is_grounded`), When any caller outside `retrieval/` needs grounding, Then it talks **only** to this facade.
  - Given `segment_sentences(text, lang)`, When called, Then `text[s.char_start:s.char_end] == s.text` for every returned `Sentence` (exact offsets), and the **same** function is imported by both `chunking/` and `citation/mapper`.
- 🔧 **Backend** — implement `retrieval/service.py:GroundingService`; `chunking/segmentation.py:segment_sentences` (CJK terminators 。！？；…, trailing quotes/brackets, Latin terminators with abbreviation guard, `auto` merges both). *(ref: 05 §1, §1.1, §6.1)*
- 🎨 **Frontend** — — none
- 🧪 **Test** — **segmentation property test** (the keystone): zh terminators, trailing quotes, mixed zh/en, exact offset round-trip. *(ref: 05 §10.1 Segmentation)*
- **Deps:** [E3.0] | **Est:** M

### Story E3.2 — As a user, I want to add a text/Markdown source by pasting it, so that I can ground answers without leaving the app.
- **Acceptance**
  - Given `POST /projects/{pid}/sources` with `kind=text|markdown`, When submitted, Then a `SourceView(status=pending)` returns and ingestion runs inline (small source) to `status=ready`.
  - Given Markdown, When parsed, Then headings become `sections` with `char_start/char_end` and the raw text is the canonical char space.
- 🔧 **Backend** — `ingest/parsers/text.py` → `ParsedDocument(text, sections, meta)`; `raw_ref` read via `BlobStore.get` (content-addressed `blob://sha256/...`); persist `Source` + `Chunk` rows. *(ref: 05 §2.5 text/markdown, §1 G4; 07 §2.3 source/chunk DDL, §7.4 BlobStore; 03 §2.2 POST /sources, §3.7 SourceCreate)*
- 🎨 **Frontend** — source sidebar "paste text/markdown" add affordance → lists `SourceView` with status. *(ref: 04 §8, §11 source sidebar)*
- 🧪 **Test** — contract: `POST /sources` → `Source(status=pending)`, terminal `ready`; parser unit: markdown headings → sections with valid spans. *(ref: 05 §10.2; 03 §8.1)*
- **Deps:** [E3.1, E3.4, E3.5, E6.5] | **Est:** M

### Story E3.3 — As a user, I want to paste a URL and have it fetched + extracted, and upload a PDF, so that I can ground on the web and documents (NotebookLM-parity).
- **Acceptance**
  - Given `POST /sources` with `kind=url`, When ingested, Then fetch → readability/Trafilatura → markdown is the canonical text; `origin` keeps the URL.
  - Given `POST /projects/{pid}/sources/upload` (multipart PDF), When parsed, Then text is extracted with **per-page char offsets** retained in `meta.page_map` and `Section.page` set for jump-to-page.
  - Given an unsupported kind, Then `UNSUPPORTED_SOURCE` (415); given parse failure, Then `INGEST_FAILED` (422).
- 🔧 **Backend** — `parsers/url.py` (fetch→readability→markdown) and `parsers/pdf.py` (pymupdf behind `SourceParser`, per-page offsets); single canonical `text` invariant. *(ref: 05 §2.5 url/pdf, §2.5 Key invariant; 07 §7.4 BlobStore; 03 §2.2 /sources/upload, §5.1 INGEST_FAILED/UNSUPPORTED_SOURCE)*
- 🎨 **Frontend** — sidebar "paste URL" + "upload PDF" affordances; failed status surfaces the error. *(ref: 04 §8, §11)*
- 🧪 **Test** — parser unit: PDF page_map offsets exact, URL extraction → canonical text; contract: `/upload` → `SourceView`; error envelope `UNSUPPORTED_SOURCE`/`INGEST_FAILED`. *(ref: 05 §10.1, §10.2; 03 §8.1)*
- **Deps:** [E3.1, E3.4, E3.5, E6.5] | **Est:** L

### Story E3.4 — As a developer, I want a heading-aware, sentence-snapped chunker, so that every cited sentence resolves precisely and big docs are fully covered.
- **Acceptance**
  - Given a `ParsedDocument`, When chunked, Then chunk boundaries snap to sentence boundaries (a cited sentence is always fully inside one chunk), overlap is honored, tiny tails merge into the previous chunk.
  - Given `respect_sections=True`, When chunked, Then no chunk merges across H1/H2 and **union of chunk spans ⊇ union of section spans** (coverage property).
  - Given chunks, Then `char_start/char_end` index the **SOURCE canonical text** (not chunk-local).
- 🔧 **Backend** — `chunking/chunker.py` recursive heading-aware impl using `segment_sentences`; CJK-aware token counting (`~1tok/1.6char` zh vs `~1tok/4char` en, or model tokenizer); `ChunkConfig` defaults. *(ref: 05 §3.2, §3.3, §6.2; 07 §2.3 chunk DDL C4 char offsets)*
- 🎨 **Frontend** — — none
- 🧪 **Test** — chunker unit: sentence-snap, overlap, `respect_sections` never crosses H1/H2, **coverage property** (Σ chunk spans ⊇ Σ section spans), tiny-tail merge. *(ref: 05 §10.1 Chunker)*
- **Deps:** [E3.1] | **Est:** M

### Story E3.5 — As a developer, I want embedding + a per-project-dim VectorIndex (with deterministic FAKE + flat fallback), so that retrieval is reproducible in CI and never hard-fails on a missing native extension.
- **Acceptance**
  - Given the FAKE embedder, When embedding identical text twice, Then vectors are identical (cache hit, no recompute) and resumable EMBED computes only the missing tail.
  - Given a project's `embedding_dim`/`embedder_id` recorded at **first ingest**, Then it is immutable thereafter and the VectorIndex table is keyed by that dim (`vec_chunks_{dim}`), never hardcoded `float[768]`.
  - Given `flat` and `sqlite_vec` over a fixture corpus, Then they return **identical ranking**; `project_id` filter prevents cross-project leakage; `delete_source` removes vectors.
- 🔧 **Backend** — `embedding/embedder.py` Protocol + registry, `providers.py` (multilingual bge-m3 default, API, **FAKE** seeded by `blake2s`), `cache.py` (content-hash); `index/{vector_index.py,sqlite_vec.py,flat.py}`; record `project.embedder_id/embedding_dim` on first ingest. *(ref: 05 §2.5 G5, §4.1, §4.2, §6.3; 07 §2.3 project G5 cols, §5.1/§5.2 SqliteVec/NumpyFlat, §5 G5)*
- 🎨 **Frontend** — — none
- 🧪 **Test** — VectorIndex contract (flat ≡ sqlite_vec ranking, project filter, delete_source); embedding cache hit + resumable tail. *(ref: 05 §10.1 VectorIndex/Embedding cache; 07 §9.2)*
- **Deps:** [E3.1] | **Est:** L

### Story E3.6 — As a thinker, I want retrieval to add source evidence without widening the branch moat, so that grounding never leaks sibling-branch thoughts into context.
- **Acceptance**
  - Given a grounded `/think`, When retrieval runs, Then the query text is built **only** from the node prompt + the resolved `BranchContext` (ancestor chain); `retrieve()` given a `BranchContext` **never** reads `NodeRepo` for siblings/children (assert via repo spy).
  - Given retrieved chunks, Then they are injected as a numbered `[S1]..[Sk]` grounding block in the **system/grounding slot** — ancestor conversational turns are unmodified and no fake turns are appended.
  - Given `is_grounded=false`, Then no retrieval/injection occurs.
- 🔧 **Backend** — `retrieve/{retriever.py,query.py}` (vector recall + flat fallback for MVP; grounding-block formatting with `GROUNDING_INSTRUCTIONS`); `assemble_messages` appends evidence to system slot only. *(ref: 05 §5.1, §5.2, §5.3 MVP vector-only)*
- 🎨 **Frontend** — — none (grounding-block is server-side; citation chips covered in E3.7)
- 🧪 **Test** — **isolation** unit: `retrieve()` never reads sibling nodes (repo spy); message-assembly keeps ancestor turns intact. *(ref: 05 §10.1 Isolation; 03 §8.2 moat at API boundary)*
- **Deps:** [E3.4, E3.5, E2.1] | **Est:** M

### Story E3.7 — As a thinker, I want grounded answer sentences to carry sentence-level citations mapping to exact source char spans (CJK-safe), so that every claim is auditable to the original (the P0 hard indicator).
- **Acceptance** (pure, no I/O, no model)
  - Given an answer with `[S2]`, When mapped, Then it cites chunk 2 and the quote span resolves to the exact **source** substring (`method="marker"`).
  - Given a paraphrase with no marker, Then it falls back to the supporting **source sentence** span (`method="lexical"`, confidence < direct quote); never a whole-chunk span.
  - Given a **zh direct quote**, Then the char span is exact after width-normalization (no off-by-N drift) — golden zh fixtures.
  - Given a bogus `[S#]` with ~0 overlap, Then confidence is **downgraded** (marker verified by alignment).
  - Given an uncited sentence, Then it is returned in the `inferred` set; and `source_text[char_start:char_end] ≈ quote` for every citation.
- 🔧 **Backend** — `citation/{mapper.py,align.py}`: `map_citations` (marker-primary + lexical/semantic fallback), `best_substring_span` (char-level LCS, CJK width-fold/zero-width strip), `best_chunk_by_alignment`, `dedupe_overlaps`; emit `CitationDraft{quote,char_start,char_end (SOURCE space),answer_span,confidence,method}`; persist as `Citation` rows post-`done`. *(ref: 05 §7.1 C4, §7.2, §7.3, §7.5, §6.5; 07 §2.3 citation DDL C4 dedicated cols; 03 §3.2 CitationRef)*
- 🎨 **Frontend** — — none (rendering in E3.8)
- 🧪 **Test** — **citation mapper** (heaviest, pure): marker path exact span, lexical paraphrase → source-sentence span, **CJK direct quote** exact span golden fixtures, marker-verification downgrade, uncited→`inferred` set, source round-trip. *(ref: 05 §10.1 Citation mapper)*
- **Deps:** [E3.1, E3.4, E3.6] | **Est:** L

### Story E3.8 — As a thinker, I want clickable citation chips on node answers (and trust styling) that jump to the original source span, so that I can verify a claim in one click.
- **Acceptance**
  - Given a grounded node answer with `?include=citations`, When rendered, Then sentence-level chips show the `quote` (Geist Mono); clicking opens the source at `char_start..char_end` (PDF page via `Section.page`).
  - Given `CitationRef.method` (`marker|lexical|semantic|none`), Then chip uses **method-based trust styling**; `answer_span` underlines the supported answer span.
  - Given an ungrounded answer, Then no chips render.
- 🔧 **Backend** — `CitationRef` on `NodeView` (only when grounded + `?include=citations`); `citation`-type `TokenEvent` mid-stream carries `CitationRef` shape; `GET /sources/{id}/chunks` for resolution. *(ref: 03 §3.2 CitationRef C4, §4.2 citation TokenEvent, §2.2 /sources/{id}/chunks)*
- 🎨 **Frontend** — citation chips in `NodeCard` body; `CitationPopover` "Jump to source"; method-driven trust styling; underline `answer_span`; source sidebar opens at offset. *(ref: 04 §5.4 node card citations, §8 citation chips/popover C4, §11 source sidebar)*
- 🧪 **Test** — browser smoke **M3**: grounded project → node answer shows chips → click jumps to source; component: chips render only when grounded, method styling, `char_start/end` resolve into SOURCE canonical text. *(ref: 04 §10.3 M3, §10.1 Draft/streaming rows)*
- **Deps:** [E3.7, E3.2] | **Est:** M

### Story E3.9 — As a user with sources, I want honesty marking so that uncited claims are flagged `inferred` and weak matches `weakly_grounded`, keeping even the ungrounded path trustworthy.
- **Acceptance**
  - Given a grounded sentence with `method∈{marker,lexical}` and conf≥τ, Then it is **grounded** (clickable).
  - Given a grounded project sentence with no supporting chunk, Then the mapper returns it in the uncited set → flagged **inferred** (handed to 01-*).
  - Given a low-confidence semantic match, Then **weakly_grounded** (dimmed, not a hard citation).
  - Given an ungrounded project, Then AI claims are **inferred** and user content is **user_judgment** — with **no retrieval running**.
- 🔧 **Backend** — `map_citations` returns `CitationDraft[]` **plus** the uncited-sentence set; `method="semantic"` low-conf → `weakly_grounded`; supplies supported/unsupported signal only (honesty enum + node flag owned by E2.21). *(ref: 05 §8 C13, §7.2; honesty vocabulary `user_judgment|inferred|grounded|weakly_grounded`)*
- 🎨 **Frontend** — render canonical `HonestyLabel` from codegen (no local vocabulary); weakly_grounded shown dimmed. *(ref: 04 §3.1 C13, §8 no-source mode)*
- 🧪 **Test** — mapper unit: uncited sentence → `inferred` set; low-conf semantic → `weakly_grounded`; zero-source path produces honesty labels without retrieval. *(ref: 05 §10.1 uncited sentence; 04 §10.1 Draft row)*
- **Deps:** [E3.7, E2.21] | **Est:** S

### Story E3.10 — As a user, I want to watch ingestion progress stream, so that I know a source is being processed and when it's ready.
- **Acceptance**
  - Given an inline (small) source ingest, When running, Then `Source.ingest_progress` advances monotonically through PARSE(0→.30)/CHUNK(.30→.45)/EMBED(.45→.95)/INDEX(.95→1.0) and the `SourceView` shows it.
  - Given `GET /sources/{id}/progress`, When subscribed, Then it emits canonical **`progress`** `TokenEvent`s (data `{ratio, stage, detail}`) — **no** `ingest_progress` event type — ending with terminal ready/failed.
  - Given re-ingest, When chunks change, Then affected citations get `details.stale=true` (shown as "source changed" badge, not broken).
- 🔧 **Backend** — `ingest/pipeline.py` (stages + monotonic progress, idempotent/resumable via chunk_key + embedding cache), `ingest/progress.py` bridges `IngestProgress`→`progress` TokenEvent; re-ingest replace-in-place + citation staleness. *(ref: 05 §2.1 C1, §2.2, §2.3, §7.4; 03 §2.2 /sources/{id}/progress C1, §4.2 progress TokenEvent; 07 §6 jobs/inline)*
- 🎨 **Frontend** — sidebar shows per-source progress bar + status; stale-source badge on affected citations. *(ref: 04 §8, §11)*
- 🧪 **Test** — contract: ingest emits `progress` `TokenEvent`s validating against schema (C1, `{ratio,stage,detail}`), terminal ready/failed; unit: progress monotonic, re-ingest flags citation `stale`. *(ref: 05 §10.2; 03 §8.2 SSE event-schema)*
- **Deps:** [E3.2, E3.4, E3.5, E3.7] | **Est:** M

---

## Epic E4 — Crystallize + Draft
**Milestone:** M4 | **Priority:** P0 | **Page:** Draft | **Goal:** Turn selected branches/nodes into a Voice-shaped, citation-preserving long-form draft — generated directly from branches or via an optional argument outline.

### Story E4.1 — As a writer, I want to promote selected nodes/branches into an argument outline deterministically, so that I have an editable, traceable argument skeleton without any model call.
- **Acceptance** — Given a branch with ≥1 node, When I `POST /branches/{head_node_id}/promote` with `node_ids`, Then a new `Outline` (or appended `OutlinePoint`s) is returned where each point's `text` = single-node annotation (or first sentence) / joined for multi-node, `source_node_ids` is dedup + order-preserving, and `narrative_role=None`; And no model is invoked (pure).
- 🔧 **Backend** — `build_outline_point` pure claim-seed extraction (single vs multi node), `source_node_ids` dedup; route creates new outline when `outline_id` null; `dead_end` nodes promotable. *(ref: 06 §2.3, §2.2; 03 §3.8 PromoteRequest, §2.2 Branches/promote)*
- 🎨 **Frontend** — "Promote to argument point" action on `promising` node in `NodeActions`; sends node id, reflects returned outline. *(ref: 04 §5.5)*
- 🧪 **Test** — unit: claim-seed single vs multi, dedup, purity/no-I/O; contract: `POST /branches/{id}/promote` + `POST /outlines/{id}/points` shape & error envelope; FAKE not needed (no model). *(ref: 06 §9 Unit; 03 §8.1)*
- **Deps:** [E2.10, E2.1] | **Est:** M

### Story E4.2 — As a writer, I want to reorder outline points and tag narrative roles, so that I control the argument's ordering before generation.
- **Acceptance** — Given an outline with N points, When I `POST /outlines/{id}/reorder { ordered_point_ids }`, Then `order_index` is reassigned dense 0..n in one transaction and is idempotent; And `PATCH /outline-points/{id}` can set `narrative_role` ∈ {cold_open|setup|turn|payoff|takeaway} as advisory metadata (roles not validated as a required sequence; a roleless outline is valid).
- 🔧 **Backend** — bulk reorder → dense `order_index` (pure permutation, server source of truth); `narrative_role` advisory only, no sequence validation in MVP; `point_order` removed from `OutlineUpdate`. *(ref: 06 §2.4; 03 §2.2 Outlines, §3.8 OutlineReorder/OutlinePointUpdate)*
- 🎨 **Frontend** — outline UI drag-to-reorder mapped to the reorder call; role tagging on points. *(ref: 04 §5.5; 06 §9 Frontend)*
- 🧪 **Test** — unit: permutation → dense `order_index`, idempotent; contract: `POST /outlines/{id}/reorder`; FE: drag-reorder maps to reorder call. *(ref: 06 §9 Unit/Frontend; 03 §8.1)*
- **Deps:** [E4.1] | **Est:** S

### Story E4.3 — As a writer, I want to generate a cited draft DIRECTLY from selected branch heads with NO outline, so that the outline is genuinely optional and the default path.
- **Acceptance** — Given selected branch head node ids and a `voice`, When I `POST /projects/{pid}/drafts` with `DraftGenerateRequest{ source_branch_node_ids:[…], outline_id:null, voice }`, Then tokens stream via SSE and the terminal `done` carries the new draft id + `DraftView` summary; And each selected branch head becomes a section (in selection order) via `branch_to_section` using `resolve_branch_context` so sibling branches never bleed into another section; And when both `outline_id` and `source_branch_node_ids` are set (or neither) the call fails with `DRAFT_SOURCE_AMBIGUOUS` (422) before any stream opens.
- 🔧 **Backend** — single streaming `generate_draft`: step-1 `branch_to_section` per head via `resolve_branch_context` (the moat); SSE `TokenEvent`; create+persist `Draft` at `done` boundary; XOR validation → `DRAFT_SOURCE_AMBIGUOUS`. *(ref: 06 §4.2 step 1/else-branch, §4.3; 03 §2.2 Drafts (C2), §3.9 DraftGenerateRequest, §4.5)*
- 🎨 **Frontend** — Draft surface: select branches → generate; stream into `DraftEditor`; refetch citation-anchored AST on `done`. *(ref: 04 §8 Editor; 04 §10.3 M4 smoke)*
- 🧪 **Test** — contract: `POST /projects/{pid}/drafts` with `outline_id=null` (NDJSON), assert `TokenEvent` schema + terminal `done` with draft id + citation summary; unit: `branch_to_section` — sibling material never leaks; error test: `DRAFT_SOURCE_AMBIGUOUS`; FAKE provider. *(ref: 06 §9 Unit/Contract; 03 §8.1/§8.2)*
- **Deps:** [E4.6, E4.5, E2.1] | **Est:** L

### Story E4.4 — As a writer, I want to generate the same-shape cited draft VIA an outline, so that I can use a crystallized ordering when I want one.
- **Acceptance** — Given an existing outline, When I `POST /projects/{pid}/drafts` with `DraftGenerateRequest{ outline_id:set, source_branch_node_ids:[], voice }`, Then each `OutlinePoint` (ordered, with role) becomes a section via `outline_point_to_section`, and steps 2–6 (marker injection, Voice, mapping, persist) are byte-identical to the direct path — producing the same `Draft` shape with citations preserved; And `Draft.source_branch_node_ids` = union of point `source_node_ids`.
- 🔧 **Backend** — step-1 `outline_point_to_section` (ordered, roled) feeding the shared steps 2–6; only step 1 differs from E4.3. *(ref: 06 §4.2 if-branch, §1 two-entry-edge table; 03 §3.9)*
- 🎨 **Frontend** — generate-from-outline entry on Draft surface (outline_id path); same editor/citation rendering. *(ref: 04 §8)*
- 🧪 **Test** — contract: `POST /projects/{pid}/drafts` with `outline_id` set; unit: `outline_point_to_section` uses `resolve_branch_context`, no sibling leak; assert both paths yield identical `Draft` shape; FAKE. *(ref: 06 §9 Unit/Contract; 03 §8.1)*
- **Deps:** [E4.1, E4.2, E4.6, E4.5] | **Est:** M

### Story E4.5 — As a writer, I want Voice presets (academic/casual/professional) to change the DRAFT output, so that the draft reads in my chosen register — the edge over chat-only personas.
- **Acceptance** — Given a `VoiceTone`, When the draft system prompt is built (`build_voice_system_prompt`), Then for ACADEMIC it contains the hedge/citation-forward/third-person directives, CASUAL the first-person/short-sentence directives, PROFESSIONAL the confident/declarative directives, AND every voice contains the constant marker rule "Preserve every [#c{id}] marker… never invent markers."; And `citation_density` differs by voice (high/low/medium) while no voice drops a citation row; And default voice = `Project.voice_default` (fallback `professional`); And there is NO `voice` field on `ThinkRequest` (Voice is draft-only).
- 🔧 **Backend** — `VOICE_SPECS` table + `build_voice_system_prompt`; inject into draft gen system prompt (structure/hedging/person/rhythm), not a post-filter; `citation_density` modulates phrasing only; G6 — never applied to `/think`. *(ref: 06 §4.4 incl. contract-freeze G6; 03 §3.3 ThinkRequest no-voice note)*
- 🎨 **Frontend** — `VoiceSelector` with the 3 exact prototype preset labels on the draft surface; changing voice + regenerate sends `voice` in `DraftGenerateRequest`. *(ref: 04 §8 Voice selector)*
- 🧪 **Test** — unit (deterministic, FAKE): each `VoiceTone` → system prompt contains its directives + constant marker rule; `citation_density` differs but no voice drops markers; smoke asserts Voice applied via system-prompt assertion; FE: selector renders 3 presets & sends `voice`. *(ref: 06 §9 Unit "Voice", §8 step 5; 04 §10.1 Draft)*
- **Deps:** [E4.3, E12.5] | **Est:** M

### Story E4.6 — As a writer, I want sentence-level citations carried from node answers into the draft and surfaced as clickable chips, so that the P0 grounded-citation promise survives into output.
- **Acceptance** — Given node-answer citations on the source material, When the draft is generated, Then cited sentences are injected with stable `[#c{id}]` markers, and after generation each real marker yields a NEW draft-scoped `Citation` (same chunk/source/quote/offsets) with a well-formed `draft_anchor` (`{block_id}:{char_offset}`) while the original node citation is untouched; And markers the model invented are dropped into `Draft.uncited_claims` (never faked); And ungrounded source → `Draft.grounded=False`, no citations, no fabrication; And clicking a draft citation chip resolves a `weaver://source/{source_id}#char={char_start}-{char_end}` deep link to the source original.
- 🔧 **Backend** — `assemble_material_with_markers` + `map_markers_to_citations`; create draft-scoped Citation rows (node row immutable); `draft_anchor` block-id+offset; in-scope marker validation drops hallucinations → `uncited_claims`; `grounded`/`uncited_claims` server-derived (never request fields). *(ref: 06 §3.1–3.4, §4.2 steps 2/5; 03 §3.9 CitationAnchor/DraftView (C4/C6))*
- 🎨 **Frontend** — clickable sentence citation chips in `DraftEditor` → `CitationPopover` with `quote` (Geist Mono) + "Jump to source"; underline `answer_span`; `method`-based trust styling; render `grounded` banner + `uncited_claims` panel; ungrounded → no chips, `HonestyLabel` marking. *(ref: 04 §8 Citations/Grounded state/No-source mode (C4/C6/C13))*
- 🧪 **Test** — unit (the spine): node citation → draft citation same chunk/source/quote/offsets; `draft_anchor` well-formed + survives a block edit (fuzzy re-anchor) reporting unmatched rather than losing; hallucinated markers → `uncited_claims`; original node citation untouched; FE: chip click opens popover (offsets into SOURCE canonical text), `grounded=false` shows no chips + renders `uncited_claims`; FAKE. *(ref: 06 §9 Unit "Citation carry-through"/"draft_anchor"; 04 §10.1 Draft)*
- **Deps:** [E3.7, E4.3] | **Est:** L

### Story E4.7 — As a writer, I want to read and manually edit the generated draft, so that the AI draft is a starting point I refine.
- **Acceptance** — Given a generated draft, When I `GET /drafts/{id}`, Then I receive the body AST + preserved `citations` (`CitationAnchor[]`) + `grounded` + `uncited_claims`; And When I `PATCH /drafts/{id}` with edited `body`/`voice`/`format`, Then changes persist and untouched blocks keep their `block_id` (citations on edited blocks re-anchored best-effort, unmatched surfaced as "失效引用" not silently lost).
- 🔧 **Backend** — `GET /drafts/{id}` (DraftView) + `PATCH /drafts/{id}` (DraftUpdate, block-level); preserve `block_id` on untouched blocks; re-anchor citations on edited blocks. *(ref: 06 §3.3, §4.1; 03 §2.2 Drafts GET/PATCH, §3.9 DraftUpdate/DraftView)*
- 🎨 **Frontend** — long-form `DraftEditor` rich-text over the AST; save via `PATCH /drafts/:id`. *(ref: 04 §8 Editor)*
- 🧪 **Test** — contract: `GET /drafts/{id}` + `PATCH /drafts/{id}` shapes & `DRAFT_NOT_FOUND`; unit: `draft_anchor` re-anchor on block edit (reuse E4.6 case). *(ref: 06 §9 Unit; 03 §8.1)*
- **Deps:** [E4.3, E4.6] | **Est:** M

### Story E4.8 — As a writer, I want an AI-proposed outline skeleton (P1, stubbed), so that the route exists forward-compatibly without MVP behavior.
- **Acceptance** — Given the P1 boundary, When `POST /projects/{pid}/outline/propose` is called in MVP, Then it is gated off (`features.structure_templates`/propose not enabled) and the contract shape (`OutlineProposeRequest` → SSE `TokenEvent`, terminal `done` `proposals[]`) is reserved; the deterministic promote (E4.1) remains the only MVP crystallize path. (Implementation is a stub only — full `propose_outline` with `validate_and_clamp` is P1, delivered in E7.5.)
- 🔧 **Backend** — stub route + `OUTLINE_PROPOSAL_SCHEMA` reserved; `validate_and_clamp` rejecting out-of-scope `source_node_ids` is P1 (E7.5), not built here. *(ref: 06 §2.5 (P1); 03 §2.2 Outlines propose row (P1, C8))*
- 🎨 **Frontend** — — none (gated; promote UI from E4.1 is the MVP affordance). *(ref: 04 §11 feature gating G3)*
- 🧪 **Test** — contract: route is registered and feature-gated/returns the reserved shape (no model behavior asserted in MVP). *(ref: 03 §8.1)*
- **Deps:** [E4.1] | **Est:** S

---

## Epic E5 — Export
**Milestone:** M5 | **Priority:** P0 | **Page:** Draft | **Goal:** Export a draft to citation-preserving Markdown and prove the full think → branch → (optional crystallize) → draft → export loop end to end.

### Story E5.1 — As a writer, I want to export my draft to Markdown with citations preserved as deep-linked footnotes, so that my grounded output survives outside the app.
- **Acceptance** — Given a generated draft, When I `POST /drafts/{id}/exports { target:"markdown" }`, Then an `Export` is materialized with `citations_preserved=True` and a content-addressed `payload_ref` (`blob://sha256/…`) via the `BlobStore`; And the rendered Markdown serializes inline citations to GitHub-style footnotes each carrying the `quote`, a human source label, and a `weaver://source/{source_id}#char={char_start}-{char_end}` deep link; And the footnote count equals the count of draft-scoped citations; And `GET /exports/{id}/download` returns the bytes with `text/markdown` content-type.
- 🔧 **Backend** — `export_markdown`: `render_ast_to_markdown(citation_style="footnote")` + `append_citation_footnotes` from `citation_repo.for_draft`; `blob.put(...)`; `POST /drafts/{id}/exports`, `GET /exports/{id}`, `GET /exports/{id}/download`. *(ref: 06 §5.1, §5.2; 03 §2.2 Exports, §3.10 ExportCreate/ExportView)*
- 🎨 **Frontend** — export action on Draft surface → download; (Markdown only — PNG/SVG/DOCX are P1 in E9.5). *(ref: 04 §10.3 M5; 04 §11 PNG/SVG P1)*
- 🧪 **Test** — contract: `POST /drafts/{id}/exports` (markdown) asserts `citations_preserved` + footnote/citation count parity; grounded: each footnote has a resolvable `weaver://source` deep link; `DRAFT_NOT_FOUND`; FAKE. *(ref: 06 §5.2, §9 Contract; 03 §8.1)*
- **Deps:** [E4.6, E4.7, E6.5] | **Est:** M

### Story E5.2 — As the team, I want an end-to-end smoke test exercising both draft paths through export, so that "outline optional" and citation-preservation are regression-guarded.
- **Acceptance** — Given the FAKE provider, When the smoke runs: create project → add node → FAKE answer (grounded variant: 1 source + citation) → fork into 2 branches + a node each → **path A** generate draft directly from the 2 branch heads AND **path B** promote 2 nodes → outline → reorder → generate via outline → export Markdown, Then both drafts have Voice applied (system-prompt assertion) and, when grounded, preserve ≥1 citation with a valid `draft_anchor`; And exported footnote count == draft citation count; And (grounded) each footnote has a resolvable `weaver://source` deep link. No test reaches a real model.
- 🔧 **Backend** — HTTP-level smoke per 03 §8.4 mirroring the loop; both draft paths exercised. *(ref: 06 §8 (steps 1–7); 03 §8.4)*
- 🎨 **Frontend** — Playwright M5 browser smoke: export Markdown, citations present in output; full think → branch → (optional crystallize) → draft → export. *(ref: 04 §10.3 M5)*
- 🧪 **Test** — smoke (per-milestone) exercising both paths with FAKE; assert Voice applied, citation + `draft_anchor` preserved, footnote parity, deep-link resolvable. *(ref: 06 §8, §9 Smoke; 03 §8.4; 04 §10.3)*
- **Deps:** [E4.3, E4.4, E4.5, E4.6, E5.1] | **Est:** M

---

## Epic E6 — Deployment & ops
**Milestone:** M6 | **Priority:** P1 | **Page:** — | **Goal:** Make Weaver self-hostable: Docker Compose (SQLite default + Postgres/pgvector profile), production env template, backup/restore, the jobs runtime, and the content-addressed blob store. *(ref: README §M6; 07 §6, §7, §8)*

> **Note:** E6.5 (jobs runtime + blob store) is an upstream dependency of M3 grounding (sources need the blob store at E3.2/E3.3 and async ingest at E3.10). Schedule E6.5 early — alongside M1 — even though the rest of E6 lands at M6.

### Story E6.1 — As a self-hoster, I want a Docker Compose stack (SQLite default), so that `docker compose up` runs the whole app with zero external deps.
- **Acceptance**
  - Given `tooling/docker/docker-compose.yml` default profile, When `docker compose up`, Then `api` (uvicorn) and `web` (Next.js) start; `api` entrypoint runs `alembic upgrade head` then serves; `web` waits on `api` healthcheck.
  - Given the running stack, Then `GET /api/v1/health` is green and one named volume `weaver-data` holds DB + blobs + secrets.
  - Given a restart, Then migrations re-run idempotently (no error on already-migrated DB).
- 🔧 **Backend** — `docker-compose.yml`, `api.Dockerfile`, `web.Dockerfile`, entrypoint (`alembic upgrade head` + uvicorn); healthcheck. *(ref: 07 §7.1)*
- 🎨 **Frontend** — `web` service env `NEXT_PUBLIC_API_BASE`; production build in Dockerfile. *(ref: 07 §7.1)*
- 🧪 **Test** — deploy smoke (M6): `docker compose up` default → `/health` green → create project → add node → FAKE draft → export Markdown (run with `MODEL_MODE=fake`). *(ref: 07 §9.4 deploy smoke)*
- **Deps:** [E1.1, E1.2] | **Est:** M

### Story E6.2 — As a self-hoster, I want a production env template, so that I can configure persistence, auth, secrets, and model mode by copying one file.
- **Acceptance**
  - Given `tooling/docker/.env.example`, Then it documents `DATABASE_URL`, `VECTOR_BACKEND`, `WEAVER_DATA_DIR`, `EMBEDDING_DIM` (default-for-new-projects), `WEAVER_BEARER_TOKEN`, `SECRET_STORE`/`SECRET_STORE_PATH`, `MODEL_MODE`, `POSTGRES_PASSWORD`.
  - Given a copied `.env` with `MODEL_MODE=fake`, When the stack starts, Then the FAKE provider is forced.
  - Given no `WEAVER_BEARER_TOKEN`, Then startup refuses (required for single-user auth).
- 🔧 **Backend** — `.env.example` with documented defaults; config loader enforces required `WEAVER_BEARER_TOKEN`. *(ref: 07 §7.2; 03 §6 auth)*
- 🎨 **Frontend** — — none
- 🧪 **Test** — unit: config loader applies documented defaults and raises on missing bearer token; `MODEL_MODE=fake` selects FAKE. *(ref: 07 §7.2; 02 §8)*
- **Deps:** [E6.1, E0.6] | **Est:** S

### Story E6.3 — As a self-hoster, I want the Postgres + pgvector swap proven, so that I can scale beyond SQLite with no app-code change.
- **Acceptance**
  - Given `--profile postgres` with `DATABASE_URL=postgresql+asyncpg://…` and `VECTOR_BACKEND=pgvector`, When started, Then the `db` (pgvector image) service comes up, migrations apply (guarded `CREATE EXTENSION vector`), and the app runs unchanged.
  - Given the parametrized repo + vector test suite, Then it passes on both SQLite and a Postgres container (same assertions).
  - Given the `VectorIndex` interface, Then `PgVectorIndex` and `SqliteVecIndex`/`NumpyFlatIndex` are selected by `VECTOR_BACKEND` with no service-code branch on dialect.
- 🔧 **Backend** — `db` compose profile; pgvector migration guard; `VectorIndex` impls + factory keyed off `VECTOR_BACKEND`; per-project dim handling (`vec_chunks_{dim}`). *(ref: 07 §4.2, §4.4 guarded extension, §5, §7.1 postgres profile)*
- 🎨 **Frontend** — — none
- 🧪 **Test** — parametrized `db=[sqlite,postgres]` repo CRUD + ancestor-chain≡moat cross-check; vector contract suite over all three impls (upsert→query nearest→filter→delete). *(ref: 07 §9.1, §9.2)*
- **Deps:** [E6.1, E1.1] | **Est:** L

### Story E6.4 — As a data owner, I want backup/restore + project-JSON export, so that my thinking data is portable and never trapped.
- **Acceptance**
  - Given `make backup`, Then SQLite `VACUUM INTO` produces a consistent file (WAL checkpointed) and a tarball bundling `blobs/` (secrets excluded unless `--with-secrets`).
  - Given `make restore FILE=…`, Then stop→replace `weaver.db`+`blobs`→start auto-upgrades schema and data is identical.
  - Given `GET /projects/{id}/export?format=json`, Then a self-describing JSON of forest/relations/sources-metadata/outlines/drafts/citations is returned.
- 🔧 **Backend** — `make backup`/`make restore` wrappers; project-JSON export route serializing the aggregate. *(ref: 07 §8.1–8.4)*
- 🎨 **Frontend** — — none (export reachable via API; UI optional)
- 🧪 **Test** — round-trip: backup → restore → assert data identical (run under `MODEL_MODE=fake`); content-addressed blob restore is idempotent; project-JSON export validates as self-describing. *(ref: 07 §9.4 backup/restore smoke; §7.4)*
- **Deps:** [E6.1, E6.5] | **Est:** M

### Story E6.5 — As a self-hoster, I want the jobs runtime + content-addressed blob store, so that ingestion can run async/resumably and raw payloads dedupe.
- **Acceptance**
  - Given the `job` table + `InProcessJobRunner`, When `submit(kind, subject_id)` is called twice for the same live subject, Then the same live job is returned (idempotent, `ux_job_live`).
  - Given a handler that fails midway leaving a `cursor`, When re-run, Then it resumes without duplicating chunks/vectors; a job stuck in `running` is re-queued by the startup sweep.
  - Given `BlobStore.put(data)`, Then a `blob://sha256/<hex>` ref is returned, identical payloads dedupe, and blobs live on-disk under `WEAVER_DATA_DIR/blobs/` (included in backups).
- 🔧 **Backend** — `weaver_core/persistence/jobs.py` (`Job` model, `JobRepo`, `InProcessJobRunner`, crash-recovery sweep); `weaver_core/persistence/blobs.py` (`BlobStore` Protocol + `FileBlobStore`). *(ref: 07 §6.1–6.2, §7.4; §2.3 job DDL)*
- 🎨 **Frontend** — — none
- 🧪 **Test** — jobs: idempotent submit, resumability (chunk-count stable on re-run), crash recovery re-queue; blob store: dedupe + idempotent restore. *(ref: 07 §9.3; §7.4)*
- **Deps:** [E1.1] | **Est:** M

---

## Epic E7 — Advanced thinking
**Milestone:** Post-MVP (P1) | **Priority:** P1 | **Page:** Thinking Tree | **Goal:** Turn the isolated tree into a comparable, connectable, AI-stress-tested thinking surface — compare branches side-by-side, link/merge across branches, and let AI mark gaps/counterexamples and propose an outline skeleton without ever widening the moat.

### Story E7.1 — As a deep thinker, I want to put two branches side-by-side, so that I can compare two reasoning lines without scrolling between them.
- **Acceptance** Given two selected nodes/branch-heads, When I open Compare, Then a read-only side-by-side panel renders each branch's ancestor path (root→…→head), scroll-synced where depths align; Given >2 selected, Then selection is capped at 2; Given the panel is open, Then neither branch's context is recomputed client-side (paths come from the server branch read-model).
- 🔧 **Backend** — expose branch read-models for two heads as derived value objects via `resolve_branch_context` per head (no `BranchRepo`; branch is derived); return ordered chains for A and B. *(ref: 01 §2.2, §4.1 compare row, §5)*
- 🎨 **Frontend** — `components/compare/ComparePanel`; selection from `FocusStore.selection` (max 2); fetch each branch read-model; side-by-side scroll-synced render; gate behind `features.compare`. *(ref: 04 §7.1, §11 G3)*
- 🧪 **Test** — unit: selection cap=2; e2e (FAKE): select two branch heads → compare renders both ancestor paths, sibling of A absent from B's column. *(ref: 04 §10.1, §10.3)*
- **Deps:** [E2.12, E2.20] | **Est:** M

### Story E7.2 — As a thinker, I want to draw cross-branch relation links (汇合/相通/反例), so that I can record how separate branches connect without breaking the tree.
- **Acceptance** Given two nodes, When I drag from one's relation-handle to another and pick a kind (`merge|connection|contradiction`), Then a `Relation` is created as an additive overlay; Given any relations exist, When I remove all of them, Then `NodeForest.build` yields a byte-identical tree (no `parent_id`/`order_index` touched); Given a relation exists, Then `resolve_branch_context` output is unchanged for every node.
- 🔧 **Backend** — `relations/ops.py` validate (`NODE_NOT_FOUND`/`SELF_RELATION`, additivity I8); `relation_service` add/list/remove; never mutate `parent_id`; `created_by` user vs ai. *(ref: 01 §6, §3 I3/I8)*
- 🎨 **Frontend** — `RelationOverlay.tsx` Layer 2 dashed/curved connectors using existing `LayoutResult` coords; kind drives style (solid join / dashed / red opposed); drag-to-create → `POST /relations`; overlay must not alter layout; gate behind `features.relations`. *(ref: 04 §4.3, §7.2)*
- 🧪 **Test** — unit (no model): T-REL-1 validation, T-REL-2 additivity (remove-all → identical forest), T-CTX-10 relations invisible to moat; component: overlay renders without shifting layout coords. *(ref: 01 §11.3, §11.1)*
- **Deps:** [E2.20] | **Est:** M

### Story E7.3 — As a thinker, I want AI to merge two branches' insights into a new synthesized node, so that a convergence (汇合) becomes a real node I can keep building from.
- **Acceptance** Given two branches I select to merge, When I trigger "合并这两枝洞察", Then AI synthesizes new content from each branch's *own* resolved context (no cross-branch bleed), Then the result commits as an ordinary `fork` child under one parent (single parent, I3) plus a `connection`/`merge` Relation to the other branch; Given I dismiss, Then nothing is persisted.
- 🔧 **Backend** — synthesis is upstream structured generation fed per-branch `resolve_branch_context` for each head; commit via pure `tree.fork` (kind=ai_reasoning) + `add_relation`; synthesized node has exactly one `parent_id`. *(ref: 01 §4.2, §6 merge-vs-context-merge, Open Q #4)*
- 🎨 **Frontend** — "Merge these two" affordance on a relation/two-selection; preview → Accept commits fork+relation. *(ref: 04 §7.2, §5.5 promote pattern)*
- 🧪 **Test** — contract (FAKE): merge → child fork created (single parent) + relation row; assert each input branch's material excludes the other sibling. *(ref: 01 §11.5 smoke; 02 §7.3 relation/structured reuse)*
- **Deps:** [E7.2, E2.17] | **Est:** M

### Story E7.4 — As a thinker, I want AI to mark gaps and counterexamples on my branches, so that I can see the weak points of my argument.
- **Acceptance** Given a branch, When I run an AI gap/counterexample scan, Then AI (purpose=`relation_scan`, structured) returns proposals scoped to in-branch nodes only; Given a counterexample proposal, Then accepting creates a `contradiction` relation (or a flagged node), `created_by="ai"`; Given the scan sees only the node's ancestor chain, Then no proposal can reference a sibling branch; nothing persists until accepted.
- 🔧 **Backend** — `relation_scan` structured generation over `ModelProvider.generate` fed `resolve_branch_context`; `RelationProposal` schema; `validate_and_clamp` rejects out-of-scope node ids; accept → `add_relation(kind=contradiction)`. *(ref: 02 §7.3; 01 §6 RelationKind, §12 P1)*
- 🎨 **Frontend** — gap/counterexample markers on nodes; "AI suggested" badge until confirmed (mirrors AI-discovered relation styling); gate behind `features.relations`. *(ref: 04 §7.2)*
- 🧪 **Test** — unit: clamp rejects invented/out-of-scope ids; contract (FAKE): scan → schema-valid proposals → accept creates contradiction relation; isolation: scan never reads sibling nodes (repo spy). *(ref: 02 §9, §7.3; 05 §10.1 isolation pattern)*
- **Deps:** [E7.2, E2.17] | **Est:** M

### Story E7.5 — As a writer, I want AI to propose an ordered outline skeleton from my selected branches, so that I get a first-pass argument structure I can edit.
- **Acceptance** Given selected branch heads, When I request an outline proposal, Then AI returns ordered points each with `text` + `source_node_ids` (+ optional `narrative_role`), built from per-branch resolved contexts so sibling assumptions cannot blend; Given the model invents a `source_node_id` not in the selected set, Then it is rejected; Given I accept, Then each accepted spec commits through the pure `promote_to_point`.
- 🔧 **Backend** — `crystallize/propose.py::propose_outline` with `OUTLINE_PROPOSAL_SCHEMA`; `resolve_branch_context` per head; `validate_and_clamp(allowed_node_ids)`; accept → pure `promote_to_point`; route `POST /projects/{id}/outline/propose` (SSE) — fills in the E4.8 stub. *(ref: 06 §2.5 (C8); 01 §7.2 AI skeleton)*
- 🎨 **Frontend** — accept/edit proposed points UI on outline surface; reorder reflects server; gate behind P1 flag. *(ref: 06 §10; 04 §5.5 promote)*
- 🧪 **Test** — unit: clamp drops out-of-scope ids; FAKE structured `done.structured` validates schema; contract: propose route SSE → schema-valid points. *(ref: 06 §9; 02 §8 FAKE structured)*
- **Deps:** [E4.1, E4.8, E2.17] | **Est:** M

### Story E7.6 — As a writer, I want a narrative/logic-jump check on my outline, so that I'm warned when the argument ordering is unconvincing.
- **Acceptance** Given an outline with narrative roles, When I run the narrative check, Then it warns on weak ordering (e.g. payoff before setup, logic jumps) but never blocks; Given roles are absent, Then the check still runs and the outline stays valid; warnings are advisory only.
- 🔧 **Backend** — narrative/logic-jump check over outline points + narrative roles (advisory; roles are soft hints, not enforced); reuse structured generation where AI-assisted. *(ref: 06 §2.4 (roles feed P1 narrative check), §11 P1; 01 §7.2)*
- 🎨 **Frontend** — non-blocking warning strip on outline (e.g. "payoff before setup"); dismissible. *(ref: 06 §2.4; 04 §11 P1 outline)*
- 🧪 **Test** — unit: weak ordering (payoff<setup) yields a warning, never raises; no-roles outline passes; FAKE for any AI-phrased warnings. *(ref: 06 §9 voice/role determinism pattern; 01 §11.3 T-CRYS-5 soft rule)*
- **Deps:** [E7.5] | **Est:** S

---

## Epic E8 — Capture & rich sources
**Milestone:** Post-MVP (P1) | **Priority:** P1 | **Page:** Sources / Thinking Tree | **Goal:** Extend optional grounding beyond MVP paste/URL — a browser-extension capture, video/podcast transcription, reading-view highlights as start nodes, and full chunked coverage of large documents with visible progress — all feeding the same canonical-text/citation pipeline without widening the moat.

### Story E8.1 — As a researcher, I want a browser extension to capture pages into a project, so that I can grab sources while reading without leaving the page.
- **Acceptance** Given the extension on a page, When I capture, Then it posts the URL/cleaned content into the same ingestion path as MVP URL-grab (readability→markdown→canonical text), Then a `Source` is created (status=pending→ready) with progress; Given the same URL is captured twice, Then ingestion is idempotent (content-addressed `raw_ref`, stable chunk keys).
- 🔧 **Backend** — reuse `parsers/url.py` + `BlobStore` `raw_ref`; extension feeds the *same* URL/text path (no new parser); ingest via `GroundingService.ingest_source`. *(ref: 05 §2.5 (browser-extension capture feeds same url/text path), §1 G4)*
- 🎨 **Frontend** — browser-capture intake UI; capture confirmation + progress in Sources sidebar; gate behind `features.browser_capture`. *(ref: 04 §11 P1 (browser-capture intake UI), G3)*
- 🧪 **Test** — contract: capture → `Source(status=pending)` → SSE `progress` TokenEvents (not `ingest_progress`) → `ready`; idempotent re-capture reuses cached chunks. *(ref: 05 §10.2, §2.3; 02 §1.2 C1 progress)*
- **Deps:** [E3.3, E3.1] | **Est:** M

### Story E8.2 — As a researcher, I want to import video/podcast transcripts, so that I can ground my thinking in audio/video sources with deep links to timecodes.
- **Acceptance** Given a video/audio source, When ingested, Then transcription produces timestamped text into the canonical char space, Then chunks carry timecode in `Chunk.section`; Given a grounded answer cites a transcript span, Then the citation deep-links to `t=` (timecode); offsets index the source canonical text.
- 🔧 **Backend** — video/audio `SourceParser` (whisper-class) → timestamped `ParsedDocument`; `Chunk.section` carries timecode; citations resolve to `t=`; runs through same chunk/embed/citation pipeline. *(ref: 05 §2.5 (video/audio P1), §11 (video/podcast transcription → timecoded chunks/citations))*
- 🎨 **Frontend** — media-source import UI; citation popover "jump to source" resolves timecode; gate behind `features.media_transcription`. *(ref: 04 §8 citations, §11 P1)*
- 🧪 **Test** — unit: transcript parser emits exact char offsets + timecode in section; citation mapper resolves span→timecode; FAKE embedder. *(ref: 05 §10.1 segmentation/mapper, §10.3)*
- **Deps:** [E3.3, E3.7] | **Est:** L

### Story E8.3 — As a reader, I want to turn a highlight in the reading view into a start node, so that an excerpt I care about seeds a new branch.
- **Acceptance** Given text highlighted in the reading view, When I "send to tree", Then a new root/start `ThoughtNode` is created (via `fork` with `parent_id=null` or under a chosen node) seeded with the highlight content; Given the source is grounded, Then the start node carries provenance to the highlighted span; the highlight remains in the source.
- 🔧 **Backend** — highlight → `ForkSpec(parent_id=None or chosen)` start node; preserve highlight provenance (source span) for later citation. *(ref: 01 §4.2 fork new root, §4.1; 05 §11 (reading view highlight → start node))*
- 🎨 **Frontend** — reading-view (depends on a Sources reading surface) highlight affordance → "start node"; reflects new node on tree; gate behind P1 flag. *(ref: 04 §11 P1 (reading-view highlights → start node); PRD §4.1 P1)*
- 🧪 **Test** — unit: highlight → fork creates start node with seeded content + source provenance; e2e (FAKE): highlight → node appears as tree root. *(ref: 01 §11.2 T-TREE-2 new root; 04 §10.3)*
- **Deps:** [E3.3, E2.10] | **Est:** M

### Story E8.4 — As a researcher, I want large documents fully processed with visible progress, so that nothing is silently dropped and I can watch ingestion of a big PDF.
- **Acceptance** Given a doc above the inline token budget, When imported, Then an in-process async job ingests it (jobs table: status/progress/error) with streamed progress; Given a large doc, Then every section is chunked (coverage: union of chunk spans ⊇ union of section spans — nothing dropped); Given the job dies mid-embed, Then re-running resumes (cached vectors, only missing tail recomputed).
- 🔧 **Backend** — `choose_mode` routes large docs to `asyncio` job + `jobs` table; `respect_sections=True` full-coverage chunking; MMR section diversification; embedding cache + stable chunk keys for resumability. *(ref: 05 §2.4 (in-process job P1), §3.2 (respect_sections coverage), §2.3 (resumability), §5.3 (MMR P1), §11)*
- 🎨 **Frontend** — big-doc job progress UI (poll/stream); gate behind `features.big_doc_jobs`. *(ref: 04 §11 P1; 05 §2.1 progress over SSE)*
- 🧪 **Test** — unit: coverage property (Σ chunk spans ⊇ Σ section spans); resumable EMBED computes only missing tail (cache hit); contract: job → SSE `progress` TokenEvents → ready/failed. *(ref: 05 §10.1 (chunker coverage, embedding cache), §10.2)*
- **Deps:** [E3.4, E3.5, E6.5] | **Est:** L

---

## Epic E9 — Multi-format output
**Milestone:** Post-MVP (P1) | **Priority:** P1 | **Page:** Draft | **Goal:** Derive Deck / X-Thread / Newsletter / Video-script / Email — plus paragraph-level AI ops and PNG/SVG tree/outline export — all from the SAME Draft so emphasis stays consistent (the anti-NotebookLM bet).

### Story E9.1 — As a creator, I want to derive multiple formats from one draft, so that every output stresses the same claims in the same order.
- **Acceptance** (Given/When/Then): Given a persisted `Draft` D, When I `POST /drafts/{id}/artifacts` for `article`, `deck`, and `x_thread`, Then each returned `Artifact` shares D's `derived_from_hash`, and an in-scope assertion holds — no artifact contains a claim/`source_node_id` absent from D. Given two formats derived from the same D, Then their ordered claim set is identical (theme-consistency test).
- 🔧 **Backend** — add `ArtifactRenderer` Protocol + per-format registry keyed by `ArtifactFormat`; each renderer reshapes the one `Draft` (never re-researches) and stamps `derived_from_hash`; enforce the §2.5 in-scope check inside the transform; *(ref: 06 §7.1/§7.3; 08 §2.3)*
- 🎨 **Frontend** — multi-format preview switcher (article/deck/x_thread/...) reading from one source; exhaustive-switch over `ArtifactFormat` (TS compile guard for new formats); *(ref: 04 multi-format preview UI)*
- 🧪 **Test** — unit: in-scope check rejects an invented `source_node_id`; **theme-consistency** assert two formats from one Draft share `derived_from_hash` + identical ordered claim set (FAKE provider); contract: `POST /drafts/{id}/artifacts` (SSE) vs OpenAPI + error envelope; *(ref: 06 §9; 08 §5)*
- **Deps:** [E4.x draft generation, E4.x citation carry-through] | **Est:** L

### Story E9.2 — As a creator, I want each format to reshape narrative roles and carry citations where the format allows, so that derived outputs stay grounded and well-structured.
- **Acceptance**: Given a roled Draft, When I derive `video_script`, Then roles map `cold_open→hook, setup→context, turn→tension, payoff→reveal, takeaway→CTA`. Given a footnote-capable format (article/newsletter/email/docx), Then draft citations carry through as footnotes; Given x_thread/deck, Then a trailing "sources" block is attached (citation count parity with source where supported).
- 🔧 **Backend** — renderers consume `NarrativeRole` scaffold; citation routing per-format (footnote vs sources-block); never fabricate citations; *(ref: 06 §7.3; 08 §2.3)*
- 🎨 **Frontend** — render deck slides + speaker notes, thread items, video beats; show sources block for non-footnote formats; *(ref: 04 multi-format preview UI)*
- 🧪 **Test** — unit: role→beat mapping for video_script; footnote-format preserves citation count, x_thread emits sources block; no fabricated citation rows (FAKE); *(ref: 06 §9)*
- **Deps:** [E9.1, E4.x narrative roles] | **Est:** M

### Story E9.3 — As a creator, I want stale artifacts flagged when the source draft changes, so that derivation provenance is explicit and never silently overwrites my edits.
- **Acceptance**: Given an `Artifact` whose source Draft's current hash ≠ the artifact's `derived_from_hash`, When I open it, Then it is flagged **stale** ("源已更新，重新派生"). Given staleness, Then regeneration is explicit (user-initiated), never automatic.
- 🔧 **Backend** — `derived_from_hash = sha256(canonical_source_repr)` over ordered claim text + citation ids + voice; staleness compare on read; *(ref: 06 §7.2)*
- 🎨 **Frontend** — stale-Artifact badge + explicit "重新派生" action; *(ref: 04 multi-format preview UI)*
- 🧪 **Test** — unit: hash stable for same input, changes when claims/voice change; staleness detection; no auto-regenerate (FAKE); *(ref: 06 §9)*
- **Deps:** [E9.1] | **Est:** S

### Story E9.4 — As a writer, I want paragraph-level AI ops (expand/condense/reangle/stronger_evidence), so that I can refine one block without disturbing the rest of the draft.
- **Acceptance**: Given a draft block, When I `POST /drafts/{id}/blocks/{block_id}/op {op}` (streamed), Then the block's `block_id` is preserved and its citations re-anchored; Given `stronger_evidence`, Then new retrieval is pulled and added as new draft citations (never invented); Given any op, Then sibling/branch material is never touched.
- 🔧 **Backend** — `ParaOp` enum + `run_paragraph_op` over block-local context (neighbors + that block's citations); `stronger_evidence` calls retrieval (05) and adds citations; `reanchor_citations` preserves `[#c]` markers; *(ref: 06 §6)*
- 🎨 **Frontend** — block-scoped op menu; live stream into the block; show re-anchored citations + "可能失效的引用" on mismatch; *(ref: 04 multi-format preview UI / draft editor)*
- 🧪 **Test** — unit: op preserves `block_id` + re-anchors citations; `stronger_evidence` adds (never fabricates) citations; op never mutates sibling blocks (FAKE); contract: `POST /drafts/{id}/blocks/{block_id}/op` SSE vs OpenAPI; *(ref: 06 §9)*
- **Deps:** [E4.x draft AST + draft_anchor] | **Est:** M

### Story E9.5 — As a creator, I want to export the thinking-tree and outline as PNG/SVG (and the draft as DOCX), so that I can share visuals and Word docs with citations intact.
- **Acceptance**: Given a tree/outline, When I export PNG/SVG, Then the frontend renders the geometry and posts a blob back, recorded as an `Export` with a content-addressed `payload_ref`. Given a Draft, When I export DOCX, Then footnotes map to Word footnotes (`citations_preserved = True`, footnote count == draft citation count).
- 🔧 **Backend** — `Export` record + provenance for png/svg (blob posted from FE) and server-side DOCX from the same `MarkdownAST` via docx writer; `payload_ref` via `BlobStore`; *(ref: 06 §5.3; 08 §2.2 BlobStore G4)*
- 🎨 **Frontend** — D3 render tree/outline → PNG/SVG blob → POST back; *(ref: 04 network/tree render; 06 §5.3)*
- 🧪 **Test** — unit: DOCX footnote/citation count parity, `citations_preserved`; contract: PNG/SVG/DOCX `Export` targets recorded with valid blob ref; *(ref: 06 §9)*
- **Deps:** [E9.1 not required; E2.x tree render, E4.x export markdown] | **Est:** M

---

## Epic E10 — Cross-project network & extensibility
**Milestone:** Post-MVP (P2; ingestion seams P1) | **Priority:** P2 | **Page:** Network | **Goal:** A `CrossLink` overlay + discovery across projects (never widening the moat), structure-template library, fact-check, one-click publish, and the SourceBlock/provider extensibility seams — all additive over fixed contracts.

### Story E10.1 — As a deep creator, I want to draw CrossLinks between projects/nodes, so that I can see where my projects share themes, contradict, or continue an issue.
- **Acceptance**: Given two projects, When I `POST /api/v1/crosslinks` with a `kind` (shared_theme|contradiction|continuation), Then a `CrossLink` is created `created_by=user`, `status=accepted`, requiring no model call. Given a from==to project with no node distinction, Then `CROSSLINK_SELF_LINK` is returned.
- 🔧 **Backend** — `CrossLink` schema + `CrossLinkRepo` (`cross_links` edge table over ULIDs, no graph DB); routes `POST/PATCH/DELETE /crosslinks`; *(ref: 08 §1.2; 08 §4)*
- 🎨 **Frontend** — network view: drag project→project (or node→node) to create a link, pick kind; *(ref: 04 network view)*
- 🧪 **Test** — contract: crosslink CRUD vs OpenAPI; `CROSSLINK_SELF_LINK`/`CROSSLINK_NOT_FOUND` error envelopes; *(ref: 08 §5)*
- **Deps:** [E1.x project/node model, E2.x relations overlay] | **Est:** M

### Story E10.2 — As a user, I want a global network view of projects and their CrossLinks, so that I can navigate (not edit) the forest of projects at a glance.
- **Acceptance**: Given projects + links, When I `GET /api/v1/network`, Then `build_network_graph` returns a project-level graph (node-pinned links collapse to one edge); `suggested` links filtered unless requested; edges encode `kind` (color) and `status` (dashed=suggested, solid=accepted). When I expand two bubbles, Then pinned from/to nodes are revealed.
- 🔧 **Backend** — pure `build_network_graph(projects, links, include_suggested)` read-model builder (no I/O); cursor-paginated `list_network`; *(ref: 08 §1.3)*
- 🎨 **Frontend** — read-and-jump project-graph canvas (not an editing canvas); kind→color, dashed/solid; drill-in; exhaustive switch over `CrossLinkKind`; *(ref: 04 network view)*
- 🧪 **Test** — unit: project-level collapse of node-pinned links, `suggested` filtering, deterministic edge ordering; frontend: render from `NetworkGraph` fixture, unhandled `CrossLinkKind` fails TS compile; *(ref: 08 §5)*
- **Deps:** [E10.1] | **Est:** M

### Story E10.3 — As a creator, I want AI to discover cross-project links with evidence, so that I find contradictions/continuations I'd miss, while keeping the moat intact.
- **Acceptance**: Given many projects, When I `POST /api/v1/network/discover`, Then a batch background job (returns a job id, polled via `GET /jobs/{id}`) proposes `status=suggested` links with `confidence` + `evidence` quotes; re-running never re-suggests a `dismissed` pair. **Guard:** discovery resolves context via `resolve_branch_context` per project, so the classifier input for side A contains ONLY A's ancestor chain — a `CrossLink` never widens any node's resolved context.
- 🔧 **Backend** — discovery job: cross-project `VectorIndex.search` (filter `project_id != self`, same embeddings) → symmetric dedupe → structured `ModelProvider.generate` classify ({kind,confidence,evidence}); upsert suggested, skip dismissed; accept/dismiss lifecycle; staleness via `derived_from_hash`; *(ref: 08 §1.4/§1.5; 08 §3.1)*
- 🎨 **Frontend** — suggested-link inbox (accept/dismiss), evidence quotes + confidence, "sources changed" stale badge; *(ref: 04 network view)*
- 🧪 **Test** — **moat-preservation (critical, must exist before ship):** assert discovery calls `resolve_branch_context` per project and side-A classifier input excludes B's nodes & siblings (cross-project analogue of the core isolation test); **CrossLink-never-in-resolve_branch_context guard:** assert `resolve_branch_context` output is unchanged by any `CrossLink` rows (FAKE); unit: symmetric dedupe `(A,B)==(B,A)`, dismissed never re-emitted, staleness; contract: `/network/discover` + `/jobs/{id}`; *(ref: 08 §5 moat-preservation test)*
- **Deps:** [E10.2, E3.x VectorIndex/retrieval, E2.x resolve_branch_context] | **Est:** L

### Story E10.4 — As a maintainer, I want SourceKind/provider/format/template additions to be purely additive, so that new capabilities never edit the moat, tree, or draft pipeline.
- **Acceptance**: Given the additivity litmus, When a new `SourceIngestor` / `ModelBackend` / `ArtifactRenderer` / `StructureTemplate` is added, Then it is (a) a new enum value and/or adapter file, (b) touches zero domain logic in `weaver_core/{tree,context,relations,crystallize,citation}`, and (c) flows to TS via the schema-first contract. Given a registry miss, Then the canonical `ErrorCode` (e.g. `UNKNOWN_BACKEND` / `UNSUPPORTED_SOURCE_KIND` / `UNKNOWN_ARTIFACT_FORMAT` / `UNKNOWN_TEMPLATE`) is raised.
- 🔧 **Backend** — define stable seams: `SourceIngestor` Protocol + `register_ingestor`; `ArtifactRenderer` registry (shared with E9.1); `StructureTemplate` registry; provider builders via the canonical `ProviderRegistry`; *(ref: 08 §2.1–§2.5)*
- 🎨 **Frontend** — `GET /backends/registry` so Settings can offer new backends; exhaustive-switch coverage for new enum members; *(ref: 04 settings/network view)*
- 🧪 **Test** — **additive guard (pytest+CI):** import `weaver_core.{context,tree,crystallize}` and assert no import of any `ingest/*`, `artifact/*`, `crosslink`, `network` module; registry registration is additive; enum-completeness (every `SourceKind` has an ingestor); drift guard regenerates openapi+TS or build goes red; *(ref: 08 §5 additive guard)*
- **Deps:** [E1.x schema-first contract, E3.x VectorIndex/ingest pipeline] | **Est:** M

### Story E10.5 — As a creator, I want a structure-template library (论说文/分析报告/故事化), so that promoted points order into a proven narrative scaffold.
- **Acceptance**: Given `essay|analysis|story` templates, When I apply one to an outline, Then promoted `OutlinePoint`s order into the template's `roles` per its `ordering_hint`; the crystallization algorithm is unchanged (template = data row, not a code branch). When I `GET /api/v1/templates`, Then registered templates list; an unknown key → `UNKNOWN_TEMPLATE`.
- 🔧 **Backend** — `StructureTemplate` (key/title/roles/ordering_hint) + `register_template`; crystallizer takes template as input only; `Outline.structure_template` set; *(ref: 06 §2.6; 08 §2.4)*
- 🎨 **Frontend** — template picker on the outline; preview the role scaffold; *(ref: 04 outline/network view)*
- 🧪 **Test** — unit: applying a template orders points into its roles (deterministic); crystallizer unchanged across templates; contract: `GET /templates` + `UNKNOWN_TEMPLATE`; *(ref: 06 §9; 08 §5)*
- **Deps:** [E10.4 template registry, E4.x crystallize/outline] | **Est:** M

### Story E10.6 — As a creator, I want fact-check and one-click publish on a finished draft, so that I can verify claims and ship without leaving the tool.
- **Acceptance**: Given a Draft, When I run fact-check, Then each empirical claim is checked against its grounded citations (and flagged where unsupported), surfaced as warnings — never silently auto-edited, honesty-preserving. Given a verified draft, When I one-click publish to a configured platform, Then it exports via the same `MarkdownAST`/`Artifact` path with citations preserved.
- 🔧 **Backend** — fact-check pass over draft citations (reuses retrieval/citation machinery; flags unsupported claims like `uncited_claims`); publish as an additive `Export`/artifact target behind a publisher seam; *(ref: 06 §3 citation spine; 08 §2.3/§2.5)*
- 🎨 **Frontend** — fact-check report panel (claim → support status); publish button + target config; *(ref: 04 draft editor)*
- 🧪 **Test** — unit: fact-check flags an unsupported claim, never fabricates a citation (FAKE); publish path preserves footnote/citation parity; *(ref: 06 §9)*
- **Deps:** [E9.1 artifact path, E4.x citation carry-through] | **Est:** L
