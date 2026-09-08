# Copyright (c) 2022, Frappe Technologies Pvt. Ltd. and Contributors
# MIT License. See license.txt

import re

import frappe
from frappe.tests.utils import whitelist_for_tests

DEFAULT_PASSWORD = "DriveWriterE2E!2026"
USER_COUNT = 2
MAX_USER_COUNT = 16
RUN_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")


def _validate_run_id(run_id: str) -> str:
    run_id = (run_id or "").strip().lower()
    if not RUN_ID_PATTERN.fullmatch(run_id):
        frappe.throw("run_id must contain 1-40 lowercase letters, numbers, or hyphens")
    return run_id


def _user_emails(run_id: str, user_count: int = USER_COUNT) -> list[str]:
    run_id = _validate_run_id(run_id)
    if user_count < USER_COUNT or user_count > MAX_USER_COUNT or user_count % 2:
        frappe.throw(f"user_count must be an even number between {USER_COUNT} and {MAX_USER_COUNT}")
    return [f"drive-writer-e2e-{run_id}-{number}@example.test" for number in range(1, user_count + 1)]


def _existing_user_emails(run_id: str) -> list[str]:
    run_id = _validate_run_id(run_id)
    return frappe.get_all(
        "User",
        filters={"name": ["like", f"drive-writer-e2e-{run_id}-%@example.test"]},
        pluck="name",
        order_by="name",
    )


def _user_result(email: str, password: str | None = None) -> dict:
    result = {
        "email": email,
        "user": email,
        "drive_settings": frappe.db.get_value("Drive Settings", {"user": email}, "name"),
        "user_folder": frappe.db.get_value("Drive Settings", email, "user_folder"),
    }
    if password is not None:
        result["password"] = password
    return result


def _user_files(email: str) -> list[str]:
    """The user's folder and everything under it, plus anything they own."""
    folder = frappe.db.get_value("Drive Settings", email, "user_folder")
    names = frappe.get_all("File", filters={"owner": email}, pluck="name")
    if folder:
        names.append(folder)
        frontier = [folder]
        while frontier:
            children = frappe.get_all("File", filters={"folder": ["in", frontier]}, pluck="name")
            frontier = [c for c in children if c not in names]
            names.extend(frontier)
    return list(dict.fromkeys(names))


def _delete_user_drive_data(email: str) -> None:
    files = _user_files(email)

    if files:
        writer_documents = frappe.get_all(
            "File",
            filters={"name": ["in", files], "content_doctype": "Writer Document"},
            pluck="content_docname",
        )
        for document in set(filter(None, writer_documents)):
            frappe.db.delete("Writer Version", {"doc": document})
            frappe.db.delete("Writer Document", {"name": document})

        sheets = frappe.get_all(
            "File",
            filters={"name": ["in", files], "content_doctype": "Sheet"},
            pluck="content_docname",
        )
        for sheet in set(filter(None, sheets)):
            # Sheet Op Log and Sheet Snapshot both carry a User link (actor) that
            # blocks the User delete below.
            frappe.db.delete("Sheet Op Log", {"sheet": sheet})
            frappe.db.delete("Sheet Snapshot", {"sheet": sheet})
            frappe.db.delete("Sheet", {"name": sheet})

        presentations = frappe.get_all(
            "File",
            filters={"name": ["in", files], "content_doctype": "Presentation"},
            pluck="content_docname",
        )
        for presentation in set(filter(None, presentations)):
            frappe.db.delete("Presentation", {"name": presentation})

        for doctype, field in (
            ("Drive Permission", "entity"),
            ("Drive Favourite", "entity"),
            ("Drive Recent", "node"),
            ("Drive Entity Activity Log", "entity"),
            ("Drive Token", "file"),
        ):
            frappe.db.delete(doctype, {field: ["in", files]})

    frappe.db.delete("Drive Permission", {"user": email})
    frappe.db.delete("Drive Favourite", {"user": email})
    frappe.db.delete("Drive Recent", {"user": email})
    frappe.db.delete("Drive Token", {"user": email})
    frappe.db.delete("Drive Notification", {"from_user": email})
    frappe.db.delete("Drive Notification", {"to_user": email})
    frappe.db.delete("Drive User Invitation", {"email": email})

    if files:
        frappe.db.delete("File", {"name": ["in", files]})

    frappe.db.delete("Drive Settings", {"user": email})


def _create_user_drive_data(email: str) -> None:
    from suite.drive.utils import get_user_folder

    get_user_folder(email)


@whitelist_for_tests(methods=["POST"])
def provision_users(run_id: str, password: str = DEFAULT_PASSWORD, user_count: int = USER_COUNT) -> dict:
    """Create isolated owner/collaborator pairs for each E2E worker."""
    emails = _user_emails(run_id, user_count)
    if not password:
        frappe.throw("password is required")

    existing = [email for email in emails if frappe.db.exists("User", email)]
    if existing:
        frappe.throw(f"E2E users already exist for run_id {run_id}: {', '.join(existing)}")

    for number, email in enumerate(emails, 1):
        user = frappe.get_doc(
            {
                "doctype": "User",
                "email": email,
                "first_name": f"Drive Writer E2E {number}",
                "enabled": 1,
                "send_welcome_email": 0,
                "new_password": password,
            }
        )
        user.flags.skip_drive_setup = True
        user.insert(ignore_permissions=True)
        user.reload()
        user.add_roles("Suite User")
        _create_user_drive_data(email)

    return {"run_id": run_id, "users": [_user_result(email, password) for email in emails]}


@whitelist_for_tests(methods=["POST"])
def create_user_group(run_id: str, name: str, members: str) -> dict:
    """Group named for this run, so cleanup_users can find it again."""
    group = f"{_validate_run_id(run_id)}-{name}"
    emails = [e for e in (members or "").split(",") if e]
    if frappe.db.exists("User Group", group):
        frappe.delete_doc("User Group", group, ignore_permissions=True, force=True)

    doc = frappe.get_doc({"doctype": "User Group", "__newname": group})
    for email in emails:
        doc.append("user_group_members", {"user": email})
    doc.insert(ignore_permissions=True)

    from suite.drive.utils import clear_user_group_cache

    clear_user_group_cache()
    frappe.db.commit()
    return {"name": group, "member_count": len(emails)}


@whitelist_for_tests(methods=["POST"])
def cleanup_users(run_id: str) -> dict:
    """Delete only users and personal Drive/Writer data named by this run ID."""
    emails = _existing_user_emails(run_id)
    deleted = []

    for group in frappe.get_all(
        "User Group", filters={"name": ["like", f"{_validate_run_id(run_id)}-%"]}, pluck="name"
    ):
        frappe.db.delete("Drive Permission", {"user": f"$GROUP:{group}"})
        frappe.delete_doc("User Group", group, ignore_permissions=True, force=True)

    for email in emails:
        if not frappe.db.exists("User", email):
            continue

        _delete_user_drive_data(email)
        frappe.delete_doc("User", email, ignore_permissions=True)
        deleted.append(email)

    return {"run_id": run_id, "deleted_users": deleted}
