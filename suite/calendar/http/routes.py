"""REST adapters for Calendar event windows."""

from __future__ import annotations

import json
from typing import Literal, NotRequired, TypedDict
from urllib.parse import urlparse

import frappe
from frappe import _
from frappe.utils import get_system_timezone, get_url
from pydantic import BaseModel

from suite.calendar.api import (
    create_calendar,
    delete_calendar,
    delete_calendar_event_series_from,
    edit_calendar,
    get_calendar_event_density_with_shared,
    get_calendar_events,
    get_calendar_events_with_shared,
    get_calendars_with_shared,
    rsvp_calendar_event,
    search_calendar_events_with_shared,
    split_calendar_event_series,
)
from suite.calendar.api.invites import add_invite_to_calendar, get_invite_details, rsvp_to_invite
from suite.calendar.doctype.calendar_event.calendar_event import (
    add_calendar_event,
    delete_calendar_event_instance,
    delete_calendar_events,
    update_calendar_event,
    update_calendar_event_instance,
)
from suite.calendar.doctype.calendar_event.fields import EventFields
from suite.composition.http import BadRequest, Route
from suite.mail.doctype.user_account.user_account import (
    get_user_jmap_accounts,
    is_jmap_account_belongs_to_user,
)

Given = str | int | float | bool | list | dict | None


class Conferencing(TypedDict):
    meeting_id: str
    url: str


class EventLink(TypedDict):
    uid: str
    href: str | None
    content_type: str | None


class EventCalendar(TypedDict):
    calendar: str
    calendar_id: str
    calendar_name: str | None
    color: str | None


class Participant(TypedDict):
    uid: str
    roles: dict[str, bool]
    kind: str
    _name: str | None
    email: str
    schedule_id: str | None
    send_to: dict[str, str] | None
    participation_status: str
    expect_reply: Literal[0, 1]
    description: str | None
    comment: str | None
    schedule_agent: str
    member_of: dict[str, bool]
    user_image: NotRequired[str | None]


class CalendarEvent(TypedDict):
    name: str
    account: str
    id: str
    uid: str
    title: str
    start: str
    duration: str
    time_zone: str
    status: str
    description: str
    show_without_time: Literal[0, 1]
    recurrence_id: str | None
    recurrence_rule: str | dict | None
    organizer: str
    calendars: list[EventCalendar]
    created: str | None
    draft: Literal[0, 1]
    recurrence_id_time_zone: str
    privacy: str
    free_busy_status: str
    locations: list[dict]
    alerts: list[dict]
    use_default_alerts: Literal[0, 1]
    created_utc: str
    updated_utc: str
    origin: bool
    may_invite_self: Literal[0, 1]
    may_invite_others: Literal[0, 1]
    hide_attendees: Literal[0, 1]
    creation: str
    modified: str
    sequence: int
    master_id: NotRequired[str]
    master_start: NotRequired[str]
    master_duration: NotRequired[str]
    links: list[EventLink]
    participants: list[Participant]
    conferencing: NotRequired[Conferencing | None]


EventsQuery = TypedDict(
    "EventsQuery",
    {"from": str, "to": str, "account": NotRequired[str]},
)


class CalendarWindow(TypedDict):
    account: str
    from_date: str
    to_date: str
    time_zone: str


class AccountInput(TypedDict):
    account: str


class CalendarRow(TypedDict):
    name: str
    account: str
    id: str
    _name: str
    color: str | None
    default: Literal[0, 1]
    visible: Literal[0, 1]
    may_write_all: Literal[0, 1]
    may_delete: Literal[0, 1]


class CalendarCreate(BaseModel):
    account: str
    name: str
    color: str | None = None


class CalendarUpdate(BaseModel):
    account: str
    id: str
    name: str | None = None
    color: str | None = None
    default: bool = False
    visible: bool | None = None


class CalendarDelete(TypedDict):
    account: str
    id: str


class EventCreate(EventFields):
    # The existing method accepts case-insensitive wire values before parsing,
    # so the contract widens these fields on purpose.
    status: str = "Confirmed"  # type: ignore[assignment]
    privacy: str | None = None  # type: ignore[assignment]
    free_busy_status: str | None = None  # type: ignore[assignment]
    alerts: list[dict] | None = None  # type: ignore[assignment]
    account: str
    send_scheduling_messages: bool = False


class EventUpdate(EventCreate):
    id: str
    uid: str | None = None


class InstanceUpdate(BaseModel):
    account: str
    master_id: str
    recurrence_id: str
    patch: dict
    send_scheduling_messages: bool = False


class SeriesSplit(EventCreate):
    master_id: str
    recurrence_id: str


class InstanceDelete(BaseModel):
    account: str
    master_id: str
    recurrence_id: str
    send_scheduling_messages: bool = False


class EventsDelete(BaseModel):
    account: str
    ids: list[str]
    send_scheduling_messages: bool = False


class EventSearch(BaseModel):
    account: str
    text: str | None = None
    limit: int = 20
    time_zone: str | None = None
    filters: dict | None = None


