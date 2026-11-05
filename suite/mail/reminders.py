# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""Mail a person can't act on yet: conversations due back in the Inbox at a chosen time.

Snoozing files a conversation in the Snoozed folder (see suite.mail.filing) and leaves a Mail Reminder
row saying when it is due. A job every minute takes every row that is due, however late, so a missed
run only means a late one. A failed run leaves the row due, to be tried again.

What is due is worked out from the mail rather than kept in step with it. A conversation archived,
trashed, moved or put back by Undo has left Snoozed, and when its row comes due there is nothing to
return: the row just goes, and no extra work is needed anywhere those actions happen.

Back in the Inbox a conversation is unread and marked returned, which holds it near the top of the
list, and its row stays for a day to take the mark off again. It isn't taken off on reading: a row that
jumped away while being read would be a surprise. The reader is told once, after the row is committed,
so a crash costs at most the alert rather than a repeat of it.

A reply that lands in the Inbox while snoozed wakes the conversation early, unmarked: the reply's own
notification is the one alert. And a daily sweep returns anything in Snoozed that has no row, so nothing
stays hidden for ever.
"""

from datetime import datetime, timedelta

import frappe
from frappe import _
from frappe.utils import cint, get_datetime, now_datetime

from suite.mail.doctype.mail_message.mail_message import (
    _remove_cached_messages,
    _update_emails,
    get_thread_email_ids,
    is_unscreened_message,
    read_reactions,
)
from suite.mail.doctype.mail_reminder.mail_reminder import reminder_name
from suite.mail.doctype.user_account.user_account import get_user_for_jmap_account
from suite.mail.filing import Filed, account_roles, file_messages
from suite.mail.jmap import chunked_get, get_account_client, get_cached_mailboxes
from suite.mail.pins import RETURNED_KEYWORD
from suite.mail.utils import log_mail_error
from suite.mail.utils.dt import from_utc_z, to_utc_z
from suite.mail.utils.user import get_account_emails
from suite.suite_core.push import notify
from suite.utils import user_context

SNOOZE = "Snooze"
WAITING = "Waiting"
RETURNED = "Returned"

# How long a returned conversation is held near the top of the Inbox.
HELD_FOR = timedelta(hours=24)
# How many rows one run takes. The rest are still due for the next, a minute later.
BATCH = 200
# A row that keeps failing is logged this often rather than every minute.
LOG_EVERY = 60 * 60

DOCTYPE = "Mail Reminder"
EMAIL_PROPERTIES = ["id", "threadId", "mailboxIds", "keywords", "receivedAt", "subject"]


def snooze(account: str, ids: list[str], until: str) -> Filed:
    """Hides the conversations these messages are until `until`, a UTC `...Z` time. Snoozing what is
    already snoozed changes when it comes back."""

    get_user_for_jmap_account(account, allow_system_manager=False, raise_exception=True)
    due_at = from_utc_z(until)
    if not due_at or get_datetime(due_at) <= now_datetime():
        frappe.throw(_("Choose a time in the future."))

    emails = _emails(account, ids)
    # The rows first, in this request's transaction: a filing that fails takes them back with it.
    # One that lands with its commit lost is left for the daily sweep.
    for thread_id in {email["threadId"] for email in emails}:
        _set_row(account, thread_id, due_at)

    filed = file_messages(account, ids, "snooze")
    snoozed = account_roles(account).get("snoozed")
    if not filed["updated"] and not any(snoozed in email.get("mailboxIds", {}) for email in emails):
        frappe.throw(_("Only mail in the Inbox or Archive can be snoozed."))
    return filed


def unsnooze(account: str, ids: list[str]) -> Filed:
    """Brings the conversations these messages are back now, near the top of the Inbox as if they had
    come due, but as read as they were and with no alert: the reader asked for it just now."""

    get_user_for_jmap_account(account, allow_system_manager=False, raise_exception=True)
    filed = file_messages(account, ids, "wake")
    emails = _emails(account, ids)
    # Only with a row to take the mark off again in a day.
    held = set()
    for thread_id in {email["threadId"] for email in emails}:
        name = reminder_name(account, thread_id, SNOOZE)
        if frappe.db.exists(DOCTYPE, name):
            _hold(name)
            held.add(thread_id)
    _mark_returned(account, [e for e in emails if e["id"] in filed["updated"] and e["threadId"] in held])
    return filed


def add_snooze_times(account: str, threads: list[dict]) -> None:
    """Says on each row of the Snoozed list when it comes back."""

    due = dict(
        frappe.db.get_all(
            DOCTYPE,
            filters={
                "account": account,
                "kind": SNOOZE,
                "status": WAITING,
                "thread_id": ["in", [thread["thread_id"] for thread in threads]],
            },
            fields=["thread_id", "due_at"],
            as_list=True,
        )
    )
    for thread in threads:
        thread["snoozed_until"] = to_utc_z(due.get(thread["thread_id"]))


def wake_on_reply(account: str, messages: list[dict]) -> None:
    """Wakes the snoozed conversations these newly arrived messages reply to. Only one that reached the
    Inbox wakes it: a reply a rule filed elsewhere, or Junk, is not asking to be read now."""

    inbox = account_roles(account)["inbox"]
    own = set(get_account_emails(account))
    threads = {
        message["thread_id"]
        for message in messages
        if not message["draft"]
        and message["from_email"] not in own
        and any(box["mailbox_id"] == inbox for box in message["mailboxes"])
        and not read_reactions(message)
        and not is_unscreened_message(message)
    }
    if not threads:
        return

    rows = frappe.db.get_all(
        DOCTYPE,
        filters={"account": account, "kind": SNOOZE, "status": WAITING, "thread_id": ["in", list(threads)]},
        fields=["name", "thread_id"],
    )
    for row in rows:
        ids = get_thread_email_ids(account, [row.thread_id]).get(row.thread_id, [])
        if ids:
            file_messages(account, ids, "wake")
        frappe.db.delete(DOCTYPE, {"name": row.name})


def run_due() -> None:
    """Works every row that has come due, one at a time so one failure leaves the rest alone."""

    due = frappe.db.get_all(
        DOCTYPE, filters={"due_at": ["<=", now_datetime()]}, pluck="name", order_by="due_at", limit=BATCH
    )
    for name in due:
        try:
            alert = _work(name)
            frappe.db.commit()
        except Exception:
            frappe.db.rollback()
            _log_failure(name)
            continue
        if alert:
            _tell(**alert)


def return_unheld() -> None:
    """Returns what is in Snoozed with no row saying when, from a lost write or another mail client."""

    for account in frappe.db.get_all("User Account", pluck="account", distinct=True):
        user = get_user_for_jmap_account(account, ignore_permissions=True)
        if not user:
            continue
        try:
            with user_context(user):
                _return_unheld(account)
            frappe.db.commit()
        except Exception:
            frappe.db.rollback()
            log_mail_error(_("Failed to return snoozed mail"), frappe.get_traceback(with_context=True))


def _return_unheld(account: str) -> None:
    snoozed = next((m for m in get_cached_mailboxes(account) if (m.get("role") or "") == "snoozed"), None)
    if not snoozed or not snoozed.get("totalEmails"):
        return

    client = get_account_client(account)
    with client.batch() as b:
        query = b.mail.email.query(filter={"inMailbox": snoozed["id"]}, limit=500)
    emails = _emails(account, list(query.result.ids))
    held = set(
        frappe.db.get_all(
            DOCTYPE,
            filters={
                "account": account,
                "kind": SNOOZE,
                "thread_id": ["in", [e["threadId"] for e in emails]],
            },
            pluck="thread_id",
        )
    )
    if unheld := [email["id"] for email in emails if email["threadId"] not in held]:
        file_messages(account, unheld, "wake")
        frappe.publish_realtime("mail_changed", user=frappe.session.user)


def _work(name: str) -> dict | None:
    """Works one due row, and returns the alert to send once it is committed, if there is one."""

    row = frappe.db.get_value(
        DOCTYPE,
        name,
        ["name", "kind", "status", "due_at", "user", "account", "thread_id", "email_id"],
        as_dict=True,
        for_update=True,
    )
    # Another run got here first, or the row was set to a later time.
    if not row or get_datetime(row.due_at) > now_datetime():
        return None

    # Whoever set it may have lost the account since; its owner can still bring the mail back.
    acting = _acting_user(row)
    if not acting:
        frappe.db.delete(DOCTYPE, {"name": name})
        return None

    with user_context(acting):
        alert = _settle(row) if row.status == RETURNED else _return(row)
        frappe.publish_realtime("mail_changed", user=row.user)
    return alert


def _acting_user(row: dict) -> str | None:
    users = frappe.db.get_all("User Account", {"account": row.account}, pluck="user")
    if row.user in users:
        return row.user
    return get_user_for_jmap_account(row.account, ignore_permissions=True)


def _return(row: dict) -> dict | None:
    """Brings a snoozed conversation back, if it is still waiting."""

    roles = account_roles(row.account)
    snoozed, sent = roles.get("snoozed"), roles.get("sent")
    ids = get_thread_email_ids(row.account, [row.thread_id]).get(row.thread_id, [])
    emails = _emails(row.account, ids)
    waiting = [email for email in emails if snoozed in email.get("mailboxIds", {})]
    if not waiting:
        frappe.db.delete(DOCTYPE, {"name": row.name})
        return None

    # Marked before it moves: whichever step fails, it is still in Snoozed for the next run to finish,
    # rather than back in the Inbox with no mark and no alert.
    _mark_returned(row.account, [e for e in waiting if not _is_own(e, sent)], unread=True)
    file_messages(row.account, [email["id"] for email in waiting], "wake")
    _hold(row.name)

    latest = max(waiting, key=lambda email: email.get("receivedAt") or "")
    inbox = roles["inbox"]
    return {
        "user": row.user,
        "title": _("Back from snooze"),
        "body": latest.get("subject") or _("[No subject]"),
        "path": f"/mail/account/{row.account}/mailbox/{inbox}/{row.thread_id}",
    }


def _settle(row: dict) -> None:
    """A returned conversation's day is up: it falls back to its date."""

    ids = get_thread_email_ids(row.account, [row.thread_id]).get(row.thread_id, [])
    marked = [email["id"] for email in _emails(row.account, ids) if _is_marked(email)]
    if marked:
        _update_emails(row.account, [{"id": id, "keywords": {RETURNED_KEYWORD: None}} for id in marked])
        _remove_cached_messages(row.account, marked)
    frappe.db.delete(DOCTYPE, {"name": row.name})


