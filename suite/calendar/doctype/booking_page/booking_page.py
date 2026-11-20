# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

"""A public page where someone outside the company picks a free time with a host
(specs/calendar/003-booking-pages.md, "The page" and "Settings").

The page is kept on the site; the mail server has nothing for it. Its hosts are a list so that
team pages fit later, but a page holds exactly one host for now, and only a page's hosts may
change it.
"""

import re
from datetime import time, timedelta
from itertools import pairwise
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import get_system_timezone, to_timedelta

from suite import mail

WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")

# What a new page offers when the host names no hours of their own (§Settings).
DEFAULT_HOURS = tuple((day, "09:00:00", "17:00:00") for day in WEEKDAYS[:5])

# Bounds that keep a page's slot grid a size the server can work out per request.
MAX_LENGTH = 24 * 60
MAX_DAYS_AHEAD = 365

SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
MAX_SLUG = 80


class BookingPage(Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        from suite.calendar.doctype.booking_page_host.booking_page_host import BookingPageHost
        from suite.calendar.doctype.booking_page_hours.booking_page_hours import BookingPageHours

        buffer: DF.Int
        days_ahead: DF.Int
        description: DF.SmallText | None
        enabled: DF.Check
        hosts: DF.Table[BookingPageHost]
        length: DF.Int
        minimum_notice: DF.Int
        slot_interval: DF.Literal["Length", "15", "30"]
        slug: DF.Data | None
        time_zone: DF.Autocomplete | None
        title: DF.Data
        weekly_hours: DF.Table[BookingPageHours]
    # end: auto-generated types

    def before_insert(self) -> None:
        if not self.weekly_hours:
            for weekday, start, end in DEFAULT_HOURS:
                self.append("weekly_hours", {"weekday": weekday, "start_time": start, "end_time": end})

    def validate(self) -> None:
        # The model holds a list for team pages; the rest of v1 is built for one host.
        if len(self.hosts) != 1:
            frappe.throw(_("A booking page has exactly one host."))
        self._validate_editor()
        self._validate_hosts()
        self._validate_slug()
        self._validate_times()
        self._validate_time_zone()
        self._validate_weekly_hours()

    def _validate_editor(self) -> None:
        """Only a page's hosts change it (§The page). On a change it is the saved page's hosts
        who may, so nobody makes a page theirs by adding themselves to it."""

        before = self.get_doc_before_save()
        hosts = host_users(before) if before else host_users(self)
        if frappe.session.user not in hosts:
            frappe.throw(_("Only the page's hosts can change it."), frappe.PermissionError)

    def _validate_hosts(self) -> None:
        for host in self.hosts:
            account = mail.personal_account(host.user)
            if not account:
                frappe.throw(_("{0} has no calendar to take bookings.").format(frappe.bold(host.user)))
            if not host.calendar:
                host.calendar = _default_calendar(account)
            # Busy time is read from the account the calendar is in, so it must be the host's
            # own: a calendar shared with the host is someone else's time (002 §Your own conflicts).
            if host.calendar.partition("|")[0] != account:
                frappe.throw(
                    _("Bookings for {0} must go to one of their own calendars.").format(
                        frappe.bold(host.user)
                    )
                )

    def _validate_slug(self) -> None:
        """The slug names the page's address, /book/<slug>, and starts from the title (§The link)."""

        self.slug = (self.slug or "").strip().lower() or slugify(self.title)
        if not SLUG.match(self.slug) or len(self.slug) > MAX_SLUG:
            frappe.throw(_("A slug is lowercase letters and digits, with single hyphens between them."))
        if frappe.db.exists("Booking Page", {"slug": self.slug, "name": ("!=", self.name)}):
            frappe.throw(_("Another booking page is at {0}.").format(frappe.bold(self.slug)))

    def _validate_times(self) -> None:
        if not 0 < self.length <= MAX_LENGTH:
            frappe.throw(_("The length is between 1 minute and 24 hours."))
        if self.buffer < 0 or self.minimum_notice < 0:
            frappe.throw(_("The buffer and the minimum notice cannot be negative."))
        if not 1 <= self.days_ahead <= MAX_DAYS_AHEAD:
            frappe.throw(_("Days ahead is between 1 and {0}.").format(MAX_DAYS_AHEAD))

    def _validate_time_zone(self) -> None:
        if not self.time_zone:
            host = self.hosts[0].user
            self.time_zone = frappe.db.get_value("User", host, "time_zone") or get_system_timezone()
        try:
            ZoneInfo(self.time_zone)
        except (ZoneInfoNotFoundError, ValueError):
            frappe.throw(_("{0} is not a time zone.").format(frappe.bold(self.time_zone)))

    def _validate_weekly_hours(self) -> None:
        by_day: dict[str, list[tuple[timedelta, timedelta]]] = {}
        for row in self.weekly_hours:
            start, end = hours_span(row)
            if end <= start:
                frappe.throw(_("Row {0}: the hours must end after they start.").format(row.idx))
            by_day.setdefault(row.weekday, []).append((start, end))

        for weekday, spans in by_day.items():
            spans.sort()
            for (_start, end), (next_start, _end) in pairwise(spans):
                if next_start < end:
                    frappe.throw(_("The hours on {0} overlap.").format(_(weekday)))


def host_users(page: Document) -> set[str]:
    return {host.user for host in page.hosts}


def hours_span(row: Document) -> tuple[timedelta, timedelta]:
    """A weekly-hours row as offsets from midnight. An end of 00:00 is the midnight that ends the
    day, since a Time field cannot hold 24:00."""

    start = to_timedelta(row.start_time) if not isinstance(row.start_time, time) else _since(row.start_time)
    end = to_timedelta(row.end_time) if not isinstance(row.end_time, time) else _since(row.end_time)
    return start, end or timedelta(days=1)


def _since(value: time) -> timedelta:
    return timedelta(hours=value.hour, minutes=value.minute, seconds=value.second)


def slugify(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (title or "").lower()).strip("-")[:MAX_SLUG].strip("-")


def _default_calendar(account: str) -> str:
    from suite.calendar.api import MAX_CALENDARS
    from suite.calendar.doctype.calendar.calendar import fetch_calendars

    calendar = next(
        (c["name"] for c in fetch_calendars(account, limit=MAX_CALENDARS) if c.get("default")), None
    )
    if not calendar:
        frappe.throw(_("Pick the calendar bookings go to."))
    return calendar


def has_permission(doc: Document, ptype: str, user: str | None = None) -> bool:
    """A page is its hosts' alone: nobody else reads or changes it in Desk. The public page
    reads what a booker may see through `suite.calendar.booking`, not through this."""

    user = user or frappe.session.user
    if doc.is_new() and ptype == "create":
        return True
    return user in host_users(doc)


def get_permission_query_conditions(user: str | None = None) -> str:
    user = user or frappe.session.user
    return (
        "exists (select 1 from `tabBooking Page Host` host"
        " where host.parent = `tabBooking Page`.name"
        " and host.parenttype = 'Booking Page'"
        f" and host.user = {frappe.db.escape(user)})"
    )
