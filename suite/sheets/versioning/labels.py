"""Mutate snapshot metadata: rename, pin, delete.

Deletion is allowed only for unpinned snapshots — pinned/named ones are
user-curated and survive nightly rollup.
"""

import frappe


def set_label(snapshot_id: str, label: str | None, pinned: bool | None = None) -> dict:
    """Update a snapshot's label and/or pinned flag.

    Setting a non-empty label implicitly promotes the snapshot to `kind=named`
    and pins it; clearing the label demotes it back to `kind=auto` (unless
    pinned was explicitly set).
    """
    snap = frappe.get_doc("Sheet Snapshot", snapshot_id)
    # Permission first, then the Drive refusal. Reversed, the refusal message
    # tells a caller with no rights on the sheet that this snapshot id exists
    # and that Drive owns its parent. `state.restore` needs no such swap:
    # `at()` has already validated read.
    frappe.has_permission("Sheet", doc=snap.sheet, ptype="write", throw=True)
    _refuse_linked_sheet(snap.sheet)

    if label is not None:
        clean = label.strip()
        snap.label = clean or None
        if clean:
            snap.kind = "named"
            snap.pinned = 1
        else:
            # Cleared the label — demote unless caller insists on pinned.
            snap.kind = "auto" if snap.kind == "named" else snap.kind
            if pinned is None:
                snap.pinned = 0

    if pinned is not None:
        snap.pinned = 1 if pinned else 0

    snap.save(ignore_permissions=True)
    return {"id": snap.name, "label": snap.label, "kind": snap.kind, "pinned": bool(snap.pinned)}


def delete(snapshot_id: str) -> dict:
    """Delete an unpinned snapshot. Pinned ones must be unpinned first."""
    snap = frappe.db.get_value("Sheet Snapshot", snapshot_id, ["sheet", "pinned"], as_dict=True)
    if not snap:
        frappe.throw(f"Snapshot {snapshot_id} not found")
    # Permission first, for the reason `set_label` states.
    frappe.has_permission("Sheet", doc=snap.sheet, ptype="write", throw=True)
    _refuse_linked_sheet(snap.sheet)
    if snap.pinned:
        frappe.throw("Cannot delete a pinned snapshot — unpin it first")

    frappe.delete_doc("Sheet Snapshot", snapshot_id, ignore_permissions=True)
    # If we just deleted the head_snapshot, fall back to the next-most-recent.
    current_head = frappe.db.get_value("Sheet", snap.sheet, "head_snapshot")
    if current_head == snapshot_id:
        next_snap = frappe.get_all(
            "Sheet Snapshot",
            filters={"sheet": snap.sheet},
            fields=["name"],
            order_by="seq desc",
            limit=1,
        )
        frappe.db.set_value(
            "Sheet",
            snap.sheet,
            "head_snapshot",
            next_snap[0]["name"] if next_snap else None,
            update_modified=False,
        )
    return {"deleted": snapshot_id}


def _refuse_linked_sheet(sheet: str) -> None:
    from suite.sheets.drive import refuse_drive_native

    refuse_drive_native(sheet, "Drive version history")
