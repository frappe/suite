"""Frappe request adapter for Drive identity."""

import frappe

from suite.drive._core.principals import Principals, parse_link_header


def is_drive_admin(user: str | None = None) -> bool:
    user = user or frappe.session.user
    return user == "Administrator" or "Suite Admin" in frappe.get_roles(user)


def principals_for_request() -> Principals:
    """Build the caller's identity principals once at the framework boundary."""
    user = frappe.session.user
    request = getattr(frappe.local, "request", None)
    credentials = parse_link_header(request.headers.get("X-Drive-Links") if request is not None else None)
    links = tuple(credential.principal for credential in credentials)
    tickets = tuple(
        (credential.principal, credential.exp, credential.mac)
        for credential in credentials
        if credential.exp is not None and credential.mac is not None
    )
    if user == "Guest":
        return Principals(
            user=user,
            own=(),
            open=("$PUBLIC", *links),
            is_admin=False,
            link_tickets=tickets,
        )

    groups = frappe.cache().hget("drive_user_groups", user, generator=lambda: _user_groups(user))
    own = (user, *(f"$GROUP:{group}" for group in groups), "$GENERAL")
    return Principals(
        user=user,
        own=own,
        open=("$PUBLIC", *links),
        is_admin=is_drive_admin(user),
        link_tickets=tickets,
    )


def _user_groups(user: str) -> tuple[str, ...]:
    return tuple(
        frappe.get_all(
            "User Group Member",
            filters={"parenttype": "User Group", "user": user},
            pluck="parent",
            order_by="parent",
        )
    )
