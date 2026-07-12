# MCP Tool-Surface Consolidation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Shrink the MCP server's **model-facing** tool count from 52 to ~18 so Codex stops dropping critical write tools (`weaver_submit_changeset`), by (a) grouping reads into a few domain tools, (b) merging write families, (c) moving recommend/validate/preview workflows into skills — while the 7 critical develop-loop tools stay individual and always present, and BOTH hosts (Codex + Claude Code) keep working.

**Architecture:** The problem is the *model-facing* surface (52), not total registrations (78). Three levers, in priority order: **reclassify** widget-called reads to `visibility:["app"]` (off the model surface, widget code untouched); **add** a few domain-grouped model-facing read tools + merged write tools that dispatch to the existing store methods; **remove** model-only redundant tools and move advisory ones to skills. The load-bearing rule from the architecture review: **never put a read and a write in the same tool** — Codex's Apps-SDK proxy hard-blocks `readOnlyHint:false` tools on some paths (the -32000 family), so read tools stay `readOnlyHint:true` and writes stay separate.

**Tech Stack:** TypeScript monorepo (npm workspaces), `@modelcontextprotocol/sdk` McpServer, zod, node:sqlite, vitest. Widget is React+Vite (`apps/widget`).

---

## Critical background (executor MUST read first)

**How model-facing is computed** (`packages/mcp/src/create-server.ts`):
- `computeToolSurface(registry)` (added recently): a tool is **model-facing** unless its `_meta.ui.visibility` array excludes `"model"`. No visibility meta ⇒ model-facing (normal agent tool). `visibility:["app"]` ⇒ widget-only (hidden from model).
- The `registerTool` wrapper (create-server.ts:~83-108): tools in `PREVIEW_TOOL_ALLOWLIST` are force-bumped to `_meta.ui.visibility:["app","model"]` + `openai/widgetAccessible:true`. **BUT** the spread `ui: { visibility: ["app","model"], ...config?._meta?.ui }` means a tool that *declares its own* `_meta.ui.visibility:["app"]` overrides the bump. So: **to take a widget-called (allowlisted) read OFF the model surface, declare `_meta: { ui: { visibility: ["app"] } }` on its registration** — it stays widget-accessible, leaves the model surface, widget code unchanged.
- `weaver_get_diagnostics` reports `toolSurface` live. Use it as the authoritative check after every task: `toolSurface.modelFacing` and `toolSurface.criticalPresent`.

**The 7 critical tools — NEVER merge, rename, or reclassify:**
`weaver_prepare_task_from_active_canvas`, `weaver_start_agent_task`, `weaver_submit_changeset`, `weaver_apply_changeset`, `weaver_complete_agent_task`, `weaver_report_task_progress`, `weaver_await_canvas_prompt`.

**Widget coupling — DO NOT break these.** `PREVIEW_TOOL_ALLOWLIST` (create-server.ts:31-43) is the set the browser widget calls via `callTool(...)`. Any tool in it that you touch must remain callable by the widget under its EXISTING name. The strategy for allowlisted reads is *reclassify to app-only*, NOT remove. Non-allowlisted model-only reads may be removed once folded into a grouped read tool AND all skill references updated.

**Both-host rule:** every capability must work in Codex and Claude Code; only the entry point differs. After changes, smoke both.

**Skills are the workflow layer.** 13 skills in `skills/weaver-*/SKILL.md` reference tool names in prose. Every rename/removal MUST update them in the same task. `plugins/weaver-next/skills/*` and `plugins/weaver-next/claude-skills/*` are BUILD SNAPSHOTS — never hand-edit; refreshed by `build:release` in the final task.

**No parallel-run inflation:** for each family, add-new + reclassify/remove-old + update-skills in the SAME task, so the model surface never temporarily grows.

**Verify commands:**
```bash
npm --workspace @weaver/contracts run build   # only if contracts change (they won't here)
npm run build:packages                         # after any packages/mcp change
npx vitest run packages/mcp
npm run typecheck:widget && npx vitest run apps/widget   # only if widget touched
```
Live model-surface check (throwaway, run from repo root):
```bash
node -e 'import("./packages/mcp/dist/create-server.js").then(async m=>{const{mkdtempSync}=await import("node:fs");const{tmpdir}=await import("node:os");const{join}=await import("node:path");const s=await m.createWeaverServer({previewWorkspaceDir:mkdtempSync(join(tmpdir(),"x"))});const d=await s.dispatch("weaver_get_diagnostics",{});console.log(JSON.stringify(d.structuredContent.toolSurface,null,0));await s.close();})'
```

