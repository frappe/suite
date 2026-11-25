import frappe

from suite.mail.patches.enable_screening_for_personal_accounts import (
    enable_screening_for_personal_accounts,
)


def execute() -> None:
    """Turn screening back on for personal accounts whose owner turned it off.

    Screening is no longer a choice for a personal account, so one left with it off would have no
    way back. The earlier backfill does the work and keeps its limits: an account whose own Sieve
    script is active, or whose user has push turned off, is left as it is. It needs a live JMAP
    session, so it runs as a background job, and a re-run skips the accounts it already turned on.
    """

    frappe.enqueue(enable_screening_for_personal_accounts, queue="long", enqueue_after_commit=True)
