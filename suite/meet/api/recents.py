"""Personal recent rooms; membership alone is not evidence of a visit."""

from datetime import timedelta

import frappe
from frappe import _
from frappe.utils import now_datetime
from pypika import Order

from suite.meet.api.recordings import get_recordings


def record_room_visit(room: str, user: str) -> None:
    if not user or user == "Guest":
        return
    # Also covers approved users requesting connection details outside join_meeting.
    frappe.db.get_value("Meet Room", room, "name", for_update=True)
    name = frappe.db.get_value("Meet Recent Room", {"user": user, "room": room})
    if name:
        frappe.db.set_value("Meet Recent Room", name, "last_joined", now_datetime())
    else:
        frappe.get_doc(
            {
                "doctype": "Meet Recent Room",
                "user": user,
                "room": room,
                "last_joined": now_datetime(),
            }
        ).insert(ignore_permissions=True)


@frappe.whitelist()
def get_recent_meetings() -> list[dict]:
    user = frappe.session.user
    if not user or user == "Guest":
        frappe.throw(_("Authentication required"), frappe.AuthenticationError)
    recent = frappe.qb.DocType("Meet Recent Room")
    room = frappe.qb.DocType("Meet Room")
    banned = frappe.qb.DocType("Meet Room User")
    blocked = (
        frappe.qb.from_(banned)
        .select(banned.parent)
        .where(
            (banned.user == user)
            & (banned.parenttype == "Meet Room")
            & (banned.parentfield == "banned_users")
        )
    )
    meetings = (
        frappe.qb.from_(recent)
        .join(room)
        .on(room.name == recent.room)
        .select(room.name.as_("id"), room.title, recent.last_joined)
        .where(
            (recent.user == user)
            & room.name.notin(blocked)
            & (recent.last_joined >= now_datetime() - timedelta(days=7))
        )
        .orderby(recent.last_joined, order=Order.desc)
        .limit(10)
    ).run(as_dict=True)
    recordings = get_recordings()
    for meeting in meetings:
        meeting["recording"] = next(
            (item.artifact for item in recordings if item.meet_room == meeting.id), None
        )
    return meetings
