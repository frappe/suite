import frappe


def execute():
    if not frappe.db.table_exists("Meet Recording"):
        return
    frappe.db.set_value(
        "Meet Recording",
        {"status": "Pending"},
        "status",
        "Starting",
        update_modified=False,
    )
