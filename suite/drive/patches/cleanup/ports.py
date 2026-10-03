"""What Cleanup is allowed to reach (§14.10). Every port is a narrow read
or a narrow write; nothing here bundles more than one phase needs.

The real `Site*` classes below are wired by `CleanupEnvironment.for_site()`
and run inside `bench migrate`, right after Build. Fixture tests exercise
every contract through `tests.fakes`; `tests.test_site_ports` covers the
real classes with `frappe.db` and the bucket client stubbed.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import frappe

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

# The subset step 7 and the manual `delete_legacy_objects` command still
# need after step 5 has dropped every one of them. `phase_file_rows`
# snapshots these into the state file once, before step 5 runs; the
# credentials stay out of that file on purpose, because the framework S3
# driver supplies the client.
SNAPSHOT_FIELDS = ("enabled", "root_folder", "thumbnail_prefix", "bucket")


@dataclass(frozen=True)
class ChainRow:
    """The three columns the upward reachability climb needs, and nothing else."""

    name: str
    folder: str | None
    status: str


@dataclass(frozen=True)
class SlidesMediaRow:
    """A legacy `File` attached to a Presentation, whose blob a node of that
    deck holds. `file_url` is what a slide body would still name it by."""

    name: str
    file_url: str | None


@dataclass(frozen=True)
class SlideBodyValues:
    """Every string the site's slide bodies hold, for "is this URL still named".

    `strings` are the complete values of every readable body. `unreadable`
    are the raw `elements` of a body that is not a JSON array; a URL that
    appears anywhere inside one counts as named, which over-reports and so
    only keeps a row.
    """

    strings: frozenset[str]
    unreadable: tuple[str, ...]


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


class LegacyFileRows(Protocol):
    def delete(self, names: tuple[str, ...]) -> int:
        """Delete these legacy `File` rows. Returns the count actually removed."""


class SchemaGateway(Protocol):
    def drop_custom_fields(self, fieldnames: tuple[str, ...]) -> int:
        """Delete `Custom Field` rows on `File` by fieldname."""

    def drop_property_setters(self, keys: tuple[tuple[str, str, str], ...]) -> int:
        """Delete `Property Setter` rows by `(doc_type, field_name, property)`."""

    def drop_doctypes(self, doctypes: tuple[str, ...]) -> int:
        """Delete these DocType rows and drop their tables. A doctype whose
        row or table is already gone is skipped, not an error."""

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

    def custom_fields_present(self, fieldnames: tuple[str, ...]) -> frozenset[str]:
        """The subset of these `File` custom-field names that still exist,
        checked directly against `Custom Field` rows — never inferred from
        how many a `drop_custom_fields` call reported removing. MariaDB's
        DDL inside `drop_columns`/`drop_single_values` auto-commits, so a
        crash between two of this phase's own calls can leave some targets
        already gone before the phase's own checkpoint is ever written; a
        resumed call's own `drop_*` count is then legitimately smaller than
        the full expected count, which is not the same fact as something
        still being there. This is the fact removal.py's phases actually
        need: is every named target really gone now, regardless of how much
        of that this call did versus an earlier, interrupted one."""

    def property_setters_present(
        self, keys: tuple[tuple[str, str, str], ...]
    ) -> frozenset[tuple[str, str, str]]:
        """The subset of these `(doc_type, field_name, property)` keys that
        still have a `Property Setter` row, checked directly."""

    def doctypes_present(self, doctypes: tuple[str, ...]) -> frozenset[str]:
        """The subset of these doctypes that still have a `DocType` row or a
        table, checked directly."""

    def columns_present(self, doctype: str, fieldnames: tuple[str, ...]) -> frozenset[str]:
        """The subset of these fieldnames that are still real columns on
        `doctype`'s table, checked directly with `frappe.db.has_column`. Not
        for a Single: use `single_values_present`."""

    def single_values_present(self, doctype: str, fieldnames: tuple[str, ...]) -> frozenset[str]:
        """The subset of these fieldnames that still have a row in
        `tabSingles` for this Single `doctype`, checked directly."""


class ContentRows(Protocol):
    def governed_docshares_remaining(self) -> frozenset[str]:
        """The governed doctypes that still carry a `DocShare` row.

        §14.10 lists "Delete Sheet `DocShare` rows" under this phase, but
        Build already deletes them: it rewrites each one as a grant and
        removes it in the same commit, because §5.13's read guards fail
        closed on a surviving row and `suite.drive.framework.
        validate_content_registry` refuses the migration while one is left.
        A site that reaches Cleanup with any governed doctype still shared
        never ran that Build, so this phase verifies rather than deletes, and
        refuses instead of quietly finishing the job a release late.

        Every doctype `suite.drive._core.content.governed_doctypes` names is
        asked, not only `Sheet`: satellites take their rights from the
        document's node too."""

    def clear_writer_ycomments(self) -> int:
        """Blank `Writer Document.ycomments` on every row that still carries it."""

    def strip_sheet_comments(self, *, batch_size: int) -> int:
        """Strip the `comments` key out of `Sheet.sheets_data`'s decoded JSON,
        paged `batch_size` rows at a time. Leaves everything else in the
        workbook untouched: this is not a general-purpose key scrub."""

    def converted_slides_media(self, after: str, limit: int) -> list[SlidesMediaRow]:
        """The `File` rows attached to a Presentation whose own blob a `file`
        node directly under that deck's node holds, by name after `after`.

        That node is Build's record of the conversion (§14.7): Build makes
        one per deck per blob and gives it the File's blob. A row whose blob
        Build swapped for a same-content one is not returned, so deleting a
        returned row never leaves a blob that only that row referenced."""

    def slide_body_values(self, *, batch_size: int) -> SlideBodyValues:
        """The strings in every Slide's `elements`, `background` and
        `thumbnail`, read `batch_size` rows at a time."""

    def site_host(self) -> str:
        """The one netloc a stored URL may carry and still name this site."""


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


