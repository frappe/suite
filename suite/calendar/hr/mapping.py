"""HR records as calendar events.

Pure functions: they take what HR returns and give back the events that should exist,
so what the sync writes can be tested without touching a calendar. Each event carries a `uid`
built from the HR record it came from, which is how a later run finds the event it wrote
and updates or removes it instead of adding a second one.
"""

from datetime import date, timedelta

from suite.calendar.external import yearly_occurrence
from suite.utils import convert_html_to_text


def holiday_events(holiday_list: str, holidays: list[dict]) -> list[dict]:
    """A day off for each holiday in the list, weekly offs left out: a weekend is not news."""

    events = []
    for holiday in holidays:
        if holiday.get("weekly_off"):
            continue
        day = _day(holiday.get("holiday_date"))
        if not day:
            continue
        events.append(
            {
                "uid": f"hr-holiday-{holiday_list}-{day}",
                "title": convert_html_to_text(holiday.get("description")) or "Holiday",
                **_all_day(day),
            }
        )
    return events


def birthday_events(employees: list[dict]) -> list[dict]:
    """A birthday each year, without the year: whose it is belongs on a calendar, their age
    does not. Anchored on the day itself, which never moves — the store draws the day in each
    year the reader looks at, so an anchor that followed the calendar would rewrite every
    birthday each January for nothing."""

    return [
        _yearly(employee, "birthday", "birthday", born, anchor=born)
        for employee, born in _dated(employees, "date_of_birth")
    ]


def anniversary_events(employees: list[dict]) -> list[dict]:
    """A work anniversary each year, from the first one. The years served can't be in the
    title — every occurrence of a repeating event shares one — so the day is the whole of it.

    Anchored on that first anniversary, the year after they joined: before it there is nothing
    to mark, and after it the store draws one a year.
    """

    return [
        _yearly(
            employee,
            "anniversary",
            "work anniversary",
            joined,
            anchor=yearly_occurrence(joined[5:10], int(joined[:4]) + 1).isoformat(),
            description=f"Joined on {_written_out(joined)}",
        )
        for employee, joined in _dated(employees, "date_of_joining")
    ]


def _dated(employees: list[dict], field: str):
    """Each employee with a date in `field`, as (employee, ISO day). One without is skipped."""

    for employee in employees:
        if day := _day(employee.get(field)):
            yield employee, day


def _yearly(
    employee: dict, kind: str, what: str, day: str, anchor: str, description: str | None = None
) -> dict:
    """One yearly event of an employee's: `kind` names it in the uid, `what` in the title, `day`
    is the date it falls on and `anchor` the first occurrence.

    The day is stated apart from the anchor on purpose: anchored in a year without a 29
    February, a leap-day birthday is still a leap-day birthday.
    """

    event = {
        "uid": f"hr-{kind}-{employee['name']}",
        "title": f"{employee['employee_name']}'s {what}",
        "repeats": "Yearly",
        "month_day": day[5:10],
        **_all_day(anchor),
    }
    if description:
        event["description"] = description
    return event


def _all_day(day: str) -> dict:
    """A whole day, from its midnight to the next: the store holds a span, and a day off is one
    that carries no time of day for the calendar to draw it against."""

    after = date.fromisoformat(day) + timedelta(days=1)
    return {"starts_on": f"{day} 00:00:00", "ends_on": f"{after.isoformat()} 00:00:00", "all_day": True}


def _day(value) -> str | None:
    """The value as an ISO date, or nothing. What HR sends is somebody else's data: a date that is
    not one is skipped rather than written into an event nothing can draw."""

    text = str(value or "")[:10]
    try:
        return date.fromisoformat(text).isoformat()
    except ValueError:
        return None


def _written_out(day: str) -> str:
    """The date as someone reads it — 15 September 2025 — and with the month as a word, so it is
    the same date to a reader who writes the day first as to one who writes the month first."""

    value = date.fromisoformat(day)
    return f"{value.day} {value:%B} {value.year}"
