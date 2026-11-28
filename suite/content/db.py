"""Writes that commit at once, a conditional claim and an admin alert, and a system variable read."""

from datetime import timedelta

import frappe
from frappe.query_builder import CustomFunction, Interval, Table
from frappe.query_builder.utils import ImportMapper, db_type_is
from frappe.utils import now_datetime
from pymysql.constants import ER
from pypika.dialects import MySQLQueryBuilder
from pypika.queries import QueryBuilder

from suite.utils.db import affected_rows

Unhex = CustomFunction("UNHEX", ["hex"])
_Greatest = CustomFunction("GREATEST", ["first", "second"])
_SQLiteGreatest = CustomFunction("MAX", ["first", "second"])
_PreciseNow = CustomFunction("NOW", ["precision"])
greatest = ImportMapper(
    {db_type_is.MARIADB: _Greatest, db_type_is.POSTGRES: _Greatest, db_type_is.SQLITE: _SQLiteGreatest}
)


def precise_now():
    """Use a site-local timestamp with microsecond precision on both engines."""
    return now_datetime() if frappe.db.db_type == "sqlite" else _PreciseNow(6)


def timestamp_before(now, **offset: int):
    """Subtract a time offset from a timestamp value or query expression."""
    if frappe.db.db_type == "sqlite":
        return now - timedelta(**offset)
    return now - Interval(**offset)


def insert_into(table_name: str, row: dict) -> MySQLQueryBuilder:
    """Build an INSERT of `row` into `table_name`, its keys the columns, for the caller to run."""
    values = row.values()
    return frappe.qb.into(Table(table_name)).columns(*row).insert(*values)


def changed_rows(query: QueryBuilder) -> int:
    """Run an UPDATE or DELETE and answer how many rows it changed."""
    query.run()  # type: ignore[operator]  # frappe adds run() at runtime
    return affected_rows()


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
    if frappe.db.db_type == "sqlite":
        return frappe.db.sql("SELECT sqlite_version()")[0][0] if name == "version" else None

    try:
        # Raw SQL: qb can't read a system variable
        [[value]] = frappe.db.sql(f"SELECT @@{name}")
    except frappe.db.OperationalError as error:
        if error.args[0] != ER.UNKNOWN_SYSTEM_VARIABLE:
            raise

        return None

    return value
