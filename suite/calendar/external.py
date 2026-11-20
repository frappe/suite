"""Calendars this site holds on behalf of another system, as the calendar app reads them.

A source — an integration that reads holidays or birthdays somewhere else — keeps the result
here, in External Calendar and the events and assignments beside it; `external_store` is how it
writes them. The calendar app draws them alongside the ones the mail server holds, read-only.

Kept here rather than on the mail server because of who they are for. A holiday calendar is
about everyone in a company, and a calendar on the mail server is seen by the people it is
shared with — a list the server caps (ten sharees by default). Here a calendar is assigned to
a user by a row, or to everyone by being site-wide.
"""

from datetime import date, datetime, timedelta

import frappe
from frappe.utils import get_datetime
from isodate import duration_isoformat
from pypika.queries import QueryBuilder

from suite.utils.dt import utcnow

# What an external calendar's `account` is called where the app expects one. Calendars and events
# are addressed as `account|id` throughout the app; these have no mail account, so they say so.
EXTERNAL_ACCOUNT = "external"

# The fields a source states an event in, and so what a difference is measured on.
EVENT_FIELDS = ("title", "description", "starts_on", "ends_on", "all_day", "repeats", "month_day")

# A window is widened by a day at each end before it is read: an all-day event carries no zone,
# and the reader's day may start before the window the browser asked in UTC. Which day it lands
# on is the client's arithmetic either way.
WINDOW_MARGIN = timedelta(days=1)


def calendar_rows(user: str) -> list[dict]:
    """The external calendars drawn for `user`, in the shape the app reads calendars in."""

    return [
        {
            "name": f"{EXTERNAL_ACCOUNT}|{calendar.name}",
            "account": EXTERNAL_ACCOUNT,
            "id": calendar.name,
            "_name": calendar.calendar_name,
            "color": calendar.color,
            "default": 0,
            # Whether a reader who has not chosen yet sees it: the source's call, since a holiday
            # is news to everyone and a birthday most days is not. The reader's choice is kept in
            # their browser and wins.
            "visible": calendar.starts_visible,
            # Nobody writes to these here. What they say is the source's to change.
            "may_write_all": 0,
            "may_delete": 0,
        }
        for calendar in calendars_for(user)
    ]


def events_in_window(user: str, from_date: str, to_date: str) -> list[dict]:
    """Every occurrence between the two, on the calendars drawn for `user`.

    A yearly event is one row, so it is drawn into each year the window reaches rather than
    stored once a year.
    """

    calendars = {calendar.name: calendar for calendar in calendars_for(user)}
    if not calendars:
        return []

    start = get_datetime(from_date) - WINDOW_MARGIN
    end = get_datetime(to_date) + WINDOW_MARGIN

    stamp = utcnow()
    events = []
    for row in stored_events(list(calendars), start, end).run(as_dict=True):
        for day in occurrences(row, start, end):
            events.append(event_row(calendars[row.calendar], row, day, stamp))
    return events


def calendars_for(user: str) -> list[frappe._dict]:
    """The calendars drawn for this user: those assigned to them, and the site-wide ones.

    Read as the site. Who sees an external calendar is decided here and nowhere else, so the
    rows are never exposed by permission.
    """

    drawn: dict[str, object] = {"site_wide": 1}
    if assigned := frappe.get_all("External Calendar Assignment", {"user": user}, pluck="calendar"):
        drawn["name"] = ("in", assigned)
    return frappe.get_all(
        "External Calendar",
        or_filters=drawn,
        fields=["name", "calendar_name", "color", "starts_visible"],
        order_by="calendar_name asc",
    )


def stored_events(
    calendars: list[str], start: datetime | None = None, end: datetime | None = None
) -> QueryBuilder:
    """A query for the stored events on `calendars` that can reach the window: those that run
    through it, and the yearly ones whose day falls in it, whatever year they were anchored in.

    Either bound alone narrows as far as it can: a yearly event is asked for by its day only
    where both are given. Left a query so a search can narrow it by its words before it runs.
    """

    event = frappe.qb.DocType("External Calendar Event")
    query = (
        frappe.qb.from_(event)
        .select(event.name, event.calendar, event.uid, *(event[field] for field in EVENT_FIELDS))
        .where(event.calendar.isin(calendars))
    )
    if not (start or end):
        return query

    # A blank and a missing repeat alike happen once: a row written past the event's validate
    # can carry either.
    dated = event.repeats.isnull() | (event.repeats == "")
    yearly = event.repeats == "Yearly"
    if start:
        dated &= event.ends_on > start
    if end:
        dated &= event.starts_on < end
        yearly &= event.starts_on < end
    if start and end:
        # Asked for by the days the window holds, which the index answers. There are at most 366
        # of them however long the window, so this never comes to every birthday on the calendar.
        yearly &= event.month_day.isin(_days_between(start, end))
    return query.where(dated | yearly)


