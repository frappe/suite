"""Rename Writer's `__writer_collab_*` tables to `__writer_content_*`, keeping every row.

A migrate can create the new tables empty before this runs, so an empty table on
either side is dropped. Rows on both sides stop the patch rather than lose either.
"""

import frappe

from suite.suite_core.collab.tables import KINDS, table


def execute() -> None:
    renames = []
    for kind in KINDS:
        old, new = f"__writer_collab_{kind}", table("writer", kind)
        if not exists(old):
            continue
        if exists(new):
            if rows(new) and rows(old):
                raise frappe.ValidationError(f"Both {old} and {new} have rows; merge them by hand")
            if not rows(new):
                frappe.db.sql_ddl(f"DROP TABLE `{new}`")
            else:
                frappe.db.sql_ddl(f"DROP TABLE `{old}`")
                continue
        renames.append(f"`{old}` TO `{new}`")
    if renames:
        frappe.db.sql_ddl(f"RENAME TABLE {', '.join(renames)}")


def exists(name: str) -> bool:
    return bool(
        frappe.db.sql(
            "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = %s",
            name,
        )
    )


def rows(name: str) -> bool:
    return bool(frappe.db.sql(f"SELECT 1 FROM `{name}` LIMIT 1"))
