"""Cleanup's durable record, saved under the site's private directory.

Mirrors `suite.drive.patches.build.state`'s atomic-write discipline: a
temp file, `fsync`, `os.replace`, and a directory `fsync`, so a run killed
mid-write leaves the previous version readable, and an unreadable file is
quarantined rather than silently overwritten. Cleanup's phases are far
smaller than Build's, so one shared `PhaseResult` shape covers all eight
instead of one dataclass per phase.
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import asdict, dataclass
from pathlib import Path

STATE_FILENAME = "drive-cleanup-state.json"
STATE_VERSION = 1


@dataclass
class PhaseResult:
    """One phase's outcome. Only the counters that phase touches are non-zero."""

    completed: bool = False
    rows_deleted: int = 0
    fields_dropped: int = 0
    property_setters_dropped: int = 0
    doctypes_dropped: int = 0
    columns_dropped: int = 0
    docshares_deleted: int = 0
    ycomments_cleared: int = 0
    sheet_comments_stripped: int = 0
    forwarders_removed: int = 0
    wildcard_prefix_removed: bool = False
    sidecars_deleted: int = 0
    candidates_found: int = 0
    referenced_excluded: int = 0
    job_id: str | None = None

    def as_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> PhaseResult:
        known = cls.__dataclass_fields__
        return cls(**{key: value for key, value in (data or {}).items() if key in known})


class CleanupState:
    """The JSON document at `<site>/private/drive-cleanup-state.json`."""

    def __init__(self, path: Path):
        self.path = Path(path)

    @classmethod
    def for_site(cls) -> CleanupState:
        import frappe

        return cls(Path(frappe.get_site_path("private", STATE_FILENAME)))

    def load(self) -> dict:
        try:
            with open(self.path, encoding="utf-8") as f:
                data = json.load(f)
        except FileNotFoundError:
            return {"version": STATE_VERSION}
        except (json.JSONDecodeError, UnicodeDecodeError):
            data = None
        if not isinstance(data, dict):
            self._quarantine()
            return {"version": STATE_VERSION}
        return data

    def save(self, data: dict) -> None:
        data = {**data, "version": STATE_VERSION}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = self._temp_path()
        with open(temp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, sort_keys=True)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, self.path)
        self._sync_directory()

    def get(self, phase: str) -> PhaseResult:
        stored = self.load().get(phase)
        return PhaseResult.from_dict(stored if isinstance(stored, dict) else {})

    def put(self, phase: str, result: PhaseResult) -> None:
        self.save({**self.load(), phase: result.as_dict()})

    def _temp_path(self) -> Path:
        return self.path.with_suffix(f"{self.path.suffix}.{os.getpid()}.tmp")

    def _quarantine(self) -> None:
        if not self.path.exists():
            return
        stamp = time.strftime("%Y%m%d-%H%M%S")
        spoiled = self.path.with_name(f"{self.path.name}.corrupt-{stamp}-{os.getpid()}")
        try:
            os.replace(self.path, spoiled)
            self._sync_directory()
        except OSError:
            pass

    def _sync_directory(self) -> None:
        try:
            fd = os.open(self.path.parent, os.O_RDONLY)
        except OSError:
            return
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
