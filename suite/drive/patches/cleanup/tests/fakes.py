"""In-memory doubles for Cleanup's ports.

No site, no bucket, no database: every gate, phase, and refusal is
exercised directly, and an interrupted run is reproduced by raising where
a real one would be killed. Mirrors `suite.drive.patches.build.tests.fakes`.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from suite.drive.patches.cleanup.environment import CleanupEnvironment
from suite.drive.patches.cleanup.ports import ACTIVE, DISK_SETTINGS_FIELDS, ChainRow
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


class FakeForwarders:
    """`ForwarderRegistry` over a plain classification dict."""

    def __init__(self, classification: dict[str, str] | None = None, wildcard_paths: list[str] | None = None):
        self._classification = dict(classification or {})
        self._wildcard_paths = list(
            wildcard_paths if wildcard_paths is not None else ["/api/method/suite.drive.api.", "/dav/"]
        )
        self.removed: list[str] = []
        self.error: Exception | None = None

    def classification(self) -> dict[str, str]:
        if self.error is not None:
            raise self.error
        return dict(self._classification)

    def remove(self, names: tuple[str, ...]) -> int:
        removed = 0
        for name in names:
            if self._classification.pop(name, None) is not None:
                removed += 1
                self.removed.append(name)
        return removed

    def remove_wildcard_prefix(self, prefix: str) -> bool:
        if prefix in self._wildcard_paths:
            self._wildcard_paths.remove(prefix)
            return True
        return False


class FakeClientCallerEvidence:
    """`ClientCallerEvidence` over a plain in-memory "still called" set.

    Defaults to empty: a fixture that never mentions caller evidence models
    a site where the SPA has genuinely moved off every legacy name, which
    is what makes `check_gate_legacy_callers_removed` pass by default in
    every existing test that only cares about something else.
    """

    def __init__(self, still_called: set[str] | None = None):
        self.still_called = set(still_called or ())
        self.error: Exception | None = None
        self.calls: list[tuple[str, ...]] = []

    def still_referenced(self, names: tuple[str, ...]) -> frozenset[str]:
        self.calls.append(tuple(names))
        if self.error is not None:
            raise self.error
        return frozenset(name for name in names if name in self.still_called)


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
        self.dropped_child_table_fields: list[tuple[str, str]] = []
        self.removed_permission_hooks: list[tuple[str, ...]] = []

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

    def drop_doctypes(self, dotted_paths: tuple[str, ...]) -> int:
        dropped = 0
        for path in dotted_paths:
            if path in self.doctypes:
                self.doctypes.discard(path)
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

    def drop_child_table_field(self, parent_doctype: str, fieldname: str) -> None:
        self.dropped_child_table_fields.append((parent_doctype, fieldname))

    def remove_permission_hooks(self, doctypes: tuple[str, ...]) -> None:
        self.removed_permission_hooks.append(tuple(doctypes))


class RaisingSchema(FakeSchema):
    """A `SchemaGateway` whose source-edit ports raise, like the real one does."""

    def drop_child_table_field(self, parent_doctype: str, fieldname: str) -> None:
        raise NotImplementedError("fixture: drop_child_table_field is not implemented")

    def remove_permission_hooks(self, doctypes: tuple[str, ...]) -> None:
        raise NotImplementedError("fixture: remove_permission_hooks is not implemented")


class FakeSourceSchema:
    """`SourceSchemaReadiness` over plain in-memory sets.

    Defaults to fully ready (nothing still declared, nothing still hooked):
    a fixture that never mentions source-schema readiness models a site
    where Ticket 36's source edits have already landed, which is what makes
    `readiness.run_preflight` pass by default in every existing test that
    only cares about something else. Pass `still_declared`/`still_hooked` to
    model the real, checked-in-source default instead.
    """

    def __init__(
        self,
        still_declared: dict[str, set[str]] | None = None,
        still_hooked: set[str] | None = None,
    ):
        self.still_declared = {k: set(v) for k, v in (still_declared or {}).items()}
        self.still_hooked = set(still_hooked or ())
        self.fields_declared_calls: list[tuple[str, tuple[str, ...]]] = []
        self.permission_hooks_calls: list[tuple[str, ...]] = []

    def fields_declared(self, doctype: str, fieldnames: tuple[str, ...]) -> frozenset[str]:
        self.fields_declared_calls.append((doctype, tuple(fieldnames)))
        return frozenset(self.still_declared.get(doctype, set()) & set(fieldnames))

    def permission_hooks_present(self, doctypes: tuple[str, ...]) -> frozenset[str]:
        self.permission_hooks_calls.append(tuple(doctypes))
        return frozenset(self.still_hooked & set(doctypes))


class FakeContent:
    """`ContentRows` over plain in-memory counters/flags."""

    def __init__(self, docshares: int = 0, ycomments: int = 0, sheets_with_comments: int = 0):
        self.docshares = docshares
        self.ycomments = ycomments
        self.sheets_with_comments = sheets_with_comments
        self.strip_calls = 0

    def delete_sheet_docshares(self) -> int:
        deleted, self.docshares = self.docshares, 0
        return deleted

    def clear_writer_ycomments(self) -> int:
        cleared, self.ycomments = self.ycomments, 0
        return cleared

    def strip_sheet_comments(self, *, batch_size: int) -> int:
        self.strip_calls += 1
        stripped, self.sheets_with_comments = self.sheets_with_comments, 0
        return stripped


class FakeThumbnails:
    """`ThumbnailStore` over a plain set of sidecar names that "exist"."""

    def __init__(self, existing: set[str] | None = None):
        self.existing = set(existing or ())
        self.delete_calls: list[tuple[tuple[str, ...], dict]] = []

    def delete_sidecars(self, names: tuple[str, ...], *, settings: dict) -> int:
        self.delete_calls.append((tuple(names), dict(settings)))
        if settings.get("enabled"):
            raise NotImplementedError("fixture: S3-backed sidecar deletion is not implemented")
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


class FakeS3:
    """`S3LegacyPrefix` over an in-memory key list and a `File Blob` key set."""

    def __init__(
        self,
        *,
        keys: list[str] | None = None,
        referenced_keys: set[str] | None = None,
    ):
        self.keys = list(keys or [])
        self.referenced_keys = set(referenced_keys or ())
        self.enqueued: list[tuple[str, ...]] = []
        self._job_seq = 0

    def list_prefix(self, prefix: str, after: str, limit: int) -> list[str]:
        candidates = sorted(key for key in self.keys if key.startswith(prefix) and key > after)
        return candidates[:limit]

    def blob_references(self, keys: tuple[str, ...]) -> set[str]:
        return {key for key in keys if key in self.referenced_keys}

    def enqueue_delete(self, keys: tuple[str, ...]) -> str:
        self._job_seq += 1
        self.enqueued.append(tuple(keys))
        return f"fake-job-{self._job_seq}"


class RaisingS3(FakeS3):
    """An `S3LegacyPrefix` whose bucket-touching ports raise, like the real one does."""

    def list_prefix(self, prefix: str, after: str, limit: int) -> list[str]:
        raise NotImplementedError("fixture: list_prefix is not implemented")

    def enqueue_delete(self, keys: tuple[str, ...]) -> str:
        raise NotImplementedError("fixture: enqueue_delete is not implemented")


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
    forwarders: FakeForwarders | None = None,
    callers: FakeClientCallerEvidence | None = None,
    schema: FakeSchema | None = None,
    source_schema: FakeSourceSchema | None = None,
    content: FakeContent | None = None,
    thumbnails: FakeThumbnails | None = None,
    disk_settings: FakeDiskSettingsSnapshot | None = None,
    s3: FakeS3 | None = None,
    transaction: FakeTransaction | None = None,
    authorized: bool = False,
    backup_ref: str | None = None,
) -> CleanupEnvironment:
    """A `CleanupEnvironment` wired to fakes, with its state file in `tmp_path`."""
    table = files if files is not None else FakeFileTable()
    return CleanupEnvironment(
        tree=table,
        drive=table,
        blob_columns=blob_columns if blob_columns is not None else fake_blob_columns(),
        forwarders=forwarders if forwarders is not None else FakeForwarders(),
        callers=callers if callers is not None else FakeClientCallerEvidence(),
        files=table,
        schema=schema if schema is not None else FakeSchema(),
        source_schema=source_schema if source_schema is not None else FakeSourceSchema(),
        content=content if content is not None else FakeContent(),
        thumbnails=thumbnails if thumbnails is not None else FakeThumbnails(),
        disk_settings=disk_settings if disk_settings is not None else FakeDiskSettingsSnapshot(),
        s3=s3 if s3 is not None else FakeS3(),
        transaction=transaction if transaction is not None else FakeTransaction(),
        state=CleanupState(Path(tmp_path) / "drive-cleanup-state.json"),
        authorized=authorized,
        backup_ref=backup_ref,
    )


def seed_snapshot(env, *, names: tuple[str, ...] = (), **settings) -> None:
    """Pre-populate `env.state` with the census and disk-settings snapshot
    `phase_file_rows` would otherwise take, for a test that calls a later
    phase (`phase_thumbnails`, `phase_s3_prefix`) directly instead of going
    through the whole ordered `run_cleanup`."""
    env.state.put_census(list(names))
    env.state.put_settings_snapshot({**DEFAULT_DISK_SETTINGS, **settings})
