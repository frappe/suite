"""The durable record of every legacy S3 object Build copied (§14.2 step 3).

Cleanup never deletes a bucket object. The manual command
`suite.drive.patches.cleanup.delete_legacy_objects` does, and it may delete
only what Build copied and verified, by key, in whatever layout the legacy
key happened to have. This ledger is the list it reads.

Append-only JSON lines at `<site>/private/drive-build-copied-objects.jsonl`.
One line per `(File, legacy key)` the copy step placed at a canonical
destination, flushed and fsynced before the `File.blob` link is written, so a
kill between the two leaves a ledger entry for an object that is still in
place rather than a linked row whose legacy key nobody recorded. A rerun that
copies the same row again appends a second identical line; `entries()`
answers one entry per legacy key.
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterator
from dataclasses import asdict, dataclass
from pathlib import Path

LEDGER_FILENAME = "drive-build-copied-objects.jsonl"


@dataclass(frozen=True)
class CopiedObject:
    """One legacy object Build placed at a canonical key and verified by size."""

    file: str
    legacy_key: str
    destination: str
    size: int
    checksum: str
    bucket: str


class CopyLedger:
    def __init__(self, path: Path):
        self.path = Path(path)

    @classmethod
    def for_site(cls) -> CopyLedger:
        import frappe

        return cls(Path(frappe.get_site_path("private", LEDGER_FILENAME)))

    def record(self, entry: CopiedObject) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(json.dumps(asdict(entry), sort_keys=True) + "\n")
            f.flush()
            os.fsync(f.fileno())

    def exists(self) -> bool:
        return self.path.exists()

    def entries(self) -> list[CopiedObject]:
        """Every copied object, one per legacy key, in first-recorded order.

        A line that cannot be parsed stops the read: the ledger is the only
        thing standing between the delete command and a key Build never
        copied, so a damaged ledger must refuse rather than skip."""
        seen: dict[str, CopiedObject] = {}
        for number, entry in enumerate(self._lines(), start=1):
            try:
                row = CopiedObject(**entry)
            except TypeError as e:
                raise ValueError(f"{self.path}:{number} is not a copy ledger entry: {e}") from e
            seen.setdefault(row.legacy_key, row)
        return list(seen.values())

    def _lines(self) -> Iterator[dict]:
        if not self.path.exists():
            return
        with open(self.path, encoding="utf-8") as f:
            for number, line in enumerate(f, start=1):
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError as e:
                    raise ValueError(f"{self.path}:{number} is not JSON: {e}") from e
                if not isinstance(entry, dict):
                    raise ValueError(f"{self.path}:{number} is not a copy ledger entry")
                yield entry
