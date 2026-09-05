import json

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields


def ensure_custom_fields():
    """Create Drive's `File` custom fields (status, content_doctype, ...).

    They ship as fixtures, which Frappe syncs only AFTER after_install runs. But
    inside the suite app Drive overrides the core File class app-wide, so a File
    created during ANY module's after_install (e.g. Mail's default folders) runs
    through Drive's hooks and needs these columns to already exist. Create them up
    front. Idempotent: create_custom_fields updates fields in place on re-run.
    """
    path = frappe.get_app_path("suite", "fixtures", "custom_field.json")
    with open(path) as f:
        fields = json.load(f)

    grouped = {}
    for df in fields:
        grouped.setdefault(df["dt"], []).append(df)

    create_custom_fields(grouped, ignore_validate=True)


def after_install():
    index_check = frappe.db.sql("""SHOW INDEX FROM `tabFile` WHERE Key_name = 'drive_file_name_fts_idx'""")
    if not index_check:
        frappe.db.sql("""ALTER TABLE `tabFile` ADD FULLTEXT INDEX drive_file_name_fts_idx (file_name)""")


def after_user_insert(doc, method: str | None = None) -> None:
    """Provision new and compatibility Drive state for an ordinary user."""
    from suite.drive._core.roots import provision_personal_root
    from suite.drive.utils.users import create_drive_settings

    provision_personal_root(doc.name)
    create_drive_settings(doc, method)


def on_user_trash(doc, method: str | None = None) -> None:
    """Archive the user's Personal root without touching its node tree."""
    from suite.drive._core.roots import archive_personal_root

    archive_personal_root(doc.name)
