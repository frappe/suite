"""Keeping the HR calendars in step with HR.

One calendar per holiday list, plus a celebrations calendar for birthdays and work anniversaries,
each held on this site as an External Calendar and drawn for the people it is about. Every run
works out what should be on each calendar and makes the calendar say that: events HR no longer
has are removed, changed ones are rewritten, and the rest are left alone. So a run is repeatable,
and a holiday moved or cancelled in HR moves or goes here too.

The events carry no organizer and no participants. They are facts about a day, not invitations
to answer, which is also how every other calendar draws a holiday.
"""

from datetime import date

import frappe
from frappe import _
from frappe.utils import now_datetime

from suite.calendar.external import (
    calendars_of,
    remove_calendar,
    replace_audience,
    replace_events,
    upsert_calendar,
)
from suite.calendar.hr.mapping import anniversary_events, birthday_events, holiday_events
from suite.calendar.hr.source import HRSource
from suite.utils.lock import acquire_lock, release_lock

LOCK = "hr_calendar_sync"
# Longer than a run takes; a worker that dies mid-run frees it by this, not never.
LOCK_TIMEOUT = 1800

# What these calendars are kept by, and so which of the site's external calendars are this
# sync's to reconcile. Anything another integration keeps is not touched.
SOURCE = "Frappe HR"

# What a holiday list's calendar is remembered under, and what a celebrations calendar is,
# before the company it is for.
HOLIDAYS_KEY = "holidays:"
CELEBRATIONS_KEY = "celebrations:"


def sync_hr_calendars() -> dict:
    """The daily job, and what the settings' Sync Now runs. Returns what it did, per calendar.

    Deliberately thin. Frappe writes a failing job's traceback to the Error Log with the contents
    of every frame in it, and the frames that do the work hold employees' names and birth dates.
    So the work happens in `_run`, and what is raised from here is a new error with none of those
    frames behind it; what went wrong is recorded without variables.

    One run at a time, whoever asks: two at once would each find a calendar missing and make it.
    """

    identifier = acquire_lock(LOCK, lock_timeout=LOCK_TIMEOUT)
    if not identifier:
        return {}

    try:
        return _run()
    except Exception:
        _record_failure()
        raise frappe.ValidationError(_("The HR calendar sync failed. See the Error Log.")) from None
    finally:
        release_lock(LOCK, identifier)


def _record_failure() -> None:
    """What went wrong, in the one commit a failed run makes. Everything the run wrote is rolled
    back with it: the calendars live in this database, so a failed run leaves nothing behind to
    remember."""

    traceback = frappe.get_traceback(with_context=False)
    frappe.db.rollback()
    frappe.db.set_single_value("HR Calendar Sync Settings", "last_error", traceback[-2000:])
    frappe.log_error(title="HR Calendar Sync failed", message=traceback)
    frappe.db.commit()  # nosemgrep: the job is failing; what it says has to outlive the rollback


def _run() -> dict:
    # Read fresh rather than from the cache: the sync acts on what is saved now.
    settings = frappe.get_doc("HR Calendar Sync Settings")
    if not settings.enabled:
        return {}

    source = settings.hr_source()
    employees = source.employees()
    today = date.today()

    # Every calendar this run keeps: the key it is remembered by, its name, colour, whether it
    # starts out unticked, what is on it, and who it is for.
    plans = []
    if settings.sync_holidays:
        for holiday_list, audience in _holiday_lists(settings, source, employees, today).items():
            events = holiday_events(holiday_list, source.holidays(holiday_list))
            plans.append(
                (
                    f"{HOLIDAYS_KEY}{holiday_list}",
                    holiday_list,
                    settings.holidays_color,
                    False,
                    events,
                    audience,
                )
            )
    if settings.sync_birthdays or settings.sync_anniversaries:
        # One calendar for both: the same people see them, and the titles tell them apart.
        for company, (name, staff) in _by_company(settings.milestones_calendar, employees).items():
            audience = [person.get("user_id") for person in staff]
            events = birthday_events(staff, today) if settings.sync_birthdays else []
            if settings.sync_anniversaries:
                events += anniversary_events(staff, today)
            # A birthday or an anniversary most days, for everyone in the company, is more than
            # most people want drawn over their own week. It is theirs to switch on. Holidays are
            # few and change what a day is, so those stay shown.
            plans.append(
                (f"{CELEBRATIONS_KEY}{company}", name, settings.milestones_color, True, events, audience)
            )

    # Two plans for one calendar would each remove the other's events and replace the other's
    # audience: a holiday list named "Birthdays" would hand the birthdays to the wrong people.
    names = [plan[1] for plan in plans]
    if len(names) != len(set(names)):
        frappe.throw(_("Two synced calendars share a name. Rename one in the settings."))

    summary = _reconcile(plans)
    _record_success()
    return summary


