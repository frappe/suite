"""Durable preimages for the legacy `DocShare` rows Build deletes.

§14.5 rewrites a `DocShare` row on a governed doctype as a `Drive Grant`
row. The legacy row cannot stay: §5.13's read guards fail closed on one,
so an `everyone = 1` row on a Sheet refuses the whole Sheet list for every
non-admin, and `framework.validate_content_registry` refuses the migration
outright while any governed doctype still carries a share.

§14.11 rolls a post-Build site back by shipping the old code, which needs
those rows. The database no longer holds them, so this journal does: one
durable record per deleted row, written and fsynced before the delete, with
every column a plain `INSERT` needs to put the row back.

The journal is a write-ahead log. A caller appends one preimage, deletes
the matching row, and commits. The record stays useful when either later
step stops halfway: a rerun meets the row still present and appends the
same preimage again, which is a no-op.

This module has no Frappe or product imports. The caller supplies the exact
journal root, the row values, and the diagnostic creation stamp. The fsync
helpers are duplicated rather than shared, the way `state.py` duplicates
its own.
"""

import hashlib
import json
import os
import time
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from tempfile import mkstemp

JOURNAL_VERSION = 1

# Every `DocShare` column a `§14.11` rollback has to put back. `name` is the
# primary key, the five rights and `everyone` are the decision, and the four
# standard stamps are what makes the restored row the row that was there.
DOCSHARE_COLUMNS = (
    "name",
    "share_doctype",
    "share_name",
    "user",
    "read",
    "write",
    "share",
    "submit",
    "everyone",
    "owner",
    "creation",
    "modified",
    "modified_by",
)

_ROW_DOMAIN = b"suite.drive.build.docshare-row\x00"
_NAME_DOMAIN = b"suite.drive.build.docshare-name\x00"


class DocShareJournalError(RuntimeError):
    """Base error for an unsafe or unreadable `DocShare` journal."""


class JournalConflictError(DocShareJournalError):
    """A record path already describes a different row."""


class CorruptJournalError(DocShareJournalError):
    """A record failed validation and was moved out of the active journal."""

    def __init__(self, path: Path, quarantined: Path | None, reason: str):
        self.path = path
        self.quarantined = quarantined
        self.reason = reason
        destination = f"; quarantined as {quarantined}" if quarantined else ""
        super().__init__(f"corrupt DocShare journal record {path}: {reason}{destination}")


@dataclass(frozen=True)
class DocSharePreimage:
    """One deleted `DocShare` row, exactly as the database held it."""

    values: tuple
    row_hash: str
    created_at: str

    @property
    def name(self) -> str:
        return self.values[0]

    @property
    def share_doctype(self) -> str:
        return self.values[1]

    def columns(self) -> dict:
        """The row as a mapping ready for a rollback `INSERT`."""
        return dict(zip(DOCSHARE_COLUMNS, self.values, strict=True))

    def payload(self) -> dict:
        return {
            "schema_version": JOURNAL_VERSION,
            "row": self.columns(),
            "row_hash": self.row_hash,
            "created_at": self.created_at,
        }


def normalized(value: object) -> str | int | None:
    """Reduce one database value to what JSON can hold and SQL can restore.

    A `datetime` and a `Decimal` both round-trip as their text, which is what
    an `INSERT` takes. A bool is stored as the `0`/`1` the column holds, so a
    driver that answers `True` and one that answers `1` produce one record.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        return value
    return str(value)


def row_values(row: Mapping) -> tuple:
    """Order one source row against `DOCSHARE_COLUMNS`, refusing a gap.

    A missing `name` is refused outright: the record is named after it and a
    row without one cannot be restored. Every other column may be NULL, which
    is a value, so absence and NULL are not treated as the same thing.
    """
    if not isinstance(row, Mapping):
        raise TypeError("a DocShare preimage must be a mapping of columns")
    missing = [column for column in DOCSHARE_COLUMNS if column not in row]
    if missing:
        raise ValueError(f"the DocShare preimage is missing {', '.join(missing)}")
    values = tuple(normalized(row[column]) for column in DOCSHARE_COLUMNS)
    if not isinstance(values[0], str) or not values[0]:
        raise ValueError("a DocShare name must be a non-empty string")
    if not isinstance(values[1], str) or not values[1]:
        raise ValueError("a DocShare share_doctype must be a non-empty string")
    return values


def _field_bytes(value: str | int | None) -> bytes:
    """Frame exact values, including the difference between null and empty."""
    if value is None:
        return b"N"
    if isinstance(value, int):
        return b"I" + str(value).encode("ascii") + b"\x00"
    encoded = value.encode("utf-8")
    return b"S" + len(encoded).to_bytes(8, "big") + encoded


def row_hash(values: tuple) -> str:
    """Hash the exact stored row without interpreting any column."""
    digest = hashlib.sha256()
    digest.update(_ROW_DOMAIN)
    for value in values:
        digest.update(_field_bytes(value))
    return digest.hexdigest()


def name_hash(name: str) -> str:
    """Name a record file from the row's own primary key."""
    if not isinstance(name, str) or not name:
        raise ValueError("a DocShare name must be a non-empty string")
    return hashlib.sha256(_NAME_DOMAIN + name.encode("utf-8")).hexdigest()


