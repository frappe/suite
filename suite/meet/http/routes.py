"""REST adapters for Meet creation workflows."""

from __future__ import annotations

from datetime import datetime
from typing import Literal, NotRequired, TypedDict

import frappe
from frappe import _
from frappe.rate_limiter import rate_limit
from frappe.utils import get_system_timezone

from suite.composition.http import BadRequest, Route
from suite.mail.doctype.user_account.user_account import get_user_personal_jmap_account
from suite.meet import links
from suite.meet.api import meeting, recording, recordings, schedule
from suite.meet.doctype.meet_room.meet_room import MeetRoom
from suite.meet.http import shapes

Given = str | int | float | bool | list | dict | None


class CreateRoom(TypedDict):
    type: Literal["open", "restricted"]
    title: NotRequired[str]
    link: NotRequired[str]


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


class RecordingSelection(RoomRef):
    video_enabled: NotRequired[bool]
    transcription_enabled: NotRequired[bool]
    language: NotRequired[Literal["en"]]


class RecordingStart(RecordingSelection):
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


class LinkRef(TypedDict):
    link: str


class LinkAvailability(TypedDict):
    status: links.LinkStatus


ROUTES: tuple[Route, ...] = (
    Route(
        "POST",
        "rooms",
        "rooms_post",
        body=CreateRoom,
        errors=(BadRequest, links.LinkError),
        output=Room,
        kind="mutation",
        public_name="rooms.create",
    ),
    Route(
        "GET",
        "rooms/link-availability",
        "room_link_availability",
        query=LinkRef,
        output=LinkAvailability,
        errors=(frappe.RateLimitExceededError,),
        kind="query",
        public_name="rooms.linkAvailability",
    ),
    Route(
        "POST",
        "scheduled-meetings",
        "scheduled_meetings_post",
        body=ScheduleMeeting,
        errors=(BadRequest,),
        output=ScheduledMeeting,
        kind="mutation",
        public_name="meetings.schedule",
    ),
    # The mounted Meet and Calendar pages still use the original workflow shapes.
    # Route the resource URLs to those same workflows while the pages migrate.
    Route(
        "GET",
        "rooms/preview",
        "room_preview",
        allow_guest=True,
        query=RoomRef,
        output=shapes.Preview,
        kind="query",
        public_name="rooms.preview",
    ),
    Route(
        "GET",
        "rooms/access",
        "room_access",
        allow_guest=True,
        query=RoomRef,
        output=shapes.Access,
        kind="query",
        public_name="rooms.access",
    ),
    Route(
        "POST",
        "rooms/connections",
        "room_connection",
        body=RoomRef,
        output=dict,
        kind="mutation",
        public_name="rooms.connect",
    ),
    Route(
        "GET",
        "rooms/presence-tokens",
        "room_presence_token",
        query=RoomRef,
        output=shapes.PresenceToken,
        kind="query",
        public_name="rooms.presenceToken",
    ),
    Route(
        "POST",
        "rooms/joins",
        "room_join",
        body=RoomRef,
        output=dict,
        kind="mutation",
        public_name="rooms.join",
    ),
    Route(
        "POST",
        "rooms/guest-joins",
        "guest_room_join",
        allow_guest=True,
        body=GuestJoin,
        output=dict,
        kind="mutation",
        public_name="guests.join",
    ),
    Route(
        "POST",
        "rooms/guest-connections",
        "guest_room_connection",
        allow_guest=True,
        body=GuestRoomRef,
        output=dict,
        kind="mutation",
        public_name="guests.connect",
    ),
    Route(
        "POST",
        "rooms/guest-tokens",
        "guest_room_token",
        allow_guest=True,
        body=GuestRoomRef,
        output=dict,
        kind="mutation",
        public_name="guests.refreshToken",
    ),
    Route(
        "POST",
        "rooms/tokens",
        "room_token",
        body=RoomRef,
        output=dict,
        kind="mutation",
        public_name="rooms.refreshToken",
    ),
    Route(
        "POST",
        "e2ee-devices",
        "e2ee_device",
        body=E2EEDevice,
        output=dict,
        kind="mutation",
        public_name="devices.register",
    ),
    Route(
        "GET",
        "recordings/state",
        "recording_state",
        query=RoomRef,
        output=shapes.RecordingState | None,
        kind="query",
        public_name="recordings.get",
    ),
    Route(
        "GET",
        "recordings/preflight",
        "recording_preflight",
        query=RecordingSelection,
        output=shapes.RecordingPreflight,
        kind="query",
        public_name="recordings.preflight",
    ),
    Route(
        "POST",
        "recordings/starts",
        "recording_start",
        body=RecordingStart,
        output=shapes.RecordingCommand | shapes.RejectedRecording,
        kind="mutation",
        public_name="recordings.start",
    ),
    Route(
        "POST",
        "recordings/stops",
        "recording_stop",
        body=RoomRef,
        output=shapes.RecordingCommand | None,
        kind="mutation",
        public_name="recordings.stop",
    ),
    Route(
        "POST",
        "calendar-meetings",
        "calendar_meeting",
        body=CalendarMeeting,
        output=CalendarMeetingResult,
        kind="mutation",
        public_name="meetings.createCalendar",
    ),
    Route(
        "POST",
        "room-links",
        "room_link",
        body=RoomLink,
        output=RoomLinkResult,
        kind="mutation",
        public_name="rooms.createLink",
    ),
    Route(
        "GET",
        "recordings",
        "recording_list",
        output=list[shapes.RecordingSummary],
        kind="query",
        public_name="recordings.list",
    ),
)


