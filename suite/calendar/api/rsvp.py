# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

"""Signed RSVP links for custom event invitations.

An invitation email carries three signed links (Yes / Maybe / No) that point at the
`event_rsvp` web page. `resolve_rsvp` verifies the token and writes the participant's
response to the organizer's copy of the event via JMAP. Recipients may be on any mail
server, so we never require a login — the signed token is the only authorization.

Participants hosted on this site each hold their own copy of the event (created when the
invite email was delivered), so after the organizer's copy is updated a background job
propagates the response to those copies too — otherwise everyone but the organizer keeps
seeing the stale status.
"""

import base64
import hashlib
import hmac
import json

import frappe
from frappe import _
from frappe.utils import escape_html
from jmap import MethodError

from suite.calendar import jmap_events
from suite.mail.doctype.user_account.user_account import get_user_for_jmap_account
from suite.mail.jmap import (
    SuiteJMAPClient,
    account_view,
    format_method_error,
    format_set_error,
    get_account_client,
    get_jmap_client,
    get_participant_identities,
)
from suite.utils import log_error
from suite.utils.dt import get_utc_now

# response key -> (JSCalendar participationStatus, human label)
RESPONSES: dict[str, tuple[str, str]] = {
    "accept": ("accepted", "Yes"),
    "tentative": ("tentative", "Maybe"),
    "decline": ("declined", "No"),
}

# JSCalendar participationStatus values a logged-in attendee can respond with (see record_rsvp).
PARTICIPATION_RESPONSES = ("accepted", "tentative", "declined")


def build_rsvp_links(
    account: str,
    event_id: str,
    participant_uid: str,
    participant_email: str,
    expires_at: int | None = None,
) -> dict[str, str]:
    """Returns {accept|tentative|decline: url} signed links for one participant."""

    return {
        response: _rsvp_url(account, event_id, participant_uid, participant_email, response, expires_at)
        for response in RESPONSES
    }


def resolve_rsvp(token: str) -> dict:
    """Verifies a token, records the response via JMAP, and returns the page result.

    Returns {success: bool, title: str, message: str} for the confirmation page.
    """

    payload = _verify(token)
    if not payload:
        return _result(False, _("Invalid Link"), _("This response link is invalid or has expired."))

    response = RESPONSES.get(payload.get("r"))
    if not response:
        return _result(False, _("Invalid Response"), _("This response link is not valid."))

    status = response[0]

    try:
        client = _guest_calendar_client(payload["a"])
        result = jmap_events.set_participation_status(client, payload["e"], payload["u"], status)
        if not result.not_updated:
            _notify_organizer(payload, status)
            _sync_participant_calendars(payload, status)
        frappe.db.commit()
    except Exception:
        log_error("Calendar", title=_("Calendar RSVP failed"))
        return _result(
            False,
            _("Something Went Wrong"),
            _("We couldn't record your response. The event may no longer exist."),
        )

    if result.not_updated:
        return _result(
            False,
            _("Something Went Wrong"),
            _("We couldn't record your response. The event may no longer exist."),
        )

    state, heading, sub = _confirmation_copy(payload["r"])
    event = _fetch_event(client, payload["e"])
    return {
        "success": True,
        "state": state,
        "title": heading,
        "message": sub,
        # The title is organizer-supplied and lands in the guest RSVP page, which frappe renders
        # through a Jinja environment built without autoescaping - so escape it here rather than
        # relying on the template.
        "event_title": escape_html((event or {}).get("title") or ""),
        "event_when": _format_event_when(event) if event else "",
    }


def record_rsvp(account: str, event_id: str, response: str) -> str:
    """Records the logged-in caller's RSVP on their own copy of the event and tells the organizer.

    Their entry is matched by address against the account's participant identities and patched
    surgically. With custom event invites enabled (Mail Settings) the server's iMIP scheduling
    mail is suppressed and the custom event_response email — carrying the iTIP REPLY — is sent
    instead (see `notify_organizer_of_reply`); otherwise the JMAP server emits its own reply.
    Returns the responder's address.
    """

    from suite.calendar.doctype.calendar_event.invitations import custom_event_invites_enabled

    response = (response or "").lower()
    if response not in PARTICIPATION_RESPONSES:
        frappe.throw(_("Invalid RSVP response."))

    client = get_account_client(account)
    copies = jmap_events.get_events(client, [event_id])
    if not copies:
        frappe.throw(_("Could not record your response. The event may no longer exist."))

    # Participant keys are per-copy (each server generates its own), so locate the caller in this
    # copy by address — any of the account's participant identities counts as "me".
    identity_emails = {identity["email"] for identity in get_participant_identities(account)}

    participant_uid = responder_email = None
    for uid, participant in (copies[0].get("participants") or {}).items():
        address = (participant.get("calendarAddress") or participant.get("email") or "").lower()
        if (address := address.replace("mailto:", "")) in identity_emails:
            participant_uid, responder_email = uid, address
            break

    if not participant_uid:
        frappe.throw(_("You are not a participant of this event."))

    use_custom_reply = custom_event_invites_enabled()
    try:
        result = jmap_events.set_participation_status(
            client, event_id, participant_uid, response, send_scheduling_messages=not use_custom_reply
        )
    except MethodError as e:
        frappe.throw(_("Could not record your response: {0}").format(format_method_error(e)))

    if result.not_updated:
        error = next(iter(result.not_updated.values()), None)
        frappe.throw(_("Could not record your response: {0}").format(format_set_error(error)))

    if use_custom_reply:
        frappe.enqueue(
            "suite.calendar.doctype.calendar_event.invitations.notify_organizer_of_reply",
            queue="short",
            enqueue_after_commit=True,
            account=account,
            event_id=event_id,
            responder_email=responder_email,
            status=response,
        )

    return responder_email


