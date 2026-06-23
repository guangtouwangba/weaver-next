from __future__ import annotations

from pydantic import BaseModel


class ForkProposalItem(BaseModel):
    title: str
    prompt: str
    suggested_label: str


class ForkProposalStructured(BaseModel):
    proposals: list[ForkProposalItem]
    digest: str | None = None


FORK_PROPOSAL_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "proposals": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "prompt": {"type": "string"},
                    "suggested_label": {"type": "string"},
                },
                "required": ["title", "prompt", "suggested_label"],
            },
        },
        "digest": {"type": "string"},
    },
    "required": ["proposals"],
}
