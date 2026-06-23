from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from weaver_core.persistence.ids import new_ulid
from weaver_core.persistence.models import BackendModel, IdempotencyKeyModel, ProjectModel, QuickNoteModel, ThoughtNodeModel
from weaver_core.persistence.protocols import BackendRecord, IdempotencyRecord, ProjectRecord, QuickNoteRecord
from weaver_core.schemas.node import ThoughtNode


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class SqlAlchemyProjectRepo:
    def __init__(self, session: Session) -> None:
        self.session = session

    def create(self, title: str) -> ProjectRecord:
        now = utc_now()
        row = ProjectModel(id=new_ulid(), title=title, status="thinking", created_at=now, updated_at=now)
        self.session.add(row)
        self.session.flush()
        return _project_record(row)

    def get(self, project_id: str) -> ProjectRecord | None:
        row = self.session.get(ProjectModel, project_id)
        return _project_record(row) if row else None


class SqlAlchemyNodeRepo:
    def __init__(self, session: Session) -> None:
        self.session = session

    def create(self, node: ThoughtNode) -> ThoughtNode:
        now = utc_now()
        row = ThoughtNodeModel(
            id=node.id,
            project_id=node.project_id,
            parent_id=node.parent_id,
            title=node.title,
            body=node.body,
            status=node.status,
            order_index=node.order_index,
            tag=node.tag,
            created_at=now,
            updated_at=now,
        )
        self.session.add(row)
        self.session.flush()
        return _thought_node(row)

    def list_for_project(self, project_id: str) -> list[ThoughtNode]:
        rows = self.session.scalars(
            select(ThoughtNodeModel)
            .where(ThoughtNodeModel.project_id == project_id)
            .order_by(ThoughtNodeModel.parent_id, ThoughtNodeModel.order_index, ThoughtNodeModel.id)
        ).all()
        return [_thought_node(row) for row in rows]


class SqlAlchemyQuickNoteRepo:
    def __init__(self, session: Session) -> None:
        self.session = session

    def create(self, text: str, project_id: str | None = None) -> QuickNoteRecord:
        now = utc_now()
        row = QuickNoteModel(id=new_ulid(), text=text, project_id=project_id, created_at=now, updated_at=now)
        self.session.add(row)
        self.session.flush()
        return _quicknote_record(row)

    def get(self, quicknote_id: str) -> QuickNoteRecord | None:
        row = self.session.get(QuickNoteModel, quicknote_id)
        return _quicknote_record(row) if row else None


class SqlAlchemyBackendRepo:
    def __init__(self, session: Session) -> None:
        self.session = session

    def create(self, name: str, kind: str, provider: str, model: str) -> BackendRecord:
        now = utc_now()
        row = BackendModel(
            id=new_ulid(),
            name=name,
            kind=kind,
            provider=provider,
            model=model,
            created_at=now,
            updated_at=now,
        )
        self.session.add(row)
        self.session.flush()
        return _backend_record(row)

    def get(self, backend_id: str) -> BackendRecord | None:
        row = self.session.get(BackendModel, backend_id)
        return _backend_record(row) if row else None


class SqlAlchemyIdempotencyRepo:
    def __init__(self, session: Session) -> None:
        self.session = session

    def put(self, record: IdempotencyRecord) -> None:
        self.session.merge(
            IdempotencyKeyModel(
                key=record.key,
                fingerprint=record.fingerprint,
                result=record.result,
                expires_at=record.expires_at,
                created_at=record.created_at,
            )
        )
        self.session.flush()

    def get(self, key: str) -> IdempotencyRecord | None:
        row = self.session.get(IdempotencyKeyModel, key)
        return _idempotency_record(row) if row else None


def _project_record(row: ProjectModel) -> ProjectRecord:
    return ProjectRecord.model_validate(row, from_attributes=True)


def _quicknote_record(row: QuickNoteModel) -> QuickNoteRecord:
    return QuickNoteRecord.model_validate(row, from_attributes=True)


def _backend_record(row: BackendModel) -> BackendRecord:
    return BackendRecord.model_validate(row, from_attributes=True)


def _idempotency_record(row: IdempotencyKeyModel) -> IdempotencyRecord:
    return IdempotencyRecord.model_validate(row, from_attributes=True)


def _thought_node(row: ThoughtNodeModel) -> ThoughtNode:
    return ThoughtNode(
        id=row.id,
        project_id=row.project_id,
        parent_id=row.parent_id,
        title=row.title,
        body=row.body,
        status=row.status,
        order_index=row.order_index,
        tag=row.tag,
    )
