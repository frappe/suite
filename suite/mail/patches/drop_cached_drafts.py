import frappe
from frappe.utils import create_batch

from suite.mail.doctype.mail_message.mail_message import _remove_cached_messages
from suite.mail.store import Entity, get_data_store
from suite.mail.utils import log_mail_error
from suite.utils import enqueue_job

# Accounts cleaned per long-queue job.
_ACCOUNTS_PER_JOB = 25


def execute() -> None:
    """Drop every copy the message cache holds as a draft.

    A mail that was sent could stay cached as the draft it was while it was being sent, and a
    draft that a save replaced stayed cached after the server destroyed it. The mail queue no
    longer leaves either behind, but the cache has no expiry, so the copies from before are still
    there: a thread shows a composer over a mail that went out, and discarding that "draft"
    deletes the copy in Sent.

    The cache cannot tell such a copy from a real draft, so all of them go. A real draft is
    fetched again the next time it is read. Each account's cache is read in full, so the accounts
    are fanned out into long-queue jobs rather than read during migrate.
    """

    accounts = frappe.db.get_all("JMAP Account", {}, pluck="name")
    for i, batch in enumerate(create_batch(accounts, _ACCOUNTS_PER_JOB)):
        enqueue_job(
            drop_cached_drafts,
            job_id=f"drop-cached-drafts::{i}",
            deduplicate=True,
            queue="long",
            timeout=3600,
            accounts=batch,
        )


def drop_cached_drafts(accounts: list[str]) -> None:
    """Drop each account's cached drafts, one account's failure not stopping the rest."""

    for account in accounts:
        try:
            cached = get_data_store(account).scan(Entity.EMAIL)
            if drafts := [id for id, message in cached.items() if message.get("draft")]:
                _remove_cached_messages(account, drafts)
        except Exception:
            log_mail_error(
                f"Failed to drop cached drafts for account {account}",
                frappe.get_traceback(with_context=True),
            )
