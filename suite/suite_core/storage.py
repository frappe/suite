"""Product-neutral combined storage policy; Mail itself is never quota-gated (spec §6-7)."""

import json
from collections.abc import Mapping

import frappe
from frappe import _

from suite.suite_core.administration import require_admin


def state(*, lock: bool = False):
    if not frappe.db.exists("Suite Storage State", "site"):
        frappe.get_doc(
            {"doctype": "Suite Storage State", "site_key": "site", "policy": "{}", "measurements": "{}"}
        ).insert(ignore_permissions=True)
    if lock:
        frappe.db.get_value("Suite Storage State", "site", "name", for_update=True)
    doc = frappe.get_doc("Suite Storage State", "site")
    return doc, json.loads(doc.policy or "{}"), json.loads(doc.measurements or "{}")


def effective_limit(cap: int | None, buffer: bool) -> int | None:
    return None if cap is None else cap + (cap // 10 if buffer else 0)


def validate_cap(value) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        frappe.throw(_("A storage cap must be a positive whole number of bytes or uncapped"))
    return value


def update_limits(users: list[str], cap: int | None, buffer: bool | None = None) -> list[dict]:
    require_admin()
    cap = validate_cap(cap)
    if buffer is not None and not isinstance(buffer, bool):
        frappe.throw(_("Choose whether storage headroom is granted"))
    doc, policy, _measurements = state(lock=True)
    limits = policy.setdefault("users", {})
    results = []
    for user in dict.fromkeys(users):
        if user in ("Guest", "Administrator") or not frappe.db.exists(
            "User", {"name": user, "user_type": "System User"}
        ):
            results.append({"user": user, "success": False, "error": _("User does not exist")})
            continue
        previous = limits.get(user, {})
        limits[user] = {
            "cap": cap,
            "buffer": False if cap is None else (previous.get("buffer", False) if buffer is None else buffer),
        }
        results.append({"user": user, "success": True, "error": None})
    doc.policy = json.dumps(policy)
    doc.save(ignore_permissions=True)
    from suite.suite_core.audit import record

    for result in results:
        record("storage.cap", result["user"], "completed" if result["success"] else "failed")
    return results


def set_default(cap: int | None) -> None:
    require_admin()
    doc, policy, _measurements = state(lock=True)
    policy["default_cap"] = validate_cap(cap)
    doc.policy = json.dumps(policy)
    doc.save(ignore_permissions=True)
    from suite.suite_core.audit import record

    record("storage.default", "site", "completed")


def update_buffers(users: list[str], *, grant: bool) -> list[dict]:
    require_admin()
    if not isinstance(grant, bool):
        frappe.throw(_("Choose whether to grant personal headroom"))
    doc, policy, _measurements = state(lock=True)
    limits = policy.setdefault("users", {})
    results = []
    for user in dict.fromkeys(users):
        limit = limits.get(user)
        if user in ("Guest", "Administrator") or not frappe.db.exists("User", user):
            error = _("User does not exist")
        elif not limit or limit.get("cap") is None:
            error = _("Set a personal cap before granting or revoking headroom")
        else:
            limit["buffer"] = grant
            error = None
        results.append({"user": user, "success": error is None, "error": error})
    doc.policy = json.dumps(policy)
    doc.save(ignore_permissions=True)
    from suite.suite_core.audit import record

    for result in results:
        record(
            "storage.headroom.grant" if grant else "storage.headroom.revoke",
            result["user"],
            "completed" if result["success"] else "failed",
        )
    return results


def initialize_user_limit(user: str, *, cap: int | None = None, use_default: bool = True) -> None:
    """Snapshot policy from a trusted creation workflow; subsequent defaults never rewrite it."""
    doc, policy, _measurements = state(lock=True)
    limits = policy.setdefault("users", {})
    if user in limits and use_default:
        return
    limits[user] = {"cap": policy.get("default_cap") if use_default else validate_cap(cap), "buffer": False}
    doc.policy = json.dumps(policy)
    doc.save(ignore_permissions=True)


def check_addition(
    policy: Mapping,
    measurements: Mapping,
    *,
    user: str | None,
    site_drive: int,
    personal_drive: int,
    delta: int,
    site_delta: int | None = None,
) -> None:
    """Validate combined projected charge. Drive counters passed here already include reservations."""
    if delta <= 0:
        return
    site_mail = measurements.get("site_mail")
    allowance = measurements.get("allowance")
    growth = delta if site_delta is None else site_delta
    if growth > 0 and (site_mail is None or allowance is None):
        frappe.throw(
            _("Mail usage or the site allowance is unavailable; refresh storage before adding Drive files")
        )
    # Provider zero preserves its existing unlimited-site semantics, not a zero-byte denial.
    site_limit = effective_limit(allowance, True) if allowance else None
    if growth > 0 and site_limit is not None and site_drive + site_mail + growth > site_limit:
        frappe.throw(_("Combined Mail and Drive usage exceeds the site allowance"))
    if user is None:
        return
    mail = measurements.get("personal", {}).get(user)
    if mail is None:
        frappe.throw(_("This user's Mail usage is unavailable; refresh storage before adding Drive files"))
    limit = policy.get("users", {}).get(user, {})
    cap = effective_limit(limit.get("cap"), bool(limit.get("buffer")))
    if cap is not None and personal_drive + mail + delta > cap:
        frappe.throw(_("Combined Mail and Drive usage exceeds the user's storage cap"))
