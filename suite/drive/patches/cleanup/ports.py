"""What Cleanup is allowed to reach (§14.10). Every port is a narrow read
or a narrow write; nothing here bundles more than one phase needs.

The real `Site*` classes below are wired only by `CleanupEnvironment.for_site()`,
and nothing in this package calls that classmethod: Cleanup ships unregistered
(Ticket 35), so these classes exist for a later, separately authorized release
(Ticket 36) to wire in. Several of them honestly raise `NotImplementedError`:
deleting a Python function body out of `suite/drive/http/shims.py`, an entry
out of `suite/hooks.py`, or a `Table` field out of a doctype's shipped JSON is
a source change a maintainer makes, not a runtime database operation, so there
is no honest "real" implementation to write here — and S3-backed thumbnail
deletion has no working bucket client to call either (`Drive Disk Settings`
has never defined `get_s3_connection()`; see `SiteThumbnailStore`). Fixture
tests exercise every one of these contracts through fakes that model the
outcome instead. `suite.drive.patches.cleanup.readiness` probes every one of
these honestly-unfinished ports before Cleanup mutates anything, so an
activation attempt against a still-incomplete environment fails before phase
1, not partway through it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

ACTIVE = "Active"
TRASHED = "Trashed"
REMOVED = "Removed"

# The two `File` rows whose `name` is literally these strings and whose
# `folder` is NULL (`suite/drive/utils/__init__.py`). Same values as
# `suite.drive.patches.build.ports`, re-declared rather than imported: gate 1
# recomputes reachability independently of anything Build owns.
DRIVE_ROOT_ROW = "Drive"
USERS_ROW = "Users"

# §3.13's complete dropped-field list for `Drive Disk Settings` (Single):
# `quota`, `root_folder`, `thumbnail_prefix`, `flat`, and the six S3 fields.
# `phase_file_rows` reads this snapshot once, before step 5 drops every one
# of these columns, so steps 7 and 8 never have to query a column that may
# already be gone.
DISK_SETTINGS_FIELDS = (
    "quota",
    "root_folder",
    "thumbnail_prefix",
    "flat",
    "enabled",
    "bucket",
    "aws_key",
    "aws_secret",
    "endpoint_url",
    "signature_version",
)


@dataclass(frozen=True)
class ChainRow:
    """The three columns the upward reachability climb needs, and nothing else."""

    name: str
    folder: str | None
    status: str


class ReachabilityTree(Protocol):
    """Everything the reachability climb reads out of the legacy `File` table.

    Reads only: there is no method here that could delete or rename a row.
    """

    def unreached(self, after: str, limit: int) -> list[ChainRow]:
        """Legacy `File` rows that have no `Drive Node`, `name` ascending."""

    def all_files(self, after: str, limit: int) -> list[ChainRow]:
        """Every legacy `File` row, `name` ascending. Used to enumerate
        Cleanup's deletion candidates, not just gate 1's blocking set."""

    def chain(self, names: tuple[str, ...]) -> dict[str, ChainRow]:
        """`folder` and `status` for these ids; ids that are gone are absent."""


class NodeLookup(Protocol):
    def nodes(self, names: tuple[str, ...]) -> dict[str, dict]:
        """Existing `Drive Node` rows by id, keyed by id."""


class BlobColumnDiscovery(Protocol):
    def __call__(self) -> list[dict]:
        """`frappe.storage.gc.blob_reference_columns()`, or a fake of it."""


class ForwarderRegistry(Protocol):
    def classification(self) -> dict[str, str]:
        """`suite.drive.http.shims.CLASSIFICATION`, or a fixture of it."""

    def remove(self, names: tuple[str, ...]) -> int:
        """Delete these forwarders' bodies and their `CLASSIFICATION` rows."""

    def remove_wildcard_prefix(self, prefix: str) -> bool:
        """Drop one entry from `ALLOWED_WILDCARD_PATHS`. True if it was there."""


class ClientCallerEvidence(Protocol):
    """Gate 3's real evidence: has the SPA actually stopped calling these
    names, independent of whether `ForwarderRegistry.classification()` still
    spells any of them "forwarder". A registry label is something this
    package's own phase 6 can act on; it is not evidence of what a client
    somewhere else is doing, and gate 3 must not treat the two as the same
    fact (§14.10's third gate: "the SPA has moved off the old method
    names")."""

    def still_referenced(self, names: tuple[str, ...]) -> frozenset[str]:
        """The subset of `names` real evidence still shows a caller for."""


