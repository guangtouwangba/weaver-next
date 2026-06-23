from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ProjectModel(TimestampMixin, Base):
    __tablename__ = "project"

    id: Mapped[str] = mapped_column(String(26), primary_key=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="thinking")
    voice_default: Mapped[str | None] = mapped_column(String(32))
    default_backend_id: Mapped[str | None] = mapped_column(ForeignKey("model_backend.id", ondelete="SET NULL"))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    nodes: Mapped[list[ThoughtNodeModel]] = relationship(back_populates="project")


class ThoughtNodeModel(TimestampMixin, Base):
    __tablename__ = "thought_node"

    id: Mapped[str] = mapped_column(String(26), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"), index=True, nullable=False)
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("thought_node.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="open")
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tag: Mapped[str] = mapped_column(String(64), nullable=False, default="THOUGHT")
    collapsed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    project: Mapped[ProjectModel] = relationship(back_populates="nodes")


class QuickNoteModel(TimestampMixin, Base):
    __tablename__ = "quick_note"

    id: Mapped[str] = mapped_column(String(26), primary_key=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    project_id: Mapped[str | None] = mapped_column(ForeignKey("project.id", ondelete="SET NULL"))
    promoted_node_id: Mapped[str | None] = mapped_column(ForeignKey("thought_node.id", ondelete="SET NULL"))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class BackendModel(TimestampMixin, Base):
    __tablename__ = "model_backend"

    id: Mapped[str] = mapped_column(String(26), primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    model: Mapped[str] = mapped_column(Text, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    api_key_ref: Mapped[str | None] = mapped_column(Text)
    permissions: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)


class IdempotencyKeyModel(Base):
    __tablename__ = "idempotency_key"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(128), nullable=False)
    result: Mapped[dict] = mapped_column(JSON, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (UniqueConstraint("key", "fingerprint", name="ux_idempotency_key_fingerprint"),)
