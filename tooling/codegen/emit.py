from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
API_ROOT = ROOT / "apps" / "api"
OUTPUT = ROOT / "packages" / "contracts" / "openapi.json"


def main() -> None:
    sys.path.insert(0, str(API_ROOT))
    from weaver_api.main import app

    schema = app.openapi()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps(schema, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
