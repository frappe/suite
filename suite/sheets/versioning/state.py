"""Historical state reads + restore.

Snapshots are the unit of restore. `at(snapshot_id)` returns the snapshot's
decompressed JSON payload directly — no op replay needed.

Restore is *non-destructive*: it copies the snapshot's payload onto the
head, appends a `restore` op, takes a fresh `kind=milestone` snapshot,
and advances `head_seq`. The original snapshot stays put; the previous
head state is fully reachable by walking to the snapshot before this
restore op fired.
"""

from __future__ import annotations

import json

import frappe

from suite.sheets.doctype.sheet.storage import (
    decode_sheets_data,
    encode_sheets_data,
)

from . import seq as seq_mod
from . import snapshots as snap_mod


def at(snapshot_id: str) -> dict:
    """Return the workbook state captured by a snapshot.

    Shape: { "name": str, "sheet": str, "seq": int, "creation": ts,
             "label": str|None, "kind": str, "sheets_data": <plain JSON> }
    """
    snap = frappe.db.get_value(
        "Sheet Snapshot",
        snapshot_id,
        ["name", "sheet", "seq", "creation", "label", "kind", "sheets_data"],
        as_dict=True,
    )
    if not snap:
        frappe.throw(f"Snapshot {snapshot_id} not found")
    frappe.has_permission("Sheet", doc=snap.sheet, throw=True)
    return {
        "name": snap.name,
        "sheet": snap.sheet,
        "seq": int(snap.seq or 0),
        "creation": snap.creation,
        "label": snap.label,
        "kind": snap.kind,
        "sheets_data": decode_sheets_data(snap.sheets_data),
    }


def restore(snapshot_id: str) -> dict:
    """Restore the head to the given snapshot. Non-destructive.

    Returns: { "snapshot": <new milestone snapshot name>, "seq": int }
    """
    target = at(snapshot_id)  # validates read permission
    sheet_id = target["sheet"]
    _refuse_linked_sheet(sheet_id)
    # Authoritative write-perm gate lives here, not at the call-site — so any
    # future caller (a fixture, a script, another whitelisted endpoint) that
    # forgets to gate cannot accidentally mutate the head.
    frappe.has_permission("Sheet", doc=sheet_id, ptype="write", throw=True)

    # Append a restore op so the timeline tells the story.
    restore_seq = seq_mod.allocate(sheet_id)
    frappe.get_doc(
        {
            "doctype": "Sheet Op Log",
            "sheet": sheet_id,
            "seq": restore_seq,
            "op_type": "restore",
            "summary": _restore_summary(target),
            "actor": frappe.session.user,
        }
    ).insert(ignore_permissions=True)

    # Materialise the restored state onto the head.
    frappe.db.set_value(
        "Sheet",
        sheet_id,
        {
            "sheets_data": encode_sheets_data(target["sheets_data"]),
            "head_seq": restore_seq,
        },
        update_modified=True,
    )

    # Take a milestone snapshot at the restore seq — anchors the new history.
    snap_name = snap_mod.create(
        sheet_id,
        kind=snap_mod.KIND_MILESTONE,
        label=_restore_label(target),
    )
    return {"snapshot": snap_name, "seq": restore_seq}


def _refuse_linked_sheet(sheet: str) -> None:
    from suite.sheets.drive import refuse_drive_native

    refuse_drive_native(sheet, "Drive version history")


def _restore_summary(target: dict) -> str:
    parts = ["Restored to"]
    if target.get("label"):
        parts.append(f'"{target["label"]}"')
    else:
        parts.append(f"seq {target['seq']}")
    return " ".join(parts)


def _restore_label(target: dict) -> str:
    base = target.get("label") or f"seq {target['seq']}"
    return f"Restore of {base}"
