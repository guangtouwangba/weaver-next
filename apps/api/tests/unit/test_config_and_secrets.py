from __future__ import annotations

import stat

import pytest

from weaver_api.config import load_config
from weaver_core.persistence.secrets import EnvSecretStore, FileSecretStore
from weaver_core.model import FakeProvider, default_registry


def test_config_reads_environment_with_defaults_and_aliases(tmp_path) -> None:
    default_config = load_config({})
    assert default_config.database_url == "sqlite:///./weaver.db"
    assert default_config.vector_backend == "numpy_flat"
    assert default_config.model_mode == "fake"

    config = load_config(
        {
            "DATABASE_URL": "sqlite:///tmp.db",
            "VECTOR_BACKEND": "sqlite_vec",
            "WEAVER_DATA_DIR": str(tmp_path),
            "SECRET_STORE": "env",
            "WEAVER_MODEL_MODE": "real",
            "WEAVER_BEARER_TOKEN": "token",
        }
    )

    assert config.database_url == "sqlite:///tmp.db"
    assert config.vector_backend == "sqlite_vec"
    assert config.data_dir == tmp_path
    assert config.secret_store == "env"
    assert config.model_mode == "real"
    assert config.bearer_token == "token"
    assert config.secrets_path == tmp_path / "secrets.json"


def test_file_secret_store_round_trip_ref_and_permissions(tmp_path) -> None:
    store = FileSecretStore(tmp_path / "secrets.json")

    ref = store.put("api key", "plain-secret-value")

    assert ref.uri == "secret://file/api_key"
    assert "plain-secret-value" not in ref.model_dump_json()
    assert store.resolve(ref) == "plain-secret-value"
    assert stat.S_IMODE((tmp_path / "secrets.json").stat().st_mode) == 0o600


def test_env_secret_store_resolves_without_serializing_plaintext(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WEAVER_TEST_SECRET", "env-secret")

    store = EnvSecretStore()

    assert store.resolve("env://WEAVER_TEST_SECRET") == "env-secret"
    with pytest.raises(NotImplementedError):
        store.put("WEAVER_TEST_SECRET", "env-secret")


def test_test_env_uses_fake_provider_and_deterministic_factories(id_factory, clock) -> None:
    first_ids = [id_factory(), id_factory()]
    first_times = [clock().isoformat(), clock().isoformat()]

    second_id_factory = (f"test_ulid_{index:04d}" for index in [1, 2])
    second_clock_start = ["2026-06-23T00:00:00+00:00", "2026-06-23T00:00:01+00:00"]

    assert isinstance(default_registry().default_for(), FakeProvider)
    assert first_ids == list(second_id_factory)
    assert first_times == second_clock_start
