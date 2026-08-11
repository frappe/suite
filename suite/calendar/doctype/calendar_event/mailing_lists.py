# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

"""Expansion of mailing list participants into the list's individual members.

Stalwart resolves a mailing list at the SMTP RCPT stage: `team@example.com` is replaced by each
member's own address before delivery, and the list address is not part of any account's identity.
An iTIP ATTENDEE naming the list therefore matches nobody on ingest, so members receive the
invitation mail but the event is never added to their calendars. Groups behave differently only
because a group is a real principal with its own address and its own calendar.

Replacing the list with one participant per member before the event is stored is what RFC 5546 asks
the organizer to do, and it fixes both invite paths at once: Frappe Mail's own invitation mails and
the JMAP server's scheduling messages are both built from the stored participant list. Each member
also ends up with a distinct participant uid, which is what gives them individual RSVP links.

Membership is resolved once, when the invitation is sent. Someone added to the list afterwards will
receive later mail to the list but not this event, so participants are re-expanded on every update.
"""

import frappe
from frappe import _
from frappe.utils import cint

from suite.mail.stalwart import get_domains, get_mailing_list_index
from suite.mail.utils import get_config, log_mail_error

DEFAULT_MAX_PARTICIPANTS = 100


def expand_mailing_list_participants(participants: list[dict] | None) -> list[dict] | None:
    """Replaces any mailing list participant with one participant per member address.

    Participants that are not mailing lists are passed through untouched, and the original order is
    preserved. Returns the input unchanged when expansion is disabled or the directory cannot be
    reached — a calendar event is never worth failing over this.

    The size cap bounds the event's total participants, but only members added by expansion are ever
    dropped to honour it. A participant the organizer named themselves is always kept, even when
    that pushes the total past the cap, because dropping one removes them from the stored
    event, and on the next update the invitation code reads that as a withdrawn attendee and mails
    them a cancellation. For the same reason an explicit participant always wins over the same
    address arriving through a list, no matter which order they appear in: the explicit entry
    carries the uid their RSVP is recorded against, and a member entry would reset it.
    """

    if not participants or not _expansion_enabled():
        return participants

    if not _has_local_participant(participants):
        return participants

    index = _mailing_list_index()
    if not index or not any(_email_of(p) in index for p in participants):
        return participants

    limit = _max_participants()
    slots: list[tuple[str, dict, bool]] = []
    explicit: set[str] = set()

    for participant in participants:
        email = _email_of(participant)
        if email in index:
            slots.extend(
                (member, _member_participant(participant, member), True) for member in _members(email, index)
            )
        else:
            slots.append((email, participant, False))
            if email:
                explicit.add(email)

    expanded: list[dict] = []
    seen: set[str] = set()
    dropped: list[str] = []

    for address, entry, is_member in slots:
        if address and (address in seen or (is_member and address in explicit)):
            continue
        if is_member and len(expanded) >= limit:
            dropped.append(address)
            continue

        if address:
            seen.add(address)
        expanded.append(entry)

    if dropped:
        _report_truncation(limit, dropped)

    return expanded


def _members(address: str, index: dict[str, list[str]]) -> list[str]:
    """Returns the member addresses behind a list address, resolving nested lists.

    A list may name another list among its recipients. Each nested list is expanded where it sits,
    so the members come back in the order the lists declare them, and only addresses that are not
    themselves lists are kept. Addresses already visited are skipped, which also makes a membership
    cycle terminate.
    """

    members: list[str] = []
    seen = {address}
    stack = list(reversed(index[address]))

    while stack:
        member = stack.pop()
        if member in seen:
            continue

        seen.add(member)
        if nested := index.get(member):
            stack.extend(reversed(nested))
        else:
            members.append(member)

    return members


def _member_participant(participant: dict, email: str) -> dict:
    """Builds one member's participant entry from the mailing list's entry.

    Role, kind and reply expectations carry over from the list, while the identity fields are reset:
    a cleared uid makes the server mint a fresh one (and with it a distinct RSVP link), and the
    routing fields are dropped so they are rebuilt from the member's own address rather than
    pointing back at the list.
    """

    member = dict(participant)
    member.update({"email": email, "uid": None, "name": None, "send_to": None, "schedule_id": None})

    return member


def _has_local_participant(participants: list[dict]) -> bool:
    """True when any participant sits on a domain this server hosts.

    Only local addresses can be mailing lists, so this avoids fetching the directory for events that
    invite external attendees only.
    """

    domains = {(d.get("name") or "").lower() for d in _domains()}

    return any(_email_of(p).rpartition("@")[2] in domains for p in participants if _email_of(p))


def _domains() -> list[dict]:
    """Returns the server's domains, or an empty list when the directory is unreachable."""

    try:
        return get_domains()
    except Exception:
        log_mail_error("Mailing List Participant Expansion")
        return []


def _mailing_list_index() -> dict[str, list[str]]:
    """Returns the mailing list address index, or an empty map when the directory is unreachable."""

    try:
        return get_mailing_list_index()
    except Exception:
        log_mail_error("Mailing List Participant Expansion")
        return {}


def _report_truncation(limit: int, dropped: list[str]) -> None:
    """Surfaces the members a size cap left out, so the cap is never silent."""

    message = _("Mailing list expansion stopped at {0} participants; {1} members were left out.").format(
        limit, len(dropped)
    )
    frappe.msgprint(message, alert=True)
    log_mail_error("Mailing List Participant Expansion", f"{message}\n\n{', '.join(filter(None, dropped))}")


def _email_of(participant: dict) -> str:
    """Returns a participant's address, lowercased."""

    return (participant.get("email") or "").lower()


def _expansion_enabled() -> bool:
    """True when mailing lists should be expanded into their members, per Mail Settings or site config."""

    return bool(get_config("expand_mailing_list_participants"))


def _max_participants() -> int:
    """Returns the cap on participants per event after expansion."""

    return cint(get_config("max_mailing_list_participants")) or DEFAULT_MAX_PARTICIPANTS
