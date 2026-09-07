"""Snapshot creation, policy, and pruning.

Snapshots are checkpoints over the op log — the unit of user-visible restore.
Creation runs inline from `save_sheet` (so version history is always present,
no worker dependency); pruning runs in a nightly scheduler.

Policy (`should_snapshot`) — Google-Sheets-style: snapshot densely on the
first save and on any save after a short cooldown, so the history panel
always reflects recent work; cluster very rapid saves into one snapshot.

  * always snapshot on explicit user save (`kind=named`) or semantic
    milestone (`kind=milestone`: import, restore, sheet add/delete)
  * always snapshot the first time a sheet is saved (last is None and
    head_seq > 0) — guarantees the panel is never empty
  * snapshot when >= AUTO_SNAPSHOT_OPS ops since the last one
  * snapshot when >= AUTO_SNAPSHOT_SECS elapsed AND at least one op
    happened
  * otherwise, skip (storage stays bounded under spammy autosaves)
"""

from __future__ import annotations

import frappe
from frappe.utils import now_datetime

from suite.sheets.doctype.sheet.storage import (
    decode_sheets_data,
    effective_size,
)

# Policy knobs — overridable via site_config:
#   versioning_auto_snapshot_ops, versioning_auto_snapshot_secs
#
# Tuned for Google-Sheets parity: a snapshot every 25 edits or every 30
# seconds of activity. The nightly tiered-retention pruner thins these
# down over time, so storage stays bounded even for very active suite.sheets.
AUTO_SNAPSHOT_OPS = 25
AUTO_SNAPSHOT_SECS = 30

# Valid snapshot kinds — kept in sync with sheet_snapshot.json's Select options.
KIND_AUTO = "auto"
KIND_MILESTONE = "milestone"
KIND_NAMED = "named"
_VALID_KINDS = {KIND_AUTO, KIND_MILESTONE, KIND_NAMED}


def maybe_snapshot(sheet: str, expected_head_seq: int | None = None) -> str | None:
    """Worker entry point. Creates an auto snapshot iff policy says so.

    Called from `frappe.enqueue` after `save_sheet`. `expected_head_seq` is
    the seq the request thought was the head — used only for telemetry, not
    correctness (we always snapshot the *current* head).
    """
    _refuse_linked_sheet(sheet)
    doc = frappe.db.get_value("Sheet", sheet, ["head_seq", "head_snapshot"], as_dict=True)
    if not doc:
        return None
    last = _last_snapshot(sheet)
    if not _should_snapshot(int(doc.head_seq or 0), last):
        return None
    return create(sheet, kind=KIND_AUTO)


def create(
    sheet: str,
    *,
    kind: str = KIND_AUTO,
    label: str | None = None,
    actor: str | None = None,
) -> str:
    """Create a snapshot at the sheet's current head. Returns the snapshot name."""
    _refuse_linked_sheet(sheet)
    if kind not in _VALID_KINDS:
        frappe.throw(f"Unknown snapshot kind: {kind}")

    head = frappe.db.get_value("Sheet", sheet, ["sheets_data", "head_seq"], as_dict=True)
    if not head:
        frappe.throw(f"Sheet {sheet} not found")

    last = _last_snapshot(sheet)
    head_seq = int(head.head_seq or 0)
    op_count = max(0, head_seq - int(last["seq"] if last else 0))

    snap = frappe.get_doc(
        {
            "doctype": "Sheet Snapshot",
            "sheet": sheet,
            "seq": head_seq,
            "kind": kind,
            "label": (label or "").strip() or None,
            "pinned": 1 if kind == KIND_NAMED else 0,
            "op_count": op_count,
            "byte_size": len((head.sheets_data or "").encode("utf-8")),
            "actor": actor or frappe.session.user,
            "sheets_data": head.sheets_data,
        }
    )
    snap.insert(ignore_permissions=True)

    # Update head pointer without bumping `modified` — head_snapshot is a
    # derived cache, not user-visible mutation.
    frappe.db.set_value("Sheet", sheet, "head_snapshot", snap.name, update_modified=False)
    frappe.publish_realtime(
        "sheet_snapshot_created",
        {"sheet": sheet, "snapshot": snap.name, "kind": kind, "seq": head_seq},
        after_commit=True,
    )
    return snap.name


def _should_snapshot(head_seq: int, last: dict | None) -> bool:
    if head_seq <= 0:
        return False
    ops_thresh = _conf_int("versioning_auto_snapshot_ops", AUTO_SNAPSHOT_OPS)
    secs_thresh = _conf_int("versioning_auto_snapshot_secs", AUTO_SNAPSHOT_SECS)
    if last is None:
        return True
    ops_since = head_seq - int(last["seq"] or 0)
    if ops_since <= 0:
        return False
    if ops_since >= ops_thresh:
        return True
    last_at = frappe.utils.get_datetime(last["creation"])
    elapsed = (now_datetime() - last_at).total_seconds()
    return elapsed >= secs_thresh


def _last_snapshot(sheet: str) -> dict | None:
    rows = frappe.get_all(
        "Sheet Snapshot",
        filters={"sheet": sheet},
        fields=["name", "seq", "creation"],
        order_by="seq desc",
        limit=1,
    )
    return rows[0] if rows else None


def _conf_int(key: str, default: int) -> int:
    val = frappe.conf.get(key)
    try:
        return int(val) if val is not None else default
    except (TypeError, ValueError):
        return default


def stored_size(snap_name: str) -> int:
    """Effective uncompressed byte size of a snapshot's payload."""
    stored = frappe.db.get_value("Sheet Snapshot", snap_name, "sheets_data")
    return effective_size(stored)


def decode_payload(snap_name: str) -> str:
    """Return the snapshot's payload as plain JSON (decompressed)."""
    stored = frappe.db.get_value("Sheet Snapshot", snap_name, "sheets_data")
    return decode_sheets_data(stored)


def _refuse_linked_sheet(sheet: str) -> None:
    # Local import avoids making the Writer/Sheets content declaration depend
    # on this legacy history module at import time.
    from suite.sheets.drive import refuse_drive_native

    refuse_drive_native(sheet, "Drive version history")
