"""The slot grid of a booking page, and whether its hosts are free for a slot
(specs/calendar/003-booking-pages.md, "Settings" and "Free time").

Pure time arithmetic: nothing here reads the site or the mail server. Every instant is an aware
datetime. Weekly hours are wall-clock times in the page's zone, so a slot keeps its place on the
clock across a daylight-saving change, and a wall-clock time the change skips offers no slot.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

# How the hosts' free time combines into the page's. v1 has one rule (§Free time).
CombiningRule = Literal["every_host_free"]
EVERY_HOST_FREE: CombiningRule = "every_host_free"


@dataclass(frozen=True)
class Host:
    """A person a page books time with, and the calendar their bookings go to (`account|id`)."""

    user: str
    calendar: str


@dataclass(frozen=True)
class Span:
    """A stretch of time from its first instant up to, not including, its last."""

    start: datetime
    end: datetime

    def overlaps(self, other: Span) -> bool:
        # Two that only touch, one ending at 10:00 and the next starting then, do not (002).
        return self.start < other.end and other.start < self.end


@dataclass(frozen=True)
class Schedule:
    """When a page offers slots, as its settings say."""

    length: timedelta
    interval: timedelta
    buffer: timedelta
    minimum_notice: timedelta
    days_ahead: int
    zone: ZoneInfo
    # Offsets from midnight, by weekday (Monday is 0). An end of a whole day is the next midnight.
    weekly_hours: Mapping[int, Sequence[tuple[timedelta, timedelta]]]


def candidates(schedule: Schedule, start: datetime, end: datetime, now: datetime) -> list[datetime]:
    """The slot starts in [start, end) that the page's hours, grid, notice and horizon allow,
    earliest first, before anyone's busy time is looked at.

    The grid starts at the start of each stretch of weekly hours, so a 60-minute page with
    9:00-12:00 offers 9:00, 10:00 and 11:00; a slot that would run past the stretch's end is not
    offered. Minimum notice counts from now. How far ahead counts whole days in the page's zone
    from the start of today, so 30 days ahead offers today and the 29 days after it.
    """

    zone = schedule.zone
    today = now.astimezone(zone).date()
    earliest = max(start, now + schedule.minimum_notice)
    latest = min(end, _at(today + timedelta(days=schedule.days_ahead), timedelta(), zone))
    if earliest >= latest:
        return []

    found: list[datetime] = []
    day = earliest.astimezone(zone).date()
    while _at(day, timedelta(), zone) < latest:
        for opens, closes in schedule.weekly_hours.get(day.weekday(), ()):
            closing = _at(day, closes, zone)
            offset = opens
            while offset < closes:
                slot = _wall_clock(day, offset, zone)
                offset += schedule.interval
                if slot is None or slot + schedule.length > closing:
                    continue
                if earliest <= slot < latest:
                    found.append(slot)
        day += timedelta(days=1)
    return found


def is_free(slot: datetime, schedule: Schedule, busy: Sequence[Span]) -> bool:
    """Whether nothing in `busy` takes any of the slot or the buffer on each side of it."""

    wanted = Span(slot - schedule.buffer, slot + schedule.length + schedule.buffer)
    return not any(wanted.overlaps(span) for span in busy)


def combine(rule: CombiningRule, free_by_host: Sequence[bool]) -> bool:
    if rule == EVERY_HOST_FREE:
        return all(free_by_host)
    raise ValueError(f"Unknown combining rule {rule!r}")


def _at(day: date, offset: timedelta, zone: ZoneInfo) -> datetime:
    """The instant `offset` past the wall-clock midnight that starts `day` in `zone`, in UTC."""

    return (datetime.combine(day, time()) + offset).replace(tzinfo=zone).astimezone(UTC)


def _wall_clock(day: date, offset: timedelta, zone: ZoneInfo) -> datetime | None:
    """That wall-clock time on `day` as an instant, or None when the zone skips it that day.

    A time the zone has twice, when the clocks go back, is the first of the two.
    """

    local = datetime.combine(day, time()) + offset
    instant = local.replace(tzinfo=zone).astimezone(UTC)
    if instant.astimezone(zone).replace(tzinfo=None) != local:
        return None
    return instant