def _notify_organizer(payload: dict, status: str) -> None:
    """Enqueues the organizer heads-up email for a just-recorded RSVP (best-effort).

    Runs after the response commits so the email reflects the stored state, and off the request
    so a mail hiccup never breaks the guest's confirmation page.
    """

    frappe.enqueue(
        "suite.calendar.doctype.calendar_event.invitations.notify_organizer_of_response",
        queue="short",
        enqueue_after_commit=True,
        account=payload["a"],
        event_id=payload["e"],
        participant_email=payload["m"],
        status=status,
    )


def _sync_participant_calendars(payload: dict, status: str) -> None:
    """Enqueues the job that mirrors a just-recorded RSVP onto local participants' copies.

    Runs after the response commits and off the request, so a slow or failing sync never
    delays or breaks the guest's confirmation page.
    """

    frappe.enqueue(
        "suite.calendar.api.rsvp.sync_response_to_participant_calendars",
        queue="short",
        enqueue_after_commit=True,
        account=payload["a"],
        event_id=payload["e"],
        participant_email=payload["m"],
        status=status,
    )


def sync_response_to_participant_calendars(
    account: str, event_id: str, participant_email: str, status: str
) -> None:
    """Propagates a recorded RSVP to every local participant's copy of the event (best-effort).

    The RSVP link writes the response to the organizer's copy only; no scheduling messages
    are sent in the custom-invite flow, so the copies that other participants on this site
    received via the invite email still show the old status. For each participant whose
    address resolves to a local JMAP account, this finds that account's copy by the event's
    uid and patches the responder's participationStatus there too. External participants
    have no reachable calendar and are skipped.
    """

    organizer_client = _guest_calendar_client(account)
    events = jmap_events.get_events(organizer_client, [event_id])
    if not events:
        return

    event = events[0]
    uid = event.get("uid")
    if not uid:
        return

    for email in _participant_emails(event):
        try:
            # Resolve the address through the mail server's account registry (JMAP Account
            # _name is the principal address) rather than the User doctype: a participant
            # address can be an alias or a group, where a User.email lookup could match the
            # wrong local mailbox or none at all.
            participant_account = frappe.db.get_value("JMAP Account", {"_name": email})
            if not participant_account or participant_account == account:
                continue

            # The account may still be linked to a user who has since been disabled or
            # deleted; their calendar is unreachable (get_jmap_client would refuse the
            # user), so skip them instead of logging a failure for this best-effort sync.
            user = get_user_for_jmap_account(participant_account, ignore_permissions=True)
            if not user or not frappe.get_cached_value("User", user, "enabled"):
                continue

            client = account_view(get_jmap_client(user, ignore_permissions=True), participant_account)
            copy_ids = jmap_events.get_master_ids(client, [uid])
            if not copy_ids:
                continue

            copies = jmap_events.get_events(client, [copy_ids[0]])
            if not copies:
                continue

            # Participant keys are per-copy (each server generates its own), so locate the
            # responder in this copy by address rather than by the organizer-side uid.
            responder_uid = _find_participant_uid(copies[0], participant_email)
            if not responder_uid:
                continue

            jmap_events.set_participation_status(client, copy_ids[0], responder_uid, status)
        except Exception:
            log_error(
                "Calendar",
                title=_("Failed to sync RSVP for event {0} to {1}'s calendar").format(event_id, email),
            )


def _participant_emails(event: dict) -> set[str]:
    """Returns the lowercase addresses of every participant on the event."""

    emails = set()
    for participant in (event.get("participants") or {}).values():
        email = (participant.get("calendarAddress") or participant.get("email") or "").lower()
        if email := email.replace("mailto:", ""):
            emails.add(email)

    return emails


