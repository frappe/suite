"""Writes that commit at once, a conditional claim and an admin alert, and a system variable read."""

import frappe
from frappe.query_builder import CustomFunction, Table
from pymysql.constants import ER
from pypika.queries import QueryBuilder

Unhex = CustomFunction("UNHEX", ["hex"])
Greatest = CustomFunction("GREATEST", ["first", "second"])
PreciseNow = CustomFunction("NOW", ["precision"])


def insert_into(table_name: str, row: dict) -> QueryBuilder:
    """Build an INSERT of `row` into `table_name`, its keys the columns, for the caller to run."""
    values = row.values()
    return frappe.qb.into(Table(table_name)).columns(*row).insert(*values)


def changed_rows(query: QueryBuilder) -> int:
    """Run an UPDATE or DELETE and answer how many rows it changed."""
    query.run()
    # Raw SQL: qb has no ROW_COUNT()
    [[count]] = frappe.db.sql("SELECT ROW_COUNT()")
    return count


def claim(query: QueryBuilder) -> bool:
    """Run a conditional UPDATE and commit; answers whether it changed a row."""
    changed = changed_rows(query)
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    return bool(changed)


def alert(title: str, message: str) -> None:
    """Log an error for admins on the collab settings and commit it."""
    frappe.log_error(title=title, message=message, reference_doctype="Suite Collab Settings")
    frappe.db.commit()  # nosemgrep: frappe-manual-commit


def load_system_variable(name: str) -> str | int | None:
    """Load a MariaDB system variable, None when this server has no variable by that name."""
    try:
        # Raw SQL: qb can't read a system variable
        [[value]] = frappe.db.sql(f"SELECT @@{name}")
    except frappe.db.OperationalError as error:
        if error.args[0] != ER.UNKNOWN_SYSTEM_VARIABLE:
            raise

        return None

    return value