class DocSharePreimageJournal:
    """Append and read back the rows Build removed from `tabDocShare`."""

    def __init__(self, root: Path):
        self.root = Path(root)

    @classmethod
    def for_site(cls):
        """Place rollback evidence outside the database under site private."""
        import frappe

        return cls(Path(frappe.get_site_path("private", "drive-build-docshare-preimages")))

    def append(self, row: Mapping, *, created_at: str) -> DocSharePreimage:
        """Durably publish one preimage before its matching `DELETE`.

        Returns the stored record. A rerun that meets the same row again
        re-reads the published file, repeats both fsync barriers, and returns
        it unchanged, so appending is safe to call before every delete.
        """
        if not isinstance(created_at, str) or not created_at:
            raise ValueError("created_at must be a non-empty string")
        values = row_values(row)
        preimage = DocSharePreimage(
            values=values,
            row_hash=row_hash(values),
            created_at=created_at,
        )
        directory = self._directory(preimage.name)
        path = directory / f"{name_hash(preimage.name)}.json"
        if path.exists():
            return self._reuse_existing(path, preimage)

        self._ensure_directory(directory)
        raw = _json_bytes(preimage.payload())
        descriptor, temp_name = mkstemp(prefix=f".{path.stem}.", suffix=".tmp", dir=directory)
        temp = Path(temp_name)
        try:
            with os.fdopen(descriptor, "wb") as file:
                file.write(raw)
                file.flush()
                os.fsync(file.fileno())
            try:
                # A hard link publishes the complete file atomically. Unlike
                # os.replace, it cannot overwrite a concurrent record.
                os.link(temp, path)
            except FileExistsError:
                return self._reuse_existing(path, preimage)
            finally:
                temp.unlink(missing_ok=True)
            _sync_directory(directory)
        except BaseException:
            temp.unlink(missing_ok=True)
            raise
        return preimage

    def preimages(self) -> tuple[DocSharePreimage, ...]:
        """Every validated record, ordered by `DocShare.name`."""
        if not self.root.exists():
            return ()
        found = []
        for shard in sorted(self.root.iterdir()):
            if not shard.is_dir():
                continue
            for path in sorted(shard.glob("*.json")):
                found.append(self._read_record(path))
        return tuple(sorted(found, key=lambda record: record.name))

    def restore_plan(self) -> tuple[dict, ...]:
        """The §14.11 rollback: one column mapping per row Build deleted."""
        return tuple(record.columns() for record in self.preimages())

    def _directory(self, name: str) -> Path:
        # Sharded on the record name, so a site with two hundred thousand
        # shared documents does not put two hundred thousand files in one
        # directory and make every append pay for the listing.
        return self.root / name_hash(name)[:2]

    def _ensure_directory(self, directory: Path) -> None:
        root_existed = self.root.exists()
        self.root.mkdir(parents=True, exist_ok=True)
        if not root_existed:
            _sync_directory(self.root.parent)
        shard_existed = directory.exists()
        directory.mkdir(exist_ok=True)
        if not shard_existed:
            _sync_directory(self.root)

    def _reuse_existing(self, path: Path, expected: DocSharePreimage) -> DocSharePreimage:
        actual = self._read_record(path)
        if actual.values != expected.values:
            raise JournalConflictError(
                f"DocShare {expected.name} already has a preimage holding different columns"
            )
        # A prior run can stop after publication but before the directory
        # fsync. Repeat both barriers before the caller deletes the row.
        _sync_file(path)
        _sync_directory(path.parent)
        return actual

    def _read_record(self, path: Path) -> DocSharePreimage:
        try:
            payload = json.loads(path.read_bytes())
            preimage = _preimage_from_payload(payload)
            if name_hash(preimage.name) != path.stem:
                raise ValueError("the record name does not match the DocShare id")
            if name_hash(preimage.name)[:2] != path.parent.name:
                raise ValueError("the shard directory does not match the DocShare id")
            return preimage
        except OSError:
            raise
        except Exception as error:
            quarantined = self._quarantine(path)
            raise CorruptJournalError(path, quarantined, str(error)) from error

    def _quarantine(self, path: Path) -> Path | None:
        if not path.exists():
            return None
        for attempt in range(100):
            stamp = time.time_ns()
            destination = path.with_name(f"{path.name}.corrupt-{stamp}-{os.getpid()}-{attempt}")
            try:
                os.rename(path, destination)
                _sync_directory(path.parent)
                return destination
            except FileExistsError:
                continue
            except OSError:
                return None
        return None


def _preimage_from_payload(payload: object) -> DocSharePreimage:
    if not isinstance(payload, dict):
        raise ValueError("record must be a JSON object")
    if payload.get("schema_version") != JOURNAL_VERSION:
        raise ValueError("unsupported journal schema version")
    values = row_values(payload.get("row") or {})
    created_at = payload.get("created_at")
    if not isinstance(created_at, str) or not created_at:
        raise ValueError("created_at must be a non-empty string")
    digest = row_hash(values)
    if payload.get("row_hash") != digest:
        raise ValueError("row_hash does not match the stored columns")
    return DocSharePreimage(values=values, row_hash=digest, created_at=created_at)


def _json_bytes(payload: dict) -> bytes:
    return json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def _sync_directory(directory: Path) -> None:
    descriptor = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _sync_file(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
