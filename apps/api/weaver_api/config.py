from __future__ import annotations

import os
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field


class WeaverConfig(BaseModel):
    database_url: str = "sqlite:///./weaver.db"
    vector_backend: str = "numpy_flat"
    data_dir: Path = Field(default_factory=lambda: Path(".weaver-data"))
    secret_store: Literal["file", "env"] = "file"
    model_mode: Literal["fake", "real"] = "fake"
    bearer_token: str | None = None

    @property
    def secrets_path(self) -> Path:
        return self.data_dir / "secrets.json"


def load_config(environ: dict[str, str] | None = None) -> WeaverConfig:
    env = environ if environ is not None else os.environ
    return WeaverConfig(
        database_url=env.get("DATABASE_URL", "sqlite:///./weaver.db"),
        vector_backend=env.get("VECTOR_BACKEND", "numpy_flat"),
        data_dir=Path(env.get("WEAVER_DATA_DIR", ".weaver-data")),
        secret_store=_secret_store(env.get("SECRET_STORE", "file")),
        model_mode=_model_mode(env.get("MODEL_MODE", env.get("WEAVER_MODEL_MODE", "fake"))),
        bearer_token=env.get("WEAVER_BEARER_TOKEN"),
    )


def _secret_store(value: str) -> Literal["file", "env"]:
    return "env" if value == "env" else "file"


def _model_mode(value: str) -> Literal["fake", "real"]:
    return "real" if value == "real" else "fake"