**Target final model-facing set (~18):**
Critical (7) · `weaver_read_session` · `weaver_read_graph` · `weaver_read_catalog` · `weaver_review_action` · `weaver_create_project` · `weaver_manage_view` · `weaver_import_asset` · `weaver_generate_layout_candidates` · `weaver_publish_artifact` · `weaver_open_workspace_widget` · `weaver_get_diagnostics`.

---

## Task 0: Baseline snapshot of the model surface

**Files:** none (measurement only).

**Step 1:** Run the live model-surface check above. Record the current numbers (expect `modelFacing:52`, all `criticalPresent:true`). Save the full `modelFacingNames` list to `/tmp/before-tools.json` for diffing later.

**Step 2:** `grep -rn 'weaver_get_\|weaver_list_\|weaver_query_\|weaver_resolve_\|weaver_search_\|weaver_recommend_\|weaver_validate_\|weaver_preview_' apps/widget/src --include=*.ts --include=*.tsx | grep -v dist` — record which reads the WIDGET calls. These are the ones you must reclassify (not remove). Save to `/tmp/widget-read-calls.txt`.

**Step 3:** Commit nothing. This is the reference for every later diff.

---

## Task 1: `weaver_read_session` (session reads → one model tool)

Absorbs `get_bound_canvas`, `get_agent_task`, `get_canvas_context`, `resolve_context`, plus a new `guard` convenience (bound_canvas + task in one call — the exact pre-write pattern every skill repeats).

**Files:**
- Create: `packages/mcp/src/tools/read-session.ts`
- Modify: `packages/mcp/src/create-server.ts` (register the new tool; reclassify/remove old session reads)
- Modify: `packages/mcp/src/tools/canvas-binding.ts`, `agent-tasks.ts` (old tools: `get_bound_canvas`, `get_canvas_context`, `resolve_context` live in canvas-binding/context; `get_agent_task` in agent-tasks — reclassify or remove per widget-coupling)
- Test: `packages/mcp/__tests__/read-session.test.ts`

**Step 1: Write the failing test.** Build the server, dispatch `weaver_read_session` for each resource against a bound canvas, assert each returns the same payload the old tool did. Include the `guard` resource returning `{ boundCanvas, task }`. Mirror setup from `packages/mcp/__tests__/report-progress.test.ts` (workspace + project + agent-eligible binding).

```ts
// resources: "bound_canvas" | "task" | "canvas_context" | "resolved_context" | "guard"
const r = await dispatch("weaver_read_session", { workspaceDir: root, resource: "bound_canvas" });
expect(r.structuredContent.projectId).toBeTruthy();
const g = await dispatch("weaver_read_session", { workspaceDir: root, resource: "guard" });
expect(g.structuredContent.boundCanvas).toBeTruthy();
```

**Step 2: Run — expect fail** (`TOOL_NOT_FOUND:weaver_read_session`). `npx vitest run packages/mcp -t "read_session"`.

**Step 3: Implement.**
- `read-session.ts`: `registerReadSessionTool(server, ctx)` registering `weaver_read_session` with `inputSchema: { ...workspaceSchema.shape, resource: z.enum([...]) }`, `annotations: { readOnlyHint: true, ... }`, NO visibility meta (model-facing). Handler switches on `resource`, calls the SAME store methods the old tools call (`store.getBoundCanvas`, `store.getAgentTask` via chatSessionKey, `store.getCanvasContext`, `store.resolveContext`). For `guard`, return `{ boundCanvas, task }`. Preserve each old tool's auth (chatSessionKey binding, `assertTaskChat` where the old one did).
- create-server.ts: call `registerReadSessionTool` in the registration block.
- Old tools: `weaver_get_bound_canvas` is in the allowlist (widget calls it) → **reclassify to app-only** (add `_meta:{ui:{visibility:["app"]}}` at its registration). `weaver_get_canvas_context`, `weaver_resolve_context`, `weaver_get_agent_task`: check `/tmp/widget-read-calls.txt` — if widget-called, reclassify to app-only; else **remove** the registration.

