from __future__ import annotations

import hashlib
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
GENERATED_FILES = [
    ROOT / "packages/contracts/openapi.json",
    ROOT / "packages/contracts/generated/openapi.gen.ts",
    ROOT / "packages/contracts/generated/client.gen.ts",
    ROOT / "packages/contracts/generated/errors.gen.ts",
]


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_contract_codegen_is_deterministic_and_has_generated_headers() -> None:
    subprocess.run(["make", "contracts"], cwd=ROOT, check=True)
    first = {path: _digest(path) for path in GENERATED_FILES}

    subprocess.run(["make", "contracts"], cwd=ROOT, check=True)
    second = {path: _digest(path) for path in GENERATED_FILES}

    assert first == second
    for path in GENERATED_FILES[1:]:
        assert path.read_text(encoding="utf-8").startswith("// DO NOT EDIT - generated")
    assert '"ProjectSummary"' in (ROOT / "packages/contracts/openapi.json").read_text(encoding="utf-8")
