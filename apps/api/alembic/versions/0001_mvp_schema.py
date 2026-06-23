"""MVP persistence schema.

Revision ID: 0001_mvp_schema
Revises:
Create Date: 2026-06-23
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0001_mvp_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "model_backend",
        sa.Column("id", sa.String(length=26), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("provider", sa.String(length=64), nullable=False),
        sa.Column("model", sa.Text(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False),
        sa.Column("api_key_ref", sa.Text()),
        sa.Column("permissions", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "project",
        sa.Column("id", sa.String(length=26), primary_key=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("voice_default", sa.String(length=32)),
        sa.Column("default_backend_id", sa.String(length=26), sa.ForeignKey("model_backend.id", ondelete="SET NULL")),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "thought_node",
        sa.Column("id", sa.String(length=26), primary_key=True),
        sa.Column("project_id", sa.String(length=26), sa.ForeignKey("project.id", ondelete="CASCADE"), nullable=False),
        sa.Column("parent_id", sa.String(length=26), sa.ForeignKey("thought_node.id", ondelete="CASCADE")),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False),
        sa.Column("tag", sa.String(length=64), nullable=False),
        sa.Column("collapsed", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_thought_node_project_id", "thought_node", ["project_id"])
    op.create_index("ix_thought_node_parent_id", "thought_node", ["parent_id"])
    op.create_table(
        "quick_note",
        sa.Column("id", sa.String(length=26), primary_key=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("project_id", sa.String(length=26), sa.ForeignKey("project.id", ondelete="SET NULL")),
        sa.Column("promoted_node_id", sa.String(length=26), sa.ForeignKey("thought_node.id", ondelete="SET NULL")),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "idempotency_key",
        sa.Column("key", sa.String(length=128), primary_key=True),
        sa.Column("fingerprint", sa.String(length=128), nullable=False),
        sa.Column("result", sa.JSON(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("key", "fingerprint", name="ux_idempotency_key_fingerprint"),
    )


def downgrade() -> None:
    op.drop_table("idempotency_key")
    op.drop_table("quick_note")
    op.drop_index("ix_thought_node_parent_id", table_name="thought_node")
    op.drop_index("ix_thought_node_project_id", table_name="thought_node")
    op.drop_table("thought_node")
    op.drop_table("project")
    op.drop_table("model_backend")