class TransactionGateway(Protocol):
    def commit(self) -> None:
        """End the current phase's writes. Called after a phase's mutations
        succeed and before its checkpoint is written, so a checkpoint can
        never claim durability the database does not actually have."""


# --- real site implementations, wired by CleanupEnvironment.for_site -------


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


class SiteLegacyFileRows:
    """`LegacyFileRows` over the live `tabFile` table, by direct DB deletion.

    Never `frappe.delete_doc`: the framework `File.on_trash` deletes the
    bytes a row points at, and the bytes these rows point at are the very
    ones Build linked into `File Blob` in place (local) or copied and kept
    for the backup restore (S3; only the manual `delete_legacy_objects`
    command removes them). Cleanup has already computed the safe deletion
    order (`removal._deepest_removed_first`); a plain `DELETE` fires no
    hook at all (`frappe.db.delete`'s own docstring).
    """

    def delete(self, names: tuple[str, ...]) -> int:
        import frappe

        if not names:
            return 0
        existing = frappe.db.get_all("File", filters={"name": ["in", list(names)]}, pluck="name")
        if not existing:
            return 0
        from suite.drive.patches.cleanup.attachments import preserve_attachments

        preserve_attachments(tuple(existing))
        frappe.db.delete("File", {"name": ["in", existing]})
        return len(existing)


