"""Drive-root quota calculation and atomic byte admission."""

import re
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from uuid import uuid4

import frappe
from frappe import _

from suite.drive._core.errors import (
    DriveConflict,
    DriveNotFound,
    DriveOverQuota,
    rollback_savepoint,
)
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


# A Single stores its values as text. Validate raw quota values because Frappe
# casts malformed Int values to zero when loading a document.
_INTEGER_TEXT = re.compile(r"[+-]?[0-9]+\Z")


def site_quota_bytes(value, label: str) -> int:
    """Read a byte quota that a Single stores as text. Zero is unlimited.

    A plain integer string is accepted. Anything else is refused, so a malformed
    site setting never reads as an unlimited quota.
    """
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return 0
        if not _INTEGER_TEXT.match(text):
            frappe.throw(_("{0} must be a nonnegative integer").format(label), frappe.ValidationError)
        value = int(text)
    return _nonnegative_bytes(value or 0, label)


def effective_quota(root: Mapping) -> int:
    """Return the root override or its current site default. Zero is unlimited."""
    from suite.suite_core.utils import is_suite_cloud_configured

    if is_suite_cloud_configured():
        # Configured sites use combined policy; legacy root/default caps do not stack.
        return 0
    kind = root.get("kind")
    if kind not in ("Personal", "Shared"):
        frappe.throw(_("Drive root kind must be Personal or Shared"), frappe.ValidationError)
    override = _nonnegative_bytes(root.get("quota_bytes"), _("Drive root quota"))
    if override:
        return override

    field = "shared_quota" if kind == "Shared" else "default_personal_quota"
    raw_settings = frappe.db.get_singles_dict("Drive Disk Settings", cast=False)
    return site_quota_bytes(raw_settings.get(field), _("Drive site quota"))


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
    from suite.suite_core.utils import is_suite_cloud_configured

    if is_suite_cloud_configured():
        _check_combined(root.get("name"), declared_bytes, lock=False)
        return
    limit = effective_quota(root)
    used = _nonnegative_bytes(root.get("used_bytes") or 0, _("Drive root usage"))
    if limit and declared_bytes > max(limit - used, 0):
        raise DriveOverQuota(_("This upload exceeds the Drive root quota"))


def admit(root: str, delta: int, *, source_root: str | None = None) -> None:
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
    from suite.suite_core.utils import is_suite_cloud_configured

    if is_suite_cloud_configured():
        _check_combined(root, delta, lock=True, source_root=source_root)
    frappe.db.sql(
        ADMIT_SQL,
        {"root": root, "delta": delta, "effective_quota": effective_quota(root_row)},
    )
    if not frappe.db.sql("SELECT ROW_COUNT()")[0][0]:
        raise DriveOverQuota(_("This write exceeds the Drive root quota"))


def _check_combined(root: str, delta: int, *, lock: bool, source_root: str | None = None) -> None:
    from suite.suite_core.storage import check_addition, state

    _, policy, measurements = state(lock=lock)
    # Current reads under a site lock prevent separate roots spending the same
    # headroom. Existing Drive savepoints propagate deadlock errors for retry.
    rows = frappe.db.sql(
        "SELECT name, user, kind, used_bytes FROM `tabDrive Root` ORDER BY name"
        + (" FOR UPDATE" if lock else ""),
        as_dict=True,
    )
    target = next((row for row in rows if row.name == root), None)
    if target is None:
        raise DriveNotFound(_("The Drive root was not found"))
    user = target.user if target.kind == "Personal" else None
    source = next((row for row in rows if row.name == source_root), None) if source_root else None
    if source_root and (source is None or int(source.used_bytes or 0) < delta):
        raise DriveConflict(_("The source root cannot supply the transferred bytes"))
    try:
        check_addition(
            policy,
            measurements,
            user=user,
            delta=delta,
            site_delta=0 if source is not None else delta,
            site_drive=sum(int(row.used_bytes or 0) for row in rows),
            personal_drive=sum(int(row.used_bytes or 0) for row in rows if user and row.user == user),
        )
    except frappe.ValidationError as exc:
        raise DriveOverQuota(str(exc)) from exc


def administration_usage() -> list[dict]:
    rows = frappe.get_all("Drive Root", fields=["name", "user", "kind", "used_bytes", "state", "quota_bytes"])
    reservations = dict(
        frappe.db.sql("SELECT root, SUM(reserved_bytes) FROM `tabDrive Storage Reservation` GROUP BY root")
    )
    for row in rows:
        row["reserved_bytes"] = int(reservations.get(row.name, 0))
        row["stored_bytes"] = max(int(row.used_bytes or 0) - row.reserved_bytes, 0)
        row["effective_quota_bytes"] = effective_quota(row)
    return rows


def release(root: str, delta: int) -> None:
    """Lower a root's usage without ever allowing a negative counter."""
    delta = _nonnegative_bytes(delta, _("Drive quota release"))
    if delta == 0:
        return
    frappe.db.sql(RELEASE_SQL, {"root": root, "delta": delta})


