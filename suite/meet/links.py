import re
from typing import Literal, NoReturn

import frappe
from frappe import _
from frappe.utils import get_url

LinkRefusal = Literal["invalid", "reserved", "taken"]
LinkStatus = Literal["available", LinkRefusal]


class LinkError(frappe.ValidationError):
    http_status_code = 400


_SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
_CODE = re.compile(r"[a-z]{4}-[a-z]{4}-[a-z]{4}")
_RESERVED = {"scheduled", "recordings", "new", "join", "settings", "api", "rooms", "meet", "admin", "help"}


def link_status(link: str) -> LinkStatus:
    if not 3 <= len(link) <= 40 or not _SLUG.fullmatch(link):
        return "invalid"
    if link in _RESERVED or _CODE.fullmatch(link):
        return "reserved"
    if frappe.db.exists("Meet Room", link):
        return "taken"
    return "available"


def refuse_link(status: LinkRefusal) -> NoReturn:
    messages = {
        "invalid": _("Use 3–40 lowercase letters, numbers or hyphens"),  # noqa: RUF001
        "reserved": _("This link is reserved"),
        "taken": _("Already taken"),
    }
    frappe.throw(messages[status], LinkError)


def meeting_url(room: str) -> str:
    return get_url(f"/meet/{room}")
