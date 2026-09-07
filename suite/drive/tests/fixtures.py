"""Shared fixture helpers for the Drive test modules."""

from contextlib import contextmanager

import frappe
from frappe.storage.tests import reset_file_controller

from suite.drive._core.roots import personal_root_for


def drop_personal_root(user: str) -> None:
    """Remove the Personal root that inserting a `User` provisions.

    `ensure_user` inserts a real `User`, so `after_user_insert` gives that user
    an Active Personal root. A fixture that then creates its own root for the
    same user hits `create_root`, which correctly refuses a second active
    Personal root. The hook only runs when the user is new, so leaving the
    provisioned pair in place makes the module pass or error on leftover site
    state. Drop the pair instead and start from no root.
    """
    root = personal_root_for(user)
    if not root:
        return
    nodes = sorted({root, *frappe.get_all("Drive Node", filters={"root": root}, pluck="name")})
    # `Drive DAV Lock.entity` and `Drive DAV Property.entity` are Links to
    # `Drive Node`, and a version row is written on every replacing PUT. A
    # committed fixture that dropped only the grants and the activity left all
    # three dangling on the site for good.
    for table in ("Drive DAV Lock", "Drive DAV Property"):
        frappe.db.delete(table, {"entity": ["in", nodes]})
    drop_record_rows(nodes)
    drop_node_rows(nodes)
    frappe.db.delete("Drive Root", {"name": root})


def drop_node_rows(nodes) -> None:
    """Delete a set of nodes and everything that hangs off them.

    `Drive Notification` has no `node` column. It points at the `Drive
    Activity` row, so the activity ids must be read before that table goes.
    """
    nodes = [node for node in nodes if node]
    if not nodes:
        return
    activity = frappe.get_all("Drive Activity", filters={"node": ["in", nodes]}, pluck="name")
    if activity:
        frappe.db.delete("Drive Notification", {"activity": ["in", activity]})
    for table in ("Drive Activity", "Drive Grant", "Drive Node Version", "Drive Node Preview"):
        frappe.db.delete(table, {"node": ["in", nodes]})
    frappe.db.delete("Drive Node", {"name": ["in", nodes]})


def drop_record_rows(nodes) -> None:
    """Delete the personal and comment rows `drop_node_rows` leaves behind."""
    nodes = [node for node in nodes if node]
    if not nodes:
        return
    for table in ("Drive Recent", "Drive Favourite", "Drive Comment", "Drive Comment Thread"):
        frappe.db.delete(table, {"node": ["in", nodes]})


def nodes_in_root(root: str) -> set[str]:
    """Every node id charged to one root, for a before/after fixture diff.

    A legacy forwarder can create a node anywhere in the caller's tree - an
    upload, a directory upload's folders, a move destination - so a fixture
    cannot list what it will have to clean. Diff the root instead.
    """
    return set(frappe.get_all("Drive Node", filters={"root": root}, pluck="name"))


@contextmanager
def storage_v2():
    """Turn the framework's blob upload sessions on for one block.

    `create_blob_upload` refuses with "File Storage v2 is not enabled for this
    site" until `storage_v2` is in `site_config`. Every Drive write path that
    opens an upload session goes through it, including the §11.7 `upload_file`
    forwarder, so a test that exercises one has to say so rather than depend on
    the bench's config.
    """
    previous = frappe.conf.get("storage_v2")
    frappe.conf["storage_v2"] = 1
    reset_file_controller()
    try:
        yield
    finally:
        if previous is None:
            frappe.conf.pop("storage_v2", None)
        else:
            frappe.conf["storage_v2"] = previous
        reset_file_controller()
