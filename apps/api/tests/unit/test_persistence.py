from __future__ import annotations

import ast
import asyncio
from datetime import timedelta
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect

from weaver_core.persistence import Base, SqlAlchemyUnitOfWork, make_engine, sqlite_url
from weaver_core.persistence.models import Base as ModelBase
from weaver_core.persistence.protocols import IdempotencyRecord
from weaver_core.persistence.repositories import utc_now
from weaver_core.schemas.node import ThoughtNode


ROOT = Path(__file__).resolve().parents[4]
API_ROOT = ROOT / "apps/api"


def test_repo_crud_round_trip_on_temp_sqlite(tmp_path) -> None:
    engine = make_engine(sqlite_url(tmp_path / "repo.db"))
    Base.metadata.create_all(engine)

    async def scenario() -> None:
        async with SqlAlchemyUnitOfWork(engine) as uow:
            project = uow.projects.create("Persistent project")
            node = uow.nodes.create(
                ThoughtNode(
                    id="01KVS1A8G3PKGKQE15SF5JGP87",
                    project_id=project.id,
                    parent_id=None,
                    title="Root",
                    body="Root body",
                )
            )
            quicknote = uow.quicknotes.create("Capture this", project.id)
            backend = uow.backends.create("Fake", "fake", "weaver", "deterministic")
            now = utc_now()
            uow.idempotency.put(
                IdempotencyRecord(
                    key="idem-1",
                    fingerprint="fingerprint",
                    result={"node_id": node.id},
                    expires_at=now + timedelta(hours=24),
                    created_at=now,
                )
            )

            assert project.id
            assert project.created_at <= project.updated_at
            assert quicknote.project_id == project.id
            assert backend.provider == "weaver"

        async with SqlAlchemyUnitOfWork(engine) as uow:
            assert uow.projects.get(project.id) is not None
            assert [item.id for item in uow.nodes.list_for_project(project.id)] == [node.id]
            assert uow.quicknotes.get(quicknote.id).text == "Capture this"
            assert uow.backends.get(backend.id).name == "Fake"
            assert uow.idempotency.get("idem-1").result == {"node_id": node.id}

    asyncio.run(scenario())


def test_unit_of_work_rolls_back_on_error(tmp_path) -> None:
    engine = make_engine(sqlite_url(tmp_path / "rollback.db"))
    Base.metadata.create_all(engine)

    async def scenario() -> None:
        try:
            async with SqlAlchemyUnitOfWork(engine) as uow:
                project = uow.projects.create("Rollback project")
                raise RuntimeError(project.id)
        except RuntimeError as exc:
            project_id = str(exc)

        async with SqlAlchemyUnitOfWork(engine) as uow:
            assert uow.projects.get(project_id) is None

    asyncio.run(scenario())


def test_alembic_upgrade_head_matches_metadata_tables(tmp_path) -> None:
    db_path = tmp_path / "alembic.db"
    config = Config(str(API_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(API_ROOT / "alembic"))
    config.set_main_option("sqlalchemy.url", sqlite_url(db_path))

    command.upgrade(config, "head")

    engine = make_engine(sqlite_url(db_path))
    db_tables = set(inspect(engine).get_table_names()) - {"alembic_version"}
    assert db_tables == set(ModelBase.metadata.tables)


def test_routes_do_not_import_sqlalchemy() -> None:
    tree = ast.parse((API_ROOT / "weaver_api/main.py").read_text(encoding="utf-8"))
    imports: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imports.append(node.module)

    assert not any(name == "sqlalchemy" or name.startswith("sqlalchemy.") for name in imports)
