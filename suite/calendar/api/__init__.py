import json

import frappe
from frappe import _

from suite.calendar import jmap_events
from suite.calendar.api.rsvp import record_rsvp
from suite.calendar.doctype.calendar.calendar import fetch_calendars
from suite.calendar.doctype.calendar_event.calendar_event import (
    fetch_calendar_events,
    update_calendar_event,
)
from suite.calendar.doctype.calendar_event.calendar_event import (
    get_calendar_events as get_calendar_events_by_ids,
)
from suite.mail.jmap import get_account_client
from suite.mail.utils.dt import normalize_utc_z
from suite.utils.rate_limiter import dynamic_rate_limit


@frappe.whitelist()
def get_calendars(account: str) -> list[dict[str, str]]:
    """Returns a list of the specified account's calendars."""

    calendars = fetch_calendars(account)

    return [{key: cal[key] for key in ["name", "_name"]} for cal in calendars]


@frappe.whitelist()
def get_calendar_events(account: str, from_date: str, to_date: str, time_zone: str) -> list[dict]:
    """Fetches calendar events between from_date and to_date for the specified account."""

    # The API listens UTC: a naive range value is read as UTC, not system time.
    events = fetch_calendar_events(
        account,
        {"after": normalize_utc_z(from_date), "before": normalize_utc_z(to_date)},
        limit=999,
        time_zone=time_zone,
        expand_recurrences=True,
    )[0]

    enrich_events_with_master_data(account, events)
    enrich_participants_with_avatars(events)

    return events


def enrich_events_with_master_data(account: str, events: list[dict]) -> None:
    """Attaches recurrence/master info to each event in-place.

    Masters are resolved through baseEventId rather than a uid query: the uid filter runs on
    the server's search index, which is updated asynchronously, so a query-based lookup misses
    events created moments ago — leaving them without a master_id (so the frontend falls back
    to the synthetic id, which cannot be updated or deleted) and with an unparsed
    recurrence_rule string until the index catches up."""

    if not events:
        return

    base_ids = jmap_events.get_base_event_ids(get_account_client(account), [event["id"] for event in events])
    if not base_ids:
        return

    masters = {
        master["id"]: master for master in get_calendar_events_by_ids(account, sorted(set(base_ids.values())))
    }

    for event in events:
        master = masters.get(base_ids.get(event["id"]))
        if not master:
            continue

        event.update(
            {
                "recurrence_rule": json.loads(master["recurrence_rule"]),
                "master_id": master["id"],
                "master_start": master["start"],
                "master_duration": master["duration"],
            }
        )


def enrich_participants_with_avatars(events: list[dict]) -> None:
    """Attaches user_image to each participant in-place."""
    unique_emails = list(
        dict.fromkeys(
            participant["email"]
            for event in events
            for participant in event["participants"]
            if participant.get("email")
        )
    )
    if not unique_emails:
        return

    user_data = frappe.db.get_all(
        "User", filters={"name": ["in", list(unique_emails)]}, fields=["name", "user_image"]
    )
    # Only actual profile pictures — no Gravatar fallback, so participants
    # without one render as initials in the frontend.
    user_images = {u.name: u.user_image for u in user_data if u.user_image}

    for event in events:
        for participant in event["participants"]:
            email = participant.get("email")
            if user_images.get(email):
                participant["user_image"] = user_images[email]


def _with_name(items: list[dict] | None) -> list[dict] | None:
    """Map the formatter's ``_name`` onto the ``name`` key the event payload builders read.

    format_calendar_event emits locations and participants with ``_name`` (the desk field name) and
    the frontend echoes that shape straight back. The payload builders read ``name``, so without
    this every edit rewrote location names as null and replaced each participant's display name
    with their email address - including on partial patches that never mentioned those fields.
    """

    if not items:
        return items

    return [
        {**item, "name": item["_name"]} if "name" not in item and "_name" in item else item for item in items
    ]


@frappe.whitelist()
@dynamic_rate_limit()
def rsvp_calendar_event(account: str, id: str, response: str) -> None:
    """Records the logged-in user's RSVP (accepted / declined / tentative) on the event.

    Patches only the caller's own participationStatus — unlike edit_calendar_event, which
    rewrites the whole event — and routes the organizer's notification through the custom
    event_response template when custom event invites are enabled (see record_rsvp)."""

    record_rsvp(account, id, response)


@frappe.whitelist()
@dynamic_rate_limit()
def edit_calendar_event(account: str, id: str, **kwargs) -> None:
    events = get_calendar_events_by_ids(account, [id])
    if not events:
        frappe.throw(_("Calendar Event {0} not found.").format(frappe.bold(id)), frappe.DoesNotExistError)

    event = events[0]

    def resolve(key):
        return kwargs[key] if key in kwargs else event[key]

    calendar_ids = (
        kwargs["calendar_ids"]
        if "calendar_ids" in kwargs
        else [calendar["calendar_id"] for calendar in event["calendars"]]
    )

    update_calendar_event(
        account,
        id,
        event["uid"],
        event["organizer"],
        calendar_ids,
        resolve("status"),
        resolve("draft"),
        resolve("title"),
        resolve("start"),
        resolve("duration"),
        resolve("time_zone"),
        json.loads(resolve("recurrence_rule")),
        resolve("show_without_time"),
        resolve("privacy"),
        resolve("free_busy_status"),
        resolve("description"),
        _with_name(resolve("locations")),
        resolve("links"),
        _with_name(resolve("participants")),
        resolve("alerts"),
        resolve("use_default_alerts"),
        kwargs.get("send_scheduling_messages", False),
    )
