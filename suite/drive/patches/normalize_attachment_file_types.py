import frappe
import mimemapper

from suite.drive.utils import get_file_type


def execute():
    attachments = frappe.get_all(
        "File",
        filters={"attached_to_doctype": ["is", "set"], "is_folder": 0},
        fields=["name", "file_name", "file_type", "mime_type"],
    )

    for attachment in attachments:
        mime_type = mimemapper.get_mime_type(attachment.file_name, native_first=False)
        file_type = get_file_type(mime_type)
        if file_type == "Unknown" or (attachment.file_type == file_type and attachment.mime_type):
            continue
        frappe.db.set_value(
            "File",
            attachment.name,
            {"mime_type": mime_type, "file_type": file_type},
            update_modified=False,
        )
