"""Calendars this site holds on behalf of another system.

An integration — Frappe HR's holidays and celebrations today — reads somewhere else and keeps
the result here, in External Calendar and the events and audience beside it. The calendar app
draws them alongside the ones the mail server holds, read-only.

Kept here rather than on the mail server because of who they are for. A holiday calendar is
about everyone in a company, and a calendar on the mail server is seen by the people it is
shared with — a list the server caps (ten sharees by default). An audience of four thousand is
four thousand rows in a table, which is nothing at all.

What a source has to do is in three calls: `upsert_calendar` for the calendar, `replace_events`
for what is on it, `replace_audience` for who sees it. Each replaces rather than adds, so a run
is repeatable and what the source no longer has goes.
"""

from collections.abc import Iterable
from datetime import date, datetime, timedelta
from uuid import uuid7

import frappe
from frappe.database.database import savepoint
from frappe.utils import get_datetime, now_datetime
from isodate import duration_isoformat

from suite.utils.dt import utcnow

# What an external calendar's `account` is called where the app expects one. Calendars and events
# are addressed as `account|id` throughout the app; these have no mail account, so they say so.
NAMESPACE = "external"

# The fields a source states an event in, and so what a difference is measured on.
EVENT_FIELDS = ("title", "description", "starts_on", "ends_on", "all_day", "repeats", "month_day")

# A window is widened by a day at each end before it is read: an all-day event carries no zone,
# and the reader's day may start before the window the browser asked in UTC. Which day it lands
# on is the client's arithmetic either way.
WINDOW_MARGIN = timedelta(days=1)


# --- reading ------------------------------------------------------------------------------------


def calendar_rows(user: str) -> list[dict]:
    """The external calendars drawn for `user`, in the shape the app reads calendars in."""

    return [
        {
            "name": f"{NAMESPACE}|{calendar.name}",
            "account": NAMESPACE,
            "id": calendar.name,
            "_name": calendar.calendar_name,
            "color": calendar.color,
            "default": 0,
            "visible": 1,
            # Nobody writes to these here. What they say is the source's to change.
            "may_write_all": 0,
            "may_delete": 0,
            "default_hidden": 1 if calendar.hidden_by_default else 0,
        }
        for calendar in _calendars_for(user)
    ]


def events_in_window(user: str, from_date: str, to_date: str) -> list[dict]:
    """Every occurrence between the two, on the calendars drawn for `user`.

    A yearly event is one row, so it is drawn into each year the window reaches rather than
    stored once a year.
    """

    calendars = {calendar.name: calendar for calendar in _calendars_for(user)}
    if not calendars:
        return []

    start = get_datetime(from_date) - WINDOW_MARGIN
    end = get_datetime(to_date) + WINDOW_MARGIN

    stamp = utcnow()
    events = []
    for row in _rows_in_window(list(calendars), start, end):
        for day in _occurrences(row, start, end):
            events.append(_event_row(calendars[row.calendar], row, day, stamp))
    return events


def _calendars_for(user: str) -> list[frappe._dict]:
    """The calendars this user is an audience of. Read as the site: who sees an external calendar
    is the audience beside it and nothing else, so the rows are never exposed by permission."""

    ids = frappe.get_all("External Calendar Audience", {"user": user}, pluck="calendar")
    if not ids:
        return []
    return frappe.get_all(
        "External Calendar",
        {"name": ("in", ids)},
        ["name", "calendar_name", "color", "hidden_by_default"],
        order_by="calendar_name asc",
    )


def _rows_in_window(calendars: list[str], start: datetime, end: datetime) -> list[frappe._dict]:
    """The stored events that can reach the window: those that run through it, and the yearly
    ones whose day falls in it, whatever year they were anchored in."""

    fields = ["name", "calendar", "uid", *EVENT_FIELDS]
    dated = frappe.get_all(
        "External Calendar Event",
        {
            "calendar": ("in", calendars),
            "repeats": "",
            "starts_on": ("<", end),
            "ends_on": (">", start),
        },
        fields,
    )

    # Asked for by the days the window holds, which the index answers. There are at most 366 of
    # them however long the window, so this never comes to every birthday on the calendar.
    yearly = frappe.get_all(
        "External Calendar Event",
        {
            "calendar": ("in", calendars),
            "repeats": "Yearly",
            "starts_on": ("<", end),
            "month_day": ("in", _days_between(start, end)),
        },
        fields,
    )

    return dated + yearly


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


