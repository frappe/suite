"""How a source writes the calendars this site keeps on its behalf.

What a source has to do is in three calls: `upsert_calendar` for the calendar, `replace_events`
for what is on it, `replace_assignments` for who sees it. Each replaces rather than adds, so a
run is repeatable and what the source no longer has goes. `external` reads what they wrote.
"""

from collections.abc import Iterable
from uuid import uuid7

import frappe
from frappe.database.database import savepoint
from frappe.utils import get_datetime, now_datetime

from suite.calendar.doctype.external_calendar_event.external_calendar_event import month_day_of
from suite.calendar.external import EVENT_FIELDS


def upsert_calendar(
    source: str, source_key: str, calendar_name: str, color: str | None = None, site_wide: bool = False
) -> str:
    """The calendar this source keeps for `source_key`, made if it isn't there yet.

    Its name, its colour and whether it is site-wide are written on every run, not only the day
    it was made: changed where the source states them, they are changed here.
    """

    existing = frappe.db.get_value(
        "External Calendar",
        {"source": source, "source_key": source_key},
        ["name", "calendar_name", "color", "site_wide"],
        as_dict=True,
    )
    wanted = {"calendar_name": calendar_name, "color": color, "site_wide": int(site_wide)}

    if not existing:
        # The lookup above is not a guarantee — another writer can insert between it and this,
        # and the table's unique index is what settles it. Theirs is as good as ours, so the
        # loser reads it back rather than failing a run over which of two identical calendars
        # was made first. A locking read, since a plain one answers from this transaction's
        # snapshot, taken before the winner committed, and finds nothing. A server keeping
        # snapshot isolation (MariaDB 11.6 on) refuses that read as a deadlock instead, and a
        # background job is retried on one: the retry's lookup finds the winner's calendar.
        made = None
        with savepoint(catch=frappe.UniqueValidationError):
            calendar = frappe.new_doc("External Calendar")
            calendar.update({"source": source, "source_key": source_key, **wanted})
            calendar.insert(ignore_permissions=True)
            made = calendar.name
        return made or frappe.db.get_value(
            "External Calendar", {"source": source, "source_key": source_key}, "name", for_update=True
        )

    if any(existing.get(field) != value for field, value in wanted.items()):
        frappe.db.set_value("External Calendar", existing.name, wanted, update_modified=False)
    return existing.name


def replace_events(calendar: str, events: list[dict]) -> dict:
    """Makes the calendar say what the source says: what is missing is added, what differs is
    rewritten, and what the source no longer has is removed. Returns what it did."""

    stored = {
        row.uid: row
        for row in frappe.get_all(
            "External Calendar Event",
            {"calendar": calendar},
            ["name", "uid", *EVENT_FIELDS],
        )
    }
    wanted = {event["uid"]: event for event in events}

    created = [event for uid, event in wanted.items() if uid not in stored]
    changed = [
        (stored[uid].name, event)
        for uid, event in wanted.items()
        if uid in stored and _differs(stored[uid], event)
    ]
    removed = [uid for uid in stored if uid not in wanted]

    _insert_events(calendar, created)
    if changed:
        frappe.db.bulk_update(
            "External Calendar Event",
            {name: _stored_values(event) for name, event in changed},
            update_modified=False,
        )
    if removed:
        # by key rather than by row name; an empty `not in` matches every row: nothing wanted is
        # nothing kept
        frappe.db.delete("External Calendar Event", {"calendar": calendar, "uid": ("not in", list(wanted))})

    return {"created": len(created), "updated": len(changed), "removed": len(removed)}


def replace_assignments(calendar: str, users: Iterable[str]) -> int:
    """Who the calendar is assigned to, replacing whoever it was assigned to before: somebody
    the source no longer names stops seeing it on the next run. A site-wide calendar is drawn
    for everyone whatever is assigned."""

    wanted = {user for user in users if user}
    stored = set(frappe.get_all("External Calendar Assignment", {"calendar": calendar}, pluck="user"))

    if stored - wanted:
        # an empty `not in` matches every row: nobody named is nobody assigned
        frappe.db.delete(
            "External Calendar Assignment", {"calendar": calendar, "user": ("not in", list(wanted))}
        )

    if added := sorted(wanted - stored):
        _bulk_insert(
            "External Calendar Assignment", ["calendar", "user"], [[calendar, user] for user in added]
        )
    return len(wanted)


def calendars_of(source: str) -> dict[str, str]:
    """What this source keeps here, by the key it knows each calendar as."""

    return {
        row.source_key: row.name
        for row in frappe.get_all("External Calendar", {"source": source}, ["name", "source_key"])
    }


def remove_calendar(calendar: str) -> None:
    """A calendar the source no longer has, with its events and its assignments."""

    frappe.delete_doc("External Calendar", calendar, ignore_permissions=True, delete_permanently=True)


def _insert_events(calendar: str, events: list[dict]) -> None:
    rows = []
    for event in events:
        values = _stored_values(event)
        rows.append([calendar, event["uid"], *[values[field] for field in EVENT_FIELDS]])
    _bulk_insert("External Calendar Event", ["calendar", "uid", *EVENT_FIELDS], rows)


def _bulk_insert(doctype: str, fields: list[str], rows: list[list]) -> None:
    """Straight into the table, named and stamped as a save would: these rows are the source's,
    written by the hundred, and nothing hangs off saving one."""

    if not rows:
        return

    stamp = now_datetime()
    frappe.db.bulk_insert(
        doctype,
        ["name", *fields, "creation", "modified", "owner", "modified_by"],
        [[str(uuid7()), *row, stamp, stamp, "Administrator", "Administrator"] for row in rows],
    )


def _stored_values(event: dict) -> dict:
    """An event as the table holds it: every field stated, so a rewrite clears what is gone."""

    starts_on = get_datetime(event["starts_on"])
    repeats = event.get("repeats") or ""
    return {
        "title": event.get("title") or "",
        "description": event.get("description") or None,
        "starts_on": starts_on,
        "ends_on": get_datetime(event["ends_on"]) if event.get("ends_on") else starts_on,
        "all_day": 1 if event.get("all_day") else 0,
        "repeats": repeats,
        # Worked out as the event's own validate does, since these rows are written past it.
        "month_day": month_day_of(starts_on, repeats, event.get("month_day")),
    }


def _differs(stored: frappe._dict, event: dict) -> bool:
    """Whether the stored event still says what the source says."""

    values = _stored_values(event)
    for field in EVENT_FIELDS:
        has, wanted = stored.get(field), values[field]
        if has and field in ("starts_on", "ends_on"):
            has = get_datetime(has)
        if (has or None) != (wanted or None):
            return True
    return False
