"""Writes that commit at once: a conditional claim and an admin alert."""

import frappe


def claim(sql: str, params: tuple) -> bool:
    """Run a conditional UPDATE and commit; answers whether it changed a row."""
    frappe.db.sql(sql, params)
    changed_rows = frappe.db.sql("SELECT ROW_COUNT()")[0][0]
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    return bool(changed_rows)


def alert(title: str, message: str) -> None:
    """Log an error for admins on the collab settings and commit it."""
    frappe.log_error(title=title, message=message, reference_doctype="Suite Collab Settings")
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
