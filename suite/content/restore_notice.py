"""What a restore tells people: the name of the version kept before it, and the notice other tabs show."""

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import frappe
from frappe import _
from frappe.utils import format_datetime, get_system_timezone

from suite import drive


def restored_version(node: str, seq: int) -> dict | None:
    """The Drive version a restore brings back; None when the node has no such version."""
    try:
        return drive.get_version(node, seq)
    except drive.DriveNotFound:
        return None


def before_restoring_label(version: dict | None, seq: int) -> str:
    """Names the version kept before a restore after the version restored: its name, or when it was taken."""
    if version is None:
        return _("Before restoring version {0}").format(seq)

    if version["label"]:
        return _("Before restoring “{0}”").format(version["label"])

    return _("Before restoring the version from {0}").format(local_time(version["creation"]))


def local_time(stored: datetime) -> str:
    """A stored time in the person's own time zone: the time today, with the date on other days."""
    zone = frappe.db.get_value("User", frappe.session.user, "time_zone") or get_system_timezone()
    moment = site_aware(stored).astimezone(ZoneInfo(zone))
    today = datetime.now(ZoneInfo(zone)).date()
    pattern = "h:mm a" if moment.date() == today else "d MMM, h:mm a"
    return format_datetime(moment.replace(tzinfo=None), pattern)


def notice(version: dict | None) -> dict:
    """What other tabs are told once the restore lands: who ran it and which version it brought back."""
    restored = None
    if version is not None:
        taken_at = site_aware(version["creation"]).astimezone(UTC).isoformat(timespec="seconds")
        restored = {"seq": version["seq"], "label": version["label"], "taken_at": taken_at}

    return {"by": frappe.session.user, "version": restored}


def site_aware(stored: datetime) -> datetime:
    """Stored times are naive in the site's zone."""
    return stored.replace(tzinfo=ZoneInfo(get_system_timezone()))
