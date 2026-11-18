"""Who else sees a calendar, and how much of it.

The mail server holds the answer — JMAP's `shareWith` on the calendar, keyed by principal — so
a calendar shared here is shared in every client the reader opens, not in Suite alone. This
module is the translation between that and the two answers the app offers: see that the time is
taken, or see what takes it.

The roles are a narrowing, not the whole of what JMAP can express. A calendar may already carry
rights no role here describes, granted by another CalDAV client or by an administrator; those
read back as `None` — shown as Custom and written back untouched — because a dialog with two
roles in it is no reason to quietly take rights away that something else granted.
"""

from typing import Literal

Role = Literal["view"]

# Every right the server keeps per sharee, so a role is stated in full rather than as the
# handful it sets: a right left out of a `shareWith` entry is not a right left alone.
RIGHTS = (
    "mayReadFreeBusy",
    "mayReadItems",
    "mayWriteAll",
    "mayWriteOwn",
    "mayUpdatePrivate",
    "mayRSVP",
    "mayShare",
    "mayDelete",
)

# What the one role grants. Nothing grants `mayShare`: a reader may not widen the audience its
# owner chose. Nothing grants a write, either — see the spec's "Out of scope".
#
# There is no free/busy role, though JMAP has the right for it. On Stalwart a reader granted
# `mayReadFreeBusy` alone is shown nothing: the calendar is not listed to them, its events are
# not sent, and `Principal/getAvailability` — the lookup the right exists to answer — returns
# an empty list even to a calendar's owner. A role that grants nothing anyone can see is not a
# choice to offer. A free/busy grant made elsewhere still reads back as Custom and is kept.
#
# `mayUpdatePrivate` is not among them, despite its name. On Stalwart a calendar's name,
# colour, visibility and subscription are one copy shared by everybody, not a view each: a
# reader granted this right renames and hides the calendar for its owner too, which was
# measured, not assumed. What it does buy a reader is the name — withheld without it — and
# that is not worth the owner's calendar being renameable by anyone they show it to.
ROLES: dict[str, tuple[str, ...]] = {
    "view": ("mayReadFreeBusy", "mayReadItems"),
}


def rights_for_role(role: str) -> dict[str, bool]:
    """The full rights object for a role, every right stated."""

    if role not in ROLES:
        raise ValueError(f"Unknown sharing role: {role}")

    granted = ROLES[role]
    return {right: right in granted for right in RIGHTS}


def role_for_rights(rights: dict | None) -> str | None:
    """The role a sharee's rights amount to, or `None` where they amount to none of them.

    Compared on the rights that are held, so a server that omits the false ones and a server
    that spells them all out give the same answer.
    """

    held = {right for right in RIGHTS if (rights or {}).get(right)}
    for role, granted in ROLES.items():
        if held == set(granted):
            return role
    return None


def holds_any_right(rights: dict | None) -> bool:
    """Whether a sharee is granted anything at all. One granted nothing is not shared with —
    an entry another client left behind — and is neither shown as Custom nor carried through."""

    return any((rights or {}).get(right) for right in RIGHTS)


def may_share(my_rights: dict | None) -> bool:
    """Whether the account may change who a calendar is shared with.

    Stalwart calls this right `mayShare`; the JMAP calendars draft calls it `mayAdmin`. Both are
    read, so the app is right on either server rather than hiding sharing everywhere on one of
    them — which is what reading the draft's name alone does against Stalwart.
    """

    rights = my_rights or {}
    return bool(rights.get("mayShare") or rights.get("mayAdmin"))
