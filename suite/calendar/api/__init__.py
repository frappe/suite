import json
from datetime import datetime, timedelta

import frappe
from dateutil.rrule import rrulestr
from frappe import _
from frappe.utils import cint
from icalendar.prop import vRecur

from suite.calendar.api.rsvp import record_rsvp
from suite.calendar.doctype.calendar.calendar import ensure_default_alerts, fetch_calendars
from suite.calendar.doctype.calendar_event.calendar_event import (
    add_calendar_event,
    fetch_calendar_events,
    update_calendar_event,
)
from suite.calendar.doctype.calendar_event.calendar_event import (
    get_calendar_events as get_calendar_events_by_ids,
)
from suite.calendar.doctype.calendar_exchange.calendar_exchange import _build_recurrence_rule
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


def enrich_events_with_master_data(account: str, events: list[dict]) -> None:
    """Attaches recurrence/master info to each event in-place.

    Masters are resolved through baseEventId rather than a uid query: the uid filter runs on
    the server's search index, which is updated asynchronously, so a query-based lookup misses
    events created moments ago — leaving them without a master_id (so the frontend falls back
    to the synthetic id, which cannot be updated or deleted) and with an unparsed
    recurrence_rule string until the index catches up."""

    if not events:
        return

    base_ids = get_calendar_event_service(account).get_base_event_ids([event["id"] for event in events])
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
    event_response template when custom event invites are enabled (see record_rsvp).

    `recurrence_id` answers for that occurrence alone; without one the answer is the series'."""

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


# The fields a series carries, and the only keys forwarded from a split request. A whitelisted
# function taking **kwargs is handed the whole form, `cmd` included, so the new series is built
# from a named list rather than from whatever arrived.
SERIES_FIELDS = (
    "organizer",
    "calendar_ids",
    "status",
    "draft",
    "title",
    "start",
    "duration",
    "time_zone",
    "recurrence_rule",
    "show_without_time",
    "privacy",
    "free_busy_status",
    "description",
    "locations",
    "links",
    "participants",
    "alerts",
    "use_default_alerts",
)


@frappe.whitelist()
@dynamic_rate_limit()
def split_calendar_event_series(
    account: str,
    master_id: str,
    recurrence_id: str,
    send_scheduling_messages: bool = False,
    **kwargs,
) -> str:
    """Applies an edit to one occurrence of a series and to every occurrence after it.

    JSCalendar has no way to say "from here on": a recurrence rule runs from the event's start,
    and an override speaks for a single date. So the series is cut in two — the original stops
    just before this occurrence, and the edit becomes a new series starting at it. Every calendar
    that offers "this and following" does it this way, and it is why the occurrences before the
    split keep the old title, the old time and their own overrides.

    Occurrences after the split that had been edited on their own keep those edits only when the
    new series still falls on their dates; move the series and they are drawn by the new rule
    like every other occurrence, since there is no date left to hang them on.

    Returns the id of the series that now owns this occurrence.
    """

    events = get_calendar_events_by_ids(account, [master_id])
    if not events:
        frappe.throw(
            _("Calendar Event {0} not found.").format(frappe.bold(master_id)), frappe.DoesNotExistError
        )

    master = events[0]
    rule = json.loads(master["recurrence_rule"] or "{}")
    if not rule:
        frappe.throw(_("This event does not repeat, so there is nothing following it."))

    fields = {key: value for key, value in kwargs.items() if key in SERIES_FIELDS}
    # A series edited from one of its occurrences keeps the calendars the series is in; the form
    # never names them, and without this the new half would land in the default calendar.
    if not fields.get("calendar_ids"):
        fields["calendar_ids"] = [calendar["calendar_id"] for calendar in master.get("calendars") or []]
    fields.setdefault("organizer", master.get("organizer"))

    before = _occurrences_before(rule, master["start"], recurrence_id)
    # A counted series can only be split by sharing the count out, so a rule that cannot be
    # expanded cannot be split — better said than silently turned into two full-length series.
    if rule.get("count") is not None and before is None:
        frappe.throw(_("This event's repeat rule could not be read, so it cannot be split here."))

    # Splitting at the first occurrence cuts nothing off: there is no earlier part to keep, so
    # this is the whole series changing rather than a series becoming two.
    if before == 0 or recurrence_id == master["start"]:
        update_calendar_event(
            account,
            master_id,
            master["uid"],
            fields.pop("organizer", None),
            fields.pop("calendar_ids", None),
            send_scheduling_messages=send_scheduling_messages,
            **fields,
        )
        return master_id

    head_rule = dict(rule)
    if rule.get("count") is not None:
        # A counted series stays counted: the occurrences that already happened are its whole run.
        head_rule["count"] = before
    else:
        head_rule["until"] = _moment_before(recurrence_id)

    edit_calendar_event(
        account,
        master_id,
        recurrence_rule=json.dumps(head_rule),
        send_scheduling_messages=send_scheduling_messages,
    )

    # Overrides the rule no longer generates are not dropped with it — RFC 8984 reads an override
    # on an ungenerated date as an occurrence in its own right, so leaving them would keep every
    # edited occurrence after the split visible on the old series, beside the new one.
    service = get_calendar_event_service(account)
    stored = service.get([master_id])
    overrides = (stored[0] if stored else {}).get("recurrenceOverrides") or {}
    tail_overrides = {
        rid: override for rid, override in overrides.items() if not _is_before(rid, recurrence_id)
    }
    if tail_overrides:
        service.remove_overrides(master_id, list(tail_overrides))

    # The new half takes what is left of a count; an `until` needs no adjusting, since it names
    # a date the new half runs to just as the old one did.
    tail_rule = dict(fields.get("recurrence_rule") or rule)
    if rule.get("count") is not None:
        tail_rule["count"] = max(cint(rule["count"]) - before, 1)
    fields["recurrence_rule"] = tail_rule

    new_id = add_calendar_event(account, send_scheduling_messages=send_scheduling_messages, **fields)

    # Only when the new series falls on the same dates — an occurrence's override is addressed by
    # its date, and a series that moved has none of them left.
    if tail_overrides and fields.get("start") == recurrence_id:
        service.set_overrides(new_id, tail_overrides)

    return new_id


def _occurrences_before(rule: dict, start: str, recurrence_id: str) -> int | None:
    """How many of a series' occurrences fall before the given one, or None if it can't be told.

    Expanded locally rather than asked of the server: the answer is needed while the series is
    still whole, and only to split a `count` between the two halves.
    """

    try:
        recur = _build_recurrence_rule(rule)
        if not recur:
            return None

        first = _local(start)
        split = _local(recurrence_id)
        occurrences = rrulestr(f"RRULE:{vRecur(recur).to_ical().decode()}", dtstart=first)
        # A bounded window, so an endless rule still answers.
        return len(occurrences.between(first - timedelta(seconds=1), split, inc=False))
    except Exception:
        return None


def _moment_before(recurrence_id: str) -> str:
    """The LocalDateTime a second before an occurrence — where a truncated rule stops."""

    return (_local(recurrence_id) - timedelta(seconds=1)).strftime("%Y-%m-%dT%H:%M:%S")


def _is_before(recurrence_id: str, split: str) -> bool:
    """Whether one occurrence's date falls before another's."""

    try:
        return _local(recurrence_id) < _local(split)
    except ValueError:
        return recurrence_id < split


def _local(value: str) -> datetime:
    """A JSCalendar LocalDateTime as a naive datetime — the zone is the event's, and the same
    for every date being compared here."""

    return datetime.fromisoformat(value.replace("Z", ""))
