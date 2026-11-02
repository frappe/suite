"""Per-sheet monotonic op-log sequence allocator.

Sequence numbers are the canonical ordering primitive — wall-clock timestamps
break under clock skew, concurrent writes, and DST. One `Sheet Seq` row per
sheet holds `next_seq`; `allocate()` takes a SELECT … FOR UPDATE row lock so
concurrent writers serialise rather than collide.

Allocation is idempotent at the row-creation step: if two requests hit a
brand-new sheet simultaneously, only one INSERT succeeds; the other reads the
row and increments normally.
"""

import frappe


def allocate(sheet: str, count: int = 1) -> int:
    """Allocate `count` consecutive op-log seq numbers for the sheet.

    Returns the *first* allocated seq; callers using a batch take
    [seq, seq+1, …, seq+count-1].
    """
    if count < 1:
        frappe.throw("allocate(count) requires count >= 1")

    _ensure_row(sheet)
    row = frappe.db.sql(
        "SELECT next_seq FROM `tabSheet Seq` WHERE name = %s FOR UPDATE",
        (sheet,),
        as_dict=True,
    )
    first = int(row[0]["next_seq"])
    frappe.db.sql(
        "UPDATE `tabSheet Seq` SET next_seq = next_seq + %s WHERE name = %s",
        (count, sheet),
    )
    return first


def peek(sheet: str) -> int:
    """Return the next seq that would be allocated, without consuming it."""
    row = frappe.db.get_value("Sheet Seq", sheet, "next_seq")
    return int(row) if row else 1


def _ensure_row(sheet: str) -> None:
    """Create the Sheet Seq row on first use. Safe under concurrent inserts."""
    if frappe.db.exists("Sheet Seq", sheet):
        return
    try:
        frappe.get_doc({"doctype": "Sheet Seq", "sheet": sheet, "next_seq": 1}).insert(
            ignore_permissions=True
        )
    except frappe.DuplicateEntryError:
        # Lost the race — that's fine, row exists now.
        pass