class LegacyFileRows(Protocol):
    def delete(self, names: tuple[str, ...]) -> int:
        """Delete these legacy `File` rows. Returns the count actually removed."""


class SchemaGateway(Protocol):
    def drop_custom_fields(self, fieldnames: tuple[str, ...]) -> int:
        """Delete `Custom Field` rows on `File` by fieldname."""

    def drop_property_setters(self, keys: tuple[tuple[str, str, str], ...]) -> int:
        """Delete `Property Setter` rows by `(doc_type, field_name, property)`."""

    def drop_doctypes(self, dotted_paths: tuple[str, ...]) -> int:
        """Delete a DocType and its table. `dotted_paths` are module-relative,
        e.g. `"drive/doctype/drive_permission"`."""

    def drop_columns(self, doctype: str, fieldnames: tuple[str, ...]) -> int:
        """Drop these columns (standard or custom) from one doctype's table.
        Not for a Single doctype: a Single has no table of its own for DDL to
        touch (`drop_single_values` is the Single-doctype equivalent)."""

    def drop_single_values(self, doctype: str, fieldnames: tuple[str, ...]) -> int:
        """Delete these fieldnames' rows from `tabSingles` for one Single
        doctype. A Single stores its field values as `(doctype, field, value)`
        rows, never as columns, so this is the Single-doctype counterpart to
        `drop_columns`, not an alternate implementation of it."""

    def require_field(self, doctype: str, fieldname: str) -> None:
        """Make a field `reqd: 1` without touching the shipped doctype JSON."""

    def drop_child_table_field(self, parent_doctype: str, fieldname: str) -> None:
        """Remove a `Table`-type field from `parent_doctype`'s own shipped
        JSON. A source change, not a runtime operation: a child-table field
        has no column of its own to drop by DDL, so the only real
        implementation edits the doctype file Ticket 36 ships."""

    def remove_permission_hooks(self, doctypes: tuple[str, ...]) -> None:
        """Remove `permission_query_conditions`/`has_permission` entries for
        these doctypes out of `suite/hooks.py`. A source change made once the
        doctypes themselves are gone, not a runtime operation."""


class SourceSchemaReadiness(Protocol):
    """Whether Ticket 36's source edits have actually landed, checked before
    phase 1 runs at all (`readiness.run_preflight`). A `drop_columns` or
    `drop_single_values` call can succeed as a runtime operation while the
    shipped doctype JSON still declares the field: the next `bench migrate`
    recreates a dropped column from that JSON, and any subsequent save of a
    Single doctype rewrites all of its declared fields back into
    `tabSingles` (`frappe.model.document.Document.update_single` always
    replaces the whole row set). Neither failure mode is visible until well
    after Cleanup reports success, so this is a readiness check, not an
    afterthought."""

    def fields_declared(self, doctype: str, fieldnames: tuple[str, ...]) -> frozenset[str]:
        """The subset of `fieldnames` doctype `doctype`'s shipped JSON still
        declares as fields. Non-empty means Ticket 36 has not removed them
        from source yet."""

    def permission_hooks_present(self, doctypes: tuple[str, ...]) -> frozenset[str]:
        """The subset of `doctypes` `suite/hooks.py` still names in
        `permission_query_conditions` or `has_permission`."""


class ContentRows(Protocol):
    def delete_sheet_docshares(self) -> int:
        """Delete every Sheet `DocShare` row (§14.5 superseded them with grants)."""

    def clear_writer_ycomments(self) -> int:
        """Blank `Writer Document.ycomments` on every row that still carries it."""

    def strip_sheet_comments(self, *, batch_size: int) -> int:
        """Strip the `comments` key out of `Sheet.sheets_data`'s decoded JSON,
        paged `batch_size` rows at a time. Leaves everything else in the
        workbook untouched: this is not a general-purpose key scrub."""


class ThumbnailStore(Protocol):
    def delete_sidecars(self, names: tuple[str, ...], *, settings: dict) -> int:
        """Delete the `.thumbnail` sidecar for each of these legacy `File`
        ids. `settings` is the `DiskSettingsSnapshot` `phase_file_rows` took
        before step 5 dropped the columns it would otherwise have to read
        live."""