def _occurrences(row: frappe._dict, start: datetime, end: datetime) -> list[date]:
    """The days this event lands on inside the window."""

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


def _event_row(calendar: frappe._dict, row: frappe._dict, day: date, stamp: str) -> dict:
    """One occurrence, in the shape the app reads events in.

    The fields an event carries on the mail server that these never have — participants, alerts,
    links, an organizer — are present and empty rather than missing: the client reads the same
    row whatever drew it.
    """

    starts_on = get_datetime(row.starts_on)
    ends_on = get_datetime(row.ends_on) if row.ends_on else starts_on
    start = datetime.combine(day, starts_on.time())

    return {
        "name": f"{NAMESPACE}|{row.name}-{day:%Y%m%d}",
        "account": NAMESPACE,
        "id": f"{row.name}-{day:%Y%m%d}",
        "uid": row.uid,
        # A yearly event's occurrence is named the way a series' is on the mail server: by the
        # series (`master_id`) and the occurrence within it, which is what a link to one is
        # written with and how a search counts three years of one birthday as one answer.
        "master_id": row.name if row.repeats else None,
        "recurrence_id": f"{day:%Y-%m-%d}T00:00:00" if row.repeats else None,
        "created": None,
        "organizer": "",
        "calendars": [
            {
                "calendar": f"{NAMESPACE}|{calendar.name}",
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


# --- searching ----------------------------------------------------------------------------------

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
    a birthday means. Either bound alone still holds.

    `calendars` narrows to those, and never past what the user is drawn: a calendar named by
    someone it is not for answers nothing. At most `limit` events are expanded, ranked nearest
    today first with a yearly event counting as today, the way the API ranks a series before it
    expands it.
    """

    drawn = {calendar.name: calendar for calendar in _calendars_for(user)}
    if calendars is not None:
        drawn = {name: drawn[name] for name in calendars if name in drawn}
    if not drawn:
        return []

    now = now_datetime()
    rows = _rows_carrying(list(drawn), words, title_only)
    rows.sort(key=lambda row: timedelta(0) if row.repeats else abs(get_datetime(row.starts_on) - now))
    del rows[limit:]

    windowed = bool(start and end)
    since = start or now - timedelta(days=367)
    until = end or now + timedelta(days=366 * SEARCH_HORIZON_YEARS)
    stamp = utcnow()
    events = []
    for row in rows:
        if not row.repeats:
            if (start and get_datetime(row.ends_on or row.starts_on) <= start) or (
                end and get_datetime(row.starts_on) >= end
            ):
                continue
            events.append(_event_row(drawn[row.calendar], row, get_datetime(row.starts_on).date(), stamp))
            continue
        days = _occurrences(row, since, until)
        if not windowed:
            days.sort(key=lambda day: abs(day - now.date()))
            del days[SEARCH_INSTANCES:]
        events.extend(_event_row(drawn[row.calendar], row, day, stamp) for day in days)
    return events


def _rows_carrying(calendars: list[str], words: list[str], title_only: bool) -> list[frappe._dict]:
    """The stored events on `calendars` whose title — or notes, unless the title alone was
    asked — carries every one of `words`; every event on them, for none."""

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
    return query.run(as_dict=True)


# --- writing ------------------------------------------------------------------------------------


def upsert_calendar(
    source: str,
    source_key: str,
    calendar_name: str,
    color: str | None = None,
    hidden_by_default: bool = False,
) -> str:
    """The calendar this source keeps for `source_key`, made if it isn't there yet.

    Its name and colour are written on every run, not only the day it was made: changed where
    the source or the settings state them, they are changed here.
    """

    existing = frappe.db.get_value(
        "External Calendar",
        {"source": source, "source_key": source_key},
        ["name", "calendar_name", "color", "hidden_by_default"],
        as_dict=True,
    )
    wanted = {
        "calendar_name": calendar_name,
        "color": color,
        "hidden_by_default": 1 if hidden_by_default else 0,
    }

    if not existing:
        # The lookup above is not a guarantee — another writer can insert between it and this,
        # and the table's unique index is what settles it. Theirs is as good as ours, so the
        # loser reads it back rather than failing a run over which of two identical calendars
        # was made first.
        made = None
        with savepoint(catch=frappe.UniqueValidationError):
            calendar = frappe.new_doc("External Calendar")
            calendar.update({"source": source, "source_key": source_key, **wanted})
            calendar.insert(ignore_permissions=True)
            made = calendar.name
        return made or frappe.db.get_value(
            "External Calendar", {"source": source, "source_key": source_key}, "name"
        )

    if any(existing.get(field) != value for field, value in wanted.items()):
        frappe.db.set_value("External Calendar", existing.name, wanted, update_modified=False)
    return existing.name


def replace_events(calendar: str, events: list[dict]) -> dict:
    """Makes the calendar say what the source says: what is missing is added, what differs is
    rewritten, and what the source no longer has is removed. Returns what it did."""

    stored = {
        row.uid: row
        for row in frappe.get_all(
            "External Calendar Event",
            {"calendar": calendar},
            ["name", "uid", *EVENT_FIELDS],
        )
    }
    wanted = {event["uid"]: event for event in events}

    created = [event for uid, event in wanted.items() if uid not in stored]
    changed = [
        (stored[uid].name, event)
        for uid, event in wanted.items()
        if uid in stored and _differs(stored[uid], event)
    ]
    removed = [row.name for uid, row in stored.items() if uid not in wanted]

    _insert_events(calendar, created)
    if changed:
        frappe.db.bulk_update(
            "External Calendar Event",
            {name: _stored_values(event) for name, event in changed},
            update_modified=False,
        )
    if removed:
        frappe.db.delete("External Calendar Event", {"name": ("in", removed)})

    return {"created": len(created), "updated": len(changed), "removed": len(removed)}


def replace_audience(calendar: str, users: Iterable[str]) -> int:
    """Who the calendar is drawn for, replacing whoever it was drawn for before: somebody the
    source no longer names stops seeing it on the next run."""

    wanted = {user for user in users if user}
    stored = {
        row.user: row.name
        for row in frappe.get_all("External Calendar Audience", {"calendar": calendar}, ["name", "user"])
    }

    if gone := [name for user, name in stored.items() if user not in wanted]:
        frappe.db.delete("External Calendar Audience", {"name": ("in", gone)})

    if added := sorted(wanted - set(stored)):
        _bulk_insert("External Calendar Audience", ["calendar", "user"], [[calendar, user] for user in added])
    return len(wanted)


def calendars_of(source: str) -> dict[str, str]:
    """What this source keeps here, by the key it knows each calendar as."""

    return {
        row.source_key: row.name
        for row in frappe.get_all("External Calendar", {"source": source}, ["name", "source_key"])
    }


def remove_calendar(calendar: str) -> None:
    """A calendar the source no longer has, with its events and its audience."""

    frappe.delete_doc("External Calendar", calendar, ignore_permissions=True, delete_permanently=True)


def _insert_events(calendar: str, events: list[dict]) -> None:
    rows = []
    for event in events:
        values = _stored_values(event)
        rows.append([calendar, event["uid"], *[values[field] for field in EVENT_FIELDS]])
    _bulk_insert("External Calendar Event", ["calendar", "uid", *EVENT_FIELDS], rows)


def _bulk_insert(doctype: str, fields: list[str], rows: list[list]) -> None:
    """Straight into the table, named and stamped as a save would: these rows are the source's,
    written by the hundred, and nothing hangs off saving one."""

    if not rows:
        return

    stamp = now_datetime()
    frappe.db.bulk_insert(
        doctype,
        ["name", *fields, "creation", "modified", "owner", "modified_by"],
        [[str(uuid7()), *row, stamp, stamp, "Administrator", "Administrator"] for row in rows],
    )


def _stored_values(event: dict) -> dict:
    """An event as the table holds it: every field stated, so a rewrite clears what is gone."""

    starts_on = get_datetime(event["starts_on"])
    repeats = event.get("repeats") or ""
    return {
        "title": event.get("title") or "",
        "description": event.get("description") or None,
        "starts_on": starts_on,
        "ends_on": get_datetime(event["ends_on"]) if event.get("ends_on") else starts_on,
        "all_day": 1 if event.get("all_day") else 0,
        "repeats": repeats,
        # The day a repeat falls on, which the source may state where it is not the day the
        # series is anchored on — a 29 February anchored on the 28th.
        "month_day": (event.get("month_day") or starts_on.strftime("%m-%d")) if repeats else None,
    }


def _differs(stored: frappe._dict, event: dict) -> bool:
    """Whether the stored event still says what the source says."""

    values = _stored_values(event)
    for field in EVENT_FIELDS:
        has, wanted = stored.get(field), values[field]
        if has and field in ("starts_on", "ends_on"):
            has = get_datetime(has)
        if (has or None) != (wanted or None):
            return True
    return False
