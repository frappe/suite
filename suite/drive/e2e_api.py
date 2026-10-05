# Copyright (c) 2022, Frappe Technologies Pvt. Ltd. and Contributors
# MIT License. See license.txt

"""Users and groups for the Playwright suites, named by a run id so one run
can clean up after itself and never touch another's data.

A user's Drive data is their Personal root pair and everything in it. Inserting
the `User` provisions the root, and removing the user archives and purges it
through the same workflows an admin uses, so a content document created in a
test goes with its node.
"""

import re

import frappe
import pycrdt
from frappe.tests.utils import whitelist_for_tests

from suite.drive._core.roots import archive_personal_root, personal_root_for, purge_root
from suite.drive.framework import principals_for
from suite.suite_core import collab
from suite.suite_core.collab import compaction
from suite.suite_core.collab.tables import table
from suite.writer import collab as writer_collab

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
    result = {"email": email, "user": email, "personal_root": personal_root_for(email)}
    if password is not None:
        result["password"] = password
    return result


def _purge_user_drive_data(email: str) -> None:
    """Archive and purge the user's Personal root, with every node in it."""
    root = personal_root_for(email)
    if not root:
        return
    archive_personal_root(email)
    purge_root(root, principals_for("Administrator"))


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
        user.insert(ignore_permissions=True)
        user.reload()
        user.add_roles("Suite User")

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
    frappe.db.commit()
    return {"name": group, "member_count": len(emails)}


@whitelist_for_tests(methods=["POST"])
def cleanup_users(run_id: str) -> dict:
    """Delete only the users, groups and Drive data named by this run id."""
    emails = _existing_user_emails(run_id)
    deleted = []

    for group in frappe.get_all(
        "User Group", filters={"name": ["like", f"{_validate_run_id(run_id)}-%"]}, pluck="name"
    ):
        frappe.db.delete("Drive Grant", {"principal": f"$GROUP:{group}"})
        frappe.delete_doc("User Group", group, ignore_permissions=True, force=True)

    for email in emails:
        if not frappe.db.exists("User", email):
            continue
        _purge_user_drive_data(email)
        frappe.delete_doc("User", email, ignore_permissions=True)
        deleted.append(email)

    return {"run_id": run_id, "deleted_users": deleted}


def collab_doc(node: str) -> dict:
    doc = collab.find(writer_collab.ADAPTER, node)
    if doc is None:
        frappe.throw(f"{node} has no collab log")
    return doc


@whitelist_for_tests(methods=["POST"])
def enable_collab(node: str) -> dict:
    """Turn collaboration on for the site and make `node`'s Writer document collaborative."""
    frappe.db.set_single_value("Suite Collab Settings", "mode", "on")
    frappe.db.set_value("Writer Document", {"node": node}, "collab", 1)
    if collab.find(writer_collab.ADAPTER, node) is None:
        collab.create(writer_collab.ADAPTER, node)
    frappe.db.commit()
    return state(node)


@whitelist_for_tests(methods=["POST"])
def compact_now(node: str) -> dict:
    """Compact `node`'s collab log in this request, as the queued job would."""
    writer_collab.compact(collab_doc(node)["id"])
    return state(node)


@whitelist_for_tests(methods=["GET", "POST"])
def state(node: str) -> dict:
    """Where `node`'s collab log stands: its checkpoint, its head and the rows between."""
    row = frappe.db.sql(
        f"""SELECT `checkpoint_rev`, `head_rev`, `tail_rows`
        FROM `{table(writer_collab.ADAPTER, "doc")}` WHERE `id` = %s""",
        collab_doc(node)["id"],
        as_dict=True,
    )[0]
    return {key: int(value) for key, value in row.items()}


@whitelist_for_tests(methods=["GET", "POST"])
def server_text(node: str) -> list[str]:
    """The text of each top-level block of `node`, read from the checkpoint and the rows after it."""
    stored = collab.read(writer_collab.ADAPTER, collab_doc(node)["id"])
    parts = ([stored["checkpoint"]] if stored["checkpoint"] else []) + [row for _rev, row in stored["rows"]]
    fragment = compaction.load(parts).get("default", type=pycrdt.XmlFragment)
    return [block_text(block) for block in fragment.children]


def block_text(node) -> str:
    if isinstance(node, pycrdt.XmlText):
        return "".join(chunk for chunk, _attributes in node.diff())
    return "".join(block_text(child) for child in node.children)
