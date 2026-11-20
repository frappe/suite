"""Booking pages: the free slots a page offers, and what a booker may see of a page
(specs/calendar/003-booking-pages.md).

`free_slots` works out slot starts from a page's settings, its hosts and a rule for combining
their free time; v1 has one rule, "every host is free". A host's busy time is read from their own
events on the mail server and follows the busy rules of specs/calendar/002-availability.md.
Each call reads every host's events for the window once, so its cost is one mail-server round
trip per host.

`public_page` is what the public page asks for, without signing in. A page that is switched off
answers as one that does not exist: both raise `frappe.DoesNotExistError` with the same message.
Nothing about what a host is doing leaves this module, only when slots start.

Neither call writes anything.
"""

from datetime import UTC, datetime, timedelta
from typing import TypedDict

import frappe
from frappe import _

from suite.calendar.booking.slots import EVERY_HOST_FREE, CombiningRule, Host, Schedule

__all__ = [
    "EVERY_HOST_FREE",
    "MAX_RANGE",
    "CombiningRule",
    "Host",
    "PublicHost",
    "PublicPage",
    "Schedule",
    "free_slots",
    "public_page",
]

# The widest window one lookup answers: a month's grid, with the days either side of it.
MAX_RANGE = timedelta(days=42)


class PublicHost(TypedDict):
    full_name: str
    user_image: str | None


class PublicPage(TypedDict):
    title: str
    description: str | None
    hosts: list[PublicHost]
    length: int
    time_zone: str
    slots: list[datetime]


def free_slots(
    hosts: list[Host],
    rule: CombiningRule,
    start: datetime,
    end: datetime,
    *,
    schedule: Schedule,
    now: datetime | None = None,
) -> list[datetime]:
    """The slot starts in [start, end) the page offers, earliest first, as UTC instants.

    A slot is offered when it lies inside the weekly hours, starts on the page's grid, meets the
    minimum notice and how far ahead (counted in the page's zone), and the hosts are free for it,
    by `rule`, with the buffer on each side (003 §Free time).
    """

    from suite.calendar.booking import busy, slots

    now = now or datetime.now(UTC)
    found = slots.candidates(schedule, start, end, now)
    if not found or not hosts:
        return []

    window_start = found[0] - schedule.buffer
    window_end = found[-1] + schedule.length + schedule.buffer
    busy_by_host = [busy.busy_spans(host, window_start, window_end) for host in hosts]
    return [
        slot
        for slot in found
        if slots.combine(rule, [slots.is_free(slot, schedule, spans) for spans in busy_by_host])
    ]


def public_page(slug: str, start: datetime, end: datetime, *, now: datetime | None = None) -> PublicPage:
    """What the public page at /book/<slug> shows: the page and its free slots in [start, end).

    Raises `frappe.DoesNotExistError` for a page that is missing or switched off, alike, and
    `frappe.ValidationError` for a window that ends before it starts or is wider than
    `MAX_RANGE`. Works for a guest: the page is read here, not through Desk permissions.
    """

    from suite.calendar.booking.pages import load_public

    if end <= start:
        frappe.throw(_("The end must be after the start."), frappe.ValidationError)
    if end - start > MAX_RANGE:
        frappe.throw(
            _("Free times are looked up for at most {0} days.").format(MAX_RANGE.days), frappe.ValidationError
        )

    page = load_public(slug)
    return {
        "title": page.title,
        "description": page.description,
        "hosts": page.public_hosts,
        "length": int(page.schedule.length.total_seconds() // 60),
        "time_zone": page.schedule.zone.key,
        "slots": free_slots(list(page.hosts), EVERY_HOST_FREE, start, end, schedule=page.schedule, now=now),
    }
