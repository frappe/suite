# Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

import frappe


def ensure_user(email: str, enabled: bool = True) -> str:
    """A user of this site by this address, made if there isn't one and switched on or off as
    asked. Returns the name, which is the address."""

    if not frappe.db.exists("User", email):
        frappe.get_doc(
            {
                "doctype": "User",
                "email": email,
                "first_name": email.split("@")[0],
                "send_welcome_email": 0,
                "enabled": int(enabled),
            }
        ).insert(ignore_permissions=True)
    elif bool(frappe.db.get_value("User", email, "enabled")) != enabled:
        frappe.db.set_value("User", email, "enabled", int(enabled))
    return email
