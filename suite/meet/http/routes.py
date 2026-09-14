"""REST adapters for Meet creation workflows."""

from __future__ import annotations

from datetime import datetime
from typing import Literal, NotRequired, TypedDict

import frappe
from frappe import _
from frappe.utils import get_system_timezone, get_url

from suite.composition.http import BadRequest, Route
from suite.mail.doctype.user_account.user_account import get_user_personal_jmap_account

Given = str | int | float | bool | list | dict | None


class CreateRoom(TypedDict):
    type: Literal["instant", "restricted"]


class Room(TypedDict):
    code: str
    url: str


class Attendee(TypedDict):
    email: str
    name: NotRequired[str]


class ScheduleMeeting(TypedDict):
    title: str
    start: str
    end: str
    attendees: list[Attendee]


class ScheduledMeeting(TypedDict):
    meeting: Room
    calendar_event_id: str


ROUTES = (
    Route("POST", "rooms", "rooms_post", body=CreateRoom, errors=(BadRequest,), output=Room),
    Route(
        "POST",
        "scheduled-meetings",
        "scheduled_meetings_post",
        body=ScheduleMeeting,
        errors=(BadRequest,),
        output=ScheduledMeeting,
    ),
)


@frappe.whitelist(methods=["POST"])
def rooms_post(type: Given = None) -> Room:
    from suite.meet.api.meeting import create as create_meeting

    kind = _required_text(type, "type")
    if kind not in ("instant", "restricted"):
        frappe.throw(_("Meet room type is invalid"), BadRequest)
    meeting_id = create_meeting(meeting_type="open" if kind == "instant" else "restricted")
    return {"code": meeting_id, "url": get_url(f"/meet/{meeting_id}")}


@frappe.whitelist(methods=["POST"])
def scheduled_meetings_post(
    title: Given = None,
    start: Given = None,
    end: Given = None,
    attendees: Given = None,
) -> ScheduledMeeting:
    from suite.meet.api.schedule import create_scheduled_meeting

    title_value = _required_text(title, "title")
    start_value = _required_text(start, "start")
    end_value = _required_text(end, "end")
    participants = _attendees(attendees)
    account = get_user_personal_jmap_account()
    if account is None:
        frappe.throw(_("Set up Calendar before scheduling a meeting"), BadRequest)
    created = create_scheduled_meeting(
        account=account,
        title=title_value,
        start=start_value,
        duration=_duration(start_value, end_value),
        time_zone=get_system_timezone(),
        participants=participants,
        send_scheduling_messages=bool(participants),
    )
    return {
        "meeting": {"code": created["meeting_id"], "url": created["meeting_url"]},
        "calendar_event_id": created["event_id"],
    }


def _attendees(value: Given) -> list[dict]:
    if not isinstance(value, list):
        frappe.throw(_("Meet argument attendees is invalid"), BadRequest)
    participants = []
    for attendee in value:
        if not isinstance(attendee, dict):
            frappe.throw(_("Meet attendee is invalid"), BadRequest)
        email = _required_text(attendee.get("email"), "attendee email")
        name = attendee.get("name")
        if name is not None and not isinstance(name, str):
            frappe.throw(_("Meet attendee name is invalid"), BadRequest)
        participants.append({"email": email, "name": name, "expect_reply": True})
    return participants


def _duration(start: str, end: str) -> str:
    try:
        start_at = datetime.fromisoformat(start.replace("Z", "+00:00"))
        end_at = datetime.fromisoformat(end.replace("Z", "+00:00"))
        seconds = int((end_at - start_at).total_seconds())
    except (TypeError, ValueError):
        frappe.throw(_("Meet schedule is invalid"), BadRequest)
    if seconds <= 0:
        frappe.throw(_("Meet end must be after start"), BadRequest)
    return f"PT{seconds}S"


@frappe.whitelist(allow_guest=True, methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])
def unknown() -> None:
    raise frappe.DoesNotExistError(_("That Meet address does not exist"))


def _required_text(value: Given, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        frappe.throw(_("Meet argument {0} is required").format(name), BadRequest)
    return value
