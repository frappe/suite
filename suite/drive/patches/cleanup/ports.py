"""What Cleanup is allowed to reach (§14.10). Every port is a narrow read
or a narrow write; nothing here bundles more than one phase needs.

The real `Site*` classes below are wired only by `CleanupEnvironment.for_site()`,
and nothing in this package calls that classmethod: Cleanup ships unregistered
(Ticket 35), so these classes exist for a later, separately authorized release
(Ticket 36) to wire in. Two of them — forwarder and wildcard-prefix removal —
raise `NotImplementedError` on purpose: deleting a Python function body out of
`suite/drive/http/shims.py` or an entry out of `suite/hooks.py` is a source
change a maintainer makes, not a runtime database operation, so there is no
honest "real" implementation to write here. Fixture tests exercise the
contract through fakes that model the outcome instead.
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
        """Drop these columns (standard or custom) from one doctype's table."""

    def require_field(self, doctype: str, fieldname: str) -> None:
        """Make a field `reqd: 1` without touching the shipped doctype JSON."""


class ContentRows(Protocol):
    def delete_sheet_docshares(self) -> int:
        """Delete every Sheet `DocShare` row (§14.5 superseded them with grants)."""

    def clear_writer_ycomments(self) -> int:
        """Blank `Writer Document.ycomments` on every row that still carries it."""

    def strip_sheet_comments(self) -> int:
        """Strip cell comments out of `Sheet.sheets_data`, leaving the rest."""


class ThumbnailStore(Protocol):
    def delete_sidecars(self, names: tuple[str, ...]) -> int:
        """Delete the `.thumbnail` sidecar for each of these legacy `File` ids."""


class S3LegacyPrefix(Protocol):
    def enabled(self) -> bool:
        """Whether this site has S3 configured at all."""

    def legacy_prefix(self) -> str:
        """Drive's legacy key prefix in the bucket."""

    def list_prefix(self, prefix: str, after: str, limit: int) -> list[str]:
        """Object keys under `prefix`, ordered, paged by `after`."""

    def blob_references(self, keys: tuple[str, ...]) -> set[str]:
        """The subset of `keys` some `File Blob` row still names."""

    def enqueue_delete(self, keys: tuple[str, ...]) -> str:
        """Queue the long deletion job for exactly these keys. Returns a job id."""


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


class SiteLegacyFileRows:
    """`LegacyFileRows` over the live `tabFile` table."""

    def delete(self, names: tuple[str, ...]) -> int:
        import frappe

        deleted = 0
        for name in names:
            frappe.delete_doc("File", name, ignore_permissions=True, force=True, ignore_missing=True)
            deleted += 1
        return deleted


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
        import frappe

        table = f"tab{doctype}"
        dropped = 0
        for fieldname in fieldnames:
            custom = frappe.get_all(
                "Custom Field", filters={"dt": doctype, "fieldname": fieldname}, pluck="name"
            )
            for name in custom:
                frappe.delete_doc("Custom Field", name, ignore_permissions=True)
            if frappe.db.has_column(table, fieldname):
                frappe.db.sql_ddl(f"alter table `{table}` drop column `{fieldname}`")
                dropped += 1
        if dropped:
            frappe.clear_cache(doctype=doctype)
        return dropped

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

    def strip_sheet_comments(self) -> int:
        import json

        import frappe

        rows = frappe.get_all("Sheet", fields=["name", "sheets_data"])
        stripped = 0
        for row in rows:
            if not row.sheets_data:
                continue
            data = json.loads(row.sheets_data)
            if _strip_comments(data):
                frappe.db.set_value("Sheet", row.name, "sheets_data", json.dumps(data), update_modified=False)
                stripped += 1
        return stripped


class SiteThumbnailStore:
    """`ThumbnailStore` over the disk or bucket `.thumbnail` sidecars."""

    def delete_sidecars(self, names: tuple[str, ...]) -> int:
        import frappe

        settings = frappe.get_single("Drive Disk Settings")
        deleted = 0
        for name in names:
            path = f"{settings.root_folder}/{settings.thumbnail_prefix}/{name}.thumbnail"
            if _delete_one_object(settings, path):
                deleted += 1
        return deleted


class SiteS3LegacyPrefix:
    """`S3LegacyPrefix` over `Drive Disk Settings` and the live bucket."""

    def enabled(self) -> bool:
        import frappe

        return bool(frappe.get_single("Drive Disk Settings").enabled)

    def legacy_prefix(self) -> str:
        import frappe

        settings = frappe.get_single("Drive Disk Settings")
        return settings.root_folder or ""

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
            "enqueuing the live deletion job is Ticket 36's job; this port exists for fixture tests only"
        )


def _doctype_name_from_path(path: str) -> str:
    """`"drive/doctype/drive_permission"` -> `"Drive Permission"`."""
    slug = path.rsplit("/", 1)[-1]
    return " ".join(word.capitalize() for word in slug.split("_"))


def _delete_one_object(settings, path: str) -> bool:
    import frappe

    try:
        if settings.enabled:
            conn = frappe.get_doc("Drive Disk Settings").get_s3_connection()
            conn.delete_object(Bucket=settings.bucket, Key=path)
        else:
            import os

            if os.path.exists(path):
                os.unlink(path)
            else:
                return False
        return True
    except Exception:
        return False


def _strip_comments(data) -> bool:
    """Remove a sheet's cell-comment payload in place. Returns whether it changed."""
    changed = False
    if isinstance(data, dict):
        if "comment" in data or "comments" in data:
            data.pop("comment", None)
            data.pop("comments", None)
            changed = True
        for value in data.values():
            if _strip_comments(value):
                changed = True
    elif isinstance(data, list):
        for value in data:
            if _strip_comments(value):
                changed = True
    return changed