@frappe.whitelist(allow_guest=True, methods=["GET"])
def room_preview(meeting_id: str) -> shapes.Preview:
    try:
        return {"title": meeting.get_public_meeting_preview(meeting_id)["title"]}
    except frappe.PermissionError:
        return {"title": ""}


# Reuse the original whitelisted functions so the resource and legacy addresses
# have exactly the same validation, authorization and transaction behavior.
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
recording_list = recordings.get_recordings


@frappe.whitelist(methods=["POST"])
def rooms_post(type: Given = None, title: str | None = None, link: str | None = None) -> Room:
    kind = _required_text(type, "type")
    if kind not in ("open", "restricted"):
        frappe.throw(_("Meet type is invalid"), BadRequest)
    meeting_id = meeting.create(meeting_type=kind, title=title, link=link)
    return {"code": meeting_id, "url": links.meeting_url(meeting_id)}


@frappe.whitelist(methods=["GET"])
@rate_limit(limit=120, seconds=60, user_based=True)
def room_link_availability(link: str) -> LinkAvailability:
    return {"status": links.link_status(link)}


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
    except TypeError, ValueError:
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


# Contract the existing Framework document endpoints without changing dispatch.


def room_document(name: str) -> shapes.RoomDocument:
    doc = frappe.get_doc("Meet Room", name)
    doc.check_permission("read")
    return doc.as_dict()