**Step 4: Run tests + surface check.** `npm run build:packages && npx vitest run packages/mcp`, then the live surface check — `modelFacing` should drop by ~4, all 7 `criticalPresent` still true.

**Step 5: Update skills.** In every `skills/weaver-*/SKILL.md`, replace `weaver_get_bound_canvas`/`weaver_get_agent_task` calls with `weaver_read_session(resource:"bound_canvas"|"task")`, and where a skill calls bound_canvas THEN task back-to-back (weaver-agent-loop step 7, weaver-develop-space step 11), collapse to `weaver_read_session(resource:"guard")`. Grep to confirm no stale references: `grep -rn "weaver_get_bound_canvas\|weaver_get_agent_task\|weaver_get_canvas_context\|weaver_resolve_context" skills/`.

**Step 6: Commit.**
```bash
git add packages/mcp skills
git commit -m "refactor(mcp): group session reads into weaver_read_session"
```

---

## Task 2: `weaver_read_graph` (graph reads → one model tool)

Absorbs `get_project_manifest`, `get_project_graph`, `query_graph`, `get_node_content`.

**Files:** Create `packages/mcp/src/tools/read-graph.ts`; modify create-server.ts + `graph.ts`/`projects.ts` registrations; Test `packages/mcp/__tests__/read-graph.test.ts`.

**Steps:** Same shape as Task 1. Resources: `"manifest" | "full" | "query" | "node"`. Required params per resource (`node` needs `nodeId`; `query` takes `nodeTypes`/`text`/`limit`). Handler dispatches to existing store methods. **Widget coupling:** `get_project_graph`, `get_project_manifest`, `get_node_content` ARE allowlisted (widget-called) → reclassify to app-only. `query_graph` — check widget usage; remove if model-only. Update skills (`weaver-develop-space` step 4-6 references these heavily). Surface check: model-facing drops another ~4. Commit `refactor(mcp): group graph reads into weaver_read_graph`.

---

## Task 3: `weaver_read_catalog` (browse/catalog reads → one model tool)

Absorbs `list_projects`, `list_project_views`, `search_project_views`, `get_project_view`, `get_layout`, `get_layout_run`, `get_layout_capabilities`, `list_changesets`, `get_changeset`, `preview_changeset`, `list_visual_templates`, `get_visual_template`, `get_artifact`, `get_asset_metadata`.

**Files:** Create `packages/mcp/src/tools/read-catalog.ts`; modify create-server.ts + the owning tool files; Test `packages/mcp/__tests__/read-catalog.test.ts`.

**Steps:** Same shape. Resources namespaced: `"project.list" | "view.list" | "view.search" | "view.get" | "layout.get" | "layout.run" | "layout.capabilities" | "changeset.list" | "changeset.get" | "changeset.preview" | "template.list" | "template.get" | "artifact.get" | "asset.metadata"`. **This is the biggest group** — if the single tool feels unwieldy in testing, it's acceptable to split into `weaver_read_catalog` (project/view/template/artifact/asset) + `weaver_read_review` (changeset/layout reads) — that lands at 4 read tools total, still within budget; decide during implementation and note it. **Widget coupling:** several here are allowlisted (`list_projects`, `list_project_views`, `list_visual_templates`, `get_layout_run`, `preview_changeset`) → reclassify app-only; the rest (model-only) remove. Update skills (`weaver-review-changes`, `weaver-layout-space`, `weaver-create-space`). Surface check. Commit `refactor(mcp): group catalog reads into weaver_read_catalog`.

---

## Task 4: `weaver_review_action` (review writes → one model tool)

Absorbs `reject_changeset`, `apply_layout`, `reject_layout`, `revert_layout`. NOTE: `apply_changeset` stays separate (critical).

**Files:** Create `packages/mcp/src/tools/review-action.ts`; modify create-server.ts + `changesets.ts`/`layout.ts`; Test `packages/mcp/__tests__/review-action.test.ts`.

