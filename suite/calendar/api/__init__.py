import json

import frappe
from frappe import _

from suite.calendar.api.rsvp import record_rsvp
from suite.calendar.doctype.calendar.calendar import ensure_default_alerts, fetch_calendars
from suite.calendar.doctype.calendar_event.calendar_event import (
    fetch_calendar_events,
    update_calendar_event,
)
from suite.calendar.doctype.calendar_event.calendar_event import (
    get_calendar_events as get_calendar_events_by_ids,
)
from suite.mail.jmap import get_calendar_event_service
from suite.mail.utils.dt import normalize_utc_z
from suite.utils.rate_limiter import dynamic_rate_limit


@frappe.whitelist()
def get_calendars(account: str) -> list[dict[str, str]]:
    """Returns a list of the specified account's calendars."""

    ensure_default_alerts(account)
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


# What an occurrence inherits from its series, as (our name, the JMAP name the override uses).
#
# An occurrence that carries a recurrence override comes back from Stalwart 0.16.20 with the
# structural half merged — uid, zone, calendars, organizer, participants — and this half
# dropped, plus a duration invented to run to the end of the day. RFC 8984 reads an override as
# a patch over the series, so the series is what these should say unless the override says
# otherwise. Applying that here is the whole of the workaround; delete it, and the test that
# pins it, once the server merges them itself.
INHERITED_FROM_SERIES = (
    ("title", "title"),
    ("description", "description"),
    ("duration", "duration"),
    ("privacy", "privacy"),
    ("free_busy_status", "freeBusyStatus"),
    ("status", "status"),
    ("show_without_time", "showWithoutTime"),
    ("locations", "locations"),
    ("links", "links"),
    ("alerts", "alerts"),
    ("use_default_alerts", "useDefaultAlerts"),
)


def enrich_events_with_master_data(account: str, events: list[dict]) -> None:
    """Attaches recurrence/master info to each event in-place, and what its series says about it.

    Masters are resolved through baseEventId rather than a uid query: the uid filter runs on
    the server's search index, which is updated asynchronously, so a query-based lookup misses
    events created moments ago — leaving them without a master_id (so the frontend falls back
    to the synthetic id, which the server renumbers as overrides land) and with an unparsed
    recurrence_rule string until the index catches up."""

    if not events:
        return

    service = get_calendar_event_service(account)
    base_ids = service.get_base_event_ids([event["id"] for event in events])
    if not base_ids:
        return

    master_ids = sorted(set(base_ids.values()))
    # The raw copies carry recurrenceOverrides, which the formatter drops — and the override is
    # the only thing that says which properties an occurrence owns rather than inherits.
    overrides = {master["id"]: master.get("recurrenceOverrides") or {} for master in service.get(master_ids)}
    masters = {master["id"]: master for master in get_calendar_events_by_ids(account, master_ids)}

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

        if not event.get("recurrence_id"):
            continue

        # Only where the series actually carries an override for this date. An occurrence the
        # server keeps as its own object — or one whose series has lost its rule — is not a
        # patch over anything, and reading the series onto it would replace what it does say
        # with what the series does not.
        override = overrides.get(master["id"], {}).get(event["recurrence_id"])
        if not override:
            continue

        # A patch names its property first, whether it replaces the whole thing ("title") or
        # reaches inside it ("participants/<uid>/participationStatus").
        owned = {key.split("/")[0] for key in override}
        for name, jmap_name in INHERITED_FROM_SERIES:
            if jmap_name not in owned:
                event[name] = master[name]


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
    """Map the formatter's ``_name`` onto the ``name`` key CalendarEventService reads.

    format_calendar_event emits locations and participants with ``_name`` (the desk field name) and
    the frontend echoes that shape straight back. The service reads ``name``, so without this every
    edit rewrote location names as null and replaced each participant's display name with their
    email address - including on partial patches that never mentioned those fields.
    """

    if not items:
        return items

    return [
        {**item, "name": item["_name"]} if "name" not in item and "_name" in item else item for item in items
    ]


@frappe.whitelist()
@dynamic_rate_limit()
def rsvp_calendar_event(account: str, id: str, response: str, recurrence_id: str | None = None) -> None:
    """Records the logged-in user's RSVP (accepted / declined / tentative) on the event.

    Patches only the caller's own participationStatus — unlike edit_calendar_event, which
    rewrites the whole event — and routes the organizer's notification through the custom
    event_response template when custom event invites are enabled (see record_rsvp)."""

    record_rsvp(account, id, response, recurrence_id=recurrence_id)


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
