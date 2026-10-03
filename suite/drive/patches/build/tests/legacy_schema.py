"""The legacy Drive schema, put back on a site that no longer ships it.

Build reads the old tables and columns and Cleanup drops them, but the source
tree carries neither any more: the legacy doctype JSON, the `File` custom
fields and the dropped fields on retained doctypes are all gone. A test that
wants to run Build against a real database therefore has to create what a
pre-migration site would have had. This module does that, with DDL, and
undoes exactly what it created.

`install()` is idempotent and conservative: a doctype, table, column, custom
field, property setter or Singles row that already exists is left alone and
not recorded, so `remove()` on a site that really has (say) `tabSheet.title`
never drops it. The legacy doctypes are created as *custom* DocTypes, which
gives them a table with the right columns and no files on disk, keeps
`frappe.new_doc` working for them, and runs Cleanup's real
`frappe.delete_doc("DocType", ...)` path when it drops them.

`insert_row` writes one row with plain SQL, for columns the meta no longer
declares (`Sheet.title`, `Drive Settings.user_folder`); `db_insert` would
silently drop those values.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import frappe
from frappe.utils import now_datetime

# Field shapes as the legacy doctype JSON declared them (fieldname, fieldtype,
# options). Layout fields are left out: a table has no column for them.
LEGACY_DOCTYPES: dict[str, dict] = {
    "Drive Permission": {
        "module": "Drive",
        "autoname": "hash",
        "fields": (
            ("user", "Data", None),
            ("entity", "Link", "File"),
            ("read", "Check", None),
            ("comment", "Check", None),
            ("share", "Check", None),
            ("write", "Check", None),
            ("upload", "Check", None),
            ("deny", "Check", None),
        ),
    },
    "Drive Entity Activity Log": {
        "module": "Drive",
        "autoname": "hash",
        "fields": (
            ("message", "Data", None),
            ("document_field", "Data", None),
            (
                "action_type",
                "Select",
                "create\ncomment\nshare_add\nshare_remove\nshare_edit\nrename\nedit\nmove\ndelete",
            ),
            ("old_value", "Data", None),
            ("new_value", "Data", None),
            ("entity", "Link", "File"),
            ("meta_value", "Data", None),
        ),
    },
    "Drive Token": {
        "module": "Drive",
        "fields": (
            ("file", "Link", "File"),
            ("user", "Link", "User"),
            ("expiry", "Datetime", None),
        ),
    },
    "Drive User Invitation": {
        "module": "Drive",
        "autoname": "hash",
        "fields": (
            ("email", "Data", None),
            ("status", "Select", "Expired\nPending\nAccepted\nAutomatic\nProposed"),
            ("accepted_on", "Datetime", None),
        ),
    },
    # After `Drive User Invitation`: its `invite` field links to it.
    "Account Request": {
        "module": "Drive",
        "fields": (
            ("email", "Data", None),
            ("request_key", "Data", None),
            ("ip_address", "Data", None),
            ("referral_source", "Data", None),
            ("url_args", "Code", "JSON"),
            ("referrer_id", "Data", None),
            ("geo_location", "Code", None),
            ("oauth_signup", "Check", None),
            ("otp", "Data", None),
            ("otp_generated_at", "Datetime", None),
            ("invite", "Link", "Drive User Invitation"),
            ("signed_up", "Check", None),
            ("login_count", "Int", None),
        ),
    },
    "Drive Legacy Call": {
        "module": "Drive",
        "autoname": "hash",
        "fields": (
            ("legacy_name", "Data", None),
            ("user_agent", "Data", None),
            ("count", "Int", None),
            ("first_seen", "Datetime", None),
            ("last_seen", "Datetime", None),
        ),
    },
    "Writer Version": {
        "module": "Writer",
        "autoname": "hash",
        "fields": (
            ("snapshot", "HTML Editor", None),
            ("title", "Data", None),
            ("manual", "Check", None),
            ("doc", "Link", "Writer Document"),
        ),
    },
    "Writer Doc Version": {
        "module": "Writer",
        "autoname": "hash",
        "istable": 1,
        "fields": (
            ("snapshot", "HTML Editor", None),
            ("title", "Data", None),
            ("manual", "Check", None),
        ),
    },
    "Writer Template": {
        "module": "Writer",
        "autoname": "hash",
        "fields": (
            ("title", "Data", None),
            ("content", "HTML Editor", None),
            ("keymap", "Data", None),
        ),
    },
    "Sheet Snapshot": {
        "module": "Sheets",
        "autoname": "hash",
        "fields": (
            ("sheet", "Link", "Sheet"),
            ("seq", "Int", None),
            ("kind", "Select", "auto\nmilestone\nnamed"),
            ("label", "Data", None),
            ("pinned", "Check", None),
            ("op_count", "Int", None),
            ("byte_size", "Int", None),
            ("actor", "Link", "User"),
            ("sheets_data", "JSON", None),
        ),
    },
}

# Columns Cleanup drops from doctypes that stay: (fieldname, fieldtype).
LEGACY_COLUMNS: dict[str, tuple[tuple[str, str], ...]] = {
    "Sheet": (
        ("title", "Data"),
        ("trashed", "Check"),
        ("trashed_on", "Datetime"),
        ("trashed_by", "Link"),
        # Pointed at `Sheet Snapshot`; step 7 reads it to find the head version.
        ("head_snapshot", "Link"),
    ),
    "Presentation": (("title", "Data"),),
    "Drive Notification": (
        ("from_user", "Link"),
        ("type", "Select"),
        ("message", "Text"),
        ("notif_doctype", "Link"),
        ("notif_doctype_name", "Dynamic Link"),
        ("entity_type", "Data"),
    ),
    "Drive Settings": (("user_folder", "Link"), ("quota", "Int")),
    "Drive Storage Reservation": (("storage_owner", "Link"),),
    "Drive Favourite": (("entity", "Link"),),
    "Drive Root": (("acl_generation", "Int"),),
}

# The ten `Drive Disk Settings` fields, as `tabSingles` rows. A local site.
DISK_SETTINGS_SINGLES: dict[str, str] = {
    "enabled": "0",
    "quota": "0",
    "root_folder": "",
    "thumbnail_prefix": "",
    "flat": "0",
    "aws_key": "",
    "aws_secret": "",
    "bucket": "",
    "endpoint_url": "",
    "signature_version": "",
}

# `suite/fixtures/custom_field.json`, as it shipped.
FILE_CUSTOM_FIELDS: tuple[dict, ...] = (
    {
        "fieldname": "section_break_nfot8",
        "fieldtype": "Section Break",
        "label": "Drive Properties",
        "insert_after": "section_break_8",
    },
    {
        "fieldname": "mime_type",
        "fieldtype": "Data",
        "label": "MIME Type",
        "insert_after": "section_break_nfot8",
    },
    {
        "fieldname": "status",
        "fieldtype": "Select",
        "label": "Status",
        "options": "Active\nTrashed\nRemoved",
        "insert_after": "section_break_nfot8",
    },
    {
        "fieldname": "file_modified",
        "fieldtype": "Datetime",
        "label": "File Modified",
        "insert_after": "status",
    },
    {"fieldname": "column_break_tapww", "fieldtype": "Column Break", "insert_after": "settings"},
    {
        "fieldname": "content_doctype",
        "fieldtype": "Link",
        "label": "Content Doctype",
        "options": "DocType",
        "insert_after": "column_break_tapww",
    },
    {
        "fieldname": "content_docname",
        "fieldtype": "Dynamic Link",
        "label": "Content Docname",
        "options": "content_doctype",
        "insert_after": "content_doctype",
    },
)

# `suite/fixtures/property_setter.json`, as it shipped.
FILE_PROPERTY_SETTERS: tuple[dict, ...] = (
    {
        "fieldname": "file_url",
        "property": "depends_on",
        "value": "eval:!doc.is_folder",
        "property_type": "Data",
    },
    {"fieldname": "folder", "property": "hidden", "value": "0", "property_type": "Check"},
    {"fieldname": "folder", "property": "depends_on", "value": "", "property_type": "Data"},
)

STANDARD_COLUMNS = ("name", "creation", "modified", "modified_by", "owner", "docstatus", "idx")


@dataclass
class LegacySchema:
    """What one `install()` created, so `remove()` takes back only that."""

    doctypes: list[str] = field(default_factory=list)
    columns: list[tuple[str, str]] = field(default_factory=list)
    singles: list[str] = field(default_factory=list)
    custom_fields: list[str] = field(default_factory=list)
    property_setters: list[str] = field(default_factory=list)

    def remove(self) -> None:
        for name in self.property_setters:
            frappe.delete_doc(
                "Property Setter", name, force=True, ignore_permissions=True, ignore_missing=True
            )
        for fieldname in self.custom_fields:
            name = frappe.db.get_value("Custom Field", {"dt": "File", "fieldname": fieldname})
            if name:
                frappe.delete_doc("Custom Field", name, force=True, ignore_permissions=True)
            frappe.db.sql_ddl(f"ALTER TABLE `tabFile` DROP COLUMN IF EXISTS `{fieldname}`")
        if self.singles:
            frappe.db.sql(
                "DELETE FROM `tabSingles` WHERE `doctype` = 'Drive Disk Settings' AND `field` IN %(fields)s",
                {"fields": tuple(self.singles)},
            )
        for doctype, column in self.columns:
            frappe.db.sql_ddl(f"ALTER TABLE `tab{doctype}` DROP COLUMN IF EXISTS `{column}`")
        # Children of a link go before the doctype they link to.
        for doctype in reversed(self.doctypes):
            if frappe.db.exists("DocType", doctype):
                frappe.delete_doc("DocType", doctype, force=True, ignore_permissions=True)
            frappe.db.sql_ddl(f"DROP TABLE IF EXISTS `tab{doctype}`")
        frappe.clear_cache()
        self.doctypes.clear()
        self.columns.clear()
        self.singles.clear()
        self.custom_fields.clear()
        self.property_setters.clear()


def install() -> LegacySchema:
    """Create whatever part of the legacy schema this site lacks."""
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    schema = LegacySchema()
    for name, spec in LEGACY_DOCTYPES.items():
        if frappe.db.exists("DocType", name) or frappe.db.table_exists(name):
            continue
        _create_custom_doctype(name, spec)
        schema.doctypes.append(name)
    for doctype, columns in LEGACY_COLUMNS.items():
        # The column list is cached per table and DDL does not refresh it;
        # a previous install that died half-way leaves it stale.
        frappe.client_cache.delete_value(f"table_columns::tab{doctype}")
        for column, fieldtype in columns:
            if frappe.db.has_column(doctype, column):
                continue
            frappe.db.sql_ddl(f"ALTER TABLE `tab{doctype}` ADD COLUMN `{column}` {_column_type(fieldtype)}")
            schema.columns.append((doctype, column))
    present = set(
        frappe.db.sql_list(
            "SELECT `field` FROM `tabSingles` WHERE `doctype` = 'Drive Disk Settings' AND `field` IN %(fields)s",
            {"fields": tuple(DISK_SETTINGS_SINGLES)},
        )
    )
    for fieldname, value in DISK_SETTINGS_SINGLES.items():
        if fieldname in present:
            continue
        frappe.db.sql(
            "INSERT INTO `tabSingles` (`doctype`, `field`, `value`) VALUES ('Drive Disk Settings', %(field)s, %(value)s)",
            {"field": fieldname, "value": value},
        )
        schema.singles.append(fieldname)
    missing_custom_fields = [
        dict(spec)
        for spec in FILE_CUSTOM_FIELDS
        if not frappe.db.exists("Custom Field", {"dt": "File", "fieldname": spec["fieldname"]})
    ]
    if missing_custom_fields:
        create_custom_fields({"File": missing_custom_fields}, ignore_validate=True)
        schema.custom_fields.extend(spec["fieldname"] for spec in missing_custom_fields)
    for spec in FILE_PROPERTY_SETTERS:
        key = {"doc_type": "File", "field_name": spec["fieldname"], "property": spec["property"]}
        if frappe.db.exists("Property Setter", key):
            continue
        # `make_property_setter` answers nothing; the row is found by its key.
        frappe.make_property_setter(
            {"doctype": "File", **spec}, ignore_validate=True, validate_fields_for_doctype=False
        )
        schema.property_setters.append(frappe.db.get_value("Property Setter", key))
    frappe.clear_cache()
    return schema


def insert_row(doctype: str, name: str, **columns) -> str:
    """One row, written with SQL so undeclared columns keep their values."""
    now = now_datetime()
    values = {
        "name": name,
        "creation": now,
        "modified": now,
        "modified_by": "Administrator",
        "owner": "Administrator",
        "docstatus": 0,
        "idx": 0,
        **columns,
    }
    names = ", ".join(f"`{column}`" for column in values)
    placeholders = ", ".join(f"%({column})s" for column in values)
    frappe.db.sql(f"INSERT INTO `tab{doctype}` ({names}) VALUES ({placeholders})", values)
    return name


def update_row(doctype: str, name: str, **columns) -> None:
    """Set columns the doctype's meta no longer declares, so `db_insert` cannot."""
    if not columns:
        return
    assignments = ", ".join(f"`{column}` = %({column})s" for column in columns)
    frappe.db.sql(
        f"UPDATE `tab{doctype}` SET {assignments} WHERE `name` = %(name)s", {**columns, "name": name}
    )


def _create_custom_doctype(name: str, spec: dict) -> None:
    fields = [
        {
            "fieldname": fieldname,
            "fieldtype": fieldtype,
            "options": options,
            "label": fieldname.replace("_", " ").title(),
        }
        for fieldname, fieldtype, options in spec["fields"]
    ]
    doctype = frappe.get_doc(
        {
            "doctype": "DocType",
            "name": name,
            "module": spec["module"],
            "custom": 1,
            "istable": spec.get("istable", 0),
            "autoname": spec.get("autoname"),
            "fields": fields,
            "permissions": []
            if spec.get("istable")
            else [{"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1}],
        }
    )
    doctype.flags.ignore_links = True
    doctype.insert(ignore_permissions=True)


def _column_type(fieldtype: str) -> str:
    kind, length = frappe.db.type_map[fieldtype]
    column = f"{kind}({length})" if length else kind
    if fieldtype in ("Check", "Int"):
        column += " NOT NULL DEFAULT 0"
    return column
