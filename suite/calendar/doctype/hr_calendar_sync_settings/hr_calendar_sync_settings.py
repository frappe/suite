# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document

from suite.calendar.hr.source import HRSource, validate_site_url
from suite.calendar.hr.sync import reported_plainly


class HRCalendarSyncSettings(Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        anniversaries_color: DF.Color | None
        api_key: DF.Password | None
        api_secret: DF.Password | None
        birthdays_color: DF.Color | None
        enabled: DF.Check
        holiday_lists: DF.SmallText | None
        holidays_color: DF.Color | None
        hr_site_url: DF.Data | None
        last_error: DF.SmallText | None
        last_sync: DF.Datetime | None
        lists_not_updated: DF.SmallText | None
        sync_anniversaries: DF.Check
        sync_birthdays: DF.Check
        sync_holidays: DF.Check
    # end: auto-generated types

    def validate(self) -> None:
        self.hr_site_url = validate_site_url(self.hr_site_url)
        self.validate_key_goes_where_it_was_made_for()

    def validate_key_goes_where_it_was_made_for(self) -> None:
        """A saved key is sent only to the site it was saved for. Pointed at another address, the
        settings would send it there in a header on the next run, so a new address needs both the
        key and the secret typed again: either one left as saved would still be sent."""

        if not self.hr_site_url or not self.has_value_changed("hr_site_url"):
            return
        if any(value and self.is_dummy_password(value) for value in (self.api_key, self.api_secret)):
            frappe.throw(_("Enter the API key and secret again: the saved ones are for another HR site."))

    def hr_source(self) -> HRSource:
        key = self.get_password("api_key", raise_exception=False)
        secret = self.get_password("api_secret", raise_exception=False)
        return HRSource(self.hr_site_url, f"token {key}:{secret}" if key and secret else "")

    def chosen_holiday_lists(self) -> set[str]:
        """The lists named in the settings. None named is every list."""

        return {line.strip() for line in (self.holiday_lists or "").splitlines() if line.strip()}

    @frappe.whitelist(methods=["POST"])
    def test_connection(self) -> dict:
        """What the saved settings can see in HR, before a sync is trusted to write anything."""

        settings = saved_settings()
        return reported_plainly(settings._test_connection)

    def _test_connection(self) -> dict:
        source = self.hr_source()
        employees = source.employees()
        holiday_lists = source.holiday_lists()
        return {
            "employees": len(employees),
            "with_birth_date": sum(1 for employee in employees if employee.get("date_of_birth")),
            "with_joining_date": sum(1 for employee in employees if employee.get("date_of_joining")),
            "holiday_lists": holiday_lists,
            # Typed by hand, and a name HR doesn't have would quietly sync nothing.
            "unknown_holiday_lists": sorted(self.chosen_holiday_lists() - set(holiday_lists)),
        }

    @frappe.whitelist(methods=["POST"])
    def sync_now(self) -> None:
        """Runs the sync once in the background, whether or not it is enabled. What it did lands in
        Last Sync, or in Last Error."""

        saved_settings()
        frappe.enqueue(
            "suite.calendar.hr.sync.sync_hr_calendars",
            queue="long",
            timeout=1800,
            # One job whoever asks: with the lock in the sync, two administrators, or one and the
            # hourly run, can't reconcile the same calendars at once.
            job_id="hr-calendar-sync",
            deduplicate=True,
            enqueue_after_commit=True,
        )


def saved_settings() -> HRCalendarSyncSettings:
    """The settings as saved, for someone allowed to change them.

    A document method is handed whatever document the browser sends, unsaved edits and all. These
    methods reach another site, so they act on what was saved, never on an address that arrived
    with the request.
    """

    settings = frappe.get_doc("HR Calendar Sync Settings")
    settings.check_permission("write")
    return settings