class SiteSchemaGateway:
    """`SchemaGateway` over Custom Field, Property Setter, and raw DDL."""

    def drop_custom_fields(self, fieldnames: tuple[str, ...]) -> int:
        """Deletes the `Custom Field` metadata rows. `CustomField.on_trash`
        clears property setters and layouts but never drops the column, so
        the phase follows with `drop_columns("File", ...)` for the five
        fields that have one."""
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

    def drop_doctypes(self, doctypes: tuple[str, ...]) -> int:
        """`frappe.delete_doc` removes the `DocType` row and its fields but
        leaves the table (orphan tables are only ever dropped by hand), so
        the `DROP TABLE` here is what actually frees the legacy data. Both
        halves are idempotent: a resumed call finds nothing and does nothing.
        """
        import frappe

        removed = 0
        for doctype in doctypes:
            if frappe.db.exists("DocType", doctype):
                frappe.delete_doc("DocType", doctype, ignore_permissions=True, force=True)
                removed += 1
            frappe.db.sql_ddl(f"DROP TABLE IF EXISTS `tab{doctype}`")
        if removed:
            frappe.clear_cache()
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
        """Idempotent: a resumed phase, or a rehearsal that already ran, finds
        the setter in place and only makes sure of its value."""
        import frappe

        key = {"doc_type": doctype, "field_name": fieldname, "property": "reqd"}
        existing = frappe.db.get_value("Property Setter", key)
        if existing:
            frappe.db.set_value("Property Setter", existing, "value", "1")
            frappe.clear_cache(doctype=doctype)
            return
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

    def custom_fields_present(self, fieldnames: tuple[str, ...]) -> frozenset[str]:
        import frappe

        if not fieldnames:
            return frozenset()
        found = frappe.get_all(
            "Custom Field", filters={"dt": "File", "fieldname": ["in", list(fieldnames)]}, pluck="fieldname"
        )
        return frozenset(found)

    def property_setters_present(
        self, keys: tuple[tuple[str, str, str], ...]
    ) -> frozenset[tuple[str, str, str]]:
        import frappe

        present = set()
        for doc_type, field_name, prop in keys:
            if frappe.db.exists(
                "Property Setter", {"doc_type": doc_type, "field_name": field_name, "property": prop}
            ):
                present.add((doc_type, field_name, prop))
        return frozenset(present)

    def doctypes_present(self, doctypes: tuple[str, ...]) -> frozenset[str]:
        import frappe

        return frozenset(
            doctype
            for doctype in doctypes
            if frappe.db.exists("DocType", doctype) or frappe.db.table_exists(doctype)
        )

    def columns_present(self, doctype: str, fieldnames: tuple[str, ...]) -> frozenset[str]:
        import frappe

        return frozenset(name for name in fieldnames if frappe.db.has_column(doctype, name))

    def single_values_present(self, doctype: str, fieldnames: tuple[str, ...]) -> frozenset[str]:
        import frappe

        if not fieldnames:
            return frozenset()
        placeholders = ", ".join(["%s"] * len(fieldnames))
        rows = frappe.db.sql(
            f"select field from `tabSingles` where doctype=%s and field in ({placeholders})",
            (doctype, *fieldnames),
        )
        return frozenset(row[0] for row in rows)


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
    except TypeError, ValueError:
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
    """`ContentRows` over Sheet, Writer, Slides, and their side tables."""

    def governed_docshares_remaining(self) -> frozenset[str]:
        import frappe

        from suite.drive._core.content import governed_doctypes

        return frozenset(
            doctype
            for doctype in governed_doctypes()
            if frappe.db.exists("DocShare", {"share_doctype": doctype})
        )

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

    def converted_slides_media(self, after: str, limit: int) -> list[SlidesMediaRow]:
        import frappe

        rows = frappe.db.sql(
            """
            select f.name as name, f.file_url as file_url
            from `tabFile` f
            join `tabPresentation` p on p.name = f.attached_to_name
            where f.attached_to_doctype = 'Presentation'
              and f.name > %(after)s
              and ifnull(f.`blob`, '') != ''
              and exists (
                select 1 from `tabDrive Node` n
                where n.parent_node = p.node and n.kind = 'file' and n.`blob` = f.`blob`
              )
            order by f.name
            limit %(limit)s
            """,
            {"after": after, "limit": limit},
            as_dict=True,
        )
        return [SlidesMediaRow(row.name, row.file_url) for row in rows]

    def slide_body_values(self, *, batch_size: int) -> SlideBodyValues:
        import json

        import frappe

        from suite.drive.patches.build.slides import _strings

        strings: set[str] = set()
        unreadable: list[str] = []
        after = ""
        while True:
            rows = frappe.db.sql(
                """
                select name, elements, background, thumbnail
                from `tabSlide`
                where name > %(after)s
                order by name
                limit %(limit)s
                """,
                {"after": after, "limit": batch_size},
                as_dict=True,
            )
            for row in rows:
                strings |= {value for value in (row.background, row.thumbnail) if value}
                if not row.elements:
                    continue
                try:
                    elements = json.loads(row.elements)
                except ValueError:
                    elements = None
                if isinstance(elements, list):
                    strings |= _strings(elements)
                else:
                    unreadable.append(row.elements)
            if len(rows) < batch_size:
                return SlideBodyValues(frozenset(strings), tuple(unreadable))
            after = rows[-1].name

    def site_host(self) -> str:
        from urllib.parse import urlsplit

        from frappe.utils import get_url

        return urlsplit(get_url()).netloc


class ThumbnailPathError(frappe.ValidationError):
    """A `thumbnail_prefix` would build a delete path outside `root_folder`."""


