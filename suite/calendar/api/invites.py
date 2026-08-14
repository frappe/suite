from uuid import uuid7

import frappe
from frappe import _
from jmap import MethodError

from suite.calendar import jmap_events
from suite.calendar.api.rsvp import record_rsvp
from suite.calendar.doctype.calendar_event.calendar_event import (
    format_calendar_event,
    get_calendar_events,
)
from suite.calendar.doctype.calendar_exchange.calendar_exchange import SERVER_MANAGED_KEYS
from suite.mail.jmap import (
    SuiteJMAPClient,
    format_set_error,
    get_account_client,
    get_default_calendar_id,
    get_participant_identities,
)
from suite.utils.rate_limiter import dynamic_rate_limit


@frappe.whitelist()
@dynamic_rate_limit()
def get_invite_details(account: str, blob_id: str) -> dict | None:
    """Parses a text/calendar mail attachment (already a blob in the account's JMAP namespace) and
    reports whether its event is on the calendar yet, so the thread view can offer "Add to Calendar".

    Returns None when the blob has no parsable event or the event carries no UID (nothing to
    deduplicate against). ``event`` is the existing calendar copy when one is found, else a preview
    formatted from the parsed invite (its id is empty — it does not exist on the server yet).
    ``participant`` is the viewer's own entry on that event (None when they aren't invited), so the
    thread view can offer RSVP actions with their current response.

    Caveat: the UID lookup runs on the server's search index, which is updated asynchronously, so
    an event added moments ago may still report ``exists: False``."""

    client = get_account_client(account)
    events = _parse_events(client, blob_id)
    if not events:
        return None

    invite = events[0]
    uid = invite.get("uid")
    if not uid:
        return None

    # The iTIP METHOD (request/cancel/reply/...) travels through the parse; only a request or
    # publish is something the reader can add.
    method = (invite.get("method") or "").lower()

    exists = False
    event = None
    if master_ids := jmap_events.get_master_ids(client, [uid]):
        if existing := get_calendar_events(account, master_ids[:1]):
            exists = True
            event = existing[0]

    if event is None:
        event = _format_preview(account, invite)

    return {
        "uid": uid,
        "method": method,
        "exists": exists,
        "event": event,
        "participant": _viewer_participant(account, event),
    }


@frappe.whitelist()
@dynamic_rate_limit()
def add_invite_to_calendar(account: str, blob_id: str) -> dict:
    """Creates the invite's event(s) from a text/calendar mail attachment on the account's default
    calendar and returns the calendar copy. No scheduling messages are sent — adding the invite is
    not an RSVP. Idempotent: an event whose UID is already on the calendar is not recreated."""

    client = get_account_client(account)
    event_id = _ensure_on_calendar(client, account, _parse_events(client, blob_id))

    if formatted := get_calendar_events(account, [event_id]):
        return formatted[0]

    frappe.throw(_("Could not add the event to the calendar."))


@frappe.whitelist()
@dynamic_rate_limit()
def rsvp_to_invite(account: str, blob_id: str, response: str) -> dict:
    """Records the viewer's RSVP to an invite attachment: puts the event on their calendar first
    if it isn't yet, then records the response via `record_rsvp` — which notifies the organizer
    through the custom event_response template when custom event invites are enabled, or the JMAP
    server's own scheduling mail otherwise. Returns the updated calendar copy."""

    client = get_account_client(account)
    event_id = _ensure_on_calendar(client, account, _parse_events(client, blob_id))
    record_rsvp(account, event_id, response)

    if formatted := get_calendar_events(account, [event_id]):
        return formatted[0]

    frappe.throw(_("Could not record your response."))


def _ensure_on_calendar(client: SuiteJMAPClient, account: str, events: list[dict]) -> str:
    """Creates the parsed events that aren't on the calendar yet (idempotent by UID, on the default
    calendar, no scheduling messages) and returns the master id of the invite's event."""

    uids = [e["uid"] for e in events if e.get("uid")]
    if not uids:
        frappe.throw(_("The attachment does not contain a valid calendar event."))

    existing_ids = jmap_events.get_master_ids(client, uids)
    existing_uids = (
        {e["uid"] for e in jmap_events.get_events(client, existing_ids) if e.get("uid")}
        if existing_ids
        else set()
    )

    default_calendar_id = None

    payload = {}
    for event in events:
        if not event.get("uid") or event["uid"] in existing_uids:
            continue
        if default_calendar_id is None:
            default_calendar_id = get_default_calendar_id(account, raise_exception=True)
        event = {k: v for k, v in event.items() if k not in SERVER_MANAGED_KEYS}
        event["@type"] = "Event"
        event["calendarIds"] = {default_calendar_id: True}
        payload[str(uuid7())] = event

    created_ids = []
    if payload:
        with client.batch() as b:
            h = b.calendars.calendar_event.set(create=payload, sendSchedulingMessages=False)
        result = h.result
        created_ids = [str(created.id) for created in result.created.values()]

        if result.not_created:
            error = next(iter(result.not_created.values()), None)
            frappe.throw(_("Could not add the event to the calendar: {0}").format(format_set_error(error)))

    return (created_ids or existing_ids)[0]


def _parse_events(client: SuiteJMAPClient, blob_id: str) -> list[dict]:
    """Parses the blob into JSCalendar events. A mail attachment's blob id lives in the same JMAP
    account namespace as calendar blobs, so it can be parsed directly without re-uploading."""

    if not blob_id:
        frappe.throw(_("Blob ID is required."))

    try:
        response = jmap_events.parse_event_blobs(client, [blob_id])
    except MethodError:
        # The old dict-parsing path yielded no events for a failed parse; keep the same
        # user-facing outcome (the callers' "not a valid calendar event" flow).
        return []

    events = []
    for parsed in (response.get("parsed") or {}).values():
        events.extend(parsed or [])

    return events


def _viewer_participant(account: str, event: dict) -> dict | None:
    """Returns the viewer's entry from a *formatted* event's participants, or None if they aren't
    one. Matched by address against the account's participant identities, mirroring how the
    calendar app decides whose RSVP the "Going?" control edits."""

    emails = {identity["email"] for identity in get_participant_identities(account)}

    for participant in event.get("participants") or []:
        if (participant.get("email") or "").lower() in emails:
            return {
                "uid": participant["uid"],
                "email": participant["email"],
                "status": participant.get("participation_status") or "",
            }

    return None


def _format_preview(account: str, event: dict) -> dict:
    """Formats a parsed (not yet created) invite through the same formatter served events go
    through, so the frontend renders one shape either way."""

    preview = dict(event)
    # A parsed invite has no server id or calendar membership yet, and the formatter indexes into
    # these (and iterates the sub-object maps) unconditionally.
    preview["id"] = preview.get("id") or ""
    for key in ("calendarIds", "locations", "links", "alerts", "participants"):
        preview[key] = preview.get(key) or {}

    return format_calendar_event(account, {}, preview)
