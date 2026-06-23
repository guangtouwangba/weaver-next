from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Protocol

from pydantic import BaseModel


class SecretRef(BaseModel):
    uri: str


class SecretStore(Protocol):
    def put(self, name: str, value: str) -> SecretRef:
        ...

    def resolve(self, ref: SecretRef | str) -> str | None:
        ...


class EnvSecretStore:
    def put(self, name: str, value: str) -> SecretRef:
        raise NotImplementedError("EnvSecretStore is read-only")

    def resolve(self, ref: SecretRef | str) -> str | None:
        uri = ref.uri if isinstance(ref, SecretRef) else ref
        prefix = "env://"
        if not uri.startswith(prefix):
            return None
        return os.getenv(uri[len(prefix):])


class FileSecretStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def put(self, name: str, value: str) -> SecretRef:
        key = _safe_key(name)
        data = self._read()
        data[key] = value
        self._write(data)
        return SecretRef(uri=f"secret://file/{key}")

    def resolve(self, ref: SecretRef | str) -> str | None:
        uri = ref.uri if isinstance(ref, SecretRef) else ref
        prefix = "secret://file/"
        if not uri.startswith(prefix):
            return None
        return self._read().get(uri[len(prefix):])

    def _read(self) -> dict[str, str]:
        if not self.path.exists():
            return {}
        raw = self.path.read_text(encoding="utf-8")
        if not raw.strip():
            return {}
        parsed = json.loads(raw)
        return {str(key): str(value) for key, value in parsed.items()}

    def _write(self, data: dict[str, str]) -> None:
        tmp_path = self.path.with_suffix(f"{self.path.suffix}.tmp")
        tmp_path.write_text(json.dumps(data, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        os.chmod(tmp_path, 0o600)
        tmp_path.replace(self.path)
        os.chmod(self.path, 0o600)


def _safe_key(name: str) -> str:
    cleaned = "".join(char if char.isalnum() or char in {"_", "-"} else "_" for char in name.strip())
    return cleaned or "secret"
