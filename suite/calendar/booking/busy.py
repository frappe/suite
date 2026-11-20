"""When a host is busy, from their own events (specs/calendar/002-availability.md).

Read here rather than asked of the mail server's `Principal/getAvailability`: Stalwart 0.16.20
counts an event the host declined as busy, leaves out an event with nobody on it from a calendar
set to count only what its owner attends, and runs an all-day event on UTC days rather than the
host's. So Suite reads the host's events and applies the 002 rules itself, as the event form does
(`frontend/src/apps/calendar/utils/availability.ts`).

Only start and end leave this module: what the host is doing stays here (003 §Free time).
"""

from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import frappe
import isodate
from frappe.utils import get_system_timezone

from suite.calendar.booking.slots import Host, Span

QUERY_MARGIN = timedelta(days=1)


@dataclass(frozen=True)
class HostEvents:
    """What the mail server holds for a host, as the calendar app reads it."""

    account: str
    events: Sequence[Mapping]
    # Each of the account's calendars (`account|id`) and its "include in availability".
    include_in_availability: Mapping[str, str]
    own_emails: frozenset[str]


def busy_spans(host: Host, start: datetime, end: datetime) -> list[Span]:
    """The stretches of [start, end) the host's own events make busy, earliest first."""

    zone = host_zone(host.user)
    held = read_host_events(host, start, end)
    spans = [event_span(event, zone) for event in held.events if makes_busy(event, held)]
    return sorted((span for span in spans if span.end > start and span.start < end), key=lambda s: s.start)


def host_zone(user: str) -> ZoneInfo:
    return ZoneInfo(frappe.db.get_value("User", user, "time_zone") or get_system_timezone())


def read_host_events(host: Host, start: datetime, end: datetime) -> HostEvents:
    """The host's events in the window, every occurrence of a series on its own, with the
    account's calendars and addresses. This is the mail-server boundary.

    The busy time is the host's own account: the one their bookings go to, which the page has
    checked is theirs. A calendar shared with them lives in its owner's account and is not read.
    The reads run as the host, since a booker is a guest who holds no mail account to read with,
    and the session is put back however they end.
    """

    from suite.calendar.api import (
        MAX_CALENDARS,
        _events_in_window,
        _own_emails,
        enrich_events_with_master_data,
    )
    from suite.calendar.doctype.calendar.calendar import fetch_calendars

    account = host.calendar.partition("|")[0]
    with _acting_as(host.user):
        # Stalwart 0.16.20 reads a query's ends as wall-clock times in its `timeZone`, so the
        # window is asked in UTC. A day either side catches a floating or all-day event, whose
        # place depends on the host's zone; `busy_spans` cuts the answer to the window.
        events = _events_in_window(account, _utc(start - QUERY_MARGIN), _utc(end + QUERY_MARGIN), "UTC")
        # An occurrence moved on its own comes back without its series' status, availability
        # and guests; this puts them back, as for the calendar grid.
        enrich_events_with_master_data(account, events)
        calendars = fetch_calendars(account, limit=MAX_CALENDARS)
        own_emails = _own_emails(account)

    return HostEvents(
        account=account,
        events=events,
        include_in_availability={c["name"]: c.get("include_in_availability") or "All" for c in calendars},
        own_emails=frozenset(own_emails),
    )


@contextmanager
def _acting_as(user: str) -> Iterator[None]:
    """Run as `user`, then put the request's own session back as it was.

    `frappe.set_user` empties the session's data and the form dict, which a signed-in visitor's
    request still needs after the read, so both are kept aside and restored.
    """

    local = frappe.local
    caller, sid, data, form_dict = local.session.user, local.session.sid, local.session.data, local.form_dict
    frappe.set_user(user)
    try:
        yield
    finally:
        frappe.set_user(caller)
        local.session.sid, local.session.data, local.form_dict = sid, data, form_dict


def makes_busy(event: Mapping, held: HostEvents) -> bool:
    """Whether an event takes the host's time, wherever it falls (002 §Your own conflicts)."""

    if event.get("account") != held.account:
        return False
    if event.get("status") == "Cancelled":
        return False
    # JMAP reads an event that does not say as busy.
    if event.get("free_busy_status") == "Free":
        return False
    if any(
        p.get("participation_status") == "DECLINED" and _address(p.get("email")) in held.own_emails
        for p in event.get("participants") or []
    ):
        return False
    return _counted_by_calendar(event, held)


def _counted_by_calendar(event: Mapping, held: HostEvents) -> bool:
    rules = [held.include_in_availability.get(c.get("calendar"), "All") for c in event.get("calendars") or []]
    if not rules or "All" in rules:
        return True
    if "Attending" not in rules:
        return False
    # Counting only what the owner attends still counts an event with nobody on it.
    participants = event.get("participants") or []
    return not participants or _is_on(event, held.own_emails)


def _is_on(event: Mapping, own_emails: frozenset[str]) -> bool:
    return _address(event.get("organizer")) in own_emails or any(
        _address(p.get("email")) in own_emails for p in event.get("participants") or []
    )


def event_span(event: Mapping, zone: ZoneInfo) -> Span:
    """When an event takes place. A timed event is read in its own zone, a floating one in the
    host's; an all-day event runs from the start of its first day to the start of the day after
    its last, on the host's days."""

    duration = isodate.parse_duration(event.get("duration") or "PT0S")
    wall_clock = datetime.fromisoformat(event["start"])
    if _is_all_day(event, wall_clock, duration):
        first = wall_clock.date()
        return Span(_midnight(first, zone), _midnight(first + _days_touched(wall_clock, duration), zone))

    start = wall_clock.replace(tzinfo=_zone_or(event.get("time_zone"), zone)).astimezone(UTC)
    return Span(start, start + duration)


def _is_all_day(event: Mapping, wall_clock: datetime, duration) -> bool:
    """As the calendar draws one: shown without a time, or a whole number of days from midnight."""

    if event.get("show_without_time"):
        return True
    whole_days = (
        isinstance(duration, timedelta) and duration >= timedelta(days=1) and not duration % timedelta(days=1)
    )
    return whole_days and wall_clock.time() == datetime.min.time()


def _days_touched(start: datetime, duration) -> timedelta:
    """How many days an all-day event covers: at least one, and any part of a day is the day."""

    length = duration if isinstance(duration, timedelta) else duration.totimedelta(start=start)
    return timedelta(days=max(1, -(-length // timedelta(days=1))))


def _zone_or(name: str | None, fallback: ZoneInfo) -> ZoneInfo:
    """The event's own zone, or the host's for a floating event or a zone this server lacks."""

    try:
        return ZoneInfo(name) if name else fallback
    except (ZoneInfoNotFoundError, ValueError):
        return fallback


def _midnight(day: date, zone: ZoneInfo) -> datetime:
    return datetime(day.year, day.month, day.day, tzinfo=zone).astimezone(UTC)


def _utc(instant: datetime) -> str:
    return instant.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _address(value: str | None) -> str:
    return (value or "").lower().removeprefix("mailto:")
