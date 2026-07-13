.DEFAULT_GOAL := plugin-build

.PHONY: plugin-build build install release check-release probe test lint typecheck dev help

# One-command reproducible plugin build from the committed lockfile.
plugin-build: install
	npm run build:plugin

build: plugin-build

install:
	npm ci

release: install
	npm run build:release

check-release:
	npm run check:release

probe:
	node scripts/probe-mcp.mjs

test:
	npm test

lint:
	npm run lint

typecheck:
	npm run typecheck:widget

dev:
	npm run dev

help:
	@printf "Targets:\n"
	@printf "  plugin-build  Install dependencies and build packages + Widget (default)\n"
	@printf "  build         Alias for plugin-build\n"
	@printf "  release       Build the distributable plugin release\n"
	@printf "  check-release Validate the distributable plugin release\n"
	@printf "  probe         Probe the local MCP tool surface\n"
	@printf "  test          Run the test suite\n"
	@printf "  lint          Run Biome lint\n"
	@printf "  typecheck     Type-check the Widget\n"
	@printf "  dev           Start the Widget development server\n"
