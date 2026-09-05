"""Frappe request adapter for Drive identity."""

import frappe

from suite.drive._core.principals import Principals


def is_drive_admin(user: str | None = None) -> bool:
    user = user or frappe.session.user
    return user == "Administrator" or "Suite Admin" in frappe.get_roles(user)


def principals_for_request() -> Principals:
    """Build the caller's identity principals once at the framework boundary."""
    user = frappe.session.user
    if user == "Guest":
        return Principals(user=user, own=(), open=("$PUBLIC",), is_admin=False)

    groups = frappe.cache().hget("drive_user_groups", user, generator=lambda: _user_groups(user))
    own = (user, *(f"$GROUP:{group}" for group in groups), "$GENERAL")
    return Principals(user=user, own=own, open=("$PUBLIC",), is_admin=is_drive_admin(user))


def _user_groups(user: str) -> tuple[str, ...]:
    return tuple(
        frappe.get_all(
            "User Group Member",
            filters={"parenttype": "User Group", "user": user},
            pluck="parent",
            order_by="parent",
        )
    )
