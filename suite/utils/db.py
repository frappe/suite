"""Database operations shared by Suite apps."""

import frappe


def affected_rows() -> int:
    """Return the affected row count immediately after a write on this connection."""
    [[count]] = frappe.db.multisql({"mariadb": "SELECT ROW_COUNT()", "sqlite": "SELECT changes()"})
    return int(count)
