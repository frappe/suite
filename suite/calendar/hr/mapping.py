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

    events = []
    for employee in employees:
        born = _day(employee.get("date_of_birth"))
        if not born:
            continue
        events.append(
            {
                "uid": f"hr-birthday-{employee['name']}",
                "title": f"{employee['employee_name']}'s birthday",
                "repeats": "Yearly",
                # The day they were born, not the day the series is anchored on: anchored in a
                # year without a 29 February, a leap-day birthday is still a leap-day birthday.
                "month_day": born[5:10],
                **_all_day(born),
            }
        )
    return events


def anniversary_events(employees: list[dict]) -> list[dict]:
    """A work anniversary each year, from the first one. The years served can't be in the
    title — every occurrence of a repeating event shares one — so the day is the whole of it.

    Anchored on that first anniversary, the year after they joined: before it there is nothing
    to mark, and after it the store draws one a year.
    """

    events = []
    for employee in employees:
        joined = _day(employee.get("date_of_joining"))
        if not joined:
            continue
        first = yearly_occurrence(joined[5:10], int(joined[:4]) + 1)
        events.append(
            {
                "uid": f"hr-anniversary-{employee['name']}",
                "title": f"{employee['employee_name']}'s work anniversary",
                "description": f"Joined on {_written_out(joined)}",
                "repeats": "Yearly",
                "month_day": joined[5:10],
                **_all_day(first.isoformat()),
            }
        )
    return events


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
