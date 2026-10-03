"""REST adapters for Mail rail state."""

from typing import TypedDict

import frappe
from frappe import _

from suite.composition.http import Route
from suite.mail.api.mail import get_all_inbox_unread_count


class InboxSummary(TypedDict):
    unread: int


ROUTES = (Route("GET", "inbox-summary", "inbox_summary", output=InboxSummary),)


@frappe.whitelist(methods=["GET"])
def inbox_summary() -> InboxSummary:
    return {"unread": get_all_inbox_unread_count()}


@frappe.whitelist(allow_guest=True, methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])
def unknown() -> None:
    raise frappe.DoesNotExistError(_("That Mail address does not exist"))
