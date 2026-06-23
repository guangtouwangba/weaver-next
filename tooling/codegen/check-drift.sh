#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

make contracts

untracked="$(git ls-files --others --exclude-standard -- packages/contracts/openapi.json packages/contracts/generated)"

if [ -n "$untracked" ] || ! git diff --exit-code -- packages/contracts/openapi.json packages/contracts/generated; then
  printf '\ncontracts stale, run `make contracts`\n' >&2
  if [ -n "$untracked" ]; then
    printf '%s\n' "$untracked" >&2
  fi
  exit 1
fi
