"""Writes that commit at once, a conditional claim and an admin alert, and a system variable read."""

import frappe
from pymysql.constants import ER


def claim(sql: str, params: tuple) -> bool:
    """Run a conditional UPDATE and commit; answers whether it changed a row."""
    frappe.db.sql(sql, params)
    [[changed_rows]] = frappe.db.sql("SELECT ROW_COUNT()")
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    return bool(changed_rows)


def alert(title: str, message: str) -> None:
    """Log an error for admins on the collab settings and commit it."""
    frappe.log_error(title=title, message=message, reference_doctype="Suite Collab Settings")
    frappe.db.commit()  # nosemgrep: frappe-manual-commit


def load_system_variable(name: str) -> str | int | None:
    """Load a MariaDB system variable, None when this server has no variable by that name."""
    try:
        [[value]] = frappe.db.sql(f"SELECT @@{name}")
    except frappe.db.OperationalError as error:
        if error.args[0] != ER.UNKNOWN_SYSTEM_VARIABLE:
            raise

        return None

    return value
