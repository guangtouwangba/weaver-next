# Weaver skills for Claude Code

Version-controlled [Claude Code](https://claude.com/claude-code) skills for driving Weaver
from a terminal session. These are **Claude Code** skills (slash commands you run), separate
from the Weaver plugin's own agent skills under `../../skills/`.

They live here (tracked) rather than in `.claude/skills/` (which is git-ignored and local), so
anyone who clones the repo can install them.

## Install

```bash
npm run install:claude-skills            # into <repo>/.claude/skills (this project only)
npm run install:claude-skills -- --global   # into ~/.claude/skills (all your projects)
```

Then run `/reload-skills` in Claude Code (or restart it). Re-run after pulling updates.

## Prerequisite

The Weaver MCP must be registered for Claude Code as the preview host (once):

```bash
npm run build:plugin
claude mcp add weaver-preview -- node ./scripts/start-mcp-claude.mjs
```

## Skills

- **`/weaver-open`** — open this project's Weaver canvas in a browser window beside the
  terminal, bound to the current Claude session.
- **`/weaver-watch`** — open the canvas **and** enter watch mode: Claude long-polls for prompts
  typed in the on-canvas composer and turns each into a reviewed ChangeSet. Drive Weaver entirely
  from the whiteboard; press Esc or say "stop" to exit.
