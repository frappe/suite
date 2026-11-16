"""Move a disabled user's retained tree without restoring trash or changing node identities."""

import dataclasses
import hashlib
import json

import frappe
from frappe import _

from suite.drive._core.access import chain_ids
from suite.drive._core.errors import DriveConflict, DriveForbidden
from suite.drive._core.nodes import _move, _node, _subtree_charge, ensure_folder
from suite.drive._core.principals import Principals
from suite.drive._core.quota import _check_combined, administration_usage, preflight, root_for_node
from suite.drive._core.roots import personal_root_for, validate_root_pair
from suite.suite_core.storage import effective_limit, personal_mail_usage, state
from suite.suite_core.utils import is_suite_cloud_configured


def preview(user: str, to_user: str | None, to_drive: str | None, principals: Principals) -> dict:
    if not principals.is_admin:
        raise DriveForbidden(_("Only an Admin can transfer a disabled user's Drive"))
    if user in ("Guest", "Administrator") or frappe.db.get_value("User", user, "enabled") != 0:
        raise DriveConflict(_("Disable the user before transferring retained Drive content"))
    roots = frappe.get_all("Drive Root", filters={"kind": "Personal", "user": user}, pluck="name")
    if len(roots) != 1:
        raise DriveConflict(_("The user must have exactly one retained Personal Root"))
    source = validate_root_pair(roots[0])
    if source.root.state != "Archived":
        raise DriveConflict(_("Archive the Personal Root before transferring its retained content"))
    if bool(to_user) == bool(to_drive):
        raise DriveConflict(_("Choose exactly one person or shared Drive"))
    if to_user:
        if (
            to_user in (user, "Guest", "Administrator")
            or frappe.db.get_value("User", to_user, "enabled") != 1
        ):
            raise DriveConflict(_("Choose another enabled person"))
        root = personal_root_for(to_user)
        if not root:
            raise DriveConflict(_("Choose a person with an active Personal Root"))
    else:
        root = to_drive
    if not root:
        raise DriveConflict(_("Choose an active shared Drive"))
    pair = validate_root_pair(root)
    target_root, target = pair.root, pair.node
    if target_root.state != "Active" or target_root.kind != ("Personal" if to_user else "Shared"):
        raise DriveConflict(_("Choose an active Personal or Shared Drive"))
    destination = target.name
    folder_title = _("{0}'s files").format(frappe.db.get_value("User", user, "full_name") or user)
    destination_title = (
        (frappe.db.get_value("User", to_user, "full_name") or to_user) if to_user else target.title
    )
    reserved = frappe.db.get_value("Drive Storage Reservation", {"root": source.root.name}, "name")
    if reserved:
        raise DriveConflict(
            _("Wait for admitted Drive operations to finish before transferring this user's content")
        )
    items = frappe.get_all(
        "Drive Node",
        filters={"parent_node": source.node.name},
        fields=["name", "title", "state", "modified"],
        order_by="name asc",
    )
    charge = sum(_subtree_charge(_node(item.name)) for item in items)
    usage = administration_usage()
    personal = target_root.kind == "Personal"
    rows = [
        row
        for row in usage
        if row["name"] == target_root.name or (personal and row["user"] == target_root.user)
    ]
    reserved_bytes = sum(row["reserved_bytes"] for row in rows)
    stored_bytes = sum(row["stored_bytes"] for row in rows)
    mail_bytes: int | None = 0
    cap = next(row["effective_quota_bytes"] for row in rows if row["name"] == target_root.name) or None
    buffer_bytes = 0
    configured = is_suite_cloud_configured()
    if configured:
        _doc, policy, measurements = state()
        limit = policy.get("users", {}).get(target_root.user, {}) if personal else {}
        cap = limit.get("cap")
        buffer_bytes = cap // 10 if cap is not None else 0
        mail_bytes = personal_mail_usage(measurements, target_root.user) if personal else 0
    threshold = effective_limit(cap) if configured else cap
    current_bytes = stored_bytes + reserved_bytes + mail_bytes if mail_bytes is not None else None
    projected_bytes = current_bytes + charge if current_bytes is not None else None
    blocker = None
    if charge > 0 and current_bytes is None:
        blocker = "unknown_usage"
    elif charge > 0 and threshold is not None and projected_bytes is not None and projected_bytes > threshold:
        blocker = "personal_limit" if configured else "drive_limit"
    capacity = {
        "stored_bytes": stored_bytes,
        "mail_bytes": mail_bytes,
        "reserved_bytes": reserved_bytes,
        "current_bytes": current_bytes,
        "projected_bytes": projected_bytes,
        "cap_bytes": cap,
        "buffer_bytes": buffer_bytes,
        "effective_threshold_bytes": threshold,
        "complete": mail_bytes is not None,
        "blocker": blocker,
    }
    # Destination inheritance is an explicit consequence, even where it gives
    # fewer people access. Stable node/version/grant identities are preserved.
    grants = frappe.get_all(
        "Drive Grant",
        filters={"node": ["in", chain_ids(target)]},
        fields=["principal", "role"],
        order_by="principal asc",
    )
    fingerprint = hashlib.sha256(
        json.dumps(
            {
                "source": source.root.name,
                "destination": destination,
                "folder_title": folder_title,
                "to_user": to_user,
                "to_drive": to_drive,
                "items": items,
                "bytes": charge,
                "grants": grants,
            },
            default=str,
            sort_keys=True,
        ).encode()
    ).hexdigest()
    return {
        "source_root": source.root.name,
        "destination": destination,
        "destination_user": to_user,
        "folder_title": folder_title,
        "destination_title": destination_title,
        "bytes": charge,
        "item_count": len(items),
        "fingerprint": fingerprint,
        "inherited_grants": grants,
        "items": items,
        "destination_capacity": capacity,
    }