**Step 1: Failing test** — dispatch `weaver_review_action` for `{resource:"changeset",action:"reject"}`, `{resource:"layout_run",action:"apply",id,candidateId}`, `{resource:"layout_run",action:"reject"}`, `{resource:"layout_run",action:"revert",projectId,viewId}`; assert each matches old behavior. Assert `{resource:"changeset",action:"apply"}` is REJECTED by schema (a zod `refine`) — applying a changeset must only go through `weaver_apply_changeset`.

**Step 3: Implement** with `annotations:{ readOnlyHint:false, ... }` (it writes — so it is model-facing but NOT in the widget path unless an old one was). Check widget coupling: `apply_layout`/`reject_layout`/`reject_changeset` — are they widget-called (Apply/Reject buttons)? YES (`weaver_apply_changeset`, `weaver_reject_changeset`, `weaver_apply_layout`, `weaver_reject_layout` are in the allowlist). So the widget needs these under their old names → **keep the old tools app-only** AND add `weaver_review_action` for the model. Do NOT remove them. This is the read/write asymmetry: writes the widget calls stay as-is (app-only), model gets the merged tool.

**Step 4-6:** surface check (drops ~4 from model), update skills (`weaver-review-changes`, `weaver-layout-space`), commit `refactor(mcp): merge review writes into weaver_review_action`.

---

## Task 5: `weaver_create_project` unify (absorb template variant)

Merge `weaver_create_project_from_visual_template` into `weaver_create_project` via an optional `template:{templateId,version}` param.

**Files:** modify `packages/mcp/src/tools/projects.ts` + `templates.ts` + create-server.ts; Test in existing `packages/mcp/__tests__/` or a new one.

**Steps:** Failing test: `weaver_create_project` with `template:{...}` produces the same result the old template tool did (project + starter graph + themed view). Without `template`, plain project. `create_project_from_visual_template` is NOT widget-called (agent creates projects) — verify, then remove it and fold logic. Update skills (`weaver-create-space`). Surface check (drops 1). Commit `refactor(mcp): fold template creation into weaver_create_project`.

---

## Task 6: `weaver_manage_view` (view lifecycle → one model tool)

Absorbs `get_or_create_view`, `duplicate_project_view`, `create_view_from_visual_template`.

**Files:** Create `packages/mcp/src/tools/manage-view.ts`; modify create-server.ts + owning files; Test `packages/mcp/__tests__/manage-view.test.ts`.

**Steps:** Actions `"open_or_create" | "duplicate" | "create_from_template"`. Writes (`readOnlyHint:false`). Widget coupling: `duplicate_project_view` is allowlisted → keep app-only + add to `weaver_manage_view`. `get_or_create_view`, `create_view_from_visual_template` — check; reclassify or remove. Update skills (`weaver-layout-space`, `weaver-open-space`). Surface check. Commit `refactor(mcp): merge view lifecycle into weaver_manage_view`.

---

## Task 7: `weaver_import_asset` (image import → one model tool)

Absorbs `ingest_image` (base64 bytes) + `render_svg_image` (SVG→PNG). Both return `{assetId,...}` for a ChangeSet add-node op.

**Files:** Create `packages/mcp/src/tools/import-asset.ts`; modify create-server.ts + the imagegen tool file(s); Test `packages/mcp/__tests__/import-asset.test.ts` (reuse fixtures from the existing `imagegen-tools.test.ts`).

**Steps:** `source:"bytes"|"svg"`. Neither is widget-called (agent/skill path) → remove both old registrations, fold logic. Update the imagegen skills (`weaver-illustrate`, `weaver-cover-image`, `weaver-infographic`, `weaver-image-edit`) that call `ingest_image`/`render_svg_image`. Surface check (drops 1). Commit `refactor(mcp): merge image import into weaver_import_asset`.

---

## Task 8: Move recommend/validate/preview to skills (remove 6 model tools)

Remove `recommend_scene`, `recommend_layout`, `recommend_visual_templates`, `validate_layout_plan`, `validate_visual_template`, `preview_visual_template` from the model surface; encode the guidance as skill prose. Accept the reproducibility trade-off (per user decision).

**Files:** modify `packages/mcp/src/tools/{templates,layout,projects}.ts` + create-server.ts; modify `skills/weaver-create-space/SKILL.md`, `skills/weaver-layout-space/SKILL.md`.