def _record_success() -> None:
    frappe.db.set_single_value("HR Calendar Sync Settings", {"last_sync": now_datetime(), "last_error": None})


def _reconcile(plans: list[tuple]) -> dict:
    kept = calendars_of(SOURCE)
    summary = {}

    for key, name, color, hidden, events, audience in plans:
        calendar = upsert_calendar(SOURCE, key, name, color=color, hidden_by_default=hidden)
        summary[name] = replace_events(calendar, events)
        summary[name]["drawn_for"] = replace_audience(calendar, _site_users(audience))

    # What this sync used to keep and HR no longer has — a holiday list nobody follows any more,
    # or a kind switched off. The calendar goes with its events and its audience, so a former
    # follower stops seeing it; nothing of it is left on a server to come back.
    planned = {plan[0] for plan in plans}
    for key, calendar in kept.items():
        if key not in planned:
            remove_calendar(calendar)
            summary[f"({key})"] = {"removed_calendar": True}

    return summary


def _site_users(emails: list[str | None]) -> list[str]:
    """The people HR named, as users of this site.

    HR knows an employee by the address they log in to HR with; the same address is their user
    here. One HR names that this site has never heard of is left out — an employee with no
    account here has nowhere to be shown a calendar.
    """

    wanted = {email.strip().lower() for email in emails if email}
    if not wanted:
        return []
    return frappe.get_all("User", {"name": ("in", sorted(wanted)), "enabled": 1}, pluck="name")


def _by_company(name: str, employees: list[dict]) -> dict[str, tuple[str, list[dict]]]:
    """One celebrations calendar per company, as HR's own birthday reminders go to the company and
    no further: companies sharing an HR site are not each other's colleagues. A single company
    keeps the plain name."""

    companies: dict[str, list[dict]] = {}
    for employee in employees:
        companies.setdefault(employee.get("company") or "", []).append(employee)

    if len(companies) <= 1:
        return {company: (name, staff) for company, staff in companies.items()}
    return {
        company: (f"{name} — {company}" if company else name, staff) for company, staff in companies.items()
    }


def _holiday_lists(settings, source: HRSource, employees: list[dict], today: date) -> dict[str, list[str]]:
    """Which holiday lists to draw, and whose calendar each belongs on.

    Asked the way HR itself resolves them, so a list is drawn for exactly the people it applies
    to: by Holiday List Assignment, the employee's own, else their company's.
    """

    chosen = settings.chosen_holiday_lists()
    audiences: dict[str, list[str]] = {}
    follows = _lists_by_assignment(source.holiday_list_assignments(), employees, today.isoformat())

    for employee in employees:
        for holiday_list in follows.get(employee["name"], []):
            if not chosen or holiday_list in chosen:
                audiences.setdefault(holiday_list, []).append(employee.get("user_id"))

    return audiences


def _lists_by_assignment(assignments: list[dict], employees: list[dict], today: str) -> dict[str, list[str]]:
    """The lists each employee follows from today on: the one in force, and any already assigned
    to come after it — next year's list belongs on the calendar before the year turns.

    An employee's own assignments come before their company's, as in HR. The company's count only
    for someone with none of their own, or until their first one starts.
    """

    # By kind as well as name: an employee whose id is also a company's name is not that company,
    # and its lists are not theirs.
    by_holder: dict[tuple, list[dict]] = {}
    for row in assignments:
        start = str(row.get("from_date") or "")[:10]
        if row.get("holiday_list") and start:
            holder = (row.get("applicable_for"), row.get("assigned_to"))
            by_holder.setdefault(holder, []).append({"holiday_list": row["holiday_list"], "start": start})
    for rows in by_holder.values():
        rows.sort(key=lambda row: row["start"])

    def from_today(rows: list[dict], until: str | None = None) -> list[dict]:
        rows = [row for row in rows if until is None or row["start"] < until]
        in_force = [row for row in rows if row["start"] <= today][-1:]
        return in_force + [row for row in rows if row["start"] > today]

    follows = {}
    for employee in employees:
        own = from_today(by_holder.get(("Employee", employee["name"]), []))
        company = by_holder.get(("Company", employee.get("company")), [])
        if not own:
            rows = from_today(company)
        elif own[0]["start"] > today:
            rows = from_today(company, until=own[0]["start"]) + own
        else:
            rows = own
        follows[employee["name"]] = list(dict.fromkeys(row["holiday_list"] for row in rows))
    return follows
