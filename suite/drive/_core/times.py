"""The one conversion between stored times and times on the wire.

The database stores every Drive time naive, in the site's zone
(`frappe.utils.get_system_timezone()`). The wire never sees that form: HTTP
and WebDAV both publish RFC 3339 in UTC with a `Z`, such as
`2026-10-03T06:30:00Z`, and both accept only a time that carries its offset.
A browser then formats every time in the viewer's zone, and the two
protocols publish the identical string for the same row.
"""

from datetime import UTC, date, datetime, time
from zoneinfo import ZoneInfo

import frappe
from frappe import _
from frappe.utils import get_datetime, get_system_timezone

WIRE_FORMAT = "%Y-%m-%dT%H:%M:%SZ"


def site_zone() -> ZoneInfo:
    return ZoneInfo(get_system_timezone())


def to_utc(value: datetime | date | str) -> datetime:
    """A stored site-naive time as an aware UTC instant.

    A naive site-local stamp is ambiguous during the DST fall-back hour;
    `fold=0` picks the earlier instant, the best the lost offset allows.
    """
    instant: datetime
    if isinstance(value, datetime):
        instant = value
    elif isinstance(value, date):
        instant = datetime.combine(value, time.min)
    else:
        parsed = get_datetime(value)
        if parsed is None:
            raise frappe.ValidationError(_("{0} is not a time").format(value))
        instant = parsed
    if instant.tzinfo is None:
        instant = instant.replace(tzinfo=site_zone())
    return instant.astimezone(UTC)


def to_site_naive(value: datetime) -> datetime:
    """An aware instant as the naive site-local form the database stores."""
    if value.tzinfo is None:
        return value
    return value.astimezone(site_zone()).replace(tzinfo=None)


def publish(value: datetime | date | str | None) -> str | None:
    """One stored time as the wire publishes it, to the second: `2026-10-03T06:30:00Z`."""
    if value is None or value == "":
        return None
    return to_utc(value).strftime(WIRE_FORMAT)


def parse(value: object, field: str) -> datetime:
    """One time as the wire accepts it, returned site-naive for storage.

    The input must be RFC 3339 with an offset or `Z`. A naive string would be
    read in the site's zone, which the sender does not know, so it is refused
    rather than guessed.
    """
    if isinstance(value, datetime) and value.tzinfo is not None:
        return to_site_naive(value)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.strip())
        except ValueError:
            parsed = None
        if parsed is not None and parsed.tzinfo is not None:
            return to_site_naive(parsed)
    raise frappe.ValidationError(
        _("{0} must be an RFC 3339 time with its UTC offset, such as 2026-10-03T06:30:00Z").format(field)
    )