def _days_between(start: datetime, end: datetime) -> list[str]:
    """Every MM-DD the window covers. Past a year that is every day there is, so it stops there."""

    day = start.date()
    span = min((end.date() - day).days, 366)
    days = {(day + timedelta(days=offset)).strftime("%m-%d") for offset in range(span + 1)}
    # A 29 February event is drawn on the 28th in a year without one, so a window holding that
    # day has to ask for the 29th as well — a date the window itself never contains.
    if "02-28" in days:
        days.add("02-29")
    return sorted(days)


def occurrences(row: frappe._dict, start: datetime, end: datetime) -> list[date]:
    """A one-off's own day, whatever the window; a yearly event's days inside the window."""

    first = get_datetime(row.starts_on)
    if not row.repeats:
        return [first.date()]

    # The day the source named, which is not always the day it was anchored on: a 29 February
    # is stored against the 28th in a year without one, and must come back on the 29th in a
    # year with one.
    month_day = row.month_day or first.strftime("%m-%d")

    days = []
    for year in range(start.year, end.year + 1):
        # Before the series began is not an occurrence: a work anniversary has no year nought.
        if year < first.year:
            continue
        day = yearly_occurrence(month_day, year)
        if start.date() <= day <= end.date():
            days.append(day)
    return days


def yearly_occurrence(month_day: str, year: int) -> date:
    """The MM-DD in the given year. A 29 February falls on the 28th in a year without one,
    which is where a yearly rule would otherwise skip three years in four."""

    month, day = (int(part) for part in month_day.split("-"))
    try:
        return date(year, month, day)
    except ValueError:
        return date(year, 2, 28)


def event_row(calendar: frappe._dict, row: frappe._dict, day: date, stamp: str) -> dict:
    """One occurrence, in the shape the app reads events in.

    The fields an event carries on the mail server that these never have — participants, alerts,
    links, an organizer — are present and empty rather than missing: the client reads the same
    row whatever drew it.
    """

    starts_on = get_datetime(row.starts_on)
    ends_on = get_datetime(row.ends_on) if row.ends_on else starts_on
    start = datetime.combine(day, starts_on.time())

    return {
        "name": f"{EXTERNAL_ACCOUNT}|{row.name}-{day:%Y%m%d}",
        "account": EXTERNAL_ACCOUNT,
        "id": f"{row.name}-{day:%Y%m%d}",
        "uid": row.uid,
        # A yearly event's occurrence is named the way a series' is on the mail server: by the
        # series (`master_id`) and the occurrence within it, which is what a link to one is
        # written with. An event that happens once has no series, and the key is left out.
        **({"master_id": row.name} if row.repeats else {}),
        "recurrence_id": f"{day:%Y-%m-%d}T00:00:00" if row.repeats else None,
        "created": None,
        "organizer": "",
        "calendars": [
            {
                "calendar": f"{EXTERNAL_ACCOUNT}|{calendar.name}",
                "calendar_id": calendar.name,
                "calendar_name": calendar.calendar_name,
                "color": calendar.color,
            }
        ],
        "status": "Confirmed",
        "draft": 0,
        "title": row.title or "",
        "start": start.strftime("%Y-%m-%dT%H:%M:%S"),
        "duration": _duration(ends_on - starts_on),
        "time_zone": "",
        "recurrence_id_time_zone": "",
        "recurrence_rule": "{}",
        "show_without_time": 1 if row.all_day else 0,
        "privacy": "",
        # A holiday is not an hour of anyone's day, and a birthday is not a meeting.
        "free_busy_status": "Free",
        "description": row.description or "",
        "locations": [],
        "links": [],
        "participants": [],
        "alerts": [],
        "use_default_alerts": 0,
        "created_utc": stamp,
        "updated_utc": stamp,
        "origin": False,
        "may_invite_self": 0,
        "may_invite_others": 0,
        "hide_attendees": 0,
        "creation": stamp,
        "modified": stamp,
        "sequence": 0,
    }


def _duration(span: timedelta) -> str:
    """The span as JSCalendar states one: P1D for a day off, PT1H for an hour.

    Never negative: `isodate` would write -P1D, which is not a duration an event can have.
    """

    return duration_isoformat(span) if span > timedelta(0) else "P0D"
