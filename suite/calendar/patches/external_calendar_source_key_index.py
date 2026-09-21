import frappe


def execute():
    """One calendar per thing a source has — the check in validate is a message, not a guarantee.

    Two runs in flight at once would both look, both find nothing, and both insert; the table is
    what actually stops the second one.
    """

    if not frappe.db.table_exists("External Calendar"):
        return
    # idempotent: checks information_schema before issuing the DDL
    frappe.db.add_unique("External Calendar", ["source", "source_key"], constraint_name="unique_source_key")