class DiskSettingsSnapshot(Protocol):
    def read(self) -> dict:
        """The `DISK_SETTINGS_FIELDS` values, read once before step 5 drops
        every one of them."""


class S3LegacyPrefix(Protocol):
    def list_prefix(self, prefix: str, after: str, limit: int) -> list[str]:
        """Object keys under `prefix`, ordered, paged by `after`."""

    def blob_references(self, keys: tuple[str, ...]) -> set[str]:
        """The subset of `keys` some `File Blob` row still names."""

    def enqueue_delete(self, keys: tuple[str, ...]) -> str:
        """Queue the long deletion job for exactly these keys. Returns a job id."""


class TransactionGateway(Protocol):
    def commit(self) -> None:
        """End the current phase's writes. Called after a phase's mutations
        succeed and before its checkpoint is written, so a checkpoint can
        never claim durability the database does not actually have."""


# --- real site implementations, wired only by CleanupEnvironment.for_site ---
#
# None of these run during this ticket: nothing calls `for_site()` from
# production code, and no test exercises these classes against a live site.
# They exist so Ticket 36 has somewhere to start, not so Ticket 35 can run.


class SiteReachabilityTree:
    """`ReachabilityTree` over the live `tabFile` and `tabDrive Node` tables."""

    def unreached(self, after: str, limit: int) -> list[ChainRow]:
        import frappe

        rows = frappe.db.sql(
            """
            select f.name as name, f.folder as folder, f.status as status
            from `tabFile` f
            where f.name > %(after)s
              and not exists (select 1 from `tabDrive Node` n where n.name = f.name)
            order by f.name
            limit %(limit)s
            """,
            {"after": after, "limit": limit},
            as_dict=True,
        )
        return [ChainRow(row.name, row.folder, row.status or ACTIVE) for row in rows]

    def all_files(self, after: str, limit: int) -> list[ChainRow]:
        import frappe

        rows = frappe.db.sql(
            """
            select name, folder, status
            from `tabFile`
            where name > %(after)s
            order by name
            limit %(limit)s
            """,
            {"after": after, "limit": limit},
            as_dict=True,
        )
        return [ChainRow(row.name, row.folder, row.status or ACTIVE) for row in rows]

    def chain(self, names: tuple[str, ...]) -> dict[str, ChainRow]:
        import frappe

        if not names:
            return {}
        rows = frappe.db.get_all("File", filters={"name": ["in", names]}, fields=["name", "folder", "status"])
        return {row.name: ChainRow(row.name, row.folder, row.status or ACTIVE) for row in rows}


class SiteNodeLookup:
    """`NodeLookup` over the live `tabDrive Node` table."""

    def nodes(self, names: tuple[str, ...]) -> dict[str, dict]:
        import frappe

        if not names:
            return {}
        rows = frappe.db.get_all("Drive Node", filters={"name": ["in", names]}, fields=["name"])
        return {row.name: {"name": row.name} for row in rows}


def site_blob_columns() -> list[dict]:
    from frappe.storage.gc import blob_reference_columns

    return blob_reference_columns()


class SiteForwarderRegistry:
    """`ForwarderRegistry` over the shipped classification and hooks."""

    def classification(self) -> dict[str, str]:
        from suite.drive.http.shims import CLASSIFICATION

        return dict(CLASSIFICATION)

    def remove(self, names: tuple[str, ...]) -> int:
        raise NotImplementedError(
            "deleting a forwarder's body out of suite/drive/http/shims.py is a source "
            "change made when Cleanup is activated (Ticket 36), not a runtime operation"
        )

    def remove_wildcard_prefix(self, prefix: str) -> bool:
        raise NotImplementedError(
            "editing ALLOWED_WILDCARD_PATHS out of suite/hooks.py is a source change "
            "made when Cleanup is activated (Ticket 36), not a runtime operation"
        )


