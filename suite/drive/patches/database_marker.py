"""Ties a migration record under `private/` to the database it describes.

Build and Cleanup keep their progress in JSON records beside the site
(`drive-build-state.json`, `drive-cleanup-state.json`), and skip every step a
record calls complete. §14.11's rollback restores the database and `private/`
together, but Frappe Cloud restores only the database after a failed
migrate. The records then claim steps the restored database never saw, and a
rerun would skip them silently.

So each record carries a random marker, and the database holds the same
marker as a default value keyed by the record's file name. The marker is
written to the database, and committed, before the record claims any work:
a run killed between the two leaves a database marker and no record, which
is a fresh start. A record that claims work under a marker the database does
not hold belongs to another database, and the run refuses before it reads a
step from it. A record that holds nothing but its marker claims no work, so
it is stamped again instead of refused.

This module is not a patch: `suite/patches.txt` does not name it.
"""

from __future__ import annotations

import secrets
from pathlib import Path
from typing import Protocol

import frappe

MARKER_FIELD = "database_marker"

# Keys every record carries whether or not a step has run.
UNCLAIMED_FIELDS = frozenset({"version", MARKER_FIELD})


class ForeignRecordError(frappe.ValidationError):
    """A migration record under `private/` describes another database."""


class MigrationRecord(Protocol):
    """`BuildState` and `CleanupState`: one JSON document at `path`."""

    path: Path

    def load(self) -> dict: ...

    def save(self, data: dict) -> None: ...


class DatabaseMarkers(Protocol):
    def read_marker(self, key: str) -> str | None:
        """The marker the database holds under `key`, or None."""

    def write_marker(self, key: str, marker: str) -> None:
        """Hold `marker` under `key`, committed before this returns."""


class SiteDatabaseMarkers:
    """Markers as `tabDefaultValue` rows of the `__default` parent.

    `read_marker` asks the table, not `frappe.db.get_default`: the defaults
    cache lives in Redis, which a database restore does not reset."""

    def read_marker(self, key: str) -> str | None:
        return frappe.db.get_value("DefaultValue", {"parent": "__default", "defkey": key}, "defvalue")

    def write_marker(self, key: str, marker: str) -> None:
        frappe.db.set_default(key, marker)
        frappe.db.commit()


def refuse_foreign_record(record: MigrationRecord, markers: DatabaseMarkers) -> None:
    """Raise `ForeignRecordError` when `record` claims work this database never saw.

    Prints a line when the record matches and claims work, so a resumed run
    says so in the migration log."""
    data = record.load()
    if set(data) <= UNCLAIMED_FIELDS:
        return
    recorded = data.get(MARKER_FIELD)
    if not recorded:
        raise ForeignRecordError(_foreign_message(record.path, "it carries no database marker"))
    if recorded != markers.read_marker(record.path.name):
        reason = f"this database does not hold its marker {recorded!r}"
        raise ForeignRecordError(_foreign_message(record.path, reason))
    print(f"Resuming the Drive migration from {record.path}, which this database matches.")


def stamp_record(record: MigrationRecord, markers: DatabaseMarkers) -> None:
    """Give a record that claims no work a fresh marker, in the database first."""
    data = record.load()
    if not set(data) <= UNCLAIMED_FIELDS:
        return
    marker = secrets.token_hex(16)
    markers.write_marker(record.path.name, marker)
    record.save({**data, MARKER_FIELD: marker})


def _foreign_message(path: Path, reason: str) -> str:
    return (
        f"The Drive migration record {path} does not belong to this database: {reason}. "
        "The database was restored without the site's private directory, for example by an "
        "automatic restore after a failed migrate, so the record claims steps this database "
        "never saw. If this database is the backup taken before the migrate, move every "
        f"`drive-build-*` and `drive-cleanup-*` file and folder in {path.parent} aside, then "
        "migrate again: Build and Cleanup start over. Otherwise restore the database and the "
        "private directory from the same backup."
    )