class DensityRow(TypedDict):
    start: str
    duration: str
    time_zone: str
    show_without_time: Literal[0, 1]
    calendars: list[str]
    is_declined: bool


CONTRACT_ROUTES: tuple[Route, ...] = (
    Route(
        "POST",
        "/api/method/suite.calendar.api.get_calendar_events",
        "get_calendar_events",
        id="calendar.get_calendar_events",
        kind="query",
        public_name="events.window",
        envelope="message",
        query=CalendarWindow,
        output=list[CalendarEvent],
    ),
    Route(
        "POST",
        "/api/method/suite.calendar.api.get_calendars_with_shared",
        "get_calendars_with_shared",
        id="get_calendars_with_shared",
        kind="query",
        public_name="calendars.list",
        envelope="message",
        body=AccountInput,
        output=list[CalendarRow],
        errors=(
            frappe.PermissionError,
            frappe.ValidationError,
        ),
    ),
    Route(
        "POST",
        "/api/method/suite.calendar.api.get_calendar_events_with_shared",
        "get_calendar_events_with_shared",
        id="get_calendar_events_with_shared",
        kind="query",
        public_name="events.sharedWindow",
        envelope="message",
        body=CalendarWindow,
        output=list[CalendarEvent],
        errors=(
            frappe.PermissionError,
            frappe.ValidationError,
        ),
    ),
    Route(
        "POST",
        "/api/method/suite.calendar.api.get_calendar_event_density_with_shared",
        "get_calendar_event_density_with_shared",
        id="get_calendar_event_density_with_shared",
        kind="query",
        public_name="events.density",
        envelope="message",
        body=CalendarWindow,
        output=list[DensityRow],
        errors=(
            frappe.PermissionError,
            frappe.ValidationError,
        ),
    ),
    Route(
        "POST",
        "/api/method/suite.calendar.api.search_calendar_events_with_shared",
        "search_calendar_events_with_shared",
        id="search_calendar_events_with_shared",
        kind="query",
        public_name="events.search",
        envelope="message",
        body=EventSearch,
        output=list[CalendarEvent],
        errors=(
            frappe.PermissionError,
            frappe.ValidationError,
        ),
    ),
    Route(
        "POST",
        "/api/method/suite.calendar.api.create_calendar",
        "create_calendar",
        id="create_calendar",
        kind="mutation",
        public_name="calendars.create",
        envelope="message",
        body=CalendarCreate,
        output=str,
        errors=(
            frappe.PermissionError,
            frappe.ValidationError,
        ),
    ),
    Route(
        "POST",
        "/api/method/suite.calendar.api.edit_calendar",
        "edit_calendar",
        id="edit_calendar",
        kind="mutation",
        public_name="calendars.update",
        envelope="message",
        body=CalendarUpdate,
        output=type(None),
        errors=(
            frappe.PermissionError,
            frappe.ValidationError,
        ),
    ),
    Route(
        "POST",
        "/api/method/suite.calendar.api.delete_calendar",
        "delete_calendar",
        id="delete_calendar",
        kind="mutation",
        public_name="calendars.delete",
        envelope="message",
        body=CalendarDelete,
        output=type(None),
        errors=(
            frappe.PermissionError,
            frappe.ValidationError,
        ),
    ),
    Route(
        "POST",
        "/api/method/suite.calendar.doctype.calendar_event.calendar_event.add_calendar_event",
        "add_calendar_event",
        id="add_calendar_event",
        kind="mutation",
        public_name="events.create",
        envelope="message",
        body=EventCreate,
        output=str,
        errors=(
            frappe.PermissionError,
            frappe.ValidationError,
        ),
    ),
    Route(
        "POST",
        "/api/method/suite.calendar.doctype.calendar_event.calendar_event.update_calendar_event",
        "update_calendar_event",
        id="update_calendar_event",
        kind="mutation",
        public_name="events.update",
        envelope="message",
        body=EventUpdate,
        output=type(None),
        errors=(
            frappe.PermissionError,
            frappe.ValidationError,
        ),
    ),
    Route(
        "POST",
        "/api/method/suite.calendar.doctype.calendar_event.calendar_event.update_calendar_event_instance",
        "update_calendar_event_instance",
        id="update_calendar_event_instance",
        kind="mutation",
        public_name="events.updateInstance",
        envelope="message",
        body=InstanceUpdate,
        output=type(None),
        errors=(
            frappe.PermissionError,
            frappe.ValidationError,
        ),
    ),
    Route(
        "POST",
        "/api/method/suite.calendar.doctype.calendar_event.calendar_event.delete_calendar_events",
        "delete_calendar_events",
        id="delete_calendar_events",
        kind="mutation",
        public_name="events.delete",
        envelope="message",
        body=EventsDelete,
        output=type(None),
        errors=(
            frappe.PermissionError,
            frappe.ValidationError,
        ),
    ),
    Route(
        "POST",
        "/api/method/suite.calendar.doctype.calendar_event.calendar_event.delete_calendar_event_instance",
        "delete_calendar_event_instance",
        id="delete_calendar_event_instance",
        kind="mutation",
        public_name="events.deleteInstance",
        envelope="message",
        body=InstanceDelete,
        output=type(None),
        errors=(
            frappe.PermissionError,
            frappe.ValidationError,
        ),
    ),
    Route(
        "POST",
        "/api/method/suite.calendar.api.split_calendar_event_series",
        "split_calendar_event_series",
        id="split_calendar_event_series",
        kind="mutation",
        public_name="events.splitSeries",
        envelope="message",
        body=SeriesSplit,
        output=str,
        errors=(
            frappe.PermissionError,
            frappe.ValidationError,
        ),
    ),
    Route(
        "POST",
        "/api/method/suite.calendar.api.delete_calendar_event_series_from",
        "delete_calendar_event_series_from",
        id="delete_calendar_event_series_from",
        kind="mutation",
        public_name="events.deleteFollowing",
        envelope="message",
        body=InstanceDelete,
        output=type(None),
        errors=(
            frappe.PermissionError,
            frappe.ValidationError,
        ),
    ),
)


