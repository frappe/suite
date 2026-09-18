"""Keeping the HR calendars in step with HR.

One calendar per holiday list, plus a celebrations calendar for birthdays and work anniversaries,
all owned by a service account and shared read-only with the people they are about. Every run works out
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
from suite.utils.lock import acquire_lock, release_lock

LOCK = "hr_calendar_sync"
# Longer than a run takes; a worker that dies mid-run frees it by this, not never.
LOCK_TIMEOUT = 1800

# What marks an event as this sync's. Every JMAP event has a uid, so without a mark of our own
# a calendar an admin points us at would have everything else on it deleted as "no longer in HR".
UID_PREFIX = "hr-"
# The kinds a celebrations calendar holds. Switching one off removes its events: they are still
# this calendar's to reconcile, and HR's answer for them is now "none".
MILESTONES = ("hr-birthday-", "hr-anniversary-")

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
    """The daily job, and what the settings' Sync Now runs. Returns what it did, per calendar.

    Deliberately thin. Frappe writes a failing job's traceback to the Error Log with the contents
    of every frame in it, and the frames that do the work hold employees' names and birth dates.
    So the work happens in `_run`, and what is raised from here is a new error with none of those
    frames behind it; what went wrong is recorded without variables.

    One run at a time, whoever asks: two at once would each find a calendar missing and make it.
    """

    identifier = acquire_lock(LOCK, lock_timeout=LOCK_TIMEOUT)
    if not identifier:
        return {}

    try:
        return _run()
    except Exception as error:
        _record_failure(error.made if isinstance(error, RunFailed) else {})
        raise frappe.ValidationError(_("The HR calendar sync failed. See the Error Log.")) from None
    finally:
        release_lock(LOCK, identifier)


class RunFailed(Exception):
    """A run that failed after it had calendars in hand. It carries what the run made — their
    ids, which a failed run must not forget — and what went wrong as its cause."""

    def __init__(self, made: dict):
        super().__init__("The HR calendar sync failed.")
        self.made = made


def _record_failure(made: dict) -> None:
    """What went wrong, and any calendar made before it did — in the one commit a failed run
    makes. The calendar exists on the mail server whatever the database rolls back, and a run
    that forgot it would make another on every retry."""

    traceback = frappe.get_traceback(with_context=False)
    frappe.db.rollback()
    frappe.db.set_single_value("HR Calendar Sync Settings", "last_error", traceback[-2000:])
    if made:
        frappe.db.set_single_value("HR Calendar Sync Settings", "synced_calendars", frappe.as_json(made))
    frappe.log_error(title="HR Calendar Sync failed", message=traceback)
    frappe.db.commit()  # nosemgrep: the job is failing; what it says has to outlive the rollback


def _run() -> dict:
    # Read fresh rather than from the cache: the sync acts on what is saved now.
    settings = frappe.get_doc("HR Calendar Sync Settings")
    if not settings.enabled:
        return {}

    source = settings.hr_source()
    account = settings.account
    employees = source.employees()
    today = date.today()

    # Every calendar this run keeps: what it is (the key it is remembered by), its name, colour,
    # events, audience, and which of our events it holds.
    plans = []
    if settings.sync_holidays:
        for holiday_list, audience in _holiday_lists(settings, source, employees, today).items():
            events = holiday_events(holiday_list, source.holidays(holiday_list))
            key = f"holiday:{holiday_list}"
            plans.append((key, holiday_list, settings.holidays_color, events, audience, "hr-holiday-"))
    if settings.sync_birthdays or settings.sync_anniversaries:
        # One calendar for both: the same people see them, and the titles tell them apart.
        for company, (name, staff) in _by_company(settings.milestones_calendar, employees).items():
            audience = [person.get("user_id") for person in staff]
            events = birthday_events(staff, today) if settings.sync_birthdays else []
            if settings.sync_anniversaries:
                events += anniversary_events(staff, today)
            key = f"milestones:{company}"
            plans.append((key, name, settings.milestones_color, events, audience, MILESTONES))

    # Two plans for one calendar would each remove the other's events and replace the other's
    # share: a holiday list named "Birthdays" would hand the birthdays to the wrong people.
    names = [plan[1] for plan in plans]
    if len(names) != len(set(names)):
        frappe.throw(_("Two synced calendars share a name. Rename one in the settings."))

    owned = OwnedCalendars(settings, account)
    # To the very end: a calendar is on the mail server from the moment it is made, so a failure
    # anywhere after that — saving what was made included — has to carry it out.
    try:
        summary = _reconcile(account, owned, plans)
        owned.save()
        _record_success()
    except Exception as error:
        raise RunFailed(owned.made()) from error
    return summary


def _reconcile(account: str, owned: OwnedCalendars, plans: list[tuple]) -> dict:
    summary = {}
    for key, name, color, events, audience, prefix in plans:
        calendar_id = owned.ensure(key, name, color)
        summary[name] = _sync_calendar(account, calendar_id, events, audience, prefix)

    # What this sync used to keep and HR no longer has — a holiday list nobody follows any more,
    # or a kind switched off. Emptied of our events and shared with nobody, so a former follower
    # loses it; the calendar stays, remembered, for the day the list comes back.
    planned = {plan[0] for plan in plans}
    for key, calendar_id in owned.others(planned).items():
        summary[f"({key})"] = _sync_calendar(account, calendar_id, [], [], UID_PREFIX)
    return summary


def _record_success() -> None:
    frappe.db.set_single_value("HR Calendar Sync Settings", {"last_sync": now_datetime(), "last_error": None})


class OwnedCalendars:
    """The calendars this sync made, by what they are — and the only ones it will ever touch.

    Names are no way to find them. A calendar's name comes from HR (a holiday list, a company),
    and a name that happened to match a calendar already in the service account would have the
    sync adopt it and share it, showing its events to people they were never meant for. So what
    the sync created is remembered by id in the settings, a calendar is only ever reused from
    there, and anything else in the account — whatever it is called — is left alone.
    """

    def __init__(self, settings, account: str):
        self.account = account
        self.created = False
        stored = frappe.parse_json(settings.synced_calendars or "{}") or {}
        # Remembered for one account: pointed at another, the sync starts over there.
        known = stored.get("calendars", {}) if stored.get("account") == account else {}
        existing = {calendar["id"] for calendar in get_calendar_service(account).get()}
        self.calendars = {key: id for key, id in known.items() if id in existing}

    def ensure(self, key: str, name: str, color: str | None) -> str:
        if key not in self.calendars:
            self.calendars[key] = add_calendar(self.account, name, color=color)
            self.created = True
        return self.calendars[key]

    def made(self) -> dict:
        """What to save even if the run fails further on: nothing, unless a calendar was made."""

        return self.state() if self.created else {}

    def others(self, planned: set[str]) -> dict[str, str]:
        return {key: id for key, id in self.calendars.items() if key not in planned}

    def state(self) -> dict:
        return {"account": self.account, "calendars": dict(self.calendars)}

    def save(self) -> None:
        frappe.db.set_single_value(
            "HR Calendar Sync Settings", "synced_calendars", frappe.as_json(self.state())
        )


def _by_company(name: str, employees: list[dict]) -> dict[str, tuple[str, list[dict]]]:
    """One celebrations calendar per company, as HR's own birthday reminders go to the company and
    no further: companies sharing an HR site are not each other's colleagues. A single company
    keeps the plain name."""

    companies: dict[str, list[dict]] = {}
    for employee in employees:
        companies.setdefault(employee.get("company") or "", []).append(employee)

    if len(companies) <= 1:
        return {company: (name, staff) for company, staff in companies.items()}
    return {
        company: (f"{name} — {company}" if company else name, staff) for company, staff in companies.items()
    }


def _holiday_lists(settings, source: HRSource, employees: list[dict], today: date) -> dict[str, list[str]]:
    """Which holiday lists to draw, and whose calendar each belongs on.

    Asked the way HR itself resolves them, so a list is shared with exactly the people it applies
    to: by Holiday List Assignment, the employee's own, else their company's.
    """

    chosen = settings.chosen_holiday_lists()
    audiences: dict[str, list[str]] = {}
    follows = _lists_by_assignment(source.holiday_list_assignments(), employees, today.isoformat())

    for employee in employees:
        for holiday_list in follows.get(employee["name"], []):
            if not chosen or holiday_list in chosen:
                audiences.setdefault(holiday_list, []).append(employee.get("user_id"))

    return audiences


def _lists_by_assignment(assignments: list[dict], employees: list[dict], today: str) -> dict[str, list[str]]:
    """The lists each employee follows from today on: the one in force, and any already assigned
    to come after it — next year's list belongs on the calendar before the year turns.

    An employee's own assignments come before their company's, as in HR. The company's count only
    for someone with none of their own, or until their first one starts.
    """

    # By name alone, employee or company: that is all HR itself asks an assignment.
    by_holder: dict[str, list[dict]] = {}
    for row in assignments:
        start = str(row.get("from_date") or "")[:10]
        if row.get("holiday_list") and start:
            by_holder.setdefault(row.get("assigned_to"), []).append({"holiday_list": row["holiday_list"], "start": start})
    for rows in by_holder.values():
        rows.sort(key=lambda row: row["start"])

    def from_today(rows: list[dict], until: str | None = None) -> list[dict]:
        rows = [row for row in rows if until is None or row["start"] < until]
        in_force = [row for row in rows if row["start"] <= today][-1:]
        return in_force + [row for row in rows if row["start"] > today]

    follows = {}
    for employee in employees:
        own = from_today(by_holder.get(employee["name"], []))
        company = by_holder.get(employee.get("company"), [])
        if not own:
            rows = from_today(company)
        elif own[0]["start"] > today:
            rows = from_today(company, until=own[0]["start"]) + own
        else:
            rows = own
        follows[employee["name"]] = list(dict.fromkeys(row["holiday_list"] for row in rows))
    return follows


def _sync_calendar(
    account: str, calendar_id: str, events: list[dict], audience: list[str], prefix: str | tuple[str, ...]
) -> dict:
    """Makes one of the sync's own calendars say what HR says, and shares it with the people it is
    about. `prefix` is the kind of event it holds: only those are ever rewritten or removed."""

    result = _sync_events(account, calendar_id, events, prefix)
    result["shared_with"] = _share(account, calendar_id, audience)
    return result


def _sync_events(account: str, calendar_id: str, events: list[dict], prefix: str | tuple[str, ...]) -> dict:
    """Creates what is missing, rewrites what differs, and removes what HR no longer has."""

    service = get_calendar_event_service(account)
    existing = _existing_events(service, calendar_id, prefix)
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

    # In the server's own portions: it takes only so many objects in one call.
    size = service.max_objects_in_set
    for batch in service.create_batches(list(create.items()), size):
        _raise_for_errors(service._create(dict(batch)), "notCreated")
    for batch in service.create_batches(list(update.items()), size):
        _raise_for_errors(service._update(dict(batch)), "notUpdated")
    for batch in service.create_batches(destroy, size):
        _raise_for_errors(service._delete(batch), "notDestroyed")

    return {"created": len(create), "updated": len(update), "removed": len(destroy)}


def _existing_events(service, calendar_id: str, prefix: str | tuple[str, ...]) -> dict[str, dict]:
    """What this sync has already put on the calendar, by uid.

    Only its own: every event has a uid, so anything not in our namespace was put there by
    somebody and is not ours to rewrite or remove.
    """

    ids = service.query({"inCalendar": calendar_id}, 0, 5000).get("ids") or []
    if not ids:
        return {}

    rows = service._get(ids, properties=[*JMAP_FIELDS.values(), "id"])["methodResponses"][0][1]
    return {row["uid"]: row for row in rows.get("list") or [] if (row.get("uid") or "").startswith(prefix)}


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
    wanted = {email.lower() for email in emails}
    principals = []
    for batch in service.create_batches(sorted(wanted), 50):
        ids = service.query({"operator": "OR", "conditions": [{"email": email} for email in batch]}, 0, 500)
        for row in service.get(ids.get("ids") or []):
            # Exactly an address HR gave, and a person: the search is loose, and a share with a
            # group is a share with everyone in it, which HR never said.
            if (row.get("email") or "").lower() in wanted and row.get("type") == "individual":
                principals.append(row["id"])
    return principals


def _raise_for_errors(response: dict, key: str) -> None:
    method_responses = response.get("methodResponses") or []
    result = method_responses[0][1] if method_responses else {}
    if errors := result.get(key):
        frappe.throw(_("The mail server refused part of the sync: {0}").format(frappe.as_json(errors)))