def _is_own(email: dict, sent: str | None) -> bool:
    return bool(sent and sent in email.get("mailboxIds", {}))


def _is_marked(email: dict) -> bool:
    return bool((email.get("keywords") or {}).get(RETURNED_KEYWORD))


def _mark_returned(account: str, emails: list[dict], unread: bool = False) -> None:
    """Marks what came back, and makes the latest of it unread if it is to be seen as new."""

    if not emails:
        return
    latest = max(emails, key=lambda email: email.get("receivedAt") or "")["id"]
    patches = []
    for email in emails:
        keywords: dict = {RETURNED_KEYWORD: True}
        if unread and email["id"] == latest:
            keywords["$seen"] = None
        patches.append({"id": email["id"], "keywords": keywords})
    _update_emails(account, patches)
    _remove_cached_messages(account, [email["id"] for email in emails])


def _hold(name: str) -> None:
    frappe.db.set_value(DOCTYPE, name, {"status": RETURNED, "due_at": now_datetime() + HELD_FOR})


def _set_row(account: str, thread_id: str, due_at: str | datetime) -> None:
    name = reminder_name(account, thread_id, SNOOZE)
    if frappe.db.exists(DOCTYPE, name):
        frappe.db.set_value(DOCTYPE, name, {"status": WAITING, "due_at": due_at, "user": frappe.session.user})
        return
    frappe.get_doc(
        {
            "doctype": DOCTYPE,
            "kind": SNOOZE,
            "status": WAITING,
            "user": frappe.session.user,
            "account": account,
            "thread_id": thread_id,
            "due_at": due_at,
        }
    ).insert(ignore_permissions=True)


