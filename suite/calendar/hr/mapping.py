"""HR records as calendar events.

Pure functions from what HR returns to the events that should exist, apart from translating what
a reader sees into the site's language. Each event carries a `uid`
made from the HR record it came from: that is how a later run finds the event it wrote, and
rewrites or removes it rather than adding a second one.
"""

from datetime import date, timedelta

from frappe import _

from suite.calendar.external import yearly_occurrence
from suite.utils import convert_html_to_text


def holiday_events(holiday_list: str, holidays: list[dict]) -> list[dict]:
    """A day off for each holiday in the list. Weekly offs are left out: a weekend is not news."""

    events = []
    for holiday in holidays:
        if holiday.get("weekly_off"):
            continue
        if not (day := _day(holiday.get("holiday_date"))):
            continue
        events.append(
            {
                "uid": f"hr-holiday-{holiday_list}-{day}",
                "title": convert_html_to_text(holiday.get("description") or "") or _("Holiday"),
                **_all_day(day),
            }
        )
    return events


def birthday_events(employees: list[dict]) -> list[dict]:
    """A birthday each year, from the day itself, which never moves. The year is not in it:
    whose birthday it is belongs on a calendar, their age does not."""

    return [
        _yearly(employee, "birthday", _("{0}'s birthday"), anchor=born)
        for employee, born in _dated(employees, "date_of_birth")
    ]


def anniversary_events(employees: list[dict]) -> list[dict]:
    """A work anniversary each year, from the first one, a year after joining. The years served
    are not in the title: every occurrence of a repeating event has one title."""

    return [
        _yearly(
            employee,
            "anniversary",
            _("{0}'s work anniversary"),
            anchor=yearly_occurrence(joined[5:], int(joined[:4]) + 1).isoformat(),
            month_day=joined[5:],
            description=_("Joined on {0}").format(_written_out(joined)),
        )
        for employee, joined in _dated(employees, "date_of_joining")
    ]


def _dated(employees: list[dict], field: str):
    """Each employee with a date in `field`, as (employee, ISO day). One without is skipped."""

    for employee in employees:
        if day := _day(employee.get(field)):
            yield employee, day


def _yearly(
    employee: dict,
    kind: str,
    title: str,
    anchor: str,
    month_day: str | None = None,
    description: str | None = None,
) -> dict:
    """One yearly event of an employee's, first falling on `anchor`, titled `title` with their
    name in its place.

    The day it repeats on is stated apart from the anchor: a work anniversary from 29 February
    is anchored on the 28th the next year, and is still a 29 February anniversary.
    """

    event = {
        "uid": f"hr-{kind}-{employee['name']}",
        "title": title.format(employee.get("employee_name") or employee["name"]),
        "repeats": "Yearly",
        "month_day": month_day or anchor[5:],
        **_all_day(anchor),
    }
    if description:
        event["description"] = description
    return event


def _all_day(day: str) -> dict:
    after = date.fromisoformat(day) + timedelta(days=1)
    return {"starts_on": f"{day} 00:00:00", "ends_on": f"{after} 00:00:00", "all_day": True}


def _day(value) -> str | None:
    """The value as an ISO date, or nothing. What HR sends is somebody else's data: a date that
    is not one is skipped rather than written into an event nothing can draw."""

    try:
        return date.fromisoformat(str(value or "")[:10]).isoformat()
    except ValueError:
        return None


def _written_out(day: str) -> str:
    """The date as someone reads it, 15 September 2025, with the month as a word, so it is the
    same date to a reader who writes the day first as to one who writes the month first."""

    value = date.fromisoformat(day)
    return f"{value.day} {_month_name(value.month)} {value.year}"


def _month_name(month: int) -> str:
    """The month's name in the site's language, not the server process's locale."""

    return (
        _("January"),
        _("February"),
        _("March"),
        _("April"),
        _("May"),
        _("June"),
        _("July"),
        _("August"),
        _("September"),
        _("October"),
        _("November"),
        _("December"),
    )[month - 1]