ROUTES = (
    Route(
        "GET",
        "events",
        "events_get",
        errors=(BadRequest, frappe.PermissionError),
        query=EventsQuery,
        output=list[CalendarEvent],
        kind="query",
        public_name="events.list",
    ),
)


@frappe.whitelist(methods=["GET"])
def events_get(to: Given = None, account: Given = None, **kwargs: Given) -> list[CalendarEvent]:
    from_value = _required_text(kwargs.get("from"), "from")
    to_value = _required_text(to, "to")
    if account is None:
        accounts = get_user_jmap_accounts()
    else:
        named = _required_text(account, "account")
        if not is_jmap_account_belongs_to_user(named):
            frappe.throw(_("That Calendar account is not available"), frappe.PermissionError)
        accounts = [named]

    events: list[CalendarEvent] = []
    for account_id in accounts:
        rows = get_calendar_events(account_id, from_value, to_value, get_system_timezone())
        for row in rows:
            row["conferencing"] = _conferencing(row.get("links") or [])
            row["recurrence_rule"] = _recurrence_rule(row.get("recurrence_rule"))
            events.append(row)
    events.sort(
        key=lambda event: (
            event.get("start") or "",
            event.get("account") or "",
            event.get("id") or "",
        )
    )
    return events


def _conferencing(links: list[dict]) -> Conferencing | None:
    site = urlparse(get_url())
    for link in links:
        href = link.get("href")
        if not isinstance(href, str) or not href:
            continue
        parsed = urlparse(href)
        if parsed.netloc and (parsed.scheme, parsed.netloc) != (site.scheme, site.netloc):
            continue
        parts = [part for part in parsed.path.split("/") if part]
        if len(parts) == 2 and parts[0] == "meet" and parts[1]:
            return {"meeting_id": parts[1], "url": href}
    return None


def _recurrence_rule(value: object) -> dict | None:
    """The rule as an object, or None for no rule. The events read hands over the stored
    JSON text for an event whose series it did not resolve, and the parsed object for one
    it did; an empty object means no rule."""

    if isinstance(value, str):
        try:
            value = json.loads(value or "null")
        except ValueError:
            return None
    return value if isinstance(value, dict) and value else None


@frappe.whitelist(allow_guest=True, methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])
def unknown() -> None:
    raise frappe.DoesNotExistError(_("That Calendar address does not exist"))


def _required_text(value: Given, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        frappe.throw(_("Calendar argument {0} is required").format(name), BadRequest)
    return value


class RsvpInput(TypedDict):
    account: str
    id: str
    response: str
    recurrence_id: NotRequired[str | None]


CONTRACT_ROUTES += (
    Route(
        "POST",
        "/api/method/suite.calendar.api.rsvp_calendar_event",
        "rsvp_calendar_event",
        kind="mutation",
        public_name="events.respond",
        body=RsvpInput,
        output=type(None),
        envelope="message",
        errors=(
            frappe.PermissionError,
            frappe.ValidationError,
        ),
    ),
)


class InviteInput(AccountInput):
    blob_id: str


class InviteResponse(InviteInput):
    response: Literal["accepted", "tentative", "declined"]


class ViewerParticipant(TypedDict):
    uid: str
    email: str
    status: str


class InviteDetails(TypedDict):
    uid: str
    method: str
    exists: bool
    event: CalendarEvent
    participant: ViewerParticipant | None


CONTRACT_ROUTES += (
    Route(
        "POST",
        "/api/method/suite.calendar.api.invites.get_invite_details",
        "get_invite_details",
        kind="query",
        public_name="invites.get",
        body=InviteInput,
        output=InviteDetails | None,
        envelope="message",
    ),
    Route(
        "POST",
        "/api/method/suite.calendar.api.invites.add_invite_to_calendar",
        "add_invite_to_calendar",
        kind="mutation",
        public_name="invites.add",
        body=InviteInput,
        output=CalendarEvent,
        envelope="message",
    ),
    Route(
        "POST",
        "/api/method/suite.calendar.api.invites.rsvp_to_invite",
        "rsvp_to_invite",
        kind="mutation",
        public_name="invites.respond",
        body=InviteResponse,
        output=CalendarEvent,
        envelope="message",
    ),
)