def transfer(
    user: str,
    to_user: str | None,
    to_drive: str | None,
    fingerprint: str,
    principals: Principals,
    *,
    confirm_access: bool,
) -> dict:
    if not confirm_access:
        raise DriveConflict(_("Confirm that destination inheritance can expand access"))
    frappe.db.get_value("User", user, "name", for_update=True)
    current = preview(user, to_user, to_drive, principals)
    destination = current["destination"]
    if current["fingerprint"] != fingerprint:
        raise DriveConflict(_("The source or destination changed. Review a new transfer preview."))
    target_root = root_for_node(_node(destination))
    if is_suite_cloud_configured():
        _check_combined(target_root.name, current["bytes"], lock=True, source_root=current["source_root"])
    else:
        preflight(target_root, current["bytes"])
    # The admin holds no grant on what they move, so the move runs with Drive's
    # own authority and records the admin as its actor (ADR 0001).
    acting = dataclasses.replace(principals, is_system=True)
    # A stable system owner makes later batches reusable across administering users.
    folder_principals = dataclasses.replace(acting, user="Administrator")
    destination = ensure_folder(folder_principals, destination, current["folder_title"])
    results = []
    # Bounded requests provide observable progress; each item uses Drive's own
    # savepoint. A retry only lists what remains in the source, never copies an
    # already moved node or double-counts versions/trash (§5).
    for item in current["items"][:50]:
        try:
            _move(
                acting,
                item.name,
                destination,
                expect_parent_node=current["source_root"],
                retained_transfer=True,
            )
        except frappe.ValidationError as exc:
            results.append({"node": item.name, "title": item.title, "success": False, "error": str(exc)})
        else:
            results.append({"node": item.name, "title": item.title, "success": True, "error": None})
    remaining = frappe.db.count("Drive Node", {"root": current["source_root"]})
    return {"results": results, "remaining": remaining, "complete": remaining == 0}


def shared_drives() -> list[dict]:
    """Answer active Shared Drive identities ordered by their root node titles."""
    roots = frappe.get_all(
        "Drive Root", filters={"kind": "Shared", "state": "Active"}, fields=["name", "node"]
    )
    return sorted(
        [{"id": root.name, "title": _node(root.node).title} for root in roots],
        key=lambda root: (root["title"], root["id"]),
    )