class SiteThumbnailStore:
    """`ThumbnailStore` over the local-disk `.thumbnail` sidecars.

    Takes `settings` as an argument instead of reading `Drive Disk Settings`
    live: by the time step 7 runs, step 5 has already dropped every field
    such a live read would need, so the caller passes the snapshot
    `phase_file_rows` took before step 5 ran.

    On an S3 site the sidecars are bucket objects, and Cleanup deletes no
    bucket object (§14.11: the backup restore stays a complete rollback
    until the manual `delete_legacy_objects` command runs), so an S3
    snapshot deletes nothing and answers 0.
    """

    def delete_sidecars(self, names: tuple[str, ...], *, settings: dict) -> int:
        """A missing `root_folder` or `thumbnail_prefix` means this site's
        local sidecar location is unknown, not that it lives at the
        filesystem root: an empty string in an f-string path joins into a
        leading or doubled `/`, which would anchor `os.path.exists`/
        `os.unlink` outside Drive's storage entirely. Refuse to build that
        path at all and no-op instead — never touching local legacy bytes is
        always the safe outcome here, not a best-effort guess at one.

        A configured but hostile `thumbnail_prefix` gets the same refusal,
        for a sharper reason: `os.path.join`/`Path.__truediv__` both discard
        everything to their left the moment a later component is itself
        absolute, so `os.path.join(root_folder, "/etc", name)` silently
        becomes `/etc/<name>` — string concatenation cannot tell that case
        apart from an ordinary relative prefix. `root_folder` itself is
        allowed to be absolute (a real site's disk root usually is); only
        `thumbnail_prefix` is untrusted here, so the check is containment of
        the resolved join under the resolved root, not a ban on absolute
        paths in general."""
        import os
        from pathlib import Path

        if settings.get("enabled"):
            return 0
        root_folder = settings.get("root_folder") or ""
        thumbnail_prefix = settings.get("thumbnail_prefix") or ""
        if not root_folder or not thumbnail_prefix:
            return 0
        if os.path.isabs(thumbnail_prefix):
            raise ThumbnailPathError(
                f"thumbnail_prefix {thumbnail_prefix!r} is an absolute path; joining it onto "
                f"root_folder {root_folder!r} would discard root_folder entirely and delete "
                "outside Drive's storage. Refusing, not deleting anything."
            )
        root = Path(root_folder).resolve()
        base = (root / thumbnail_prefix).resolve()
        if not base.is_relative_to(root):
            raise ThumbnailPathError(
                f"thumbnail_prefix {thumbnail_prefix!r} resolves to {base}, outside root_folder "
                f"{root_folder!r} (resolved: {root}). A '..'-escaping prefix must never be "
                "joined into a delete path. Refusing, not deleting anything."
            )
        deleted = 0
        for name in names:
            path = base / f"{name}.thumbnail"
            if path.exists():
                path.unlink()
                deleted += 1
        return deleted


class LegacyBucket:
    """The framework S3 driver's bucket and client, as the manual
    `delete_legacy_objects` command uses them. No Cleanup phase deletes a
    bucket object.

    Build already refused any site whose legacy `Drive Disk Settings.bucket`
    differs from the framework driver's (`suite.drive.patches.build.gate`),
    so "the legacy bucket" and "the driver's bucket" are one bucket
    reachable through one client.
    """

    # `DeleteObjects` takes at most this many keys per call.
    DELETE_BATCH = 1000

    def __init__(self, bucket: str, client):
        self.bucket = bucket
        self.client = client

    def delete_keys(self, keys: tuple[str, ...]) -> int:
        """Delete these keys, exactly as given, 1000 per call. Returns how
        many S3 reports deleted. A key that is already gone is reported
        deleted, not an error: `DeleteObjects` is idempotent."""
        deleted = 0
        for start in range(0, len(keys), self.DELETE_BATCH):
            batch = keys[start : start + self.DELETE_BATCH]
            response = self.client.delete_objects(
                Bucket=self.bucket,
                Delete={"Objects": [{"Key": key} for key in batch], "Quiet": False},
            )
            errors = response.get("Errors") or []
            if errors:
                first = errors[0]
                raise RuntimeError(
                    f"S3 refused to delete {len(errors)} of {len(batch)} legacy keys (for example "
                    f"{first.get('Key')!r}: {first.get('Code')} {first.get('Message')})"
                )
            deleted += len(response.get("Deleted") or [])
        return deleted


def legacy_bucket() -> LegacyBucket:
    from frappe.storage.driver import get_driver

    driver = get_driver("s3")
    return LegacyBucket(driver.bucket, driver.client)


class SiteDiskSettingsSnapshot:
    """`DiskSettingsSnapshot` over the live `Drive Disk Settings` singleton.

    Read exactly once, by `phase_file_rows`, before `phase_content_fields`
    (step 5) drops all ten `DISK_SETTINGS_FIELDS`. Step 7 and the manual
    `delete_legacy_objects` command read the persisted copy this makes;
    neither ever queries `Drive Disk Settings` live again. Plain
    `tabSingles` reads: the Single's meta no longer declares these fields
    by the time Cleanup runs.
    """

    def read(self) -> dict:
        import frappe
        from frappe.utils import cint

        rows = frappe.db.sql(
            """SELECT `field`, `value` FROM `tabSingles`
               WHERE `doctype` = 'Drive Disk Settings' AND `field` IN %(fields)s""",
            {"fields": SNAPSHOT_FIELDS},
        )
        values = dict(rows)
        snapshot = {field: values.get(field) for field in SNAPSHOT_FIELDS}
        snapshot["enabled"] = bool(cint(snapshot["enabled"]))
        return snapshot


class SiteTransactionGateway:
    """`TransactionGateway` over `frappe.db.commit()`."""

    def commit(self) -> None:
        import frappe

        if not frappe.flags.in_test:
            frappe.db.commit()  # each phase's own unit of durability  # nosemgrep
