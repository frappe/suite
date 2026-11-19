"""Keeping the HR calendars in step with HR.

One calendar per holiday list, one for birthdays and one for work anniversaries, each an External
Calendar. The sync decides what is on them. Who sees them is an administrator's, set on the
calendar itself, and the sync never changes it.

Every run works out what each calendar should say and makes it say that: what HR no longer has is
removed, what changed is rewritten, the rest is left alone. A run with nothing changed in HR
writes nothing.
"""

from collections.abc import Callable
from dataclasses import asdict, dataclass
from typing import TYPE_CHECKING

import frappe
from frappe import _
from frappe.utils import now_datetime

from suite.calendar.external_store import remove_calendar, replace_events, upsert_calendar
from suite.calendar.hr.mapping import anniversary_events, birthday_events, holiday_events
from suite.calendar.hr.source import HRSource
from suite.utils.lock import acquire_lock, release_lock

if TYPE_CHECKING:
    from suite.calendar.doctype.hr_calendar_sync_settings.hr_calendar_sync_settings import (
        HRCalendarSyncSettings,
    )

SETTINGS = "HR Calendar Sync Settings"

# What these calendars are kept by, so which of the site's external calendars are this sync's.
SOURCE = "Frappe HR"

# What each calendar is found by on the next run: a holiday list's by its name in HR.
HOLIDAYS_KEY = "holidays:"
BIRTHDAYS_KEY = "birthdays"
ANNIVERSARIES_KEY = "anniversaries"

LOCK = "hr_calendar_sync"
# Longer than a run takes: a worker that dies mid-run frees the lock by this, not never.
LOCK_TIMEOUT = 1800


@dataclass(frozen=True)
class RunResult:
    """What one run did.

    `calendars` is what was done to each calendar, by the key it is kept by: a holiday list is
    named as HR names it, so its name alone could be a birthdays calendar's. `not_updated` is the
    holiday calendars kept here that the run left as they were: lists HR no longer names, or that
    the settings leave out, or every one while holidays are switched off.
    """

    calendars: dict[str, dict]
    not_updated: list[str]


def sync_hr_calendars_hourly() -> dict:
    """The scheduler's run, once the settings are enabled. Sync Now does not come through here: it
    runs whether or not the sync is enabled, so a site can try it before switching it on."""

    if not frappe.db.get_single_value(SETTINGS, "enabled"):
        return {}
    return sync_hr_calendars()


def sync_hr_calendars() -> dict:
    """One run, now, and what it did, as the job's result. One at a time, whoever asks: two at
    once would each find a calendar missing and make it."""

    identifier = acquire_lock(LOCK, lock_timeout=LOCK_TIMEOUT)
    if not identifier:
        return {}
    try:
        return asdict(reported_plainly(_run, remember=True))
    finally:
        release_lock(LOCK, identifier)


def reported_plainly[T](work: Callable[[], T], remember: bool = False) -> T:
    """`work`, with a failure reported without the variables of the frames it failed in.

    Frappe writes a failing job's traceback to the Error Log with the local variables of every
    frame, and the frames under this one hold the HR key and employees' names and birth dates.
    So a failure is caught here: what was written is rolled back, the traceback is logged without
    variables, and a plain error is raised with nothing behind it. Where `remember`, the settings'
    Last Error says what went wrong too.
    """

    try:
        return work()
    except Exception as e:
        # A message this sync throws says what went wrong and holds nothing private. Anything else
        # may hold anything, and is named by its type alone.
        message = str(e) if isinstance(e, frappe.ValidationError) else type(e).__name__
        traceback = frappe.get_traceback(with_context=False)
        del e
        frappe.db.rollback()
        frappe.log_error(title="HR Calendar Sync failed", message=traceback)
        if remember:
            frappe.db.set_single_value(SETTINGS, "last_error", message)
        frappe.db.commit()  # nosemgrep: what went wrong has to outlive the rollback
        raise frappe.ValidationError(_("The HR calendar sync failed: {0}").format(message)) from None


def _run() -> RunResult:
    # Read fresh rather than from the cache: the run acts on what is saved now.
    settings: HRCalendarSyncSettings = frappe.get_doc(SETTINGS)
    result = sync(settings, settings.hr_source())
    frappe.db.set_single_value(
        SETTINGS,
        {
            "last_sync": now_datetime(),
            "last_error": None,
            "lists_not_updated": "\n".join(result.not_updated),
        },
    )
    return result


def sync(settings: HRCalendarSyncSettings, source: HRSource) -> RunResult:
    """Makes this site's HR calendars say what `source` says, as `settings` choose."""

    kept = dict(frappe.get_all("External Calendar", {"source": SOURCE}, ["source_key", "name"], as_list=True))
    calendars: dict[str, dict] = {}

    if settings.sync_birthdays or settings.sync_anniversaries:
        employees = source.employees()
    else:
        employees = []
    for key, on, name, color, events in (
        (BIRTHDAYS_KEY, settings.sync_birthdays, _("Birthdays"), settings.birthdays_color, birthday_events),
        (
            ANNIVERSARIES_KEY,
            settings.sync_anniversaries,
            _("Work anniversaries"),
            settings.anniversaries_color,
            anniversary_events,
        ),
    ):
        if on:
            # Unticked until a reader asks: across a company there is one most days.
            calendar = upsert_calendar(SOURCE, key, name, color=color)
            calendars[key] = replace_events(calendar, events(employees))
        elif key in kept:
            # Switched off: an administrator's word that these should not be shown, birth dates
            # least of all, so the calendar goes with what is on it.
            remove_calendar(kept[key])
            calendars[key] = {"removed_calendar": True}

    # Switched off, every holiday calendar stays as it was, so each one is not updated.
    lists: list[str] = []
    if settings.sync_holidays:
        chosen = settings.chosen_holiday_lists()
        lists = [name for name in source.holiday_lists() if not chosen or name in chosen]
        for holiday_list in lists:
            # Ticked from the start: a closed office is news to everyone it is drawn for.
            key = f"{HOLIDAYS_KEY}{holiday_list}"
            calendar = upsert_calendar(
                SOURCE, key, holiday_list, color=settings.holidays_color, starts_visible=True
            )
            calendars[key] = replace_events(
                calendar, holiday_events(holiday_list, source.holidays(holiday_list))
            )

    # Kept, and no longer updated. A list can drop out of HR's answer without being deleted
    # there (the key lost read on it, or it was renamed), and removing it would throw away
    # who an administrator assigned it to. They delete it when it should go.
    not_updated = sorted(
        key.removeprefix(HOLIDAYS_KEY)
        for key in kept
        if key.startswith(HOLIDAYS_KEY) and key.removeprefix(HOLIDAYS_KEY) not in lists
    )

    return RunResult(calendars=calendars, not_updated=not_updated)
