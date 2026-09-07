"""Build's durable record, saved under the site's private directory.

Build is resumable, so the numbers the final report prints (§14.9) cannot
live in memory. Every step writes its result here, and the report step
reads it back. The file is rewritten atomically, so a run killed mid-write
leaves the previous version readable.

Two kinds of number live in `StoragePreparation`:

- **cumulative** — `CUMULATIVE_FIELDS`. Each object is copied once ever, so
  a resumed run adds to the total instead of restarting it. These totals
  exist nowhere else, which is why an unreadable record is quarantined
  rather than overwritten.
- **per run** — everything else. A rerun recomputes them, so bytes that
  came back between two runs stop being reported as missing.
"""

import json
import os
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

STATE_FILENAME = "drive-build-state.json"
STATE_VERSION = 1

CUMULATIVE_FIELDS = frozenset(
    {
        "backfill_linked",
        "backfill_blobs_created",
        "s3_objects_copied",
        "s3_bytes_copied",
        "s3_objects_reused",
    }
)

# `missing_bytes` is held whole in memory and rewritten after every batch, so
# a site with a broken bucket must not turn the record into a multi-GB file.
# Past this many entries only the count keeps rising.
MISSING_BYTES_KEPT = 10000


@dataclass
class MissingBytes:
    """A `File` row that has no blob because its bytes could not be read."""

    file: str
    file_url: str
    reason: str


@dataclass
class StoragePreparation:
    """The result of §14.2 steps 1 to 3."""

    completed: bool = False
    backfill_linked: int = 0
    backfill_blobs_created: int = 0
    s3_rows_seen: int = 0
    s3_objects_copied: int = 0
    s3_bytes_copied: int = 0
    s3_objects_reused: int = 0
    s3_objects_missing: int = 0
    missing_bytes: list[MissingBytes] = field(default_factory=list)
    missing_bytes_total: int = 0

    def record_missing(self, entry: MissingBytes) -> None:
        """Count every row with no reachable bytes; keep a bounded sample.

        The count is the number the report must not understate. The list is
        the operator's evidence, and past `MISSING_BYTES_KEPT` it stops
        growing so one broken bucket cannot make the record unwritable."""
        self.missing_bytes_total += 1
        if len(self.missing_bytes) < MISSING_BYTES_KEPT:
            self.missing_bytes.append(entry)

    def begin_run(self) -> None:
        """Clear the per-run numbers; keep the cumulative ones."""
        blank = StoragePreparation()
        for name in self.__dataclass_fields__:
            if name not in CUMULATIVE_FIELDS:
                setattr(self, name, getattr(blank, name))

    def as_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> StoragePreparation:
        known = {f for f in cls.__dataclass_fields__ if f != "missing_bytes"}
        prep = cls(**{k: v for k, v in data.items() if k in known})
        prep.missing_bytes = [
            MissingBytes(**{k: v for k, v in row.items() if k in MissingBytes.__dataclass_fields__})
            for row in data.get("missing_bytes") or []
            if isinstance(row, dict)
        ]
        return prep


class BuildState:
    """The JSON document at `<site>/private/drive-build-state.json`."""

    def __init__(self, path: Path):
        self.path = Path(path)

    @classmethod
    def for_site(cls) -> BuildState:
        import frappe

        return cls(Path(frappe.get_site_path("private", STATE_FILENAME)))

    def load(self) -> dict:
        try:
            with open(self.path, encoding="utf-8") as f:
                data = json.load(f)
        except FileNotFoundError:
            return {"version": STATE_VERSION}
        except (json.JSONDecodeError, UnicodeDecodeError):
            # Unreadable content. A read error (EIO, EACCES) is not: losing
            # the cumulative totals to a transient fault would make the
            # report understate a migration that really did run, so it
            # propagates and the run stops instead.
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

    def _temp_path(self) -> Path:
        """Per process: a second run writing the same `.tmp` could interleave
        and have `os.replace` promote a half-written file."""
        return self.path.with_suffix(f"{self.path.suffix}.{os.getpid()}.tmp")

    def storage(self) -> StoragePreparation:
        stored = self.load().get("storage")
        return StoragePreparation.from_dict(stored if isinstance(stored, dict) else {})

    def put_storage(self, prep: StoragePreparation) -> None:
        self.save({**self.load(), "storage": prep.as_dict()})

    def _quarantine(self) -> None:
        """Move an unreadable record aside instead of overwriting it.

        The cumulative copy totals live only here, so a silent reset would
        make the report understate a migration that really did run."""
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
        """fsync the directory, so the rename itself survives a power loss."""
        try:
            fd = os.open(self.path.parent, os.O_RDONLY)
        except OSError:
            return
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
