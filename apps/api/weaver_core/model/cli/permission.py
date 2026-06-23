from __future__ import annotations

import shlex
from enum import StrEnum

from pydantic import BaseModel


class ActionCategory(StrEnum):
    READONLY = "readonly"
    EDIT = "edit"
    NETWORK = "network"
    UNKNOWN = "unknown"


class PermissionSet(BaseModel):
    auto_run_readonly: bool = False
    allow_file_edits: bool = False
    network_access: bool = False


class Decision(BaseModel):
    allowed: bool
    category: ActionCategory
    reason: str


READONLY_COMMANDS = {"ls", "pwd", "cat", "rg", "grep", "sed", "head", "tail", "find", "git"}
EDIT_COMMANDS = {"touch", "cp", "mv", "rm", "mkdir", "rmdir", "chmod", "chown", "tee", "python", "node", "npm"}
NETWORK_COMMANDS = {"curl", "wget", "ssh", "scp", "rsync", "gh"}


def classify(command: str) -> ActionCategory:
    try:
        parts = shlex.split(command)
    except ValueError:
        return ActionCategory.UNKNOWN
    if not parts:
        return ActionCategory.UNKNOWN
    executable = parts[0].split("/")[-1]
    if executable in NETWORK_COMMANDS:
        return ActionCategory.NETWORK
    if executable in EDIT_COMMANDS:
        return ActionCategory.EDIT
    if executable in READONLY_COMMANDS:
        if executable == "git" and len(parts) > 1 and parts[1] not in {"status", "log", "show", "diff", "branch", "remote"}:
            return ActionCategory.EDIT
        return ActionCategory.READONLY
    return ActionCategory.UNKNOWN


class PermissionGate:
    def __init__(self, permissions: PermissionSet | None = None) -> None:
        self.permissions = permissions or PermissionSet()

    def authorize(self, command: str) -> Decision:
        category = classify(command)
        if category == ActionCategory.READONLY:
            return Decision(
                allowed=self.permissions.auto_run_readonly,
                category=category,
                reason="readonly allowed" if self.permissions.auto_run_readonly else "readonly auto-run disabled",
            )
        if category == ActionCategory.EDIT:
            return Decision(
                allowed=self.permissions.allow_file_edits,
                category=category,
                reason="file edits allowed" if self.permissions.allow_file_edits else "file edits disabled",
            )
        if category == ActionCategory.NETWORK:
            return Decision(
                allowed=self.permissions.network_access,
                category=category,
                reason="network allowed" if self.permissions.network_access else "network disabled",
            )
        return Decision(allowed=False, category=category, reason="unknown action requires explicit approval")