def _emails(account: str, ids: list[str]) -> list[dict]:
    if not ids:
        return []
    client = get_account_client(account)
    return [
        email.to_wire()
        for email in chunked_get(
            client,
            lambda b, chunk: b.mail.email.get(ids=chunk, properties=EMAIL_PROPERTIES),
            list(dict.fromkeys(ids)),
        )
    ]


def _tell(user: str, title: str, body: str, path: str) -> None:
    """Tells the reader once: in any tab they have open, and on their devices."""

    try:
        frappe.publish_realtime("mail_reminder", {"title": title, "body": body, "path": path}, user=user)
        url = frappe.utils.get_url()
        notify(
            user,
            "mail",
            title,
            body,
            f"{url}{path}",
            f"{url}/assets/suite/mail/frontend/manifest/manifest-icon-192.maskable.png",
        )
    except Exception:
        log_mail_error(_("Failed to send a mail reminder"), frappe.get_traceback(with_context=True))


def _log_failure(name: str) -> None:
    key = f"mail_reminder_failed:{name}"
    if cint(frappe.cache.get_value(key)):
        return
    frappe.cache.set_value(key, 1, expires_in_sec=LOG_EVERY)
    log_mail_error(_("Failed to work a mail reminder"), frappe.get_traceback(with_context=True))
