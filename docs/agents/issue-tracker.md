# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

The Git remote uses the SSH host alias `github-personal`. To avoid repository inference problems, explicitly target `guangtouwangba/weaver-next` with `--repo` or `-R`.

## Conventions

- **Create an issue**: `gh issue create -R guangtouwangba/weaver-next --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> -R guangtouwangba/weaver-next --comments`, filtering comments by `jq` and also fetching labels when needed.
- **List issues**: `gh issue list -R guangtouwangba/weaver-next --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> -R guangtouwangba/weaver-next --body "..."`
- **Apply / remove labels**: `gh issue edit <number> -R guangtouwangba/weaver-next --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> -R guangtouwangba/weaver-next --comment "..."`

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> -R guangtouwangba/weaver-next --comments` and `gh pr diff <number> -R guangtouwangba/weaver-next`.
- **List external PRs for triage**: `gh pr list -R guangtouwangba/weaver-next --state open --json number,title,body,labels,author,authorAssociation,comments`, then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE`.
- **Comment / label / close**: use `gh pr comment`, `gh pr edit`, and `gh pr close` with `-R guangtouwangba/weaver-next`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either. Resolve with `gh pr view 42 -R guangtouwangba/weaver-next` and fall back to `gh issue view 42 -R guangtouwangba/weaver-next`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue in `guangtouwangba/weaver-next`.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> -R guangtouwangba/weaver-next --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue. Where sub-issues are unavailable, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels use `wayfinder:<type>` (`research`, `prototype`, `grilling`, or `task`). Once claimed, assign the ticket to the driving developer.
- **Blocking**: use GitHub native issue dependencies. Add an edge with `gh api --method POST repos/guangtouwangba/weaver-next/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric database ID. Where dependencies are unavailable, use a `Blocked by: #<n>, #<n>` line at the top of the child body.
- **Frontier query**: list the map's open children, then drop any with an open blocker or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> -R guangtouwangba/weaver-next --add-assignee @me` — the session's first write.
- **Resolve**: comment with the answer, close the issue, then append a context pointer to the map's Decisions-so-far.
