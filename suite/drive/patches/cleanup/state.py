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
from dataclasses import asdict, dataclass, field
from pathlib import Path

STATE_FILENAME = "drive-cleanup-state.json"
STATE_VERSION = 1


class CorruptCleanupStateError(RuntimeError):
    """Cleanup's on-disk record exists but cannot be trusted, so this refuses
    outright rather than starting a fresh run in its place.

    An unreadable state file is not the same fact as "no run has reached
    here yet": the census and disk-settings snapshot `phase_file_rows`
    persists exist nowhere else once step 1's `DELETE`s and step 5's DDL
    have committed, so silently resetting to a fresh, empty record after
    that point would make a resumed run rescan a table already missing the
    rows it just deleted, and orphan whatever later phases needed the
    original answer to find. There is no automatic safe recovery from that:
    the only way back is restoring this site's database from a backup taken
    before the corruption, or an operator manually reconstructing the state
    file's `census`/`disk_settings_snapshot`/per-phase records by hand from
    other evidence before Cleanup may run again."""


def _quarantine_message(path: Path, spoiled: Path | None) -> str:
    where = f"quarantined at {spoiled}" if spoiled is not None else "left in place (quarantine itself failed)"
    return (
        f"{path} could not be read as Cleanup's state record; the unreadable file has been "
        f"{where}, preserved for forensics rather than deleted. This record is Cleanup's only "
        "copy of what earlier phases already committed, so an automatic fresh run is not safe: "
        "restore this site's database from a backup taken before the corruption, or have an "
        "operator manually reconstruct this file, before Cleanup may run again."
    )


@dataclass
class PhaseResult:
    """One phase's outcome. Only the counters that phase touches are non-zero."""

    completed: bool = False
    rows_deleted: int = 0
    fields_dropped: int = 0
    property_setters_dropped: int = 0
    doctypes_dropped: int = 0
    columns_dropped: int = 0
    single_values_dropped: int = 0
    docshares_deleted: int = 0
    ycomments_cleared: int = 0
    sheet_comments_stripped: int = 0
    forwarders_removed: int = 0
    wildcard_prefix_removed: bool = False
    sidecars_deleted: int = 0
    candidates_found: int = 0
    referenced_excluded: int = 0
    job_ids: list[str] = field(default_factory=list)

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
        """The state dict, or `{"version": STATE_VERSION}` if genuinely no
        run has reached this site yet (the file has never existed). An
        existing-but-unreadable file is a different fact entirely and is
        never conflated with a fresh start: it is quarantined for forensics
        and `CorruptCleanupStateError` is raised, so every caller — direct
        or through `get`/`get_census`/`get_settings_snapshot` — fails
        closed instead of silently treating corruption as "nothing has run
        yet." """
        try:
            with open(self.path, encoding="utf-8") as f:
                data = json.load(f)
        except FileNotFoundError:
            return {"version": STATE_VERSION}
        except (json.JSONDecodeError, UnicodeDecodeError):
            data = None
        if not isinstance(data, dict):
            spoiled = self._quarantine()
            raise CorruptCleanupStateError(_quarantine_message(self.path, spoiled))
        return data

    def refuse_if_corrupt(self) -> None:
        """`run_cleanup`'s first action, before preflight, the gates, or any
        phase: `load()` already raises on an unreadable existing record, so
        this exists to give that one required check an explicit name at the
        call site, rather than relying on some later, incidental `load()`
        call (inside preflight or the phase loop) to have caught it first."""
        self.load()

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

    def get_census(self) -> list[str] | None:
        """The drive-owned name census `phase_file_rows` persists, read by
        `phase_thumbnails`. `None` means no run has reached phase 1 yet;
        an empty list is a legitimate census (nothing was drive-owned)."""
        census = self.load().get("census")
        return list(census) if isinstance(census, list) else None

    def put_census(self, names: list[str]) -> None:
        self.save({**self.load(), "census": list(names)})

    def get_settings_snapshot(self) -> dict | None:
        """The `DISK_SETTINGS_FIELDS` snapshot `phase_file_rows` persists
        before step 5 drops the live columns, read by `phase_thumbnails` and
        `phase_s3_prefix`. `None` means no run has reached phase 1 yet."""
        snapshot = self.load().get("disk_settings_snapshot")
        return dict(snapshot) if isinstance(snapshot, dict) else None

    def put_settings_snapshot(self, settings: dict) -> None:
        self.save({**self.load(), "disk_settings_snapshot": dict(settings)})

    def _temp_path(self) -> Path:
        return self.path.with_suffix(f"{self.path.suffix}.{os.getpid()}.tmp")

    def _quarantine(self) -> Path | None:
        if not self.path.exists():
            return None
        stamp = time.strftime("%Y%m%d-%H%M%S")
        spoiled = self.path.with_name(f"{self.path.name}.corrupt-{stamp}-{os.getpid()}")
        try:
            os.replace(self.path, spoiled)
            self._sync_directory()
        except OSError:
            return None
        return spoiled

    def _sync_directory(self) -> None:
        try:
            fd = os.open(self.path.parent, os.O_RDONLY)
        except OSError:
            return
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