def get_storage_usage(root: str) -> frappe._dict:
    """Return the authoritative counter and reservation detail for one root."""
    pair = validate_root_pair(root)
    reserved = frappe.db.sql(
        """SELECT COALESCE(SUM(reserved_bytes), 0)
           FROM `tabDrive Storage Reservation` WHERE root = %(root)s""",
        {"root": root},
    )[0][0]
    return frappe._dict(
        used_bytes=int(pair.root.used_bytes or 0),
        reserved_bytes=int(reserved or 0),
        quota_bytes=int(pair.root.quota_bytes or 0),
        effective_quota=effective_quota(pair.root),
    )


def get_storage_reservation(key: str) -> frappe._dict | None:
    """Return the reservation and the root it is bound to, or None."""
    _validate_reservation_key(key)
    current = _reservation(key, for_update=False)
    return _reservation_shape(current) if current else None


def create_storage_reservation(root: str, key: str, reserved_bytes: int) -> frappe._dict:
    """Create an idempotent root reservation and charge it atomically."""
    reserved_bytes = _nonnegative_bytes(reserved_bytes, _("Reserved bytes"))
    _validate_reservation_key(key)
    with _reservation_transaction():
        validate_root_pair(root, for_update=True)
        current = _reservation(key, for_update=True)
        if current:
            if current.root == root and int(current.reserved_bytes) == reserved_bytes:
                return _reservation_shape(current)
            raise DriveConflict(_("The storage reservation already exists with different values"))
        admit(root, reserved_bytes)
        return _reservation_shape(
            frappe.get_doc(
                {
                    "doctype": "Drive Storage Reservation",
                    "name": key,
                    "root": root,
                    "reserved_bytes": reserved_bytes,
                }
            ).insert(ignore_permissions=True)
        )


def bind_legacy_storage_reservation(root: str, key: str, reserved_bytes: int) -> frappe._dict:
    """Adopt one pre-root reservation onto a root and charge it exactly once.

    Migration-only: a patch that runs before Build finds reservation rows the
    old Drive wrote with no root. Such a row was never counted in any
    ``Drive Root.used_bytes``, so adoption runs the admission UPDATE. A row
    that already names a root keeps that binding for good: only its byte
    amount is corrected, on the root it is already charged to.
    """
    reserved_bytes = _nonnegative_bytes(reserved_bytes, _("Reserved bytes"))
    _validate_reservation_key(key)
    bound = _reservation(key, for_update=False)
    if bound and bound.root:
        return _resize_storage_reservation(
            bound.root, key, reserved_bytes, grow=reserved_bytes > int(bound.reserved_bytes)
        )
    with _reservation_transaction():
        validate_root_pair(root, for_update=True)
        current = _reservation(key, for_update=True)
        if current and current.root:
            # Another worker bound it first; never move a charged reservation.
            return _reservation_shape(current)
        admit(root, reserved_bytes)
        if not current:
            return _reservation_shape(
                frappe.get_doc(
                    {
                        "doctype": "Drive Storage Reservation",
                        "name": key,
                        "root": root,
                        "reserved_bytes": reserved_bytes,
                    }
                ).insert(ignore_permissions=True)
            )
        frappe.db.set_value(
            "Drive Storage Reservation",
            key,
            {"root": root, "reserved_bytes": reserved_bytes},
            update_modified=False,
        )
        return frappe._dict(name=key, root=root, reserved_bytes=reserved_bytes)


def grow_storage_reservation(root: str | None, key: str, reserved_bytes: int) -> frappe._dict:
    """Grow a reservation to an absolute byte value."""
    return _resize_storage_reservation(root, key, reserved_bytes, grow=True)


def reduce_storage_reservation(root: str | None, key: str, reserved_bytes: int) -> frappe._dict:
    """Reduce a reservation to an absolute byte value."""
    return _resize_storage_reservation(root, key, reserved_bytes, grow=False)


def release_storage_reservation(root: str | None, key: str) -> None:
    """Release an existing reservation; a missing key is an idempotent success."""
    _validate_reservation_key(key)
    with _reservation_transaction():
        bound = _reservation(key, for_update=False)
        if not bound:
            return
        if root is None and not bound.root:
            # An unbound legacy row was never charged to a root counter.
            current = _reservation(key, for_update=True)
            if current and not current.root:
                frappe.db.delete("Drive Storage Reservation", key)
                return
        root = _explicit_or_bound_root(root, key, missing_ok=True)
        if root is None:
            return
        validate_root_pair(root, for_update=True)
        current = _reservation(key, for_update=True)
        if current:
            _require_reservation_root(current, root)
            frappe.db.delete("Drive Storage Reservation", key)
            release(root, int(current.reserved_bytes))


