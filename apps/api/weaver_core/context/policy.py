from __future__ import annotations

from hashlib import sha256

from pydantic import BaseModel


class ContextPolicy(BaseModel):
    include_dead_end_ancestors: bool = False
    grounding_enabled: bool = False
    max_depth: int | None = None

    def fingerprint(self, chain_ids: list[str], excluded_dead_end_ids: list[str], target_node_id: str) -> str:
        payload = "|".join(
            [
                target_node_id,
                ",".join(chain_ids),
                ",".join(excluded_dead_end_ids),
                f"grounding={self.grounding_enabled}",
                f"dead_ends={self.include_dead_end_ancestors}",
                f"max_depth={self.max_depth}",
            ]
        )
        return sha256(payload.encode("utf-8")).hexdigest()[:16]

    def apply_depth_window(self, chain_ids: list[str]) -> list[str]:
        if self.max_depth is None or self.max_depth <= 0:
            return chain_ids
        return chain_ids[-self.max_depth:]
