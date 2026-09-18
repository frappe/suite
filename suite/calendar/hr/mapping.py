"""HR records as calendar events.

Pure functions: they take what HR returns and give back the events that should exist,
so what the sync writes can be tested without a mail server. Each event carries a `uid`
built from the HR record it came from, which is how a later run finds the event it wrote
and updates or removes it instead of adding a second one.
"""

import re
from datetime import date

# A day, as an all-day event: JSCalendar dates carry no zone and the event covers the whole day.
ALL_DAY = {"duration": "P1D", "show_without_time": True}
YEARLY = {"@type": "RecurrenceRule", "frequency": "yearly"}


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
        day = str(holiday["holiday_date"])[:10]
        events.append(
            {
                "uid": f"hr-holiday-{holiday_list}-{day}",
                "title": strip_html(holiday.get("description")) or "Holiday",
                "start": f"{day}T00:00:00",
                **ALL_DAY,
            }
        )
    return events


def birthday_events(employees: list[dict], today: date) -> list[dict]:
    """A birthday each year, without the year: whose it is belongs on a calendar, their age
    does not. Anchored in the current year so the series starts where the calendar is."""

    events = []
    for employee in employees:
        if not employee.get("date_of_birth"):
            continue
        events.append(
            {
                "uid": f"hr-birthday-{employee['name']}",
                "title": f"{employee['employee_name']}'s birthday",
                "start": f"{_anniversary_of(employee['date_of_birth'], today.year)}T00:00:00",
                "recurrence_rule": YEARLY,
                **ALL_DAY,
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
        joined = employee.get("date_of_joining")
        if not joined:
            continue
        year = max(int(str(joined)[:4]) + 1, today.year)
        events.append(
            {
                "uid": f"hr-anniversary-{employee['name']}",
                "title": f"{employee['employee_name']}'s work anniversary",
                "start": f"{_anniversary_of(joined, year)}T00:00:00",
                "description": f"Joined on {str(joined)[:10]}",
                "recurrence_rule": YEARLY,
                **ALL_DAY,
            }
        )
    return events


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
