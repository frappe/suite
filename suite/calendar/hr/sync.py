"""Keeping the HR calendars in step with HR.

One calendar per holiday list, plus a birthdays and a work anniversaries calendar, all owned
by a service account and shared read-only with the people they are about. Every run works out
what should be on each calendar and makes the calendar say that: events HR no longer has are
removed, changed ones are rewritten, and the rest are left alone. So a run is repeatable, and
a holiday moved or cancelled in HR moves or goes here too.

The events carry no organizer and no participants. They are facts about a day, not invitations
to answer, which is also how every other calendar draws a holiday.
"""

from datetime import date
from uuid import uuid7

import frappe
from frappe import _
from frappe.utils import now_datetime

from suite.calendar.doctype.calendar.calendar import add_calendar
from suite.calendar.hr.mapping import anniversary_events, birthday_events, holiday_events
from suite.calendar.hr.source import HRSource
from suite.mail.jmap import get_calendar_event_service, get_calendar_service, get_principal_service

READ_ONLY = {
    "mayReadFreeBusy": True,
    "mayReadItems": True,
    "mayWriteAll": False,
    "mayWriteOwn": False,
    "mayUpdatePrivate": False,
    "mayRSVP": False,
    "mayShare": False,
    "mayDelete": False,
}

# What an event of ours is made of, and so what a difference is measured on.
EVENT_FIELDS = ("uid", "title", "start", "duration", "show_without_time", "description", "recurrence_rule")

JMAP_FIELDS = {
    "uid": "uid",
    "title": "title",
    "start": "start",
    "duration": "duration",
    "show_without_time": "showWithoutTime",
    "description": "description",
    "recurrence_rule": "recurrenceRule",
}


def sync_hr_calendars() -> dict:
    """The daily job, and what the settings' Sync Now runs. Returns what it did, per calendar."""

    settings = frappe.get_cached_doc("HR Calendar Sync Settings")
    if not settings.enabled:
        return {}

    source = settings.hr_source()
    account = settings.account
    employees = source.employees()
    today = date.today()
    summary = {}

    try:
        if settings.sync_holidays:
            for holiday_list, audience in _holiday_lists(settings, source, employees).items():
                summary[holiday_list] = _sync_calendar(
                    account,
                    holiday_list,
                    settings.holidays_color,
                    holiday_events(holiday_list, source.holidays(holiday_list)),
                    audience,
                )

        everyone = [employee.get("user_id") for employee in employees]
        if settings.sync_birthdays:
            summary[settings.birthdays_calendar] = _sync_calendar(
                account,
                settings.birthdays_calendar,
                settings.birthdays_color,
                birthday_events(employees, today),
                everyone,
            )
        if settings.sync_anniversaries:
            summary[settings.anniversaries_calendar] = _sync_calendar(
                account,
                settings.anniversaries_calendar,
                settings.anniversaries_color,
                anniversary_events(employees, today),
                everyone,
            )
    except Exception:
        # Without the variables, and `from None`: a failing job's traceback is written to the
        # Error Log with its frames' contents, and the frames behind a sync hold HR's credentials.
        settings.db_set({"last_error": frappe.get_traceback(with_context=False)[-2000:]}, commit=True)
        frappe.log_error(title="HR Calendar Sync failed", message=frappe.get_traceback())
        raise frappe.ValidationError(_("The HR calendar sync failed. See the Error Log.")) from None

    settings.db_set({"last_sync": now_datetime(), "last_error": None}, commit=True)
    return summary


def _holiday_lists(settings, source: HRSource, employees: list[dict]) -> dict[str, list[str]]:
    """Which holiday lists to draw, and whose calendar each belongs on.

    An employee follows their own list where they have one, and their company's otherwise —
    the same order HR itself resolves them in — so a list is shared with exactly the people
    it applies to.
    """

    chosen = settings.chosen_holiday_lists()
    default_by_company: dict[str, str | None] = {}
    audiences: dict[str, list[str]] = {}

    for employee in employees:
        company = employee.get("company")
        if company not in default_by_company:
            default_by_company[company] = source.default_holiday_list(company) if company else None

        holiday_list = employee.get("holiday_list") or default_by_company.get(company)
        if not holiday_list or (chosen and holiday_list not in chosen):
            continue
        audiences.setdefault(holiday_list, []).append(employee.get("user_id"))

    return audiences


def _sync_calendar(account: str, name: str, color: str, events: list[dict], audience: list[str]) -> dict:
    """Makes one calendar say what HR says, and shares it with the people it is about."""

    calendar_id = _ensure_calendar(account, name, color)
    result = _sync_events(account, calendar_id, events)
    result["shared_with"] = _share(account, calendar_id, audience)
    return result


