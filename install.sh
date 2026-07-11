#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$ROOT/plugins/weaver-next"
CLAUDE_SKILLS="$HOME/.claude/skills"
BACKUP_ROOT="$HOME/.local/state/weaver-next/backups"
SKILLS=(weaver-open weaver-watch)

fail() { printf 'error: %s\n' "$*" >&2; exit 1; }
info() { printf 'weaver: %s\n' "$*"; }
require() { command -v "$1" >/dev/null 2>&1 || fail "$1 is required but was not found"; }

check_platform() {
  [[ "$(uname -s)" == "Darwin" ]] || fail "the first public release supports macOS only"
  require node
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [[ "$major" -ge 24 ]] || fail "Node.js 24 or newer is required (found $(node --version))"
  [[ -f "$PLUGIN_ROOT/runtime/server.mjs" ]] || fail "release runtime is missing; run npm run build:release in a source checkout"
}

install_claude() {
  check_platform
  require claude
  mkdir -p "$CLAUDE_SKILLS" "$BACKUP_ROOT"
  local stamp
  stamp="$(date +%Y%m%d-%H%M%S)"
  for skill in "${SKILLS[@]}"; do
    if [[ -e "$CLAUDE_SKILLS/$skill" && ! -L "$CLAUDE_SKILLS/$skill" ]]; then
      cp -R "$CLAUDE_SKILLS/$skill" "$BACKUP_ROOT/$skill-$stamp"
      info "backed up existing $skill skill"
    fi
    rm -rf "$CLAUDE_SKILLS/$skill"
    cp -R "$PLUGIN_ROOT/claude-skills/$skill" "$CLAUDE_SKILLS/$skill"
  done
  claude mcp remove --scope user weaver-preview >/dev/null 2>&1 || true
  claude mcp add --scope user weaver-preview -- node "$PLUGIN_ROOT/scripts/start-mcp-claude.mjs" >/dev/null
  info "installed Claude Code skills and weaver-preview MCP"
  doctor
  info "restart Claude Code or run /reload-skills, then use /weaver-open"
}

doctor() {
  check_platform
  local failed=0
  info "Node $(node --version)"
  if command -v codex >/dev/null 2>&1; then info "Codex CLI found"; else info "Codex CLI not found (optional)"; fi
  if command -v claude >/dev/null 2>&1; then
    info "Claude Code found"
    if claude mcp get weaver-preview >/dev/null 2>&1; then info "weaver-preview MCP registered"; else info "weaver-preview MCP not registered"; failed=1; fi
  else
    info "Claude Code not found"
  fi
  for skill in "${SKILLS[@]}"; do
    [[ -f "$CLAUDE_SKILLS/$skill/SKILL.md" ]] && info "$skill skill installed" || { info "$skill skill not installed"; failed=1; }
  done
  local version
  version="$(node -p "JSON.parse(require('fs').readFileSync('$PLUGIN_ROOT/.release-manifest.json','utf8')).version")"
  info "runtime $version ready at $PLUGIN_ROOT"
  return "$failed"
}

update_install() {
  check_platform
  require git
  git -C "$ROOT" diff --quiet || fail "the Weaver checkout has local changes; update aborted"
  git -C "$ROOT" pull --ff-only
  install_claude
}

uninstall_claude() {
  if command -v claude >/dev/null 2>&1; then claude mcp remove --scope user weaver-preview >/dev/null 2>&1 || true; fi
  for skill in "${SKILLS[@]}"; do rm -rf "$CLAUDE_SKILLS/$skill"; done
  info "removed Weaver's Claude MCP registration and skills"
  info "project .weaver directories were not touched"
}

case "${1:-}" in
  claude) install_claude ;;
  doctor) doctor ;;
  update) update_install ;;
  uninstall) uninstall_claude ;;
  *) printf 'Usage: %s {claude|doctor|update|uninstall}\n' "$0"; exit 2 ;;
esac
