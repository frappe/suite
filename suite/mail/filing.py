# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""Filing a conversation: what Archive, Move, Junk, Not junk and Trash do to each message in it.

Mail you received goes wherever it is filed. Your own mail has a home it is not filed out of — what
you sent stays in Sent, a draft stays in Drafts — and only Trash takes your sent mail out of Sent.
Every view hands over a whole conversation's messages and the action; the rules for each message live
here, so the lists, All Inboxes and the open thread can't each grow their own.

| Action      | Mail you received                        | Your sent mail        | A draft   |
|-------------|------------------------------------------|-----------------------|-----------|
| archive     | Inbox → Archive (Archive added if not)*  | stays in Sent         | untouched |
| unarchive   | Archive → Inbox, other folders kept      | out of Archive        | untouched |
| move        | leaves every folder for the target       | target, keeps Sent**  | untouched |
| junk        | leaves every folder for Junk, marked     | stays in Sent         | untouched |
| not_junk    | Junk → Inbox, mark cleared               | untouched             | untouched |
| trash       | Trash                                    | Trash                 | untouched |

* Archived from Junk or Trash, it leaves those too, and loses the junk mark.
** Not into the Inbox, which holds only mail you received: moved there, your sent mail keeps just Sent.
"""

from typing import Literal, TypedDict

import frappe
from frappe import _

from suite.mail.doctype.user_account.user_account import get_user_for_jmap_account
from suite.mail.jmap import chunked_get, chunked_set, get_account_client, get_mailbox_id_by_role
from suite.mail.utils import log_mail_error

Action = Literal["archive", "unarchive", "move", "junk", "not_junk", "trash"]
ACTIONS: tuple[Action, ...] = ("archive", "unarchive", "move", "junk", "not_junk", "trash")


class Roles(TypedDict):
    inbox: str
    archive: str
    sent: str | None
    drafts: str | None
    junk: str
    trash: str


class Filed(TypedDict):
    """What a filing did. `left_inbox`: some mail left the Inbox, so the conversation moved out of it —
    an Archive that only added Archive leaves the row where it was, and says so."""

    updated: list[str]
    left_inbox: bool


def plan(action: Action, emails: list[dict], roles: Roles, target: str | None = None) -> dict[str, dict]:
    """The JMAP Email/set update for each message an action changes, keyed by id; a message the
    action leaves alone has no entry. `emails` carry `id`, `mailboxIds` and `keywords` as JMAP has
    them. Removals patch with null, as RFC 8621 asks of a map."""

    if action == "move":
        if not target:
            raise ValueError("A move needs a target.")
        # Sent and Drafts are filled by sending and writing; mail moved there would pass for yours.
        if target in (roles["sent"], roles["drafts"]):
            raise ValueError("Mail can't be moved to Sent or Drafts.")
        # Junk and Trash are their own actions, whichever menu named them.
        if target == roles["junk"]:
            action = "junk"
        elif target == roles["trash"]:
            action = "trash"

    updates: dict[str, dict] = {}
    for email in emails:
        boxes = email.get("mailboxIds") or {}
        keywords = email.get("keywords") or {}
        if keywords.get("$draft") or (roles["drafts"] and roles["drafts"] in boxes):
            continue
        # Yours while in Sent. Trash is the one thing that takes it out, and from there on it is
        # filed like any other mail.
        own = bool(roles["sent"] and roles["sent"] in boxes)
        junked = bool(keywords.get("$junk"))

        if action == "archive":
            if own:
                # Never archived; but out of the Inbox, where an earlier move could have filed it.
                if roles["inbox"] not in boxes:
                    continue
                updates[email["id"]] = {f"mailboxIds/{roles['inbox']}": None}
                continue
            # Out of the Inbox; and out of Junk or Trash too, mark and all, or it would gain Archive
            # and still be shown only where it was.
            leaving = [roles[box] for box in ("inbox", "junk", "trash") if roles[box] in boxes]
            if not leaving and roles["archive"] in boxes:
                continue
            update = {f"mailboxIds/{roles['archive']}": True}
            update |= {f"mailboxIds/{box}": None for box in leaving}
            if junked:
                update |= {"keywords/$junk": None, "keywords/$notjunk": True}
        elif action == "unarchive":
            # Archive reversed: back in the Inbox, every other folder as it was. Your own mail never goes
            # into the Inbox, but is let out of Archive all the same — Archive once filed it there too.
            if roles["archive"] not in boxes:
                continue
            update = {f"mailboxIds/{roles['archive']}": None}
            if not own:
                update[f"mailboxIds/{roles['inbox']}"] = True
        elif action == "move":
            if own:
                # Filed with the conversation, but never into the Inbox: that holds mail you received.
                kept = (
                    {roles["sent"]: True} if target == roles["inbox"] else {roles["sent"]: True, target: True}
                )
                update = {"mailboxIds": kept}
            else:
                update = {"mailboxIds": {target: True}}
                if junked:
                    update |= {"keywords/$junk": None, "keywords/$notjunk": True}
        elif action == "junk":
            if own:
                continue
            update = {"mailboxIds": {roles["junk"]: True}, "keywords/$junk": True, "keywords/$notjunk": None}
        elif action == "not_junk":
            if own:
                continue
            update = {"mailboxIds": {roles["inbox"]: True}, "keywords/$junk": None, "keywords/$notjunk": True}
        elif action == "trash":
            # A junked message would be hidden wherever it went but Junk, Trash included.
            update = {"mailboxIds": {roles["trash"]: True}}
            if junked:
                update["keywords/$junk"] = None
        else:
            raise ValueError(f"Unknown action: {action}")

        updates[email["id"]] = update
    return updates


def left_inbox(updates: dict[str, dict], emails: list[dict], roles: Roles) -> bool:
    """Whether the updates take some message out of the Inbox — or out of Junk or Trash, the other
    lists Archive takes mail out of: whether the mail was archived, rather than only added to Archive."""

    lists = [roles["inbox"], roles["junk"], roles["trash"]]
    boxes = {email["id"]: email.get("mailboxIds") or {} for email in emails}
    for id, update in updates.items():
        for box in lists:
            if box not in boxes.get(id, {}):
                continue
            if update.get(f"mailboxIds/{box}", True) is None:
                return True
            if "mailboxIds" in update and box not in update["mailboxIds"]:
                return True
    return False


def account_roles(account: str) -> Roles:
    """The account's folders the rules name, the ones filing into created if missing."""

    def role(name: str, create: bool = False) -> str | None:
        return get_mailbox_id_by_role(account, name, create_if_not_exists=create, raise_exception=create)

    return {
        "inbox": role("inbox", create=True),
        "archive": role("archive", create=True),
        "sent": role("sent"),
        "drafts": role("drafts"),
        "junk": role("junk", create=True),
        "trash": role("trash", create=True),
    }


