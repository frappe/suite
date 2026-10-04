"""Whitelisted versioning endpoint.

A sheet's versions are `Drive Node Version` rows (§9.1), and the Drive client
lists, previews, names and restores them over HTTP. The one history question
Drive cannot answer is what edits one cell has seen, because only Sheets reads
its own `Sheet Op Log`:

  * ops_for_cell(sheet, cell_id, sub_sheet, limit)  — cell history popover
"""

from __future__ import annotations

import frappe

from . import ops as ops_mod

# Hard upper bound on the user-supplied `limit`, so one caller cannot make one
# request walk an arbitrary slice of the op log.
_MAX_OPS_LIMIT = 1000


# Guest is admitted for a share link's holder; `for_cell` checks read on the
# sheet, which answers for the link the request carries.
@frappe.whitelist(allow_guest=True)
def ops_for_cell(sheet: str, cell_id: str, sub_sheet: str = "", limit: int = 50) -> list[dict]:
    limit = min(max(int(limit), 1), _MAX_OPS_LIMIT)
    return ops_mod.for_cell(sheet, cell_id, sub_sheet=sub_sheet or None, limit=limit)
