"""Move a disabled user's retained tree without restoring trash or changing node identities."""

import hashlib
import json

import frappe
from frappe import _

from suite.drive._core.access import chain_ids
from suite.drive._core.errors import DriveConflict, DriveForbidden
from suite.drive._core.nodes import _move, _node, _subtree_charge
from suite.drive._core.principals import Principals
from suite.drive._core.quota import _check_combined, preflight, root_for_node
from suite.drive._core.roots import validate_root_pair
from suite.suite_core.utils import is_suite_cloud_configured


def preview(user: str, destination: str, principals: Principals) -> dict:
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
    target = _node(destination)
    if target.kind != "folder" or target.state != "Active":
        raise DriveConflict(_("Choose an active named destination folder"))
    target_root = root_for_node(target)
    if target_root.name == source.root.name or target_root.state != "Active":
        raise DriveConflict(_("Choose a destination in another active Personal or Shared Root"))
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
    if is_suite_cloud_configured():
        _check_combined(target_root.name, charge, lock=False, source_root=source.root.name)
    else:
        preflight(target_root, charge)
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
        "destination_user": target_root.user,
        "bytes": charge,
        "item_count": len(items),
        "fingerprint": fingerprint,
        "inherited_grants": grants,
        "items": items,
    }


def transfer(
    user: str, destination: str, fingerprint: str, principals: Principals, *, confirm_access: bool
) -> dict:
    if not confirm_access:
        raise DriveConflict(_("Confirm that destination inheritance can expand access"))
    frappe.db.get_value("User", user, "name", for_update=True)
    current = preview(user, destination, principals)
    if current["fingerprint"] != fingerprint:
        raise DriveConflict(_("The source or destination changed. Review a new transfer preview."))
    results = []
    # Bounded requests provide observable progress; each item uses Drive's own
    # savepoint. A retry only lists what remains in the source, never copies an
    # already moved node or double-counts versions/trash (§5).
    for item in current["items"][:50]:
        try:
            _move(
                principals,
                item.name,
                destination,
                expect_parent_node=current["source_root"],
                retained_transfer=True,
            )
        except frappe.ValidationError as exc:
            results.append({"node": item.name, "success": False, "error": str(exc)})
        else:
            results.append({"node": item.name, "success": True, "error": None})
    remaining = frappe.db.count("Drive Node", {"root": current["source_root"]})
    return {"results": results, "remaining": remaining, "complete": remaining == 0}
