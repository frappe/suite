"""In-memory doubles for Cleanup's ports.

No site, no bucket, no database: every gate, phase, and refusal is
exercised directly, and an interrupted run is reproduced by raising where
a real one would be killed. Mirrors `suite.drive.patches.build.tests.fakes`.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from suite.drive.patches.cleanup.environment import CleanupEnvironment
from suite.drive.patches.cleanup.ports import (
    ACTIVE,
    DISK_SETTINGS_FIELDS,
    ChainRow,
    SlideBodyValues,
    SlidesMediaRow,
)
from suite.drive.patches.cleanup.state import CleanupState

# A fixture's baseline "nothing configured yet" disk settings: local (not
# S3), matching what a fresh site would answer before anyone turns on S3.
DEFAULT_DISK_SETTINGS = dict.fromkeys(DISK_SETTINGS_FIELDS)
DEFAULT_DISK_SETTINGS.update(
    {"quota": 0, "root_folder": "drive-files", "thumbnail_prefix": ".thumbnails", "flat": 0, "enabled": False}
)


@dataclass
class FileSpec:
    """One legacy `File` row, as a fixture builds it."""

    name: str
    folder: str | None = None
    status: str = ACTIVE
    has_node: bool = True


class FakeFileTable:
    """The legacy `tabFile`/`tabDrive Node` pair, as one in-memory double.

    Serves three ports at once: `ReachabilityTree` (`tree=`), `NodeLookup`
    (`drive=`), and `LegacyFileRows` (`files=`) all read and write the same
    dictionary, exactly as the real tables would.
    """

    def __init__(self, specs: tuple[FileSpec, ...] = ()):
        self.rows: dict[str, ChainRow] = {}
        self._nodes: set[str] = set()
        self.deleted: list[str] = []
        self.delete_calls: list[tuple[str, ...]] = []
        self.chain_calls: list[tuple[str, ...]] = []
        for spec in specs:
            self.add(spec.name, spec.folder, spec.status, has_node=spec.has_node)

    def add(self, name: str, folder: str | None = None, status: str = ACTIVE, *, has_node: bool = True):
        self.rows[name] = ChainRow(name, folder, status)
        if has_node:
            self._nodes.add(name)
        return self

    def drop_node(self, name: str) -> None:
        """Simulate a row Build never reached: no `Drive Node` for it."""
        self._nodes.discard(name)

    # --- ReachabilityTree ---
    def unreached(self, after: str, limit: int) -> list[ChainRow]:
        candidates = sorted(name for name in self.rows if name > after and name not in self._nodes)
        return [self.rows[name] for name in candidates[:limit]]

    def all_files(self, after: str, limit: int) -> list[ChainRow]:
        candidates = sorted(name for name in self.rows if name > after)
        return [self.rows[name] for name in candidates[:limit]]

    def chain(self, names: tuple[str, ...]) -> dict[str, ChainRow]:
        self.chain_calls.append(tuple(names))
        return {name: self.rows[name] for name in names if name in self.rows}

    # --- NodeLookup ---
    def nodes(self, names: tuple[str, ...]) -> dict[str, dict]:
        return {name: {"name": name} for name in names if name in self._nodes}

    # --- LegacyFileRows ---
    def delete(self, names: tuple[str, ...]) -> int:
        self.delete_calls.append(tuple(names))
        removed = 0
        for name in names:
            if name in self.rows:
                del self.rows[name]
                self._nodes.discard(name)
                removed += 1
                self.deleted.append(name)
        return removed


class RaisingBlobColumns:
    """A `blob_reference_columns()` fake that always raises."""

    def __init__(self, error: Exception | None = None):
        self.error = error or RuntimeError("frappe.storage.gc is unavailable")

    def __call__(self) -> list[dict]:
        raise self.error


def fake_blob_columns(pairs=None):
    """A `blob_reference_columns()` fake naming `pairs` (default: all four)."""
    if pairs is None:
        pairs = [
            ("Drive Node", "blob"),
            ("Drive Node Version", "blob"),
            ("Drive Node Preview", "blob"),
            ("Drive Node Preview", "source_blob"),
        ]
    return lambda: [{"doctype": d, "fieldname": f, "issingle": 0} for d, f in pairs]


class FakeSchema:
    """`SchemaGateway` over plain in-memory sets, for asserting what Cleanup touched."""

    def __init__(
        self,
        custom_fields: set[str] | None = None,
        property_setters: set[tuple[str, str, str]] | None = None,
        doctypes: set[str] | None = None,
        columns: dict[str, set[str]] | None = None,
        singles: dict[str, set[str]] | None = None,
    ):
        self.custom_fields = set(custom_fields or ())
        self.property_setters = set(property_setters or ())
        self.doctypes = set(doctypes or ())
        self.columns: dict[str, set[str]] = {k: set(v) for k, v in (columns or {}).items()}
        self.singles: dict[str, set[str]] = {k: set(v) for k, v in (singles or {}).items()}
        self.required_fields: set[tuple[str, str]] = set()

    def drop_custom_fields(self, fieldnames: tuple[str, ...]) -> int:
        dropped = 0
        for name in fieldnames:
            if name in self.custom_fields:
                self.custom_fields.discard(name)
                dropped += 1
        return dropped

    def drop_property_setters(self, keys: tuple[tuple[str, str, str], ...]) -> int:
        dropped = 0
        for key in keys:
            if key in self.property_setters:
                self.property_setters.discard(key)
                dropped += 1
        return dropped

    def drop_doctypes(self, doctypes: tuple[str, ...]) -> int:
        dropped = 0
        for doctype in doctypes:
            if doctype in self.doctypes:
                self.doctypes.discard(doctype)
                dropped += 1
        return dropped

    def drop_columns(self, doctype: str, fieldnames: tuple[str, ...]) -> int:
        held = self.columns.get(doctype, set())
        dropped = 0
        for fieldname in fieldnames:
            if fieldname in held:
                held.discard(fieldname)
                dropped += 1
        self.columns[doctype] = held
        return dropped

    def drop_single_values(self, doctype: str, fieldnames: tuple[str, ...]) -> int:
        held = self.singles.get(doctype, set())
        dropped = 0
        for fieldname in fieldnames:
            if fieldname in held:
                held.discard(fieldname)
                dropped += 1
        self.singles[doctype] = held
        return dropped

    def require_field(self, doctype: str, fieldname: str) -> None:
        self.required_fields.add((doctype, fieldname))

    def custom_fields_present(self, fieldnames: tuple[str, ...]) -> frozenset[str]:
        return frozenset(name for name in fieldnames if name in self.custom_fields)

    def property_setters_present(
        self, keys: tuple[tuple[str, str, str], ...]
    ) -> frozenset[tuple[str, str, str]]:
        return frozenset(key for key in keys if key in self.property_setters)

    def doctypes_present(self, doctypes: tuple[str, ...]) -> frozenset[str]:
        return frozenset(doctype for doctype in doctypes if doctype in self.doctypes)

    def columns_present(self, doctype: str, fieldnames: tuple[str, ...]) -> frozenset[str]:
        held = self.columns.get(doctype, set())
        return frozenset(name for name in fieldnames if name in held)

    def single_values_present(self, doctype: str, fieldnames: tuple[str, ...]) -> frozenset[str]:
        held = self.singles.get(doctype, set())
        return frozenset(name for name in fieldnames if name in held)


class CrashingSchema(FakeSchema):
    """A `SchemaGateway` that raises right after one named call, modeling a
    real phase's DDL-driven partial application: the mutation before the
    crash point already landed in `self` (each `drop_*` call above commits
    its own change immediately, exactly like MariaDB's DDL auto-commit), and
    only what comes after it is missing when a resumed call re-checks
    presence. `crash_after` fires once: a resumed call (the same instance,
    called again) runs every method normally.
    """

    def __init__(self, *, crash_after: str, **kwargs):
        super().__init__(**kwargs)
        self.crash_after = crash_after

    def _maybe_crash(self, name: str) -> None:
        if self.crash_after == name:
            self.crash_after = None
            raise RuntimeError(f"simulated crash right after {name}")

    def drop_doctypes(self, doctypes: tuple[str, ...]) -> int:
        result = super().drop_doctypes(doctypes)
        self._maybe_crash("drop_doctypes")
        return result

    def drop_columns(self, doctype: str, fieldnames: tuple[str, ...]) -> int:
        result = super().drop_columns(doctype, fieldnames)
        self._maybe_crash(f"drop_columns:{doctype}")
        return result

    def drop_single_values(self, doctype: str, fieldnames: tuple[str, ...]) -> int:
        result = super().drop_single_values(doctype, fieldnames)
        self._maybe_crash(f"drop_single_values:{doctype}")
        return result

    def drop_custom_fields(self, fieldnames: tuple[str, ...]) -> int:
        result = super().drop_custom_fields(fieldnames)
        self._maybe_crash("drop_custom_fields")
        return result


class RaisingPresenceSchema(FakeSchema):
    """A `SchemaGateway` whose presence checks raise, like a real database
    error would, to prove a phase's fail-closed verification propagates
    that instead of swallowing it."""

    def __init__(self, *, error: Exception | None = None, **kwargs):
        super().__init__(**kwargs)
        self.error = error or RuntimeError("connection lost")

    def columns_present(self, doctype: str, fieldnames: tuple[str, ...]) -> frozenset[str]:
        raise self.error


class FakeContent:
    """`ContentRows` over plain in-memory counters/flags."""

    def __init__(
        self,
        docshares=(),
        ycomments: int = 0,
        sheets_with_comments: int = 0,
        *,
        slides_media: dict[str, str] | None = None,
        slide_strings=(),
        unreadable_bodies=(),
        host: str = "suite.test",
    ):
        # The governed doctypes that still carry a `DocShare` row. Build
        # deletes them, so on a site that ran it this is empty and Cleanup
        # only verifies that.
        self.docshares = frozenset(docshares)
        self.ycomments = ycomments
        self.sheets_with_comments = sheets_with_comments
        self.strip_calls = 0
        # `File` name to `file_url`, for the deck pictures a node of their
        # deck holds. They live in the shared `FakeFileTable` too, so a row
        # `files.delete` removed stops being returned, as on a real site.
        self.slides_media = dict(slides_media or {})
        self.slide_strings = frozenset(slide_strings)
        self.unreadable_bodies = tuple(unreadable_bodies)
        self.host = host
        self.files: FakeFileTable | None = None

    def governed_docshares_remaining(self) -> frozenset[str]:
        return self.docshares

    def clear_writer_ycomments(self) -> int:
        cleared, self.ycomments = self.ycomments, 0
        return cleared

    def strip_sheet_comments(self, *, batch_size: int) -> int:
        self.strip_calls += 1
        stripped, self.sheets_with_comments = self.sheets_with_comments, 0
        return stripped

    def converted_slides_media(self, after: str, limit: int) -> list[SlidesMediaRow]:
        present = self.files.rows if self.files is not None else self.slides_media
        names = sorted(name for name in self.slides_media if name > after and name in present)
        return [SlidesMediaRow(name, self.slides_media[name]) for name in names[:limit]]

    def slide_body_values(self, *, batch_size: int) -> SlideBodyValues:
        return SlideBodyValues(self.slide_strings, self.unreadable_bodies)

    def site_host(self) -> str:
        return self.host


class FakeThumbnails:
    """`ThumbnailStore` over a plain set of sidecar names that "exist".

    Like the real store, an S3 snapshot (`enabled`) deletes nothing: Cleanup
    deletes no bucket object. The settings each call received are kept so a
    test can check what the phase passed."""

    def __init__(self, existing: set[str] | None = None):
        self.existing = set(existing or ())
        self.delete_calls: list[tuple[tuple[str, ...], dict]] = []

    def delete_sidecars(self, names: tuple[str, ...], *, settings: dict) -> int:
        self.delete_calls.append((tuple(names), dict(settings)))
        if settings.get("enabled"):
            return 0
        deleted = 0
        for name in names:
            if name in self.existing:
                self.existing.discard(name)
                deleted += 1
        return deleted


class RaisingThumbnails(FakeThumbnails):
    """A `ThumbnailStore` that always raises, regardless of `settings`."""

    def delete_sidecars(self, names: tuple[str, ...], *, settings: dict) -> int:
        raise NotImplementedError("fixture: delete_sidecars is not implemented")


class FakeDiskSettingsSnapshot:
    """`DiskSettingsSnapshot` over a plain dict, defaulted to a local site."""

    def __init__(self, **overrides):
        self.values = {**DEFAULT_DISK_SETTINGS, **overrides}
        self.read_calls = 0

    def read(self) -> dict:
        self.read_calls += 1
        return dict(self.values)


class FakeTransaction:
    """`TransactionGateway` over a plain call counter, optionally set to fail
    once — the crash-order fixture for "commit before checkpoint"."""

    def __init__(self):
        self.commits = 0
        self.fail_next = False

    def commit(self) -> None:
        if self.fail_next:
            self.fail_next = False
            raise RuntimeError("simulated commit failure")
        self.commits += 1


def cleanup_environment(
    tmp_path,
    *,
    files: FakeFileTable | None = None,
    blob_columns=None,
    schema: FakeSchema | None = None,
    content: FakeContent | None = None,
    thumbnails: FakeThumbnails | None = None,
    disk_settings: FakeDiskSettingsSnapshot | None = None,
    transaction: FakeTransaction | None = None,
    backup: str | None = None,
) -> CleanupEnvironment:
    """A `CleanupEnvironment` wired to fakes, with its state file in `tmp_path`."""
    table = files if files is not None else FakeFileTable()
    content = content if content is not None else FakeContent()
    if content.files is None:
        content.files = table
    # A deck picture sits under frappe's `Home`, outside every Drive chain.
    if content.slides_media and "Home" not in table.rows:
        table.add("Home", has_node=False)
    for name in content.slides_media:
        if name not in table.rows:
            table.add(name, folder="Home", has_node=False)
    return CleanupEnvironment(
        tree=table,
        drive=table,
        blob_columns=blob_columns if blob_columns is not None else fake_blob_columns(),
        files=table,
        schema=schema if schema is not None else FakeSchema(),
        content=content,
        thumbnails=thumbnails if thumbnails is not None else FakeThumbnails(),
        disk_settings=disk_settings if disk_settings is not None else FakeDiskSettingsSnapshot(),
        transaction=transaction if transaction is not None else FakeTransaction(),
        state=CleanupState(Path(tmp_path) / "drive-cleanup-state.json"),
        backup=backup,
    )


def seed_snapshot(env, *, names: tuple[str, ...] = (), **settings) -> None:
    """Pre-populate `env.state` with the census and disk-settings snapshot
    `phase_file_rows` would otherwise take, for a test that calls
    `phase_thumbnails` directly instead of going through the whole ordered
    `run_cleanup`."""
    env.state.put_census(list(names))
    env.state.put_settings_snapshot({**DEFAULT_DISK_SETTINGS, **settings})
