# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from datetime import date

import frappe
from frappe import _
from frappe.model.document import Document

from suite.calendar.hr.source import HRSource, validate_site_url
from suite.mail.doctype.user_account.user_account import get_jmap_account_owner


class HRCalendarSyncSettings(Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        account: DF.Link | None
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
        synced_calendars: DF.LongText | None
    # end: auto-generated types

    def validate(self) -> None:
        self.hr_site_url = validate_site_url(self.hr_site_url)
        self.validate_key_goes_where_it_was_made_for()
        # A calendar needs a name, and a settings document saved before the field existed has none.
        self.milestones_calendar = (self.milestones_calendar or "").strip() or "Celebrations"

        if not self.enabled:
            return

        self.validate_service_account()

    def validate_service_account(self) -> None:
        """Reachable, and somebody's own login.

        The user the account belongs to is who the sync acts as, and only they hold its password:
        without one the sync has nowhere to write. And a group's calendars can be written to by
        every member of it, which would put the holidays and everyone's birthday in the hands of
        whoever is in the group — so an account that is only shared with the people linked to it,
        a group or somebody else's mailbox, is refused rather than advised against.
        """

        from suite.mail.jmap import get_jmap_connection

        owner = get_jmap_account_owner(self.account)
        if not owner:
            frappe.throw(
                _("No user on this site can reach the account {0}.").format(frappe.bold(self.account))
            )

        details = get_jmap_connection(owner).accounts.get(self.account) or {}
        if not details.get("isPersonal"):
            frappe.throw(
                _("The service account must be a mailbox of its own, not a group or one shared with you.")
            )

    def validate_key_goes_where_it_was_made_for(self) -> None:
        """A saved secret can't be read back, but it can be sent: point the settings at another
        address, press Sync Now, and the key arrives there in a header. Whoever may edit these
        settings is not thereby a manager on the HR site. So a new address needs both typed again,
        by someone who has them: either one left as saved would still be sent."""

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

    @frappe.whitelist()
    def test_connection(self) -> dict:
        """What the settings can actually see, before a sync is trusted to run: HR's answer to
        each question the sync asks, and whether the service account can be reached."""

        return saved_settings()._test_connection()

    def _test_connection(self) -> dict:
        from suite.calendar.hr.sync import _holiday_lists
        from suite.mail.jmap import get_calendar_service

        source = self.hr_source()
        employees = source.employees()
        followers = _holiday_lists(self, source, employees, date.today())
        holiday_lists = source.holiday_lists()
        return {
            "employees": len(employees),
            "with_birth_date": sum(1 for employee in employees if employee.get("date_of_birth")),
            "with_joining_date": sum(1 for employee in employees if employee.get("date_of_joining")),
            "with_mail_address": sum(1 for employee in employees if employee.get("user_id")),
            "holiday_lists": holiday_lists,
            # Typed by hand, and a name HR doesn't have would quietly sync nothing.
            "unknown_holiday_lists": sorted(self.chosen_holiday_lists() - set(holiday_lists)),
            # Who the sync would share each list with, resolved as HR resolves it.
            "followers": {name: len(people) for name, people in followers.items()},
            "calendars": [calendar["name"] for calendar in get_calendar_service(self.account).get()],
        }

    @frappe.whitelist()
    def sync_now(self) -> None:
        """Runs the sync in the background: it reads HR and writes a calendar per holiday list,
        which is more than a web worker should be held open for. What it did lands in Last Sync,
        or in Last Error."""

        saved_settings()
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
    methods reach another site and the mail server, so they act on what an administrator saved —
    never on an address or an account that arrived with the request.
    """

    settings = frappe.get_doc("HR Calendar Sync Settings")
    settings.check_permission("write")
    return settings


def sync_hr_calendars_daily() -> None:
    """The scheduled run. Nothing happens until an admin fills the settings in and enables it."""

    from suite.calendar.hr.sync import sync_hr_calendars

    if not frappe.db.get_single_value("HR Calendar Sync Settings", "enabled"):
        return

    sync_hr_calendars()
