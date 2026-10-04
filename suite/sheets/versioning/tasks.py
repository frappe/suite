"""Scheduled maintenance.

One job runs nightly: ``truncate_op_log`` drops `Sheet Op Log` rows older than
`OP_LOG_RETENTION_HOURS`. The op log is a satellite, not a version: §10.7 leaves
it app-owned and Drive has no job that prunes it, so this stays the only one
that can. A sheet's versions are `Drive Node Version` rows and Drive's own
retention keeps and prunes them.

Idempotent and safe to re-run. It commits per sheet so a stalled worker does not
block forward progress on the others.
"""

from __future__ import annotations

from datetime import timedelta

import frappe
from frappe.utils import now_datetime

OP_LOG_RETENTION_HOURS = 24 * 30


def truncate_op_log() -> dict:
    """Drop op-log rows older than the retention window, sheet by sheet."""
    max_age = int(frappe.conf.get("versioning_op_log_retention_hours") or OP_LOG_RETENTION_HOURS)
    cutoff = now_datetime() - timedelta(hours=max_age)
    deleted = 0

    for sheet_name in _iter_sheets():
        frappe.db.sql(
            "DELETE FROM `tabSheet Op Log` WHERE sheet = %(sheet)s AND creation < %(cutoff)s",
            {"sheet": sheet_name, "cutoff": cutoff},
        )
        deleted += frappe.db.sql("SELECT ROW_COUNT()")[0][0]
        frappe.db.commit()

    return {"deleted": deleted}


def _iter_sheets():
    """Iterate sheet names in modest pages — never load the full list at once."""
    last_name = ""
    page = 200
    while True:
        rows = frappe.db.sql(
            "SELECT name FROM `tabSheet` WHERE name > %s ORDER BY name LIMIT %s",
            (last_name, page),
        )
        if not rows:
            return
        for (name,) in rows:
            yield name
            last_name = name
        if len(rows) < page:
            return
