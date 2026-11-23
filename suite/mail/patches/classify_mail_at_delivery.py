import frappe

from suite.mail import classification
from suite.mail.classification.backfill import backfill_inboxes
from suite.mail.doctype.sieve_script.sieve_script import enqueue_automation_sieve_rebuilds


def execute() -> None:
    """Have the mail server give incoming mail its category, and give one to the mail already there.

    A category was given only when a site first fetched a message, so an Inbox tab, which lists by
    keyword, missed the mail nobody had fetched yet. The automation Sieve script now carries the
    header rules and marks mail as it is delivered.

    Every account's script is rebuilt, since each keeps its stored script until something rebuilds
    it. Content only: an active vacation auto-responder or hand-written script stays the active one,
    and mail delivered under it is classified when it is fetched, as before.

    The mail already in each Inbox without a category is then classified once, in the background:
    Sieve does not run again for mail that has been delivered.

    Deferred to background jobs: both need a live JMAP session per account, which is not reliably
    reachable during ``bench migrate``. A re-run is idempotent.
    """

    if not classification.is_enabled():
        return

    accounts = frappe.get_all("JMAP Account", pluck="name")
    enqueue_automation_sieve_rebuilds(accounts, job_id_prefix="classify-mail-at-delivery")
    frappe.enqueue(backfill_inboxes, queue="long", enqueue_after_commit=True, timeout=3600)
