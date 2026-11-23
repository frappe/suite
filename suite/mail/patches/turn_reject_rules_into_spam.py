import frappe

from suite.mail.doctype.sieve_script.sieve_script import enqueue_automation_sieve_rebuilds


def execute() -> None:
    """Make every Reject rule a Spam rule: blocking a sender now files their mail into Junk rather than
    discarding it unseen, and Reject is no longer an action.

    The rules change here, in one update without hooks; the scripts built from them change in the
    background, since rebuilding needs a live JMAP session per account, which is not reliably
    reachable during ``bench migrate``. An account's own rule rebuilds that account. A global rule
    (one without an account) is in every account's script, so one of those rebuilds them all. A
    rebuild drops the old discarding block whatever it finds, and a re-run finds no Reject rules.
    """

    rules = frappe.get_all("Screened Email Address", filters={"action": "Reject"}, fields=["account"])
    if not rules:
        return

    frappe.db.set_value(
        "Screened Email Address", {"action": "Reject"}, "action", "Spam", update_modified=False
    )

    if any(not rule.account for rule in rules):
        accounts = frappe.get_all("JMAP Account", pluck="name")
    else:
        accounts = sorted({rule.account for rule in rules})
    enqueue_automation_sieve_rebuilds(accounts, job_id_prefix="turn-reject-rules-into-spam")
