"""Searching the calendars this site keeps, beside the mail server's own search.

The rows answer in the shape `external.events_in_window` draws, so the calendar's search
sorts, cuts and opens them as it does the mail server's.
"""

from datetime import datetime, timedelta
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import frappe
from frappe.utils import get_datetime, now_datetime

from suite.calendar.external import calendars_for, event_row, occurrences, stored_events
from suite.mail.utils.dt import normalize_utc_z
from suite.utils.dt import utcnow

if TYPE_CHECKING:
    from suite.calendar.api import EventSearchFilters

# How many of a yearly event's occurrences a search answers with, nearest today first, and how
# far ahead it looks for them: what the mail server's series get (the API's RECURRENCE_INSTANCES
# and RECURRENCE_HORIZON_YEARS), so a birthday reads in a search the way a standup does.
SEARCH_INSTANCES = 3
SEARCH_HORIZON_YEARS = 3


def search(
    user: str,
    text: str | None,
    limit: int,
    filters: EventSearchFilters,
    time_zone: str | None,
    calendars: list[str] | None = None,
) -> list[dict]:
    """The matches for the calendar app's search among the calendars this site keeps for `user`,
    as `search_events` answers them.

    Nobody is on these events, so a search by attendee or organizer finds none here. The range
    arrives as UTC instants bounding the reader's days, and these events are days with no time,
    so each end is read back as the reader's wall clock first: compared as an instant, a reader
    east of UTC asking for one day would also be answered the day before.
    """

    if filters.attendee.strip() or filters.organizer.strip():
        return []

    try:
        zone = ZoneInfo(time_zone or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        zone = ZoneInfo("UTC")

    def wall_clock(value: str) -> datetime | None:
        if not value:
            return None
        instant = datetime.fromisoformat(normalize_utc_z(value).replace("Z", "+00:00"))
        return instant.astimezone(zone).replace(tzinfo=None)

    return search_events(
        user,
        (text or "").split(),
        limit,
        title_only=filters.scope == "title",
        calendars=calendars,
        start=wall_clock(filters.after),
        end=wall_clock(filters.before),
    )


def search_events(
    user: str,
    words: list[str],
    limit: int,
    title_only: bool = False,
    calendars: list[str] | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
) -> list[dict]:
    """The events on the calendars drawn for `user` that carry every word — all of them, for no
    words — as the rows a search answers with: the shape `events_in_window` hands over, so they
    sort, cut and open alike.

    A dated event answers as itself, wherever it falls. A yearly one answers as its occurrences
    inside `start` and `end` where both are given, and otherwise as the few nearest today on
    either side — last year's, this year's, next year's — since that is what a reader looking for
    a birthday means. Either bound alone still holds. The bounds are the reader's wall clock,
    as `search` reads them.

    `calendars` narrows to those, and never past what the user is drawn: a calendar named by
    someone it is not for answers nothing. At most `limit` events answer, nearest today first
    with a yearly event counting as today, the way the API ranks a series before it expands it
    — chosen among the events in the range, where there is one, so a holiday inside it is not
    crowded out by birthdays outside it that rank nearer.
    """

    drawn = {calendar.name: calendar for calendar in calendars_for(user)}
    if calendars is not None:
        drawn = {name: drawn[name] for name in calendars if name in drawn}
    if not drawn:
        return []

    now = now_datetime()
    windowed = bool(start and end)
    since = start or now - timedelta(days=367)
    until = end or now + timedelta(days=366 * SEARCH_HORIZON_YEARS)

    found = []
    for row in _rows_carrying(list(drawn), words, title_only, start, end):
        days = occurrences(row, since, until)
        if row.repeats and not windowed:
            days.sort(key=lambda day: abs(day - now.date()))
            del days[SEARCH_INSTANCES:]
        if days:
            found.append((row, days))

    found.sort(
        key=lambda pair: timedelta(0) if pair[0].repeats else abs(get_datetime(pair[0].starts_on) - now)
    )
    del found[limit:]

    stamp = utcnow()
    return [event_row(drawn[row.calendar], row, day, stamp) for row, days in found for day in days]


def _rows_carrying(
    calendars: list[str],
    words: list[str],
    title_only: bool,
    start: datetime | None = None,
    end: datetime | None = None,
) -> list[frappe._dict]:
    """The stored events on `calendars` that can reach the bounds, whose title — or notes,
    unless the title alone was asked — carries every one of `words`; every such event, for none."""

    event = frappe.qb.DocType("External Calendar Event")
    query = stored_events(calendars, start, end)
    for word in words:
        carries = event.title.like(f"%{word}%")
        if not title_only:
            carries = carries | event.description.like(f"%{word}%")
        query = query.where(carries)
    return query.run(as_dict=True)