class SiteClientCallerEvidence:
    """`ClientCallerEvidence` over a literal-string scan of the checked-in SPA
    source tree. This is gate 3's actual evidence — "the SPA has moved off
    the old method names" — kept deliberately separate from
    `SiteForwarderRegistry.classification()`: that dict is a hand-maintained
    label, edited by whoever writes the Python, and proves nothing about
    what the frontend bundle actually calls.

    `wayfinder/drive-layer-spec/implementation/legacy-caller-inventory.md`
    built the same evidence by hand for all 69 names and recorded this scan's
    two known blind spots: a caller can double the `/api/method/` prefix (a
    plain substring match still finds `suite.drive.<name>` inside that), and
    a dead call site can name a method that no longer exists anywhere else,
    which reads as "still called" when it is really unreachable code. Both
    make this scan over-cautious, never under-cautious: a real caller always
    matches, and a false match only blocks Cleanup longer than strictly
    necessary. That asymmetry is why a plain source scan is an honest gate
    for a destructive operation, even though it is not a live-traffic
    observation.
    """

    _EXTENSIONS = (".js", ".ts", ".vue")

    def still_referenced(self, names: tuple[str, ...]) -> frozenset[str]:
        from pathlib import Path

        import frappe

        root = Path(frappe.get_app_path("suite")).parent / "frontend" / "src"
        if not root.is_dir():
            raise RuntimeError(f"the SPA source tree is missing at {root}; cannot attest caller absence")
        remaining = {name: f"suite.drive.{name}" for name in names}
        found: set[str] = set()
        for path in root.rglob("*"):
            if not remaining or path.suffix not in self._EXTENSIONS or not path.is_file():
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            for name, needle in list(remaining.items()):
                if needle in text:
                    found.add(name)
                    del remaining[name]
        return frozenset(found)


class SiteLegacyFileRows:
    """`LegacyFileRows` over the live `tabFile` table, by direct DB deletion.

    Never `frappe.delete_doc`: `suite.drive.overrides.file.File.on_trash`
    refuses outright to delete the row named `ROOT_FOLDER` (one of the two
    rows §14.10 requires this phase to delete), and its `after_delete`
    cascades into deleting the linked Writer/Presentation/Sheet content
    document, the local blob, and half a dozen satellite tables (`Drive
    Favourite`, `Drive Recent`, `Drive Permission`, `Drive Notification`,
    `Drive Entity Activity Log`) — every one of them either a content body
    §14.10 requires Cleanup to preserve, or bytes only step 8's own
    re-checked S3 job may ever remove. Cleanup has already computed the safe
    deletion order for what it is about to delete
    (`removal._deepest_removed_first`); running each row through the
    ordinary doc-event pipeline a second time would undo exactly the
    preservation this ticket's acceptance criteria require. A plain `DELETE`
    triggers no hook at all (`frappe.db.delete`'s own docstring), which is
    what makes it the only safe way to remove these rows.
    """

    def delete(self, names: tuple[str, ...]) -> int:
        import frappe

        if not names:
            return 0
        existing = frappe.db.get_all("File", filters={"name": ["in", list(names)]}, pluck="name")
        if not existing:
            return 0
        frappe.db.delete("File", {"name": ["in", existing]})
        return len(existing)


