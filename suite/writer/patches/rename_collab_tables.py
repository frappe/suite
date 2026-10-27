"""Rename Writer's `__writer_collab_*` tables to `__writer_content_*`, keeping every row.

A migrate can create the new tables empty before this runs, so an empty table on
either side is dropped. Rows on both sides stop the patch rather than lose either.
"""

import frappe

from suite.content.tables import KINDS, table


def has_rows(name: str) -> bool:
    """Answer whether the table `name` holds any row."""
    first_row = frappe.db.sql(f"SELECT 1 FROM `{name}` LIMIT 1")
    return bool(first_row)


def execute() -> None:
    """Rename each `__writer_collab_*` table to its `__writer_content_*` name."""
    renames: list[str] = []
    for kind in KINDS:
        old_table = f"__writer_collab_{kind}"
        new_table = table("writer", kind)
        rename_clause = f"`{old_table}` TO `{new_table}`"
        tables = frappe.db.get_tables(cached=False)
        if old_table not in tables:
            continue

        if new_table not in tables:
            renames.append(rename_clause)
            continue

        has_new_rows = has_rows(new_table)
        if has_new_rows and has_rows(old_table):
            raise frappe.ValidationError(f"Both {old_table} and {new_table} have rows; merge them by hand")

        if has_new_rows:
            frappe.db.sql_ddl(f"DROP TABLE `{old_table}`")
            continue

        frappe.db.sql_ddl(f"DROP TABLE `{new_table}`")
        renames.append(rename_clause)

    if renames:
        rename_clauses = ", ".join(renames)
        frappe.db.sql_ddl(f"RENAME TABLE {rename_clauses}")
