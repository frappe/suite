"""Op-log reads.

`for_cell(sheet, cell_id)` answers every change to one cell, newest first, for
the cell-history popover.

The op log is canonical: deleting ops loses information that versions cannot
recover. The truncation job in `tasks.py` is the only writer that ever removes
rows.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import frappe
from frappe.utils import get_system_timezone

# Cell ids are spreadsheet-style refs (``A1`` … ``AB123``). Bounding the format
# stops a caller from passing wildcards / quote-escapes into the SQL `LIKE`
# pattern below — values are parameterised so injection isn't possible, but an
# unconstrained pattern would still let a probe like ``%`` match every row
# and scan the table.
_CELL_ID_RE = re.compile(r"^[A-Z]{1,3}\d{1,7}$")


def for_cell(sheet: str, cell_id: str, sub_sheet: str | None = None, limit: int = 50) -> list[dict]:
    """Return ops touching `cell_id`, newest first.

    Filters by JSON-contains on `cell_refs` so we don't paginate through
    every op for the sheet — fast even on busy suite.sheets.
    """
    frappe.has_permission("Sheet", doc=sheet, throw=True)
    if not _CELL_ID_RE.match(cell_id or ""):
        frappe.throw("Invalid cell id")
    conditions = ["sheet = %(sheet)s"]
    params: dict = {"sheet": sheet, "limit": limit}
    if sub_sheet:
        conditions.append("sub_sheet = %(sub_sheet)s")
        params["sub_sheet"] = sub_sheet
    # Naive LIKE catches the cell id inside the JSON array. False positives
    # (e.g. A1 vs A10) are filtered in Python below.
    conditions.append("cell_refs LIKE %(cell_pat)s")
    params["cell_pat"] = f'%"{cell_id}"%'

    sql = (
        "SELECT name, seq, sub_sheet, op_type, cell_refs, before_json, after_json, "
        "       summary, actor, creation "
        f"FROM `tabSheet Op Log` WHERE {' AND '.join(conditions)} "
        "ORDER BY seq DESC LIMIT %(limit)s"
    )
    rows = frappe.db.sql(sql, params, as_dict=True)

    out: list[dict] = []
    for r in rows:
        refs = _safe_json(r.get("cell_refs"))
        if isinstance(refs, list) and cell_id not in refs:
            continue
        out.append(_serialise_cell_op(r, cell_id))
    return out


def _serialise_cell_op(row: dict, cell_id: str) -> dict:
    before = _safe_json(row.get("before_json")) or {}
    after = _safe_json(row.get("after_json")) or {}
    return {
        "id": row["name"],
        "seq": int(row.get("seq") or 0),
        "sub_sheet": row.get("sub_sheet"),
        "op_type": row.get("op_type"),
        "summary": row.get("summary"),
        "actor": row.get("actor"),
        "creation": _wire_time(row.get("creation")),
        "before": before.get(cell_id) if isinstance(before, dict) else None,
        "after": after.get(cell_id) if isinstance(after, dict) else None,
    }


def _wire_time(value: datetime | None) -> str | None:
    """A stored stamp as RFC 3339 in UTC (`2026-10-03T06:30:00Z`).

    The column is naive in the site's zone. Published that way, a browser in
    another zone reads it as its own local time and shows the edit hours off.
    This is the same rule Drive's wire follows (`suite/drive/_core/times.py`),
    so the popover parses both with one `new Date()`.
    """
    if value is None:
        return None
    return (
        value.replace(tzinfo=ZoneInfo(get_system_timezone())).astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    )


def _safe_json(value):
    if not value:
        return None
    try:
        return json.loads(value)
    except TypeError, ValueError:
        return None
