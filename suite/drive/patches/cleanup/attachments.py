"""Keep framework attachments and public URLs before their Drive File rows go."""

import hashlib
from urllib.parse import quote

import frappe

ATTACHMENT_COLUMNS = (
    "name",
    "owner",
    "creation",
    "modified",
    "modified_by",
    "docstatus",
    "idx",
    "file_name",
    "file_url",
    "file_size",
    "is_private",
    "blob",
    "folder",
    "is_folder",
    "attached_to_doctype",
    "attached_to_name",
    "attached_to_field",
    "content_hash",
)
CONTENT_DOCTYPES = ("File", "Writer Document", "Sheet", "Presentation", "Drive Node")


def preserve_attachments(names: tuple[str, ...]) -> None:
    """Create stable Home copies in the same transaction as the source delete.

    Public originals still serve stored URLs after Drive takes a private copy.
    A framework attachment still needs a File row for permissions and blob GC.
    The new row sits outside Drive, so a resumed Cleanup never enumerates it.
    """
    rows = frappe.db.sql(
        """SELECT f.*, b.is_private AS blob_private, b.driver AS blob_driver
        FROM `tabFile` f JOIN `tabFile Blob` b ON b.name = f.`blob`
        WHERE f.name IN %(names)s AND f.is_folder = 0
          AND (b.is_private = 0 OR (
            IFNULL(f.attached_to_doctype, '') != '' AND f.attached_to_doctype NOT IN %(content)s))""",
        {"names": names, "content": CONTENT_DOCTYPES},
        as_dict=True,
    )
    for source in rows:
        if source.blob_private and not _framework_attachment(source):
            continue
        copy = {column: source.get(column) for column in ATTACHMENT_COLUMNS}
        copy.update(name="attachment-" + hashlib.sha256(source.name.encode()).hexdigest(), folder="Home")
        if source.blob_driver != "local":
            copy.update(
                file_url=f"/f/{source.blob}/{quote(source.file_name or source.blob)}",
                is_private=source.blob_private,
            )
        existing = frappe.db.get_value("File", copy["name"], list(ATTACHMENT_COLUMNS), as_dict=True)
        if existing:
            if any(
                existing.get(column) != copy[column]
                for column in (
                    "blob",
                    "file_url",
                    "folder",
                    "is_private",
                    "attached_to_doctype",
                    "attached_to_name",
                    "attached_to_field",
                )
            ):
                raise ValueError(f"framework attachment copy of {source.name} changed")
        else:
            frappe.db.bulk_insert(
                "File",
                fields=ATTACHMENT_COLUMNS,
                values=[tuple(copy[column] for column in ATTACHMENT_COLUMNS)],
            )
        _update_attachment_url(source, copy["file_url"])


def _framework_attachment(row) -> bool:
    return bool(
        row.attached_to_doctype not in CONTENT_DOCTYPES
        and row.attached_to_name
        and frappe.db.exists("DocType", row.attached_to_doctype)
        and frappe.db.exists(row.attached_to_doctype, row.attached_to_name)
    )


def _update_attachment_url(source, url: str) -> None:
    if url == source.file_url or not source.attached_to_field or not _framework_attachment(source):
        return
    if (
        frappe.db.get_value(source.attached_to_doctype, source.attached_to_name, source.attached_to_field)
        == source.file_url
    ):
        frappe.db.set_value(
            source.attached_to_doctype,
            source.attached_to_name,
            source.attached_to_field,
            url,
            update_modified=False,
        )
