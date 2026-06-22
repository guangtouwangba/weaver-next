.PHONY: help dev dev-api dev-web test build

help:
	@printf "Targets:\n"
	@printf "  dev-api    Start FastAPI on :8000\n"
	@printf "  dev-web    Start Next.js on :3000\n"
	@printf "  dev        Start API and web together\n"
	@printf "  test       Run backend tests\n"
	@printf "  build      Build frontend\n"

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
