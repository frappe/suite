from __future__ import annotations

import json
from typing import Literal, TypedDict

import frappe
from frappe import _

from suite.calendar.doctype.calendar_event.calendar_event import add_calendar_event
from suite.mail.doctype.user_account.user_account import is_jmap_account_belongs_to_user
from suite.meet.api.meeting import create as create_meeting
from suite.meet.doctype.meet_room.meet_room import MeetRoom
from suite.meet.links import meeting_url

DEFAULT_INVITE_ROOM = "meet_default_invite_room"
# Rooms the user has made their default before, newest first. Calendar offers them
# beside the current default, so a room joins the list by once being the default.
PAST_INVITE_ROOMS = "meet_past_invite_rooms"
PAST_INVITE_ROOMS_KEPT = 3


class InviteRoom(TypedDict):
    room: str
    title: str | None
    meeting_url: str


class DefaultInviteRoom(TypedDict):
    room: str | None
    meeting_url: str | None
    # The default first, then up to three rooms that were the default before.
    rooms: list[InviteRoom]


def _invite_user() -> str:
    user = frappe.session.user
    if user == "Guest":
        frappe.throw(_("Authentication required"), frappe.AuthenticationError)
    return user


def _can_use_invite_room(room: str, user: str) -> bool:
    try:
        doc: MeetRoom = frappe.get_doc("Meet Room", room)
    except frappe.DoesNotExistError:
        return False
    return doc.is_host_or_cohost(user)


def _past_invite_rooms(user: str) -> list[str]:
    stored = frappe.defaults.get_defaults_for(user).get(PAST_INVITE_ROOMS)
    try:
        rooms = json.loads(stored) if stored else []
    except ValueError:
        return []
    return [room for room in rooms if isinstance(room, str)] if isinstance(rooms, list) else []


def _invite_room(room: str) -> InviteRoom:
    return {
        "room": room,
        "title": frappe.db.get_value("Meet Room", room, "title"),
        "meeting_url": meeting_url(room),
    }


@frappe.whitelist(methods=["GET"])
def default_invite_room() -> DefaultInviteRoom:
    user = _invite_user()
    stored = frappe.defaults.get_defaults_for(user).get(DEFAULT_INVITE_ROOM)
    default = stored if stored and _can_use_invite_room(stored, user) else None
    past = [
        room for room in _past_invite_rooms(user) if room != default and _can_use_invite_room(room, user)
    ][:PAST_INVITE_ROOMS_KEPT]
    return {
        "room": default,
        "meeting_url": meeting_url(default) if default else None,
        "rooms": [_invite_room(room) for room in ([default] if default else []) + past],
    }


@frappe.whitelist(methods=["POST"])
def set_default_invite_room(room: str | None = None) -> None:
    user = _invite_user()
    if room is not None and not _can_use_invite_room(room, user):
        frappe.throw(_("Choose a meet you own or co-host."), frappe.PermissionError)

    # Serialize writes even when the user has no preference row yet.
    frappe.db.get_value("User", user, "name", for_update=True)
    previous = frappe.defaults.get_defaults_for(user).get(DEFAULT_INVITE_ROOM)
    frappe.defaults.set_user_default(DEFAULT_INVITE_ROOM, room, user)
    if previous and previous != room:
        past = [previous, *(r for r in _past_invite_rooms(user) if r not in (previous, room))]
        frappe.defaults.set_user_default(PAST_INVITE_ROOMS, json.dumps(past[:PAST_INVITE_ROOMS_KEPT]), user)


@frappe.whitelist(methods=["POST"])
def create_scheduled_meeting(
    account: str,
    user: str | None = None,
    organizer: str | None = None,
    calendar_ids: list[str] | None = None,
    status: Literal["Tentative", "Confirmed", "Cancelled"] = "Confirmed",
    draft: bool = False,
    title: str | None = None,
    start: str | None = None,
    duration: str | None = None,
    time_zone: str | None = None,
    recurrence_rule: dict | None = None,
    show_without_time: bool = False,
    participants: list[dict] | None = None,
    description: str | None = None,
    locations: list[dict] | None = None,
    alerts: list[dict] | None = None,
    free_busy_status: str | None = "Busy",
    privacy: str | None = None,
    use_default_alerts: bool = False,
    send_scheduling_messages: bool = False,
    meeting_type: str = "open",
) -> dict[str, str]:
    """Create a Meet room and attach it to a calendar event."""
    del user

    is_jmap_account_belongs_to_user(account, raise_exception=True)

    meeting_id = create_meeting(meeting_type=meeting_type, title=title)
    meet_url = meeting_url(meeting_id)

    # The meet link is attached as a structured event link (see `links=` below), which is what
    # the UI's "Join Frappe Meet" button, the invite email's Meet card, and the exported .ics URL
    # all read from. So it is deliberately NOT injected into the description.
    # An omitted organizer resolves to the account's default participant identity in the JMAP
    # layer, same as a plain calendar event.
    event_id = add_calendar_event(
        account=account,
        organizer=organizer,
        calendar_ids=calendar_ids,
        status=status,
        draft=draft,
        title=title,
        start=start,
        duration=duration,
        time_zone=time_zone,
        recurrence_rule=recurrence_rule,
        show_without_time=show_without_time,
        free_busy_status=free_busy_status,
        privacy=privacy,
        description=description,
        locations=locations,
        links=[{"href": meet_url, "content_type": "text/html"}],
        participants=participants,
        alerts=alerts,
        use_default_alerts=use_default_alerts,
        send_scheduling_messages=send_scheduling_messages,
    )
    frappe.db.set_value("Meet Room", meeting_id, "calendar_event", f"{account}|{event_id}")

    return {"meeting_id": meeting_id, "meeting_url": meet_url, "event_id": event_id}


@frappe.whitelist(methods=["POST"])
def create_meet_link(account: str, title: str | None = None, meeting_type: str = "open") -> dict[str, str]:
    """Create a Meet room and return its link, for attaching to an existing calendar event."""

    is_jmap_account_belongs_to_user(account, raise_exception=True)

    meeting_id = create_meeting(meeting_type=meeting_type, title=title)
    return {"meeting_id": meeting_id, "meeting_url": meeting_url(meeting_id)}