CONTRACT_ROUTES = (
    Route(
        "GET",
        "/api/v2/document/Meet Room/{name}",
        "room_document",
        output=shapes.RoomDocument,
        kind="query",
        public_name="rooms.get",
    ),
    Route(
        "POST",
        "/api/v2/document/Meet Room/{name}/method/approve_join_request",
        "approve_join_request",
        body=shapes.UserCommand,
        output=shapes.CommandResult,
        kind="mutation",
        public_name="rooms.approve",
    ),
    Route(
        "POST",
        "/api/v2/document/Meet Room/{name}/method/approve_all_join_requests",
        "approve_all_join_requests",
        output=shapes.CommandResult,
        kind="mutation",
        public_name="rooms.approveAll",
    ),
    Route(
        "POST",
        "/api/v2/document/Meet Room/{name}/method/reject_join_request",
        "reject_join_request",
        body=shapes.UserCommand,
        output=shapes.CommandResult,
        kind="mutation",
        public_name="rooms.reject",
    ),
    Route(
        "POST",
        "/api/v2/document/Meet Room/{name}/method/get_waiting_room_details",
        "get_waiting_room_details",
        output=shapes.WaitingRoom,
        kind="query",
        public_name="rooms.waiting",
    ),
    Route(
        "POST",
        "/api/v2/document/Meet Room/{name}/method/ban_guest",
        "ban_guest",
        body=shapes.GuestCommand,
        output=shapes.BanResult,
        kind="mutation",
        public_name="rooms.banGuest",
    ),
    Route(
        "POST",
        "/api/v2/document/Meet Room/{name}/method/promote_to_cohost",
        "promote_to_cohost",
        body=shapes.UserCommand,
        output=shapes.CommandResult,
        kind="mutation",
        public_name="rooms.promote",
    ),
    Route(
        "POST",
        "/api/v2/document/Meet Room/{name}/method/enable_e2ee",
        "enable_e2ee",
        output=bool,
        kind="mutation",
        public_name="rooms.enableEncryption",
    ),
    Route(
        "POST",
        "/api/v2/document/Meet Room/{name}/method/update_settings",
        "update_settings",
        body=shapes.SettingsCommand,
        output=shapes.SettingsResult,
        kind="mutation",
        public_name="rooms.updateSettings",
    ),
)

approve_join_request = MeetRoom.approve_join_request
approve_all_join_requests = MeetRoom.approve_all_join_requests
reject_join_request = MeetRoom.reject_join_request
get_waiting_room_details = MeetRoom.get_waiting_room_details
ban_guest = MeetRoom.ban_guest
promote_to_cohost = MeetRoom.promote_to_cohost
enable_e2ee = MeetRoom.enable_e2ee
update_settings = MeetRoom.update_settings


class MyRoom(TypedDict):
    name: str
    title: str | None
    meeting_type: Literal["open", "restricted"]
    owner: str
    modified: str
    url: str


@frappe.whitelist(methods=["GET"])
def my_rooms() -> list[MyRoom]:
    user = frappe.session.user
    if user == "Guest":
        frappe.throw(_("Authentication required"), frappe.AuthenticationError)
    rooms = frappe.get_all(
        "Meet Room",
        fields=["name", "title", "meeting_type", "owner", "modified"],
        or_filters=schedule.invite_room_filters(user),
        order_by="modified desc",
        limit=3,
    )
    return [
        {
            "name": room.name,
            "title": room.title,
            "meeting_type": room.meeting_type,
            "owner": room.owner,
            "modified": str(room.modified),
            "url": links.meeting_url(room.name),
        }
        for room in rooms
    ]


class RoomSearch(TypedDict):
    q: str


class RoomSummary(TypedDict):
    name: str
    title: str | None


@frappe.whitelist(methods=["GET"])
def room_search(q: str) -> list[RoomSummary]:
    return frappe.get_list(
        "Meet Room",
        fields=["name", "title"],
        or_filters={"name": ["like", f"%{q}%"], "title": ["like", f"%{q}%"]},
        order_by="modified desc",
        limit_page_length=20,
    )


class SetDefaultInviteRoom(TypedDict):
    room: str | None


default_invite_room = schedule.default_invite_room
set_default_invite_room = schedule.set_default_invite_room

ROUTES += (
    Route(
        "GET",
        "rooms/default-invite",
        "default_invite_room",
        output=schedule.DefaultInviteRoom,
        kind="query",
        public_name="rooms.defaultInvite",
    ),
    Route(
        "POST",
        "rooms/default-invite",
        "set_default_invite_room",
        body=SetDefaultInviteRoom,
        output=type(None),
        errors=(frappe.PermissionError,),
        kind="mutation",
        public_name="rooms.setDefaultInvite",
    ),
    Route(
        "GET",
        "rooms/mine",
        "my_rooms",
        output=list[MyRoom],
        kind="query",
        public_name="rooms.mine",
    ),
    Route(
        "GET",
        "rooms/search",
        "room_search",
        query=RoomSearch,
        output=list[RoomSummary],
        kind="query",
        public_name="rooms.search",
    ),
)
