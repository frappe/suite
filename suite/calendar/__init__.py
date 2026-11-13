"""What other Suite modules may ask of Calendar."""

from datetime import datetime
from typing import TYPE_CHECKING

import frappe

if TYPE_CHECKING:
    from suite.mail.jmap import SuiteJMAPClient


def add_event(
    title: str,
    start: datetime,
    duration: str,
    *,
    time_zone: str,
    recurrence_rule: dict | None = None,
    description: str | None = None,
) -> str | None:
    """Put an event in the session user's own calendar and return its id.

    `start` is a local time in `time_zone`; `duration` and `recurrence_rule` are JMAP's, such as
    "PT30M" and {"frequency": "weekly"}. Returns None when the user has no mailbox, so no calendar.
    """
    from suite.calendar.doctype.calendar_event.calendar_event import add_calendar_event
    from suite.mail.doctype.user_account.user_account import get_user_personal_jmap_account

    account = get_user_personal_jmap_account()
    if not account:
        return None
    return add_calendar_event(
        account,
        title=title,
        start=start.strftime("%Y-%m-%dT%H:%M:%S"),
        duration=duration,
        time_zone=time_zone,
        recurrence_rule=recurrence_rule,
        description=description,
        use_default_alerts=True,
    )


def add_attendee(organizer: str, event_id: str, user: str) -> bool:
    """Add `user` to an event in `organizer`'s own calendar, and put the event in `user`'s calendar.

    Both people are in this workspace, so each calendar gets its copy directly and no invitation
    is mailed. Each side is written as its owner. Returns False when either person has no mailbox
    or the event is gone.
    """
    from suite.calendar.api.invites import ensure_on_calendar
    from suite.mail.doctype.user_account.user_account import get_user_personal_jmap_account
    from suite.mail.jmap import get_account_client, get_default_participant_identity

    organizer_account = get_user_personal_jmap_account(organizer)
    attendee_account = get_user_personal_jmap_account(user)
    if not organizer_account or not attendee_account:
        return False

    previous = frappe.session.user
    try:
        frappe.set_user(user)
        attendee = get_default_participant_identity(attendee_account)
        if not attendee:
            return False
        frappe.set_user(organizer)
        event = _with_attendee(get_account_client(organizer_account), organizer_account, event_id, attendee)
        if event is None:
            return False
        frappe.set_user(user)
        ensure_on_calendar(get_account_client(attendee_account), attendee_account, [event])
    finally:
        frappe.set_user(previous)
    return True


def _with_attendee(client: SuiteJMAPClient, account: str, event_id: str, attendee: str) -> dict | None:
    """Add `attendee` to the account's event, as accepted, and return the event as stored."""
    from suite.calendar import jmap_events
    from suite.mail.jmap import get_default_participant_identity

    events = jmap_events.get_events(client, [event_id])
    if not events:
        return None
    present = {
        (participant.get("calendarAddress") or "").lower().removeprefix("mailto:")
        for participant in (events[0].get("participants") or {}).values()
    }
    if attendee in present:
        return events[0]

    joining: list[dict] = [
        {"email": attendee, "roles": {"attendee": True}, "participation_status": "accepted"}
    ]
    if not present:
        # A meeting lists its organizer too, or their own calendar would show it as someone else's.
        owner = get_default_participant_identity(account, raise_exception=True)
        joining.append({"email": owner, "roles": {"owner": True}, "participation_status": "accepted"})
    patch = {
        f"participants/{uid}": entry for uid, entry in (jmap_events.participants_map(joining) or {}).items()
    }
    with client.batch() as b:
        h = b.calendars.calendar_event.set(update={event_id: patch}, sendSchedulingMessages=False)
    if event_id not in h.result.updated:
        raise RuntimeError(f"Could not add {attendee} to event {event_id}: {h.result.not_updated}")
    return jmap_events.get_events(client, [event_id])[0]
