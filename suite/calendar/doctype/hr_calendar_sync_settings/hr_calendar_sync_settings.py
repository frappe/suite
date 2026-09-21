# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from datetime import date

import frappe
from frappe import _
from frappe.model.document import Document

from suite.calendar.hr.source import HRSource, validate_site_url


class HRCalendarSyncSettings(Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        api_key: DF.Password | None
        api_secret: DF.Password | None
        enabled: DF.Check
        holiday_lists: DF.SmallText | None
        holidays_color: DF.Color | None
        hr_site_url: DF.Data | None
        last_error: DF.SmallText | None
        last_sync: DF.Datetime | None
        milestones_calendar: DF.Data | None
        milestones_color: DF.Color | None
        sync_anniversaries: DF.Check
        sync_birthdays: DF.Check
        sync_holidays: DF.Check
    # end: auto-generated types

    def validate(self) -> None:
        self.hr_site_url = validate_site_url(self.hr_site_url)
        self.validate_key_goes_where_it_was_made_for()
        # A calendar needs a name, and a settings document saved before the field existed has none.
        self.milestones_calendar = (self.milestones_calendar or "").strip() or "Celebrations"

    def validate_key_goes_where_it_was_made_for(self) -> None:
        """A saved key is not sent anywhere but where it was saved for: point the settings at
        another address, press Sync Now, and it would arrive there in a header. So a new address
        needs both typed again: either one left as saved would still be sent.

        This keeps a key from leaving by accident, or by a changed address nobody looked at. It
        does not keep it from this site's administrators, who can read any saved password through
        Desk — what does is a key that can do little: a user on the HR site made for the sync,
        with read access to what it reads and nothing else.
        """

        if not self.hr_site_url or not self.has_value_changed("hr_site_url"):
            return
        if any(value and self.is_dummy_password(value) for value in (self.api_key, self.api_secret)):
            frappe.throw(_("Enter the API key and secret again: the saved ones are for another HR site."))

    def hr_source(self) -> HRSource:
        # The credentials go in as something to call, not as values: see the note in source.py on
        # what a failing job's traceback writes to the Error Log.
        return HRSource(self.hr_site_url, self._authorization)

    def _authorization(self) -> str:
        if not (self.api_key and self.api_secret):
            return ""
        return "token {}:{}".format(
            self.get_password("api_key", raise_exception=False) or "",
            self.get_password("api_secret", raise_exception=False) or "",
        )

    def chosen_holiday_lists(self) -> set[str]:
        """The lists named in the settings; empty means every list an employee follows."""

        return {line.strip() for line in (self.holiday_lists or "").splitlines() if line.strip()}

    @frappe.whitelist(methods=["POST"])
    def test_connection(self) -> dict:
        """What the settings can actually see, before a sync is trusted to run: HR's answer to
        each question the sync asks, and what it is keeping here already."""

        return saved_settings()._test_connection()

    def _test_connection(self) -> dict:
        from suite.calendar.hr.sync import SOURCE, _holiday_lists, _site_users

        source = self.hr_source()
        employees = source.employees()
        followers = _holiday_lists(self, source, employees, date.today())
        holiday_lists = source.holiday_lists()
        return {
            "employees": len(employees),
            "with_birth_date": sum(1 for employee in employees if employee.get("date_of_birth")),
            "with_joining_date": sum(1 for employee in employees if employee.get("date_of_joining")),
            # Who HR named that this site knows: anyone else has nowhere to be shown a calendar.
            "with_mail_address": len(_site_users([employee.get("user_id") for employee in employees])),
            "holiday_lists": holiday_lists,
            # Typed by hand, and a name HR doesn't have would quietly sync nothing.
            "unknown_holiday_lists": sorted(self.chosen_holiday_lists() - set(holiday_lists)),
            # Who the sync would draw each list for, resolved as HR resolves it.
            "followers": {name: len(people) for name, people in followers.items()},
            # What the last run left on this site, so the form says what is actually being kept.
            "calendars": sorted(
                frappe.get_all("External Calendar", {"source": SOURCE}, pluck="calendar_name")
            ),
        }

    @frappe.whitelist(methods=["POST"])
    def sync_now(self) -> None:
        """Runs the sync in the background: it reads HR and writes a calendar per holiday list,
        which is more than a web worker should be held open for. What it did lands in Last Sync,
        or in Last Error."""

        self.check_permission("write")
        frappe.enqueue(
            "suite.calendar.hr.sync.sync_hr_calendars",
            queue="long",
            timeout=1800,
            # One identity whoever asks: with the lock in the sync itself, two administrators, or
            # one and the daily run, can't reconcile the same calendars at once.
            job_id="hr-calendar-sync",
            deduplicate=True,
        )


def saved_settings() -> HRCalendarSyncSettings:
    """The settings as saved, for someone allowed to change them.

    A document method is handed whatever document the browser sends, unsaved edits and all. These
    methods reach another site, so they act on what an administrator saved — never on an address
    that arrived with the request.
    """

    settings = frappe.get_doc("HR Calendar Sync Settings")
    settings.check_permission("write")
    return settings