def _find_participant_uid(event: dict, email: str) -> str | None:
    """Returns the participant key in this copy of the event matching the given address."""

    email = email.lower()
    for uid, participant in (event.get("participants") or {}).items():
        address = (participant.get("calendarAddress") or participant.get("email") or "").lower()
        if address.replace("mailto:", "") == email:
            return uid

    return None


def _confirmation_copy(response_key: str) -> tuple[str, str, str]:
    """Returns (state, heading, sub) for a confirmed response, keyed by the RSVP response."""

    return {
        "accept": (
            "yes",
            _("You're going"),
            _("Your response has been sent to the organizer. This event is now on your calendar."),
        ),
        "tentative": (
            "maybe",
            _("Marked as maybe"),
            _("Your response has been sent to the organizer. We'll hold a tentative spot on your calendar."),
        ),
        "decline": (
            "no",
            _("You declined"),
            _("Your response has been sent to the organizer. This event won't be added to your calendar."),
        ),
    }[response_key]


def _fetch_event(client: SuiteJMAPClient, event_id: str) -> dict | None:
    """Best-effort fetch of the event for the confirmation card; None if unavailable."""

    try:
        events = jmap_events.get_events(client, [event_id])
        return events[0] if events else None
    except Exception:
        return None


def _format_event_when(event: dict) -> str:
    """Compact event start for the confirmation card, e.g. 'Tue, 14 Jul · 10:00 AM (Asia/Kolkata)'."""

    from suite.calendar.doctype.calendar_exchange.calendar_exchange import _parse_local_datetime

    start = _parse_local_datetime(event.get("start"), event.get("timeZone"))
    if not start:
        return ""

    day = f"{start.strftime('%a')}, {start.day} {start.strftime('%b')}"
    if event.get("showWithoutTime"):
        return day

    hour = start.hour % 12 or 12
    meridiem = "AM" if start.hour < 12 else "PM"
    when = f"{day} · {hour}:{start.minute:02d} {meridiem}"

    # The guest has no session, so the time stays in the event's zone - but say which zone,
    # or a reader elsewhere has no way to tell.
    if time_zone := event.get("timeZone"):
        when = f"{when} ({time_zone})"

    return when


def _guest_calendar_client(account: str) -> SuiteJMAPClient:
    """Builds a JMAP client for the organizer's account without a logged-in user."""

    user = get_user_for_jmap_account(account, ignore_permissions=True)
    if not user:
        frappe.throw(_("Calendar account not found."))

    return account_view(get_jmap_client(user, ignore_permissions=True), account)


def _rsvp_url(
    account: str,
    event_id: str,
    participant_uid: str,
    participant_email: str,
    response: str,
    expires_at: int | None,
) -> str:
    payload = {"a": account, "e": event_id, "u": participant_uid, "m": participant_email, "r": response}
    if expires_at:
        payload["x"] = int(expires_at)

    token = _sign(payload)
    return frappe.utils.get_url(f"/event_rsvp?token={token}")


def _result(success: bool, title: str, message: str) -> dict:
    return {"success": success, "title": title, "message": message}


def _sign(payload: dict) -> str:
    """Returns a `<body>.<signature>` token, both URL-safe base64 (unpadded)."""

    body = _b64encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
    signature = _b64encode(hmac.new(_secret(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{signature}"


def _verify(token: str) -> dict | None:
    """Validates the signature and expiry. Returns the payload, or None on any failure."""

    try:
        body, signature = token.split(".", 1)
        expected = _b64encode(hmac.new(_secret(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            raise ValueError("signature mismatch")
        payload = json.loads(_b64decode(body))
    except Exception:
        return None

    # Every token must carry an expiry. Reject a missing one outright so a link can never replay
    # indefinitely (older links minted without an expiry are invalidated by this too).
    # Compare in real UTC. now_datetime() is naive in the *site* timezone, and .timestamp() on a
    # naive value resolves it against the *OS* timezone - so when the two differ the expiry was off
    # by their offset, cutting links short or leaving them valid past the intended window.
    expires_at = payload.get("x")
    if not expires_at or get_utc_now().timestamp() > expires_at:
        return None

    return payload


def _secret() -> bytes:
    # The site's encryption key is the only acceptable signing secret. Never fall back to a
    # predictable value (site name) or an empty string — that would let anyone forge RSVP tokens.
    key = frappe.local.conf.get("encryption_key")
    if not key:
        frappe.throw(_("Site encryption key is not configured; cannot sign RSVP links."))
    return key.encode()


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _b64decode(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))
