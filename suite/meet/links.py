"""Own the permanent link namespace and build shareable Meet URLs."""

import re
from typing import Literal, NoReturn

import frappe
from frappe import _
from frappe.utils import get_url

from suite.meet.doctype.meet_room.meet_room import MeetRoom

LinkRefusal = Literal["invalid", "reserved", "taken"]
LinkStatus = Literal["available", LinkRefusal]


class LinkError(frappe.ValidationError):
    """A link cannot be claimed."""

    http_status_code = 400


_SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
_CODE = re.compile(r"[a-z]{4}-[a-z]{4}-[a-z]{4}")
# Keep the static children in frontend/src/apps/meet/routes.ts reserved.
_RESERVED = {"scheduled", "recordings", "new", "join", "settings", "api", "rooms", "meet", "admin", "help"}


def _address_refusal(link: str) -> LinkRefusal | None:
    if not 3 <= len(link) <= 40 or not _SLUG.fullmatch(link):
        return "invalid"
    if link in _RESERVED or _CODE.fullmatch(link):
        return "reserved"
    if frappe.db.exists("Meet Room", link):
        return "taken"
    return None


def link_status(link: str, room: str | None = None) -> LinkStatus:
    status = _address_refusal(link)
    if status:
        return status
    bound_room = frappe.db.get_value("Meet Room Link", link, "room")
    return "taken" if bound_room and bound_room != room else "available"


def _refuse(status: LinkRefusal) -> NoReturn:
    messages = {
        "invalid": _("Use 3–40 lowercase letters, numbers or hyphens"),  # noqa: RUF001
        "reserved": _("This link is reserved"),
        "taken": _("Already taken"),
    }
    frappe.throw(messages[status], LinkError)


def change_link(room: str, link: str, *, user: str) -> None:
    """Set the current link while retaining every previous binding."""
    frappe.db.savepoint("meet_change_link")
    try:
        doc: MeetRoom = frappe.get_doc("Meet Room", room, for_update=True)
        if user == "Guest" or not doc.is_host_or_cohost(user):
            frappe.throw(_("Only the host or a co-host can change the link"), frappe.PermissionError)
        status = _address_refusal(link)
        if status:
            _refuse(status)
        bound_room = frappe.db.get_value("Meet Room Link", link, "room")
        if bound_room and bound_room != doc.name:
            _refuse("taken")
        if not bound_room:
            try:
                frappe.get_doc({"doctype": "Meet Room Link", "room": room}).insert(
                    ignore_permissions=True, set_name=link
                )
            except frappe.DuplicateEntryError:
                _refuse("taken")
        frappe.db.set_value("Meet Room", room, "custom_link", link)
    except Exception:
        frappe.db.rollback(save_point="meet_change_link")
        raise


def resolve_link(address: str) -> str | None:
    code = frappe.db.exists("Meet Room", address)
    if code:
        return code
    if 3 <= len(address) <= 40 and _SLUG.fullmatch(address):
        return frappe.db.get_value("Meet Room Link", address, "room")
    return None


def meeting_url(room: str, *, current_link: str | None = None) -> str:
    if current_link is None:
        current_link = frappe.db.get_value("Meet Room", room, "custom_link")
    return get_url(f"/meet/{current_link or room}")