class SiteSchemaGateway:
    """`SchemaGateway` over Custom Field, Property Setter, and raw DDL."""

    def drop_custom_fields(self, fieldnames: tuple[str, ...]) -> int:
        import frappe

        names = frappe.get_all(
            "Custom Field", filters={"dt": "File", "fieldname": ["in", list(fieldnames)]}, pluck="name"
        )
        for name in names:
            frappe.delete_doc("Custom Field", name, ignore_permissions=True)
        if names:
            frappe.clear_cache(doctype="File")
        return len(names)

    def drop_property_setters(self, keys: tuple[tuple[str, str, str], ...]) -> int:
        import frappe

        removed = 0
        touched = set()
        for doc_type, field_name, prop in keys:
            names = frappe.get_all(
                "Property Setter",
                filters={"doc_type": doc_type, "field_name": field_name, "property": prop},
                pluck="name",
            )
            for name in names:
                frappe.delete_doc("Property Setter", name, ignore_permissions=True)
                removed += 1
            touched.add(doc_type)
        for doctype in touched:
            frappe.clear_cache(doctype=doctype)
        return removed

    def drop_doctypes(self, dotted_paths: tuple[str, ...]) -> int:
        import frappe

        removed = 0
        for path in dotted_paths:
            doctype = _doctype_name_from_path(path)
            if frappe.db.exists("DocType", doctype):
                frappe.delete_doc("DocType", doctype, ignore_permissions=True, force=True)
                removed += 1
        return removed

    def drop_columns(self, doctype: str, fieldnames: tuple[str, ...]) -> int:
        """Not for a Single doctype: `frappe.db.has_column(doctype, ...)`
        prepends `"tab"` itself (`get_table_columns` does `"tab" + doctype`),
        so `doctype` here must be the bare name, never a `table` variable
        already carrying that prefix — passing the prefixed form queries
        `tabtab<doctype>` and raises `TableMissingError`. A Single has no
        table of its own for this DDL to touch at all; use
        `drop_single_values` for one."""
        import frappe

        table = f"tab{doctype}"
        dropped = 0
        for fieldname in fieldnames:
            custom = frappe.get_all(
                "Custom Field", filters={"dt": doctype, "fieldname": fieldname}, pluck="name"
            )
            for name in custom:
                frappe.delete_doc("Custom Field", name, ignore_permissions=True)
            if frappe.db.has_column(doctype, fieldname):
                frappe.db.sql_ddl(f"alter table `{table}` drop column `{fieldname}`")
                dropped += 1
        if dropped:
            frappe.clear_cache(doctype=doctype)
        return dropped

    def drop_single_values(self, doctype: str, fieldnames: tuple[str, ...]) -> int:
        """A Single doctype's fields live as `(doctype, field, value)` rows in
        `tabSingles`, never as columns (`frappe.model.document.Document.
        update_single`'s own read/write path), so this is a row delete, not
        DDL. Idempotent: a fieldname already gone is simply absent from
        `existing` and is not counted or re-deleted."""
        import frappe

        if not fieldnames:
            return 0
        placeholders = ", ".join(["%s"] * len(fieldnames))
        rows = frappe.db.sql(
            f"select field from `tabSingles` where doctype=%s and field in ({placeholders})",
            (doctype, *fieldnames),
        )
        existing = [row[0] for row in rows]
        if not existing:
            return 0
        frappe.db.delete("Singles", {"doctype": doctype, "field": ["in", existing]})
        frappe.clear_document_cache(doctype, doctype)
        return len(existing)

    def require_field(self, doctype: str, fieldname: str) -> None:
        import frappe

        frappe.make_property_setter(
            {
                "doctype": doctype,
                "fieldname": fieldname,
                "property": "reqd",
                "value": "1",
                "property_type": "Check",
            },
            ignore_validate=True,
        )

    def drop_child_table_field(self, parent_doctype: str, fieldname: str) -> None:
        raise NotImplementedError(
            f"removing {parent_doctype}.{fieldname} (a Table field) means editing that "
            "doctype's shipped JSON, a source change Ticket 36 makes, not a runtime "
            "operation; this port exists for fixture tests only"
        )

    def remove_permission_hooks(self, doctypes: tuple[str, ...]) -> None:
        raise NotImplementedError(
            f"removing {', '.join(doctypes)}'s permission_query_conditions/has_permission "
            "entries out of suite/hooks.py is a source change Ticket 36 makes once these "
            "doctypes are gone, not a runtime operation; this port exists for fixture tests only"
        )


class SiteSourceSchema:
    """`SourceSchemaReadiness` over the shipped doctype JSON and `suite/hooks.py`.

    Reads the checked-in source tree directly, the same way
    `SiteClientCallerEvidence` does, rather than through `frappe.get_meta`:
    that keeps this port callable with no live site underneath it, and a
    file on disk is exactly what the next `bench migrate` would actually
    read. Honestly reports "not ready" today: this ticket touches no doctype
    JSON and no `suite/hooks.py` entry.
    """

    def fields_declared(self, doctype: str, fieldnames: tuple[str, ...]) -> frozenset[str]:
        import json
        from pathlib import Path

        import frappe

        slug = doctype.lower().replace(" ", "_")
        app_path = Path(frappe.get_app_path("suite"))
        matches = list(app_path.rglob(f"doctype/{slug}/{slug}.json"))
        if not matches:
            raise RuntimeError(f"no shipped doctype JSON found for {doctype!r} under {app_path}")
        data = json.loads(matches[0].read_text(encoding="utf-8"))
        declared = {field.get("fieldname") for field in data.get("fields", [])}
        return frozenset(name for name in fieldnames if name in declared)

    def permission_hooks_present(self, doctypes: tuple[str, ...]) -> frozenset[str]:
        from suite import hooks

        wanted = set(doctypes)
        present = set(hooks.permission_query_conditions) | set(hooks.has_permission)
        return frozenset(wanted & present)


