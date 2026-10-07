import time

import frappe

from suite.mail.doctype.mail_message.mail_message import (
    _remove_cached_messages,
    move_messages_to_mailbox,
    set_unscreened_status,
)
from suite.mail.doctype.mailbox.mailbox import delete_mailboxes
from suite.mail.doctype.sieve_script.sieve_script import (
    SCREENER_MAILBOX_NAME,
    build_automation_sieve,
    is_screening_enabled,
)
from suite.mail.jmap import (
    get_account_client,
    get_mailbox_id_by_name,
    get_mailbox_id_by_role,
    invalidate_jmap_mailboxes_cache,
)
from suite.mail.utils import log_mail_error

# How many of a folder's messages are moved per round. Each round asks the server again from the top,
# since the ones before it have left the folder.
BATCH_SIZE = 500

# Seconds to wait before each retry of the accounts that could not be moved.
RETRY_DELAYS = (30, 120, 300)


def execute() -> None:
    """Retire the Screener folder: mail from a sender nobody has decided on now waits in the Inbox,
    marked with the `unscreened` keyword, instead of in a folder of its own.

    Every account screening mail has its automation Sieve rebuilt — whether or not it has the folder,
    since the old gate would make one for the next new sender. Where the folder exists, the rebuild
    comes first, so new mail stops landing in it, then what is still there moves into the Inbox with
    the keyword on, and the emptied folder is deleted.
    In that order nothing is missed: mail that arrives before the rebuild is in the folder when it is
    emptied, and mail after it never goes there.

    Every account is looked at, not only those screening now: one that turned screening off without
    letting its waiting mail in still has the folder. Its mail is marked too, so turning screening on
    again offers the same decisions it left behind.

    Deferred to a background job: it needs a live JMAP session per account, which is not reliably
    reachable during ``bench migrate``. A re-run rebuilds the screening accounts again, which is
    idempotent, and finds no folder to move.
    """

    frappe.enqueue(move_screeners, queue="long", enqueue_after_commit=True, timeout=3600)


def move_screeners(accounts: list[str] | None = None, attempt: int = 0, not_before: float = 0) -> None:
    """Move every account, or `accounts`, retrying those that fail after a wait — the mail server was
    perhaps briefly unreachable, and nothing else moves an account off the old flow. Those still
    failing after the last retry are logged."""

    if (wait := not_before - time.time()) > 0:
        time.sleep(wait)

    failures: dict[str, str] = {}
    for account in accounts if accounts is not None else frappe.get_all("JMAP Account", pluck="name"):
        try:
            move_screener(account)
            frappe.db.commit()
        except Exception:
            frappe.db.rollback()
            failures[account] = frappe.get_traceback(with_context=True)

    if failures and attempt < len(RETRY_DELAYS):
        frappe.enqueue(
            move_screeners,
            queue="long",
            timeout=3600,
            accounts=list(failures),
            attempt=attempt + 1,
            not_before=time.time() + RETRY_DELAYS[attempt],
        )
        return

    for account, traceback in failures.items():
        log_mail_error(f"Could not move the Screener of {account} to the unscreened keyword", traceback)


def move_screener(account: str) -> None:
    # Every screening account gets the new gate, folder or not: one whose Screener had gone, or had
    # never been made, still carries the old gate, whose `fileinto :create` would make it again for
    # the next new sender. The rebuild comes first, so a folder that does exist stops filling up
    # before it is emptied.
    if is_screening_enabled(account):
        build_automation_sieve(account, raise_exception=True)

    invalidate_jmap_mailboxes_cache(account)
    screener_id = get_mailbox_id_by_name(account, SCREENER_MAILBOX_NAME)
    if not screener_id:
        return

    inbox_id = get_mailbox_id_by_role(account, "inbox", raise_exception=True)
    client = get_account_client(account)
    moved: list[str] = []
    while True:
        with client.batch() as b:
            h = b.mail.email.query(filter={"inMailbox": screener_id}, position=0, limit=BATCH_SIZE)
        ids = list(h.result.ids)
        if not ids:
            break
        # The keyword before the move, so the mail is never in the Inbox looking decided.
        set_unscreened_status(account, ids, True)
        move_messages_to_mailbox(account, ids, inbox_id)
        moved += ids

    # Once more at the end: a list read while a round was moving can cache a message as it was the
    # moment before — still in the Screener — after that round cleared it. A copy that says Screener
    # outlives the folder, and nothing on a site without push notifications corrects it.
    _remove_cached_messages(account, moved)
    delete_mailboxes(account, [screener_id], remove_emails=False)
    invalidate_jmap_mailboxes_cache(account)
