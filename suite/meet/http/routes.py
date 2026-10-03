"""REST adapters for Meet creation workflows."""

from __future__ import annotations

from datetime import datetime
from typing import Literal, NotRequired, TypedDict

import frappe
from frappe import _
from frappe.utils import get_system_timezone, get_url

from suite.composition.http import BadRequest, Route
from suite.mail.doctype.user_account.user_account import get_user_personal_jmap_account
from suite.meet.api import meeting, recording, schedule

Given = str | int | float | bool | list | dict | None


class CreateRoom(TypedDict):
    type: Literal["open", "restricted"]


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


class RoomRef(TypedDict):
    meeting_id: str


class GuestRoomRef(RoomRef):
    guest_id: str
    guest_session_token: str


class GuestJoin(RoomRef):
    guest_name: str
    guest_id: NotRequired[str]
    guest_session_token: NotRequired[str]


class RecordingStart(RoomRef):
    request_id: str


class E2EEDevice(TypedDict):
    device_id: str
    ed25519_public_key: str


class CalendarMeeting(TypedDict):
    account: str
    user: NotRequired[str]
    organizer: NotRequired[str]
    calendar_ids: NotRequired[list[str]]
    status: NotRequired[str]
    draft: NotRequired[bool]
    title: NotRequired[str]
    start: NotRequired[str]
    duration: NotRequired[str]
    time_zone: NotRequired[str]
    recurrence_rule: NotRequired[dict]
    show_without_time: NotRequired[bool]
    participants: NotRequired[list[dict]]
    description: NotRequired[str]
    locations: NotRequired[list[dict]]
    alerts: NotRequired[list[dict]]
    free_busy_status: NotRequired[str]
    privacy: NotRequired[str]
    use_default_alerts: NotRequired[bool]
    send_scheduling_messages: NotRequired[bool]
    meeting_type: NotRequired[str]


class CalendarMeetingResult(TypedDict):
    meeting_id: str
    meeting_url: str
    event_id: str


class RoomLink(TypedDict):
    account: str
    title: NotRequired[str]
    meeting_type: NotRequired[str]


class RoomLinkResult(TypedDict):
    meeting_id: str
    meeting_url: str


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
    # The mounted Meet and Calendar pages still use the original workflow shapes.
    # Route the resource URLs to those same workflows while the pages migrate.
    Route("GET", "rooms/preview", "room_preview", allow_guest=True, query=RoomRef, output=dict),
    Route("GET", "rooms/access", "room_access", allow_guest=True, query=RoomRef, output=dict),
    Route("POST", "rooms/connections", "room_connection", body=RoomRef, output=dict),
    Route("GET", "rooms/presence-tokens", "room_presence_token", query=RoomRef, output=dict),
    Route("POST", "rooms/joins", "room_join", body=RoomRef, output=dict),
    Route("POST", "rooms/guest-joins", "guest_room_join", allow_guest=True, body=GuestJoin, output=dict),
    Route(
        "POST",
        "rooms/guest-connections",
        "guest_room_connection",
        allow_guest=True,
        body=GuestRoomRef,
        output=dict,
    ),
    Route("POST", "rooms/guest-tokens", "guest_room_token", allow_guest=True, body=GuestRoomRef, output=dict),
    Route("POST", "rooms/tokens", "room_token", body=RoomRef, output=dict),
    Route("POST", "e2ee-devices", "e2ee_device", body=E2EEDevice, output=dict),
    Route("GET", "recordings/state", "recording_state", query=RoomRef, output=dict | None),
    Route("GET", "recordings/preflight", "recording_preflight", query=RoomRef, output=dict),
    Route("POST", "recordings/starts", "recording_start", body=RecordingStart, output=dict),
    Route("POST", "recordings/stops", "recording_stop", body=RoomRef, output=dict | None),
    Route(
        "POST", "calendar-meetings", "calendar_meeting", body=CalendarMeeting, output=CalendarMeetingResult
    ),
    Route("POST", "room-links", "room_link", body=RoomLink, output=RoomLinkResult),
)

# Reuse the original whitelisted functions so the resource and legacy addresses
# have exactly the same validation, authorization and transaction behavior.
room_preview = meeting.get_public_meeting_preview
room_access = meeting.check_meeting_access
room_connection = meeting.get_sfu_connection_details
room_presence_token = meeting.get_sfu_presence_preview_token
room_join = meeting.join_meeting
guest_room_join = meeting.join_meeting_as_guest
guest_room_connection = meeting.get_approved_guest_connection_details
guest_room_token = meeting.refresh_guest_sfu_token
room_token = meeting.refresh_sfu_token
e2ee_device = meeting.register_e2ee_device
recording_state = recording.get_state
recording_preflight = recording.get_preflight
recording_start = recording.start
recording_stop = recording.stop
calendar_meeting = schedule.create_scheduled_meeting
room_link = schedule.create_meet_link


@frappe.whitelist(methods=["POST"])
def rooms_post(type: Given = None) -> Room:
    from suite.meet.api.meeting import create as create_meeting

    kind = _required_text(type, "type")
    if kind not in ("open", "restricted"):
        frappe.throw(_("Meet room type is invalid"), BadRequest)
    meeting_id = create_meeting(meeting_type=kind)
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
