from __future__ import annotations

import pytest

from weaver_core.model.cli.permission import ActionCategory, PermissionGate, PermissionSet, classify


@pytest.mark.parametrize(
    ("command", "category"),
    [
        ("ls -la", ActionCategory.READONLY),
        ("cat README.md", ActionCategory.READONLY),
        ("git status --short", ActionCategory.READONLY),
        ("git commit -m test", ActionCategory.EDIT),
        ("touch app.py", ActionCategory.EDIT),
        ("rm old.txt", ActionCategory.EDIT),
        ("curl https://example.com", ActionCategory.NETWORK),
        ("wget https://example.com/file", ActionCategory.NETWORK),
        ("", ActionCategory.UNKNOWN),
        ("unterminated 'quote", ActionCategory.UNKNOWN),
        ("custom-tool run", ActionCategory.UNKNOWN),
    ],
)
def test_classify_actions(command: str, category: ActionCategory) -> None:
    assert classify(command) == category


@pytest.mark.parametrize(
    ("category_command", "permissions", "allowed"),
    [
        ("ls", PermissionSet(), False),
        ("touch file", PermissionSet(), False),
        ("curl https://example.com", PermissionSet(), False),
        ("unknown", PermissionSet(), False),
        ("ls", PermissionSet(auto_run_readonly=True), True),
        ("touch file", PermissionSet(auto_run_readonly=True), False),
        ("touch file", PermissionSet(allow_file_edits=True), True),
        ("curl https://example.com", PermissionSet(network_access=True), True),
        ("unknown", PermissionSet(auto_run_readonly=True, allow_file_edits=True, network_access=True), False),
    ],
)
def test_authorize_truth_table(category_command: str, permissions: PermissionSet, allowed: bool) -> None:
    decision = PermissionGate(permissions).authorize(category_command)

    assert decision.allowed is allowed
