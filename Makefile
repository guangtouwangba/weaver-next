.PHONY: help dev dev-api dev-web test build contracts contracts-emit contracts-ts lint codegen

help:
	@printf "Targets:\n"
	@printf "  dev-api    Start FastAPI on :8000\n"
	@printf "  dev-web    Start Next.js on :3000\n"
	@printf "  dev        Start API and web together\n"
	@printf "  test       Run backend tests\n"
	@printf "  build      Build frontend\n"
	@printf "  contracts  Emit OpenAPI and generated TypeScript contracts\n"
	@printf "  lint       Run frontend lint\n"
	@printf "  codegen    Run all generated-code tasks\n"

dev-api:
	.venv/bin/python -m uvicorn weaver_api.main:app --app-dir apps/api --reload --port 8000

dev-web:
	npm run dev:web

dev:
	npm run dev

test:
	.venv/bin/python -m pytest apps/api/tests

build:
	npm run build:web

contracts: contracts-emit contracts-ts

contracts-emit:
	.venv/bin/python tooling/codegen/emit.py

contracts-ts:
	bash tooling/codegen/gen-ts.sh

lint:
	npm run lint:web

codegen: contracts
