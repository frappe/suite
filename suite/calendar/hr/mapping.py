"""HR records as calendar events.

Pure functions: they take what HR returns and give back the events that should exist,
so what the sync writes can be tested without touching a calendar. Each event carries a `uid`
built from the HR record it came from, which is how a later run finds the event it wrote
and updates or removes it instead of adding a second one.
"""

import re
from datetime import date, timedelta


def strip_html(value: str | None) -> str:
    """HR stores a holiday's name as rich text; a calendar shows plain text."""

    text = re.sub(r"<[^>]+>", " ", value or "")
    return re.sub(r"\s+", " ", text).strip()


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
                "title": strip_html(holiday.get("description")) or "Holiday",
                **_all_day(day),
            }
        )
    return events


def birthday_events(employees: list[dict], today: date) -> list[dict]:
    """A birthday each year, without the year: whose it is belongs on a calendar, their age
    does not. Anchored in the current year so the series starts where the calendar is."""

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
                **_all_day(_anniversary_of(born, today.year)),
            }
        )
    return events


def anniversary_events(employees: list[dict], today: date) -> list[dict]:
    """A work anniversary each year, from the first one. The years served can't be in the
    title — every occurrence of a repeating event shares one — so the day is the whole of it.

    Someone who joined this year has their first anniversary next year, which is where the
    series starts; anyone longer-serving gets this year's.
    """

    events = []
    for employee in employees:
        joined = _day(employee.get("date_of_joining"))
        if not joined:
            continue
        year = max(int(joined[:4]) + 1, today.year)
        events.append(
            {
                "uid": f"hr-anniversary-{employee['name']}",
                "title": f"{employee['employee_name']}'s work anniversary",
                "description": f"Joined on {_written_out(joined)}",
                "repeats": "Yearly",
                "month_day": joined[5:10],
                **_all_day(_anniversary_of(joined, year)),
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


def _anniversary_of(day: str, year: int) -> str:
    """The same day in the given year. A 29 February falls on the 28th in a year without one,
    which is where a yearly rule would otherwise skip three years in four."""

    month_day = str(day)[5:10]
    if month_day == "02-29":
        try:
            date(year, 2, 29)
        except ValueError:
            month_day = "02-28"
    return f"{year}-{month_day}"