def file_messages(account: str, ids: list[str], action: Action, target: str | None = None) -> Filed:
    """Files the given messages — a whole conversation's, usually — by the rules above."""

    if not account or not ids:
        frappe.throw(_("Account and Mail IDs are required."))
    if action not in ACTIONS:
        frappe.throw(_("Unknown action: {0}").format(action))
    get_user_for_jmap_account(account, allow_system_manager=False, raise_exception=True)

    # Imported here: mail_message imports a great deal, this module is imported early.
    from suite.mail.doctype.mail_message.mail_message import _remove_cached_messages

    client = get_account_client(account)
    emails = [
        email.to_wire()
        for email in chunked_get(
            client,
            lambda b, chunk: b.mail.email.get(ids=chunk, properties=["id", "mailboxIds", "keywords"]),
            list(dict.fromkeys(ids)),
        )
    ]
    roles = account_roles(account)
    try:
        updates = plan(action, emails, roles, target)
    except ValueError as error:
        frappe.throw(_(str(error)))

    if not updates:
        return {"updated": [], "left_inbox": False}
    # Marked as changed before the write as well as after: a read already on its way then can't
    # cache the message as it was (see get_messages).
    _remove_cached_messages(account, list(updates))
    try:
        result = chunked_set(client, lambda b, chunk: b.mail.email.set(update=chunk), updates)
    except Exception:
        log_mail_error(_("Failed to file mail(s)"), frappe.get_traceback(with_context=True))
        frappe.throw(_("Failed to file mail(s)."))
    finally:
        # Whatever reached the server, nothing is left cached as it was.
        _remove_cached_messages(account, list(updates))

    updated = [id for id in updates if id in result.updated]
    if result.not_updated:
        log_mail_error(_("Failed to file mail(s)"), str(result.not_updated))
        frappe.throw(_("Some mail could not be filed. Please try again."))

    return {
        "updated": updated,
        "left_inbox": left_inbox({id: updates[id] for id in updated}, emails, roles),
    }
