from __future__ import annotations

from types import TracebackType

from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from weaver_core.persistence.repositories import (
    SqlAlchemyBackendRepo,
    SqlAlchemyIdempotencyRepo,
    SqlAlchemyNodeRepo,
    SqlAlchemyProjectRepo,
    SqlAlchemyQuickNoteRepo,
)


class SqlAlchemyUnitOfWork:
    def __init__(self, engine: Engine) -> None:
        self._session_factory = sessionmaker(bind=engine, expire_on_commit=False, future=True)
        self.session: Session | None = None

    async def __aenter__(self) -> "SqlAlchemyUnitOfWork":
        self.session = self._session_factory()
        self.projects = SqlAlchemyProjectRepo(self.session)
        self.nodes = SqlAlchemyNodeRepo(self.session)
        self.quicknotes = SqlAlchemyQuickNoteRepo(self.session)
        self.backends = SqlAlchemyBackendRepo(self.session)
        self.idempotency = SqlAlchemyIdempotencyRepo(self.session)
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        assert self.session is not None
        if exc_type:
            self.session.rollback()
        else:
            self.session.commit()
        self.session.close()