# Mirrors `suite.drive.patches.build.content_mapping.decode_sheets_data` and
# `suite.sheets.doctype.sheet.storage`'s wire format, duplicated rather than
# imported: `suite/tests/test_architecture.py` forbids Drive from importing a
# concrete content-product implementation, and Build already chose the same
# duplication over that import for the identical reason.
_SHEETS_DATA_BOUND = 75 * 1024 * 1024
_GZ_MARKER = "_z"
_GZ_KIND = "gzip"
_DATA_KEY = "data"


def _decode_sheets_data(stored: str | None) -> tuple[str, bool]:
    """Returns `(json_text, was_gzip)`. `was_gzip` is what `_encode_sheets_data`
    must be told, so a write-back never changes a row's storage format as a
    side effect of stripping a key out of it: a plain row must stay plain, a
    gzip row must stay gzip."""
    import base64
    import gzip
    import io
    import json

    if not stored:
        return "{}", False
    try:
        envelope = json.loads(stored)
    except (TypeError, ValueError):
        return stored, False
    if not (
        isinstance(envelope, dict)
        and envelope.get(_GZ_MARKER) == _GZ_KIND
        and isinstance(envelope.get(_DATA_KEY), str)
    ):
        return stored, False
    compressed = base64.b64decode(envelope[_DATA_KEY], validate=True)
    with gzip.GzipFile(fileobj=io.BytesIO(compressed), mode="rb") as stream:
        raw = stream.read(_SHEETS_DATA_BOUND)
    return raw.decode("utf-8"), True


def _encode_sheets_data(plain: str, *, gzip_encoded: bool) -> str:
    import base64
    import gzip
    import json

    if not gzip_encoded:
        return plain
    compressed = gzip.compress(plain.encode("utf-8"), compresslevel=6)
    return json.dumps({_GZ_MARKER: _GZ_KIND, _DATA_KEY: base64.b64encode(compressed).decode("ascii")})


class SiteContentRows:
    """`ContentRows` over Sheet, Writer, and their side tables."""

    def delete_sheet_docshares(self) -> int:
        import frappe

        names = frappe.get_all("DocShare", filters={"share_doctype": "Sheet"}, pluck="name")
        for name in names:
            frappe.delete_doc("DocShare", name, ignore_permissions=True)
        return len(names)

    def clear_writer_ycomments(self) -> int:
        import frappe

        names = frappe.get_all("Writer Document", filters={"ycomments": ["is", "set"]}, pluck="name")
        for name in names:
            frappe.db.set_value("Writer Document", name, "ycomments", None, update_modified=False)
        return len(names)

    def strip_sheet_comments(self, *, batch_size: int) -> int:
        """Strip only the top-level `comments` key the sheets frontend's own
        comment engine owns (`frontend/src/apps/sheets/engine/comments.js`:
        `{ [sheet]: { [cellId]: { resolved, thread } } }`, persisted at
        `sheets_data.comments` by `usePersistence.js`). Never a recursive
        scan for any key spelled "comment": a cell's own text, a chart
        title, or any other user data that happens to share that word must
        survive untouched. `sheets_data` may be the gzip envelope
        `suite.sheets.doctype.sheet.storage` writes, so this decodes before
        inspecting and re-encodes the same way before writing back."""
        import json

        import frappe

        stripped = 0
        after = ""
        previous = None
        while True:
            rows = frappe.get_all(
                "Sheet",
                filters={"name": [">", after]},
                fields=["name", "sheets_data"],
                order_by="name",
                limit_page_length=batch_size,
            )
            if not rows:
                return stripped
            if rows[0].name == previous:
                raise RuntimeError(f"the sheet comment scan stalled at {rows[0].name!r}; refusing to loop")
            previous = rows[0].name
            for row in rows:
                if not row.sheets_data:
                    continue
                decoded, was_gzip = _decode_sheets_data(row.sheets_data)
                data = json.loads(decoded)
                if isinstance(data, dict) and data.get("comments"):
                    del data["comments"]
                    frappe.db.set_value(
                        "Sheet",
                        row.name,
                        "sheets_data",
                        _encode_sheets_data(json.dumps(data), gzip_encoded=was_gzip),
                        update_modified=False,
                    )
                    stripped += 1
            after = rows[-1].name
            if len(rows) < batch_size:
                return stripped


