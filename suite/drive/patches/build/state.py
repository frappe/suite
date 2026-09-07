"""Build's durable record, saved under the site's private directory.

Build is resumable, so the numbers the final report prints (§14.9) cannot
live in memory. Every step writes its result here, and the report step
reads it back. The file is rewritten atomically, so a run killed mid-write
leaves the previous version readable.

Two kinds of number live in `StoragePreparation`:

- **cumulative** — `s3_objects_copied`, `s3_bytes_copied`,
  `s3_objects_reused`. Each object is copied once ever, so a resumed run
  adds to the total instead of restarting it.
- **per run** — everything else. A rerun recomputes them, so bytes that
  came back between two runs stop being reported as missing.
"""

import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path

STATE_FILENAME = "drive-build-state.json"
STATE_VERSION = 1

CUMULATIVE_FIELDS = ("s3_objects_copied", "s3_bytes_copied", "s3_objects_reused")


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

    def begin_run(self) -> None:
        """Clear the per-run numbers; keep the cumulative ones."""
        self.completed = False
        self.backfill_linked = 0
        self.backfill_blobs_created = 0
        self.s3_rows_seen = 0
        self.s3_objects_missing = 0
        self.missing_bytes = []

    def as_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> StoragePreparation:
        known = {f for f in cls.__dataclass_fields__ if f != "missing_bytes"}
        prep = cls(**{k: v for k, v in data.items() if k in known})
        prep.missing_bytes = [
            MissingBytes(**{k: v for k, v in row.items() if k in MissingBytes.__dataclass_fields__})
            for row in data.get("missing_bytes") or []
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
        except (FileNotFoundError, json.JSONDecodeError):
            # A first run has no file; a truncated file is not worth keeping,
            # because every per-run number is recomputed anyway.
            return {"version": STATE_VERSION}
        return data if isinstance(data, dict) else {"version": STATE_VERSION}

    def save(self, data: dict) -> None:
        data = {**data, "version": STATE_VERSION}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_suffix(self.path.suffix + ".tmp")
        with open(temp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, sort_keys=True)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, self.path)

    def storage(self) -> StoragePreparation:
        return StoragePreparation.from_dict(self.load().get("storage") or {})

    def put_storage(self, prep: StoragePreparation) -> None:
        self.save({**self.load(), "storage": prep.as_dict()})
