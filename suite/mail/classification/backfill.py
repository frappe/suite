# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""Giving a category to the mail that reached an Inbox before the mail server gave one.

The automation script marks mail as it is delivered (see `sieve`), and a fetch marks what it
reads. Neither reaches mail that was delivered earlier and that no site has read: it would stay
out of its tab until someone scrolled that far. This goes through each Inbox once and classifies
that mail, newest first, up to `MAX_MESSAGES` of it: an Inbox can hold millions of messages, and
the older ones are still classified when they are fetched.
"""

import frappe

from suite.mail.classification.category import Category, get_category
from suite.mail.doctype.user_account.user_account import get_enabled_account_user
from suite.mail.jmap import (
    get_account_client,
    get_cached_mailboxes,
    get_mailbox_id_by_role,
    invalidate_jmap_mailboxes_cache,
)
from suite.mail.utils import log_mail_error
from suite.utils import enqueue_job, user_context

# How many messages are read and marked per round. Their headers come along, so it is kept small.
BATCH_SIZE = 100

# How many of an Inbox's uncategorised messages are looked at, newest first. What lies beyond is
# left to the fetch that first reads it.
MAX_MESSAGES = 10_000

# An account's Inbox is read a batch at a time, which for a large one takes a while.
JOB_TIMEOUT = 3600


def backfill_inboxes(accounts: list[str] | None = None) -> None:
    """Classify the uncategorised Inbox mail of the first of `accounts`, then queue the rest.

    Every account when `accounts` is None. One account per job, the jobs one after another: the
    chain holds the accounts still to come, so neither the queue nor the mail server sees them all
    at once. An account that fails is logged and the chain goes on; its mail is still classified
    when it is fetched.
    """

    from suite.mail.classification import is_enabled

    if accounts is None:
        accounts = frappe.get_all("JMAP Account", pluck="name")
    if not accounts or not is_enabled():
        return

    try:
        backfill_inbox(accounts[0])
    except Exception:
        log_mail_error(
            f"Could not classify the Inbox of {accounts[0]}", frappe.get_traceback(with_context=True)
        )

    if rest := accounts[1:]:
        enqueue_job(backfill_inboxes, queue="long", timeout=JOB_TIMEOUT, accounts=rest)


def backfill_inbox(account: str) -> None:
    """Classify the newest `MAX_MESSAGES` of the mail in the account's Inbox that has no category.

    An account whose user is disabled or gone is left alone: the mail server lets nobody in as
    that user. A message that cannot be marked - a draft left in the Inbox, an account that may
    only be read - is stepped over, so the next round asks for the mail after it.
    """

    from suite.mail.classification import EMAIL_PROPERTIES, classify_emails

    user = get_enabled_account_user(account)
    if not user:
        return

    with user_context(user):
        # A worker that doesn't fork per job keeps its mailbox cache from job to job.
        invalidate_jmap_mailboxes_cache(account)
        inbox = get_mailbox_id_by_role(account, "inbox")
        if not inbox:
            return

        client = get_account_client(account)
        mailboxes = get_cached_mailboxes(account)
        uncategorised = {
            "operator": "AND",
            "conditions": [{"inMailbox": inbox}, *({"notKeyword": c.keyword} for c in Category)],
        }
        properties = ["id", "mailboxIds", "keywords", "from", *EMAIL_PROPERTIES]

        position = examined = 0
        while examined < MAX_MESSAGES:
            with client.batch() as b:
                query = b.mail.email.query(
                    filter=uncategorised,
                    sort=[{"property": "receivedAt", "isAscending": False}],
                    position=position,
                    limit=min(BATCH_SIZE, MAX_MESSAGES - examined),
                )
                get = b.mail.email.get(ids=query.ref_ids(), properties=properties)
            emails = [email.to_wire() for email in get.result.items]
            if not emails:
                return

            examined += len(emails)
            classify_emails(client, account, emails, mailboxes)
            # Mail that was marked has left the list; what is still unmarked stays at its head.
            position += sum(1 for email in emails if not get_category(email.get("keywords")))