class SiteThumbnailStore:
    """`ThumbnailStore` over the local-disk `.thumbnail` sidecars.

    Takes `settings` as an argument instead of reading `Drive Disk Settings`
    live: by the time step 7 runs, step 5 has already dropped every field
    such a live read would need, so the caller passes the snapshot
    `phase_file_rows` took before step 5 ran.

    S3-backed sidecar deletion has no working implementation to fall back
    on: `Drive Disk Settings` has never defined `get_s3_connection()` (there
    is no such method anywhere in this app), so calling it would raise
    `AttributeError`. This fails closed and says so, instead of the
    try/except this method used to wrap around that call, which caught the
    `AttributeError` too and reported a quiet "not deleted" — indistinguishable
    from an ordinary missing file.
    """

    def delete_sidecars(self, names: tuple[str, ...], *, settings: dict) -> int:
        """A missing `root_folder` or `thumbnail_prefix` means this site's
        local sidecar location is unknown, not that it lives at the
        filesystem root: an empty string in an f-string path joins into a
        leading or doubled `/`, which would anchor `os.path.exists`/
        `os.unlink` outside Drive's storage entirely. Refuse to build that
        path at all and no-op instead — never touching local legacy bytes is
        always the safe outcome here, not a best-effort guess at one."""
        import os

        if settings.get("enabled"):
            raise NotImplementedError(
                "deleting S3 thumbnail sidecars needs a real bucket client Ticket 36 must "
                "wire in (Drive Disk Settings has no working get_s3_connection() today); "
                "this port exists for fixture tests only"
            )
        root_folder = settings.get("root_folder") or ""
        thumbnail_prefix = settings.get("thumbnail_prefix") or ""
        if not root_folder or not thumbnail_prefix:
            return 0
        deleted = 0
        for name in names:
            path = os.path.join(root_folder, thumbnail_prefix, f"{name}.thumbnail")
            if os.path.exists(path):
                os.unlink(path)
                deleted += 1
        return deleted


class SiteDiskSettingsSnapshot:
    """`DiskSettingsSnapshot` over the live `Drive Disk Settings` singleton.

    Read exactly once, by `phase_file_rows`, before `phase_content_fields`
    (step 5) drops all ten `DISK_SETTINGS_FIELDS`. Steps 7 and 8 read the
    persisted copy this makes; neither ever queries `Drive Disk Settings`
    live again.
    """

    def read(self) -> dict:
        import frappe

        settings = frappe.get_single("Drive Disk Settings")
        return {field: settings.get(field) for field in DISK_SETTINGS_FIELDS}


class SiteS3LegacyPrefix:
    """`S3LegacyPrefix` over the live bucket and `File Blob` references.

    Carries no `enabled()`/`legacy_prefix()` of its own: step 8 runs after
    step 5 has dropped `Drive Disk Settings.enabled`/`root_folder`, so
    `phase_s3_prefix` reads both off the settings snapshot `phase_file_rows`
    persisted, never off a live query this class would otherwise have to
    make against columns already gone by the time step 8 runs.
    """

    def list_prefix(self, prefix: str, after: str, limit: int) -> list[str]:
        raise NotImplementedError(
            "listing the live bucket is Ticket 36's job; this port exists for fixture tests only"
        )

    def blob_references(self, keys: tuple[str, ...]) -> set[str]:
        import frappe

        if not keys:
            return set()
        rows = frappe.get_all("File Blob", filters={"key": ["in", list(keys)]}, pluck="key")
        return set(rows)

    def enqueue_delete(self, keys: tuple[str, ...]) -> str:
        raise NotImplementedError(
            "enqueuing the live deletion job is Ticket 36's job; this port exists for "
            "fixture tests only. Contract for whoever writes that job: re-read "
            "blob_references(keys) again immediately before each object's bucket delete "
            "call, at execution time — not only at enqueue time. phase_s3_prefix's own "
            "re-check closes the race between listing and enqueueing; it says nothing "
            "about the race between enqueueing and the job actually running, which can be "
            "arbitrarily far apart."
        )


class SiteTransactionGateway:
    """`TransactionGateway` over `frappe.db.commit()`."""

    def commit(self) -> None:
        import frappe

        if not frappe.flags.in_test:
            frappe.db.commit()  # each phase's own unit of durability  # nosemgrep


def _doctype_name_from_path(path: str) -> str:
    """`"drive/doctype/drive_permission"` -> `"Drive Permission"`."""
    slug = path.rsplit("/", 1)[-1]
    return " ".join(word.capitalize() for word in slug.split("_"))