def _ensure_calendar(account: str, name: str, color: str) -> str:
    """The calendar by that name in the service account, made if it isn't there yet. Matched by
    name rather than remembered, so an admin can point the sync at one they already have."""

    for calendar in get_calendar_service(account).get():
        if calendar["name"] == name:
            return calendar["id"]

    return add_calendar(account, name, color=color)


def _sync_events(account: str, calendar_id: str, events: list[dict]) -> dict:
    """Creates what is missing, rewrites what differs, and removes what HR no longer has."""

    service = get_calendar_event_service(account)
    existing = _existing_events(service, calendar_id)
    wanted = {event["uid"]: event for event in events}

    create = {
        str(uuid7()): _payload(event, calendar_id) for uid, event in wanted.items() if uid not in existing
    }
    update = {
        existing[uid]["id"]: _payload(event, calendar_id)
        for uid, event in wanted.items()
        if uid in existing and _differs(existing[uid], event)
    }
    destroy = [row["id"] for uid, row in existing.items() if uid not in wanted]

    if create:
        _raise_for_errors(service._create(create), "notCreated")
    if update:
        _raise_for_errors(service._update(update), "notUpdated")
    if destroy:
        _raise_for_errors(service._delete(destroy), "notDestroyed")

    return {"created": len(create), "updated": len(update), "removed": len(destroy)}


def _existing_events(service, calendar_id: str) -> dict[str, dict]:
    """What the sync has already put on the calendar, by uid. Anything without one was put there
    by hand and is left alone."""

    ids = service.query({"inCalendar": calendar_id}, 0, 5000).get("ids") or []
    if not ids:
        return {}

    rows = service._get(ids, properties=[*JMAP_FIELDS.values(), "id"])["methodResponses"][0][1]
    return {row["uid"]: row for row in rows.get("list") or [] if row.get("uid")}


def _payload(event: dict, calendar_id: str) -> dict:
    """The event as JMAP holds it: no organizer and no participants, and free rather than busy —
    a holiday is not an hour of anyone's day."""

    payload = {
        "@type": "Event",
        "calendarIds": {calendar_id: True},
        "freeBusyStatus": "free",
        "showWithoutTime": False,
    }
    for field in EVENT_FIELDS:
        if field in event:
            payload[JMAP_FIELDS[field]] = event[field]
    return payload


def _differs(stored: dict, event: dict) -> bool:
    """Whether the event on the server still says what HR says.

    Only what the sync writes is compared. The server fills a recurrence rule in — an interval,
    an @type — so comparing the whole of it against the rule we sent finds a difference every
    time, and every run would rewrite every birthday.
    """

    for field in EVENT_FIELDS:
        if field not in event:
            continue
        wanted, has = event[field], stored.get(JMAP_FIELDS[field])
        if isinstance(wanted, dict):
            # `@type` says what the object is, and the server does not echo it back.
            wanted = {key: value for key, value in wanted.items() if key != "@type"}
            if not isinstance(has, dict) or any(has.get(key) != value for key, value in wanted.items()):
                return True
        elif has != wanted:
            return True
    return False


def _share(account: str, calendar_id: str, emails: list[str]) -> int:
    """Shares the calendar read-only with everyone it is about, and with nobody else: the share
    is replaced, so someone who has left HR loses it on the next run. An address the mail server
    doesn't know is skipped — not everyone in HR has a mailbox here."""

    principals = _principals(account, {email for email in emails if email})
    share_with = {principal: READ_ONLY for principal in principals}

    service = get_calendar_service(account)
    stored = service._get([calendar_id], properties=["shareWith"])["methodResponses"][0][1]
    current = ((stored.get("list") or [{}])[0].get("shareWith")) or {}
    if current == share_with:
        return len(share_with)

    _raise_for_errors(service._update({calendar_id: {"shareWith": share_with}}), "notUpdated")
    return len(share_with)


def _principals(account: str, emails: set[str]) -> list[str]:
    """The mail server's id for each address, for the shares to name."""

    if not emails:
        return []

    service = get_principal_service(account)
    ids = service.query({"operator": "OR", "conditions": [{"email": email} for email in emails]}, 0, 5000)
    found = service.get(ids.get("ids") or [])
    wanted = {email.lower() for email in emails}
    return [row["id"] for row in found if (row.get("email") or "").lower() in wanted]


def _raise_for_errors(response: dict, key: str) -> None:
    method_responses = response.get("methodResponses") or []
    result = method_responses[0][1] if method_responses else {}
    if errors := result.get(key):
        frappe.throw(_("The mail server refused part of the sync: {0}").format(frappe.as_json(errors)))
