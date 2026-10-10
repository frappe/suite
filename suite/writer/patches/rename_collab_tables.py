"""Rename Writer's `__writer_collab_*` tables to `__writer_content_*`, keeping every row.

A migrate can create the new tables empty before this runs, so an empty table on
either side is dropped. Rows on both sides stop the patch rather than lose either.
"""

import frappe

from suite.suite_core.content.tables import KINDS, table


def execute() -> None:
    renames = []
    for kind in KINDS:
        old_table = f"__writer_collab_{kind}"
        new_table = table("writer", kind)
        if not table_exists(old_table):
            continue

        if table_exists(new_table):
            if has_rows(new_table) and has_rows(old_table):
                raise frappe.ValidationError(
                    f"Both {old_table} and {new_table} have rows; merge them by hand"
                )

            if not has_rows(new_table):
                frappe.db.sql_ddl(f"DROP TABLE `{new_table}`")
            else:
                frappe.db.sql_ddl(f"DROP TABLE `{old_table}`")
                continue
        renames.append(f"`{old_table}` TO `{new_table}`")

    if renames:
        rename_clauses = ", ".join(renames)
        frappe.db.sql_ddl(f"RENAME TABLE {rename_clauses}")


def table_exists(name: str) -> bool:
    matches = frappe.db.sql(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = %s",
        name,
    )
    return bool(matches)


def has_rows(name: str) -> bool:
    first_row = frappe.db.sql(f"SELECT 1 FROM `{name}` LIMIT 1")
    return bool(first_row)
