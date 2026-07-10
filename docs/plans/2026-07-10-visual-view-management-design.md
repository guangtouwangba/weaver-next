# Weaver Visual View Management Design

## Goal

Make Visual Views feel like durable, named perspectives over one shared content graph. Users must be able to find every saved View, keep a small stable shortcut set, understand duplicate templates, and safely remove or recover Views without affecting Node/Edge content.

## Confirmed product decisions

- A View is a saved visual perspective, not a disposable browser tab.
- The top switcher shows pinned Views plus the current unpinned View.
- All saved Views are discoverable from a temporary left-side View Library drawer.
- The first phase has no archive concept: pin/unpin and a 30-day recycle bin are sufficient.
- Creating another View from the same template warns about existing instances but remains allowed.
- A Project has a default View; each Codex Chat restores its own last View first.
- Switching View keeps the shared article editor open after pending content saves flush.

## Information architecture

The top bar is a shortcut surface:

```text
[Pinned Canvas] [Pinned Roadmap] [Current Mind Map] [All Views 8] [+]
```

Pinned Views retain a stable user-defined order. An unpinned current View occupies one temporary slot and is replaced when another unpinned View opens. Overflowed pinned Views remain accessible from All Views.

The left View Library drawer contains search, Fixed, Recent, All Views grouped by visual family, and Recycle Bin. Each View row shows a structural thumbnail, name, visual family/type, template, node count, and last-opened time. Row actions include open, rename, pin/unpin, duplicate, set default, and delete. Keyboard navigation, Escape dismissal, and a full-screen mobile sheet are required.

## Domain model

`ProjectView` owns catalog metadata and lifecycle. `LayoutDocument` remains responsible only for the visual projection and geometry.

```ts
interface ProjectView {
  id: string;
  projectId: string;
  name: string;
  viewType: ViewType;
  templateRef?: { id: string; version: string };
  status: "active" | "trashed";
  pinned: boolean;
  pinnedOrder?: number;
  createdBy: "user" | "agent" | "template";
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  trashedAt?: string;
  purgeAfter?: string;
}
```

Four independent version lines are authoritative:

- `graphRevision`: Node/Edge content.
- `layoutRevision`: geometry/projection/theme for one View.
- `viewCatalogRevision`: View create, rename, pin, order, default, trash, restore, and purge.
- `bindingRevision`: current Project/View for one Codex Chat.

Per Chat Canvas Session, `CanvasViewState` stores viewport, selection, focus, and last opened time for each View. First open fits the View; later opens restore the saved state.

## Lifecycle

```text
create -> active -> trash -> restore
                         -> permanent purge
```

Deleting means moving to the recycle bin for 30 days. It never changes Graph data. The last active View cannot be deleted. Deleting the current or default View atomically chooses a fallback, updates the default when required, updates Chat bindings, cancels View-bound tasks, rejects pending LayoutRuns, advances revisions, and emits durable events. Permanent purge is available only in Recycle Bin and requires confirmation.

Creation checks template instances. Existing instances are presented before the create action. A new duplicate requires an intentional confirmation and a meaningful editable name; automatic numeric names are only suggestions.

## Sync and MCP

Catalog mutations emit one durable event:

```ts
interface ViewCatalogDelta {
  projectId: string;
  fromRevision: number;
  toRevision: number;
  upsertedViews: ProjectView[];
  removedViewIds: string[];
  defaultViewId?: string;
}
```

SSE event name: `view.catalog.changed`. Widget reducers update tabs and the library without reloading Graph or resetting the canvas.

Tools:

- Read: `weaver_list_project_views`, `weaver_search_project_views`, `weaver_get_project_view`.
- Mutate: `weaver_rename_project_view`, `weaver_pin_project_view`, `weaver_reorder_pinned_views`, `weaver_set_default_view`, `weaver_trash_project_view`, `weaver_restore_project_view`, `weaver_purge_project_view`, `weaver_duplicate_project_view`.

Agent may recommend, create, duplicate, or open a View under existing permission rules. Delete and purge are app-only user actions. localhost may manage Views but remains ineligible for AgentTasks.

## Error and recovery behavior

- Dirty article content saves before switching; a save failure blocks the switch and preserves the draft.
- Layout conflicts do not overwrite newer coordinates.
- A View deleted from another Chat causes an atomic fallback and an explanatory toast.
- Restoring a View never steals focus or automatically restores default status.
- Stale Chat leases cannot mutate View catalog state.
- Empty names are rejected. Duplicate names are allowed with clear type/template disambiguation.
- View Library failures do not remove already-rendered tabs or disrupt the current canvas.
- Delete displays an Undo toast. Purge requires confirmation.

## Acceptance criteria

- Every active or trashed View is discoverable without relying on top-bar space.
- Pinned order is stable and the current unpinned View is always visible.
- Repeated templates are clearly disclosed before creation.
- Rename/pin/delete never change graphRevision or layoutRevision.
- Current/default/last-View deletion rules are deterministic and transactional.
- Multiple Chats sharing a Project retain independent current View and viewport state.
- SSE catalog updates never reload Graph or reset the editor.
- Existing LayoutDocuments migrate without coordinate or layoutRevision changes.
