from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


def test_canonical_phase_zero_directories_exist() -> None:
    expected = [
        "apps/api/weaver_core/tree",
        "apps/api/weaver_core/relations",
        "apps/api/weaver_core/crystallize",
        "apps/api/weaver_core/draft",
        "apps/api/weaver_core/citation",
        "apps/api/weaver_core/model",
        "apps/api/weaver_core/retrieval",
        "apps/api/weaver_core/persistence",
        "tooling/codegen",
        "tooling/docker",
    ]

    for relative_path in expected:
        directory = ROOT / relative_path
        assert directory.is_dir(), relative_path


def test_canonical_phase_zero_packages_are_importable() -> None:
    import weaver_core.citation
    import weaver_core.crystallize
    import weaver_core.draft
    import weaver_core.model
    import weaver_core.persistence
    import weaver_core.relations
    import weaver_core.retrieval
    import weaver_core.tree

    assert weaver_core.tree.__doc__
