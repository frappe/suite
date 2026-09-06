"""Shared fixture helpers for the Drive test modules."""

import frappe

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
    nodes = tuple({root, *frappe.get_all("Drive Node", filters={"root": root}, pluck="name")})
    activity_ids = tuple(frappe.get_all("Drive Activity", filters={"node": ["in", nodes]}, pluck="name"))
    if activity_ids:
        frappe.db.delete("Drive Notification", {"activity": ["in", activity_ids]})
    frappe.db.delete("Drive Grant", {"node": ["in", nodes]})
    frappe.db.delete("Drive Activity", {"node": ["in", nodes]})
    frappe.db.delete("Drive Node", {"name": ["in", nodes]})
    frappe.db.delete("Drive Root", {"name": root})
