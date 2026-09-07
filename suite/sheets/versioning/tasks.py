"""Scheduled maintenance.

Two jobs run nightly:

  * ``rollup_snapshots`` — applies tiered retention to auto snapshots.
    Pinned/named/milestone snapshots are *never* deleted.

  * ``truncate_op_log`` — drops ops older than the oldest retained
    snapshot's seq, preserving the invariant that any retained snapshot
    can still be expanded into an op-level activity view.

Both are idempotent and safe to re-run. They batch by sheet so a stalled
worker doesn't block forward progress on other suite.sheets.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import frappe
from frappe.utils import now_datetime

# Density tiers (configurable via site_config).
# Tier (max age in hours, keep one snapshot per N hours).
DEFAULT_TIERS = (
    (24, 0),  # 0-24h: keep all
    (24 * 7, 1),  # 1-7d: hourly
    (24 * 30, 24),  # 7-30d: daily
    (24 * 90, 168),  # 30-90d: weekly
    # Beyond 90d: only pinned/milestone/named survive (no auto kept).
)
HARD_CUTOFF_HOURS = 24 * 90  # auto snapshots beyond this are deleted entirely

OP_LOG_RETENTION_HOURS = 24 * 30


def rollup_snapshots() -> dict:
    """Apply tiered retention. Returns counters for telemetry."""
    tiers = _tiers()
    hard_cutoff_h = int(frappe.conf.get("versioning_hard_cutoff_hours") or HARD_CUTOFF_HOURS)
    now = now_datetime()
    deleted = 0
    scanned = 0

    for sheet_name in _iter_sheets():
        snaps = frappe.get_all(
            "Sheet Snapshot",
            filters={"sheet": sheet_name, "kind": "auto", "pinned": 0},
            fields=["name", "seq", "creation"],
            order_by="seq desc",
        )
        scanned += len(snaps)
        to_delete = _pick_deletions(snaps, now, tiers, hard_cutoff_h)
        for snap_name in to_delete:
            frappe.delete_doc("Sheet Snapshot", snap_name, ignore_permissions=True, force=True)
            deleted += 1
        frappe.db.commit()

    return {"scanned": scanned, "deleted": deleted}


def truncate_op_log() -> dict:
    """Drop op-log rows older than the oldest retained snapshot for each sheet.

    Caps absolute retention via OP_LOG_RETENTION_HOURS as a backstop.
    """
    max_age = int(frappe.conf.get("versioning_op_log_retention_hours") or OP_LOG_RETENTION_HOURS)
    hard_cutoff = now_datetime() - timedelta(hours=max_age)
    deleted = 0

    for sheet_name in _iter_sheets():
        oldest_snap = frappe.get_all(
            "Sheet Snapshot",
            filters={"sheet": sheet_name},
            fields=["seq"],
            order_by="seq asc",
            limit=1,
        )
        min_keep_seq = int(oldest_snap[0]["seq"]) if oldest_snap else 0
        # Delete ops strictly older than the oldest retained snapshot AND
        # older than the absolute time backstop.
        frappe.db.sql(
            "DELETE FROM `tabSheet Op Log` "
            "WHERE sheet = %(sheet)s "
            "  AND seq < %(min_seq)s "
            "  AND creation < %(cutoff)s",
            {"sheet": sheet_name, "min_seq": min_keep_seq, "cutoff": hard_cutoff},
        )
        deleted += frappe.db.sql("SELECT ROW_COUNT()")[0][0]
        frappe.db.commit()

    return {"deleted": deleted}


def _tiers() -> tuple:
    override = frappe.conf.get("versioning_tiers")
    if override and isinstance(override, list):
        return tuple(tuple(t) for t in override)
    return DEFAULT_TIERS


def _iter_sheets():
    """Iterate legacy sheet names in modest pages.

    A linked sheet's versions and retention belong to Drive. Filtering at the
    source keeps both snapshot and op-log pruning from mutating preserved
    legacy rows beneath a migrated document.
    """
    last_name = ""
    page = 200
    while True:
        rows = frappe.db.sql(
            "SELECT name FROM `tabSheet` WHERE name > %s AND node IS NULL ORDER BY name LIMIT %s",
            (last_name, page),
        )
        if not rows:
            return
        for (name,) in rows:
            yield name
            last_name = name
        if len(rows) < page:
            return


def _pick_deletions(snaps: list[dict], now: datetime, tiers: tuple, hard_cutoff_h: int) -> list[str]:
    """Walk snapshots newest→oldest, deciding which to keep per tier.

    Within each tier interval we keep at most one snapshot per density bucket
    (`tier_hours`). The kept snapshot is the *oldest* one we've seen falling
    into a given bucket — that way the kept rows are evenly spaced.
    """
    to_delete: list[str] = []
    kept_bucket_keys: dict[tuple[int, int], bool] = {}
    for s in snaps:
        creation = frappe.utils.get_datetime(s["creation"])
        age_h = (now - creation).total_seconds() / 3600.0
        if age_h > hard_cutoff_h:
            to_delete.append(s["name"])
            continue
        tier_idx, tier_hours = _tier_for(age_h, tiers)
        if tier_hours == 0:
            continue  # keep all in this tier
        # Bucket key = (tier index, floor(age / tier_hours))
        bucket = (tier_idx, int(age_h // tier_hours))
        if bucket in kept_bucket_keys:
            to_delete.append(s["name"])
        else:
            kept_bucket_keys[bucket] = True
    return to_delete


def _tier_for(age_hours: float, tiers: tuple) -> tuple[int, int]:
    for idx, (max_age, density) in enumerate(tiers):
        if age_hours <= max_age:
            return idx, density
    return len(tiers), tiers[-1][1] if tiers else 0
