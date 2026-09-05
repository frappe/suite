"""Frappe scheduler adapters for Drive-owned lifecycle work."""

from datetime import timedelta

import frappe
from frappe.utils import now_datetime

from suite.drive._core.nodes import purge_expired_trash_root
from suite.drive._core.previews import sweep_missing
from suite.drive._core.quota import recompute_usage
from suite.drive._core.versions import thin


def recompute_root_usage() -> dict:
    """Repair every Active and Archived root independently and log drift."""
    roots = frappe.get_all("Drive Root", filters={"state": ["in", ("Active", "Archived")]}, pluck="name")
    corrected = 0
    failed = 0
    for root in roots:
        try:
            result = recompute_usage(root)
            if result.drift:
                corrected += 1
                frappe.log_error(
                    title="Drive root usage drift corrected",
                    message=frappe.as_json(result),
                )
            frappe.db.commit()
        except Exception:
            frappe.db.rollback()
            failed += 1
            frappe.log_error("Drive: could not recompute root usage", frappe.get_traceback())
    return {"roots": len(roots), "corrected": corrected, "failed": failed}


def sweep_missing_previews() -> dict:
    """Queue the next bounded page of missing file previews."""
    return sweep_missing()


def purge_trashed_nodes() -> dict:
    """Purge each trash root older than 30 days in its own transaction."""
    cutoff = now_datetime() - timedelta(days=30)
    candidates = frappe.db.sql(
        """
        SELECT name
        FROM `tabDrive Node`
        WHERE state = 'Trashed' AND trash_root = name AND trashed_at < %(cutoff)s
        ORDER BY trashed_at, name
        """,
        {"cutoff": cutoff},
        pluck=True,
    )
    purged_roots = 0
    purged_nodes = 0
    failed = 0
    for node in candidates:
        try:
            count = purge_expired_trash_root(node, cutoff)
            frappe.db.commit()
        except Exception:
            frappe.db.rollback()
            failed += 1
            frappe.log_error("Drive: could not purge an expired trash root", frappe.get_traceback())
            continue
        if count:
            purged_roots += 1
            purged_nodes += count
    return {"roots": purged_roots, "nodes": purged_nodes, "failed": failed}


def thin_versions() -> dict:
    """Apply the configured Drive version ladder once per day."""
    return thin()
