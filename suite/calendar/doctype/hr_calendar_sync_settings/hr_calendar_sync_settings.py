# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document

from suite.calendar.hr.source import HRSource, validate_site_url
from suite.mail.doctype.user_account.user_account import get_user_jmap_accounts


class HRCalendarSyncSettings(Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        account: DF.Link | None
        anniversaries_calendar: DF.Data | None
        anniversaries_color: DF.Color | None
        api_key: DF.Data | None
        api_secret: DF.Password | None
        birthdays_calendar: DF.Data | None
        birthdays_color: DF.Color | None
        enabled: DF.Check
        holiday_lists: DF.SmallText | None
        holidays_color: DF.Color | None
        hr_site_url: DF.Data | None
        last_error: DF.SmallText | None
        last_sync: DF.Datetime | None
        sync_anniversaries: DF.Check
        sync_birthdays: DF.Check
        sync_holidays: DF.Check
    # end: auto-generated types

    def validate(self) -> None:
        self.hr_site_url = validate_site_url(self.hr_site_url)

        if not self.enabled:
            return

        # Reachable as the service account, or the sync has nowhere to write. The user the
        # account belongs to is who the sync acts as, and only they hold its password.
        if not get_user_jmap_accounts_for(self.account):
            frappe.throw(
                _("No user on this site can reach the account {0}.").format(frappe.bold(self.account))
            )

    def hr_source(self) -> HRSource:
        return HRSource(
            self.hr_site_url, self.api_key, self.get_password("api_secret", raise_exception=False)
        )

    def chosen_holiday_lists(self) -> set[str]:
        """The lists named in the settings; empty means every list an employee follows."""

        return {line.strip() for line in (self.holiday_lists or "").splitlines() if line.strip()}

    @frappe.whitelist()
    def test_connection(self) -> dict:
        """What the settings can actually see, before a sync is trusted to run: HR's answer to
        each question the sync asks, and whether the service account can be written to."""

        # It reaches HR and the mail server and reports what they hold, so it asks for the right
        # to change the settings rather than the right to read them.
        self.check_permission("write")

        source = self.hr_source()
        employees = source.employees()
        report = {
            "employees": len(employees),
            "with_birth_date": sum(1 for employee in employees if employee.get("date_of_birth")),
            "with_joining_date": sum(1 for employee in employees if employee.get("date_of_joining")),
            "with_mail_address": sum(1 for employee in employees if employee.get("user_id")),
            "holiday_lists": source.holiday_lists(),
        }

        from suite.mail.jmap import get_calendar_service

        report["calendars"] = [calendar["name"] for calendar in get_calendar_service(self.account).get()]
        return report

    @frappe.whitelist()
    def sync_now(self) -> dict:
        from suite.calendar.hr.sync import sync_hr_calendars

        self.check_permission("write")
        return sync_hr_calendars()


def get_user_jmap_accounts_for(account: str | None) -> list[str]:
    """The users who can reach an account, if any."""

    if not account:
        return []
    return frappe.get_all("User Account", {"account": account}, pluck="user")


def sync_hr_calendars_daily() -> None:
    """The scheduled run. Nothing happens until an admin fills the settings in and enables it."""

    from suite.calendar.hr.sync import sync_hr_calendars

    if not frappe.db.get_single_value("HR Calendar Sync Settings", "enabled"):
        return

    sync_hr_calendars()
