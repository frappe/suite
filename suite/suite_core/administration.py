"""Business administration, independent of Mail availability (§2 and §4 of the admin spec)."""

import frappe
from frappe import _

from suite.utils.user import is_suite_admin, is_user_enabled


def require_admin() -> str:
    user = frappe.session.user
    if user == "Guest" or not is_user_enabled(user) or (user != "Administrator" and not is_suite_admin(user)):
        frappe.throw(_("Only an active Suite Admin can administer this site"), frappe.PermissionError)
    return user


def list_users() -> list[dict]:
    require_admin()
    rows = frappe.get_all(
        "User",
        filters={"name": ["not in", ["Administrator", "Guest"]]},
        fields=["name", "email", "full_name", "user_image", "enabled"],
        order_by="full_name asc",
    )
    admins = set(
        frappe.get_all("Has Role", filters={"role": "Suite Admin", "parenttype": "User"}, pluck="parent")
    )
    for row in rows:
        row["is_admin"] = row["name"] in admins
        row["enabled"] = bool(row["enabled"])
        from suite.suite_core.account_state import read

        lifecycle = read(row["name"])
        row["account"] = lifecycle.get("account")
        row["setup_status"] = lifecycle.get("status") or "Active"
        row["must_change_password"] = bool(lifecycle.get("must_change_password"))
    return rows


def guard_user_change(user: str, *, is_admin: bool | None = None, enabled: bool | None = None) -> None:
    """Serialize admin demotion/suspension; recovery identities are never targets."""
    caller = require_admin()
    if user in ("Administrator", "Guest"):
        frappe.throw(_("Recovery accounts cannot be changed here"), frappe.PermissionError)
    # Lock in one order before counting: concurrent admins cannot both remove the last one.
    rows = frappe.db.sql(
        "SELECT name, enabled FROM `tabUser` WHERE user_type = 'System User' ORDER BY name FOR UPDATE",
        as_dict=True,
    )
    target = next((row for row in rows if row.name == user), None)
    if target is None:
        frappe.throw(_("User does not exist"), frappe.DoesNotExistError)
    if enabled is False and user == caller:
        frappe.throw(_("You cannot disable your own account"), frappe.ValidationError)
    admins = set(
        frappe.get_all("Has Role", filters={"role": "Suite Admin", "parenttype": "User"}, pluck="parent")
    )
    removing = is_admin is False or enabled is False
    active = {row.name for row in rows if row.enabled and row.name in admins and row.name != "Administrator"}
    if removing and user in active and len(active) == 1:
        frappe.throw(_("The last active Admin cannot be demoted or disabled"), frappe.ValidationError)


def update_user(
    user: str, *, is_admin: bool | None = None, enabled: bool | None = None, full_name: str | None = None
) -> list[dict]:
    guard_user_change(user, is_admin=is_admin, enabled=enabled)
    doc = frappe.get_doc("User", user)
    if full_name is not None:
        if not full_name.strip():
            frappe.throw(_("A display name is required"))
        first, _separator, last = full_name.strip().partition(" ")
        doc.first_name = first
        doc.last_name = last or None
    if is_admin is not None:
        if is_admin:
            doc.append_roles("Suite Admin")
        else:
            doc.set("roles", [row for row in doc.roles if row.role != "Suite Admin"])
    if enabled is not None:
        doc.enabled = int(enabled)
    # The business workflow above authorizes this exact change; ordinary users cannot
    # obtain generic User write permission through the dashboard.
    doc.save(ignore_permissions=True)
    from suite.api.account import forget_logged_in_users

    forget_logged_in_users()
    from suite.suite_core.audit import record

    record("users.update", user, "completed")
    return list_users()
