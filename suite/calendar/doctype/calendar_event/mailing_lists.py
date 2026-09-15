# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

"""Expansion of mailing list participants into the list's individual members.

Stalwart resolves a mailing list at the SMTP RCPT stage: `team@example.com` is replaced by each
member's own address before delivery, and the list address is not part of any account's identity.
An iTIP ATTENDEE naming the list therefore matches nobody on ingest, so members receive the
invitation mail but the event is never added to their calendars. Groups behave differently only
because a group is a real principal with its own address and its own calendar.

Adding one participant per member before the event is stored is what RFC 5546 asks the organizer
to do, and it fixes both invite paths at once: Frappe Mail's own invitation mails and the JMAP
server's scheduling messages are both built from the stored participant list. Each member also
ends up with a distinct participant uid, which is what gives them individual RSVP links.

The list itself stays on the event as a group participant that is never scheduled (`scheduleAgent`
none), and every member added for it points back at the list through `memberOf` (RFC 8984,
section 4.4.6). That link lets an invitation reach a member with the list in its To header, the
way any other mail to the list arrives, and it marks which participants were derived from a list
rather than named by the organizer.

Membership is resolved every time the event is saved: members no longer on the list are dropped
(the invitation code then mails them a cancellation), new members are added, and the rest keep
their participant entry along with the response recorded against it.
"""

from collections.abc import Iterator
from uuid import uuid7

import frappe
from frappe import _
from frappe.utils import cint

from suite.mail.stalwart import get_domains, get_mailing_list_index
from suite.mail.utils import get_config, log_mail_error

DEFAULT_MAX_PARTICIPANTS = 100


def expand_mailing_list_participants(participants: list[dict] | None) -> list[dict] | None:
    """Adds one participant per member behind every mailing list participant.

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
    if not index or not any(_email_of(p) in index or p.get("member_of") for p in participants):
        return participants

    return _Expansion(participants, index, _max_participants()).run()


class _Expansion:
    """One pass over an event's participants against the directory's mailing list index."""

    def __init__(self, participants: list[dict], index: dict[str, list[str]], limit: int) -> None:
        self.participants = participants
        self.index = index
        self.limit = limit
        # Lists expanded on this pass, and every participant on the event, by uid.
        self.expanded = {p.get("uid") for p in participants if _email_of(p) in index}
        self.present = {p.get("uid") for p in participants if p.get("uid")}
        # Entries an earlier expansion derived from a list, by address. A member still on the list
        # keeps their entry, and with it the uid their RSVP is recorded against.
        self.derived = {_email_of(p): p for p in participants if p.get("member_of")}
        self.explicit = {_email_of(p) for p in participants if _email_of(p) not in index and self._kept(p)}

    def run(self) -> list[dict]:
        expanded: list[dict] = []
        members: dict[str, dict] = {}
        seen: set[str] = set()
        dropped: list[str] = []
        invited = 0

        for address, entry, is_member in self._slots():
            if address and address in seen:
                # The same address through a second list: the one entry belongs to both.
                if is_member and address in members:
                    members[address]["member_of"].update(entry["member_of"])
                continue
            if is_member and address in self.explicit:
                continue
            if is_member and invited >= self.limit:
                dropped.append(address)
                continue

            if address:
                seen.add(address)
            if is_member:
                members[address] = entry
            expanded.append(entry)
            # A list kept for display is not invited, so it does not use up the cap.
            if entry.get("schedule_agent") != "none":
                invited += 1

        if dropped:
            _report_truncation(self.limit, dropped)

        return expanded

    def _slots(self) -> Iterator[tuple[str, dict, bool]]:
        """Yields (address, entry, is_member) in the order the entries should be stored."""

        for participant in self.participants:
            email = _email_of(participant)
            if email in self.index:
                yield from self._list_slots(participant, email)
            elif self._kept(participant):
                yield email, participant, False

    def _list_slots(self, participant: dict, email: str) -> Iterator[tuple[str, dict, bool]]:
        group = _list_participant(participant)
        yield email, group, False
        for member in _members(email, self.index):
            yield member, self._member(participant, group["uid"], member), True

    def _member(self, source: dict, list_uid: str, email: str) -> dict:
        entry = self.derived.get(email) or _member_participant(source, email)
        return entry | {"member_of": {list_uid: True}}

    def _kept(self, participant: dict) -> bool:
        """Whether a participant is stored as it is, rather than re-derived from a list.

        Anyone the organizer named is. A member an earlier expansion added is re-derived by their
        list while that list is on the event and in the directory, and dropped once the organizer
        removes the list, which uninvites them. Only when the list has vanished from the directory
        are they kept as they are: that was not the organizer's doing.
        """

        lists = set(participant.get("member_of") or {})
        if not lists:
            return True
        if lists & self.expanded:
            return False

        return bool(lists & self.present)


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


def _list_participant(participant: dict) -> dict:
    """Keeps the list on the event as a group participant nobody schedules.

    With scheduling turned off, neither Frappe Mail's invitation code nor the JMAP server mails
    the list address itself; its members are invited one by one. The reply expectation stays as
    the organizer set it, since members inherit it. The uid is fixed here rather than left for
    the server to mint, because the members' memberOf has to name it.
    """

    return participant | {
        "uid": participant.get("uid") or str(uuid7()),
        "kind": "group",
        "schedule_agent": "none",
        "send_to": None,
        "schedule_id": None,
        "member_of": None,
    }


def _member_participant(participant: dict, email: str) -> dict:
    """Builds one member's participant entry from the mailing list's entry.

    Role and reply expectations carry over from the list, while the identity fields are reset:
    a cleared uid makes the server mint a fresh one (and with it a distinct RSVP link), and the
    routing fields are dropped so they are rebuilt from the member's own address rather than
    pointing back at the list. The list's group kind is not inherited either.
    """

    kind = participant.get("kind") or None
    if kind and kind.lower() == "group":
        kind = None

    member = dict(participant)
    member.update(
        {
            "email": email,
            "uid": None,
            "name": None,
            "kind": kind,
            "send_to": None,
            "schedule_id": None,
            "schedule_agent": None,
        }
    )

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
