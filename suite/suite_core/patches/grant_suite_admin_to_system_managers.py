"""One-time migration of existing business administrators (admin spec §10.2)."""

import frappe


def execute() -> None:
    from suite.suite_core.storage import state

    state()
    for user in frappe.get_all(
        "Has Role", filters={"role": "System Manager", "parenttype": "User"}, pluck="parent"
    ):
        if user in ("Administrator", "Guest"):
            continue
        doc = frappe.get_doc("User", user)
        if not any(role.role == "Suite Admin" for role in doc.roles):
            doc.add_roles("Suite Admin")
