"""Drive-root quota calculation and atomic byte admission."""

from collections.abc import Mapping

import frappe
from frappe import _

from suite.drive._core.errors import DriveNotFound, DriveOverQuota
from suite.drive._core.roots import validate_root_pair

ADMIT_SQL = """
UPDATE `tabDrive Root`
SET used_bytes = used_bytes + %(delta)s
WHERE name = %(root)s
  AND (%(effective_quota)s = 0 OR used_bytes + %(delta)s <= %(effective_quota)s)
"""

RELEASE_SQL = """
UPDATE `tabDrive Root`
SET used_bytes = GREATEST(used_bytes - %(delta)s, 0)
WHERE name = %(root)s
"""


def effective_quota(root: Mapping) -> int:
    """Return the root override or its current site default. Zero is unlimited."""
    kind = root.get("kind")
    if kind not in ("Personal", "Shared"):
        frappe.throw(_("Drive root kind must be Personal or Shared"), frappe.ValidationError)
    override = _nonnegative_bytes(root.get("quota_bytes"), _("Drive root quota"))
    if override:
        return override

    settings = frappe.get_cached_doc("Drive Disk Settings")
    field = "shared_quota" if kind == "Shared" else "default_personal_quota"
    return _nonnegative_bytes(settings.get(field) or 0, _("Drive site quota"))


def root_for_node(node: Mapping, *, for_update: bool = False) -> frappe._dict:
    """Load the accounting root for a root node or one of its descendants."""
    root_id = node.get("name") if node.get("kind") == "root" else node.get("root")
    if not root_id:
        raise DriveNotFound(_("The Drive root was not found"))
    try:
        pair = validate_root_pair(root_id, for_update=True) if for_update else validate_root_pair(root_id)
    except frappe.ValidationError as exc:
        raise DriveNotFound(_("Drive root {0} was not found").format(root_id)) from exc
    return pair.root


def preflight(root: Mapping, declared_bytes: int) -> None:
    """Refuse an obvious upload overshoot without mutating the root counter."""
    declared_bytes = _nonnegative_bytes(declared_bytes, _("Declared upload size"))
    limit = effective_quota(root)
    used = _nonnegative_bytes(root.get("used_bytes") or 0, _("Drive root usage"))
    if limit and declared_bytes > max(limit - used, 0):
        raise DriveOverQuota(_("This upload exceeds the Drive root quota"))


def admit(root: str, delta: int) -> None:
    """Atomically add bytes to a root if its effective quota permits them."""
    delta = _nonnegative_bytes(delta, _("Drive quota admission"))
    if delta == 0:
        return
    root_row = frappe.db.get_value(
        "Drive Root",
        root,
        ["name", "kind", "quota_bytes"],
        as_dict=True,
    )
    if not root_row:
        raise DriveNotFound(_("Drive root {0} was not found").format(root))
    frappe.db.sql(
        ADMIT_SQL,
        {"root": root, "delta": delta, "effective_quota": effective_quota(root_row)},
    )
    if not frappe.db.sql("SELECT ROW_COUNT()")[0][0]:
        raise DriveOverQuota(_("This write exceeds the Drive root quota"))


def release(root: str, delta: int) -> None:
    """Lower a root's usage without ever allowing a negative counter."""
    delta = _nonnegative_bytes(delta, _("Drive quota release"))
    if delta == 0:
        return
    frappe.db.sql(RELEASE_SQL, {"root": root, "delta": delta})


def _nonnegative_bytes(value: int, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        frappe.throw(_("{0} must be a nonnegative integer").format(label), frappe.ValidationError)
    return value
