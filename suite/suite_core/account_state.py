"""Persistent access prerequisites. Never stores a temporary password or invitation token."""

import frappe
from frappe import _
from frappe.utils import get_datetime, now_datetime


def read(user: str) -> dict:
    return (
        frappe.db.get_value(
            "Suite Account State",
            user,
            ["account", "operation", "status", "must_change_password", "temporary_expires_at"],
            as_dict=True,
        )
        or {}
    )


def write(user: str, **values) -> None:
    frappe.db.get_value("User", user, "name", for_update=True)
    doc = (
        frappe.get_doc("Suite Account State", user)
        if frappe.db.exists("Suite Account State", user)
        else frappe.get_doc({"doctype": "Suite Account State", "user": user})
    )
    doc.update(values)
    doc.save(ignore_permissions=True)


def require_temporary_valid(user: str) -> None:
    state = read(user)
    if state.get("must_change_password") and (
        not state.get("temporary_expires_at") or get_datetime(state["temporary_expires_at"]) <= now_datetime()
    ):
        frappe.throw(
            _("Your temporary password has expired. Ask an Admin for a replacement."),
            frappe.AuthenticationError,
        )
