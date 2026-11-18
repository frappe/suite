"""Searching the calendars this site keeps, beside the mail server's own search.

The rows answer in the shape `external.events_in_window` draws, so the calendar's search
sorts, cuts and opens them as it does the mail server's.
"""

from datetime import datetime, timedelta

import frappe
from frappe.utils import get_datetime, now_datetime

from suite.calendar.external import (
    EVENT_FIELDS,
    _calendars_for,
    _days_between,
    _event_row,
    _occurrences,
)
from suite.utils.dt import utcnow

# How many of a yearly event's occurrences a search answers with, nearest today first, and how
# far ahead it looks for them: what the mail server's series get (the API's RECURRENCE_INSTANCES
# and RECURRENCE_HORIZON_YEARS), so a birthday reads in a search the way a standup does.
SEARCH_INSTANCES = 3
SEARCH_HORIZON_YEARS = 3


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
    not instants: these events are calendar days with no time of day, and which day an instant
    falls on is the reader's zone's to say, before it gets here.

    `calendars` narrows to those, and never past what the user is drawn: a calendar named by
    someone it is not for answers nothing. At most `limit` events answer, nearest today first
    with a yearly event counting as today, the way the API ranks a series before it expands it
    — chosen among the events in the range, where there is one, so a holiday inside it is not
    crowded out by birthdays outside it that rank nearer.
    """

    drawn = {calendar.name: calendar for calendar in _calendars_for(user)}
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
        if not row.repeats:
            days = [get_datetime(row.starts_on).date()]
        else:
            days = _occurrences(row, since, until)
            if not windowed:
                days.sort(key=lambda day: abs(day - now.date()))
                del days[SEARCH_INSTANCES:]
        if days:
            found.append((row, days))

    found.sort(
        key=lambda pair: timedelta(0) if pair[0].repeats else abs(get_datetime(pair[0].starts_on) - now)
    )
    del found[limit:]

    stamp = utcnow()
    return [_event_row(drawn[row.calendar], row, day, stamp) for row, days in found for day in days]


def _rows_carrying(
    calendars: list[str],
    words: list[str],
    title_only: bool,
    start: datetime | None = None,
    end: datetime | None = None,
) -> list[frappe._dict]:
    """The stored events on `calendars` whose title — or notes, unless the title alone was
    asked — carries every one of `words`; every event on them, for none. Within the bounds
    where given, the way `_rows_in_window` reads a window: a dated event that runs through
    them, a yearly one whose day falls between them."""

    event = frappe.qb.DocType("External Calendar Event")
    query = (
        frappe.qb.from_(event)
        .select(event.name, event.calendar, event.uid, *(getattr(event, field) for field in EVENT_FIELDS))
        .where(event.calendar.isin(calendars))
    )
    for word in words:
        carries = event.title.like(f"%{word}%")
        if not title_only:
            carries = carries | event.description.like(f"%{word}%")
        query = query.where(carries)

    if start or end:
        dated = event.repeats == ""
        yearly = event.repeats == "Yearly"
        if start:
            dated &= event.ends_on > start
        if end:
            dated &= event.starts_on < end
            yearly &= event.starts_on < end
        if start and end:
            yearly &= event.month_day.isin(_days_between(start, end))
        query = query.where(dated | yearly)

    return query.run(as_dict=True)