**Step 1:** For each of the 6, determine: **widget-called?** (`recommend_visual_templates`, `validate_visual_template`, `preview_visual_template` may be allowlisted for the widget's template picker — CHECK `/tmp/widget-read-calls.txt` and the allowlist). If widget-called → reclassify to app-only (widget keeps it, model loses it). If model-only → remove.

**Step 2:** In the skills, replace the tool calls with prose guidance:
- `weaver-create-space`: instead of `weaver_recommend_scene`/`weaver_recommend_visual_templates`, instruct the agent to read the scene/template catalog (`weaver_read_catalog(resource:"template.list")`) and CHOOSE based on the goal, using the criteria the old recommender encoded (state them in the skill).
- `weaver-layout-space`: instead of `weaver_recommend_layout`/`weaver_validate_layout_plan`, instruct the agent to author a LayoutPlan directly and rely on `weaver_generate_layout_candidates` (which already validates and returns typed errors) for the validation feedback loop. Drop the standalone preview/validate step; the candidate preview IS the preview.

**Step 3:** Failing test is N/A for skill prose; instead add/adjust an mcp test asserting these 6 tools are NO LONGER model-facing (`toolSurface.modelFacingNames` excludes them). Run surface check — model-facing should now be ~18.

**Step 4: Commit** `refactor(mcp): move recommend/validate/preview into skills`.

---

## Task 9: Cleanup — legacy tools + toolSurface

**Files:** `packages/mcp/src/tools/agent-tasks.ts`, `create-server.ts`.

**Step 1:** Reclassify `weaver_prepare_agent_task` to `visibility:["app"]` (raw widget-path primitive; the model uses `prepare_task_from_active_canvas`). Verify no skill references it as a model call.

**Step 2:** Remove `weaver_mark_task_dispatched` (dead "compatibility" tool) after grepping widget + skills confirm no caller. If the widget calls it, reclassify app-only instead.

**Step 3:** Update `CRITICAL_MODEL_TOOLS` / `computeToolSurface` usage: the boot log + get_diagnostics already flag all 7. Update the `weaver_get_diagnostics` description if the critical set wording changed. Add an assertion test: `toolSurface.criticalPresent` has all 7 true and `toolSurface.modelFacing <= 20`.

**Step 4:** `npx vitest run packages/mcp`; surface check confirms ~18 model-facing, all 7 critical present. **Commit** `refactor(mcp): reclassify legacy task tools and tighten tool-surface guard`.

---

## Task 10: Full verify + both-host smoke + plugin snapshot

**Step 1:** `npm run build:packages && npm run build:widget && npx vitest run && npm run typecheck:widget && npm run lint` — all green. Diff the model-surface against `/tmp/before-tools.json`: confirm the 7 critical tools survived and the count is ~18.

**Step 2:** Update `docs/plans/` note or a short `docs/` changelog if the repo expects it. Confirm no `skills/*` file references a removed tool name: `grep -rn "weaver_get_\|weaver_list_\|weaver_recommend_\|weaver_validate_\|weaver_preview_\|weaver_query_\|weaver_resolve_\|weaver_search_" skills/` should only show the surviving grouped/kept tools.

**Step 3:** **Both-host smoke (manual, required by WORKFLOW.md §4/§5).** Reconnect `weaver-preview` (Claude) and restart the Codex `weaver_mcp`. In EACH host: call `weaver_get_diagnostics`, confirm `toolSurface.modelFacing` ~18 and `criticalPresent` all true. Then run one `weaver-create-space` → `weaver-develop-space` → `weaver-review-changes` loop end-to-end in each host (this touches every merged tool). Confirm a ChangeSet actually submits and applies — i.e. the original "缺少 submit_changeset" symptom is gone because the surface now fits.

**Step 4:** `npm run build:release && npm run check:release`; commit the snapshot.
```bash
git add plugins/weaver-next
git commit -m "build(release): refresh plugin snapshot for tool-surface consolidation"
```

---

## Rollback

Every task is one commit; the changes are additive-then-subtractive per family, so `git revert <task-commit>` restores that family's old tools. The model surface is always verifiable live via `weaver_get_diagnostics.toolSurface` — if any host regresses, revert the last family task and re-smoke.
