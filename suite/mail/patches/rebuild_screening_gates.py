import frappe

from suite.mail.doctype.sieve_script.sieve_script import enqueue_automation_sieve_rebuilds


def execute() -> None:
    """Regenerate the automation Sieve script of every account with screening enabled.

    The Screening gate screened only mail whose spamtest value was below 2. That held while Stalwart
    reported nothing but 1 (ham) or 10 (spam); from v0.16.19 it reports 2-4 for ham with a positive
    score, so that mail from unscreened senders skipped the Screener and landed in the Inbox. The gate
    now cuts at 5 — Stalwart's spam verdict — and recreates a missing Screener instead of letting the
    server fall back to the Inbox.

    Each account keeps its stored script until something rebuilds it, and nothing does on a schedule —
    ``build_automation_sieve`` only runs when a user touches a folder, a rule, or screening. Only
    accounts with screening enabled carry the gate, so only those are rebuilt. Rebuilding is
    idempotent and refreshes content only, leaving an active vacation auto-responder or hand-written
    script in place.

    Deferred to a background job: regeneration needs a live JMAP session per account, which is not
    reliably reachable during ``bench migrate``.
    """

    frappe.enqueue(rebuild_screening_gates, queue="long", enqueue_after_commit=True)


def rebuild_screening_gates() -> None:
    """Fan the accounts with screening enabled out into long-queue rebuild batches."""

    accounts = frappe.get_all("JMAP Account", filters={"enable_screening": 1}, pluck="name")
    enqueue_automation_sieve_rebuilds(accounts, job_id_prefix="rebuild-screening-gates")
