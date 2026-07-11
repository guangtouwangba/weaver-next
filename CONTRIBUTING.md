# Contributing to Weaver

Thanks for helping Weaver make branching thought visible and workable with coding agents.

## Before you start

Read [product.md](product.md), [AGENTS.md](AGENTS.md), [WORKFLOW.md](WORKFLOW.md), and the current [PRD](docs/PRD-Weaver-Redesign-2026.md). The PRD is the product source of truth; `WORKFLOW.md` defines the required TDD and real-page acceptance process.

## Development setup

```bash
git clone https://github.com/guangtouwangba/weaver-next.git
cd weaver-next
npm install
npm run build:plugin
npm test
```

Use a focused branch, add a failing test before the implementation, and keep unrelated working-tree changes intact. UI changes require a real browser or Codex Widget check in addition to unit tests.

## Pull requests

- Explain the user-visible problem and the chosen behavior.
- List the tests and real interaction path you ran.
- Call out contract, storage, migration, security, or compatibility effects.
- Update affected documentation and the generated plugin snapshot with `npm run build:release`.
- Do not commit `.weaver/`, credentials, logs, personal configuration, or arbitrary local paths.

By contributing, you agree that your contribution is licensed under the repository's [MIT License](LICENSE).