def consume_storage_reservation(root: str, key: str, charged_bytes: int) -> None:
    """Replace already admitted promises with stored bytes; admit only excess growth."""
    charged_bytes = _nonnegative_bytes(charged_bytes, _("Stored bytes"))
    _validate_reservation_key(key)
    with _reservation_transaction():
        validate_root_pair(root, for_update=True)
        current = _reservation(key, for_update=True)
        if not current:
            raise DriveNotFound(_("The storage reservation was not found"))
        _require_reservation_root(current, root)
        reserved = int(current.reserved_bytes)
        if charged_bytes > reserved:
            admit(root, charged_bytes - reserved)
        elif charged_bytes < reserved:
            release(root, reserved - charged_bytes)
        frappe.db.delete("Drive Storage Reservation", key)


def recompute_usage(root: str) -> frappe._dict:
    """Repair one Active or Archived root counter from all charged records."""
    pair = validate_root_pair(root, for_update=True)
    totals = frappe.db.sql(
        """
        SELECT
          (SELECT COALESCE(SUM(size), 0) FROM `tabDrive Node`
            WHERE root = %(root)s) AS nodes,
          (SELECT COALESCE(SUM(v.size), 0) FROM `tabDrive Node Version` v
             JOIN `tabDrive Node` n ON n.name = v.node
            WHERE n.root = %(root)s) AS versions,
          (SELECT COALESCE(SUM(reserved_bytes), 0)
             FROM `tabDrive Storage Reservation` WHERE root = %(root)s) AS reserved
        """,
        {"root": root},
        as_dict=True,
    )[0]
    before = int(pair.root.used_bytes or 0)
    after = sum(int(totals.get(field) or 0) for field in ("nodes", "versions", "reserved"))
    if before != after:
        frappe.db.set_value("Drive Root", root, "used_bytes", after, update_modified=False)
    return frappe._dict(root=root, before=before, after=after, drift=after - before, **totals)


def _resize_storage_reservation(
    root: str | None, key: str, reserved_bytes: int, *, grow: bool
) -> frappe._dict:
    reserved_bytes = _nonnegative_bytes(reserved_bytes, _("Reserved bytes"))
    _validate_reservation_key(key)
    with _reservation_transaction():
        root = _explicit_or_bound_root(root, key)
        validate_root_pair(root, for_update=True)
        current = _reservation(key, for_update=True)
        if not current:
            raise DriveNotFound(_("The storage reservation was not found"))
        _require_reservation_root(current, root)
        old = int(current.reserved_bytes)
        if reserved_bytes == old:
            pass
        elif grow:
            if reserved_bytes < old:
                raise DriveConflict(_("A grow operation cannot reduce a storage reservation"))
            admit(root, reserved_bytes - old)
        else:
            if reserved_bytes > old:
                raise DriveConflict(_("A reduce operation cannot grow a storage reservation"))
            release(root, old - reserved_bytes)
        if reserved_bytes != old:
            frappe.db.set_value(
                "Drive Storage Reservation", key, "reserved_bytes", reserved_bytes, update_modified=False
            )
            current.reserved_bytes = reserved_bytes
        return _reservation_shape(current)


def _reservation(key: str, *, for_update: bool) -> frappe._dict | None:
    return frappe.db.get_value(
        "Drive Storage Reservation",
        key,
        ["name", "root", "reserved_bytes"],
        as_dict=True,
        for_update=for_update,
    )


def _explicit_or_bound_root(root: str | None, key: str, *, missing_ok: bool = False) -> str | None:
    if root is not None:
        if not isinstance(root, str) or not root:
            frappe.throw(_("Drive root must be a nonempty string"), frappe.ValidationError)
        return root
    reservation = _reservation(key, for_update=False)
    if not reservation:
        if missing_ok:
            return None
        raise DriveNotFound(_("The storage reservation was not found"))
    if not reservation.root:
        raise DriveConflict(_("The storage reservation has no Drive root binding"))
    return reservation.root


def _require_reservation_root(reservation: Mapping, root: str) -> None:
    if reservation.get("root") != root:
        raise DriveConflict(_("The storage reservation belongs to a different Drive root"))


def _reservation_shape(reservation: Mapping) -> frappe._dict:
    return frappe._dict(
        name=reservation.get("name"),
        root=reservation.get("root"),
        reserved_bytes=int(reservation.get("reserved_bytes") or 0),
    )


def _validate_reservation_key(key: str) -> None:
    if not isinstance(key, str) or not key.strip() or len(key) > 140:
        frappe.throw(_("Storage reservation key must be a nonempty string"), frappe.ValidationError)


@contextmanager
def _reservation_transaction() -> Iterator[None]:
    """Roll every reservation write back to the caller's transaction on failure."""
    savepoint = f"drive_reservation_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        yield
    except Exception as exc:
        rollback_savepoint(savepoint, exc)
        raise
    else:
        frappe.db.release_savepoint(savepoint)


def _nonnegative_bytes(value: int, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        frappe.throw(_("{0} must be a nonnegative integer").format(label), frappe.ValidationError)
    return value
