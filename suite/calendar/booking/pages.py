"""A Booking Page as the free-slot work reads it, from the row a host saved."""

from dataclasses import dataclass
from datetime import timedelta
from zoneinfo import ZoneInfo

import frappe
from frappe import _

from suite.calendar.booking.slots import Host, Schedule
from suite.calendar.doctype.booking_page.booking_page import WEEKDAYS, hours_span


@dataclass(frozen=True)
class LoadedPage:
    slug: str
    title: str
    description: str | None
    hosts: tuple[Host, ...]
    public_hosts: list[dict]
    schedule: Schedule


def load_public(slug: str) -> LoadedPage:
    """The enabled page at `slug`. A page that is switched off, or whose host can no longer sign
    in, answers exactly as one that does not exist (003 §The link)."""

    name = frappe.db.get_value("Booking Page", {"slug": (slug or "").strip().lower(), "enabled": 1})
    page = frappe.get_doc("Booking Page", name) if name else None
    people = [_signed_in_person(host.user) for host in page.hosts] if page else []
    if not people or None in people:
        raise frappe.DoesNotExistError(_("That booking page does not exist."))

    return LoadedPage(
        slug=page.slug,
        title=page.title,
        description=page.description or None,
        hosts=tuple(Host(host.user, host.calendar) for host in page.hosts),
        public_hosts=people,
        schedule=schedule_of(page),
    )


def _signed_in_person(user: str) -> dict | None:
    """The name and photo a booker sees of a host, or None when the host can no longer sign in."""

    row = frappe.db.get_value("User", user, ["full_name", "user_image", "enabled"], as_dict=True)
    if not row or not row.enabled:
        return None
    return {"full_name": row.full_name or user, "user_image": row.user_image or None}


def schedule_of(page) -> Schedule:
    """The page's settings as a `Schedule`. `Length` starts slots one length apart (§Settings)."""

    length = timedelta(minutes=page.length)
    hours: dict[int, list[tuple[timedelta, timedelta]]] = {}
    for row in page.weekly_hours:
        hours.setdefault(WEEKDAYS.index(row.weekday), []).append(hours_span(row))
    return Schedule(
        length=length,
        interval=length if page.slot_interval == "Length" else timedelta(minutes=int(page.slot_interval)),
        buffer=timedelta(minutes=page.buffer or 0),
        minimum_notice=timedelta(minutes=page.minimum_notice or 0),
        days_ahead=page.days_ahead,
        zone=ZoneInfo(page.time_zone),
        weekly_hours={day: sorted(spans) for day, spans in hours.items()},
    )
