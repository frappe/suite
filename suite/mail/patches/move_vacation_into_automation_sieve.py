import frappe

from suite.mail.doctype.sieve_script.sieve_script import (
    SieveScript,
    build_automation_sieve,
    get_active_sieve_script_id,
    pause_automation_sieve_build,
)
from suite.mail.doctype.user_account.user_account import get_enabled_account_user
from suite.mail.jmap import get_account_client
from suite.mail.utils import log_mail_error
from suite.mail.utils.dt import from_utc_z, normalize_utc_z
from suite.utils import user_context


def execute() -> None:
    """Move each account's auto-reply from Stalwart's VacationResponse into a Vacation Response,
    which the automation Sieve script now carries as its Vacation block.

    Turning Stalwart's auto-reply on activated its own `vacation` script, and since the server runs
    one script at a time, that stopped the automation script: screening, blocked senders,
    categories and folder rules were off while the user was away. A reply is on where Stalwart's
    `vacation` script is the active one: Stalwart can still say `isEnabled` after another script
    was activated over it, and that reply sends nothing. An account whose reply is on keeps it, now
    inside the automation script, which is activated; Stalwart's reply is turned off. A reply that
    is off keeps its words and dates, so turning it on again starts from them.

    Deferred to a background job: it needs a live JMAP session per account, which is not reliably
    reachable during ``bench migrate``.
    """

    frappe.enqueue(move_vacation_responses, queue="long", enqueue_after_commit=True)


def move_vacation_responses() -> None:
    for account in frappe.get_all("JMAP Account", pluck="name"):
        try:
            move_vacation_response(account)
            frappe.db.commit()
        except Exception:
            frappe.db.rollback()
            log_mail_error(
                "Move Vacation Response Patch Error",
                f"Failed to move the vacation response of JMAP account {account}\n\n{frappe.get_traceback()}",
            )


def move_vacation_response(account: str) -> None:
    """Move one account's auto-reply. Safe to run again: a reply already saved here is kept, and
    only Stalwart's is turned off, so a reply saved off before this ran stops sending."""

    user = get_enabled_account_user(account)
    if not user:
        return

    with user_context(user):
        client = get_account_client(account)
        with client.batch() as b:
            h = b.vacation.vacation_response.get()
        items = h.result.items
        vr = items[0].to_wire() if items else {}

        if not frappe.db.exists("Vacation Response", account):
            _insert_vacation_response(account, vr)

        if vr.get("isEnabled"):
            with client.batch() as b:
                h = b.vacation.vacation_response.set(update={"singleton": {"isEnabled": False}})
            if "singleton" not in h.result.updated:
                frappe.throw(f"Stalwart's vacation response of {account} could not be turned off.")
            _keep_automation_active(account)


def _insert_vacation_response(account: str, vr: dict) -> None:
    if not (vr.get("isEnabled") or vr.get("subject") or vr.get("textBody") or vr.get("htmlBody")):
        return

    enabled = bool(vr.get("isEnabled")) and _is_vacation_script_active(account)

    # Saving a reply that is on builds the automation script with the Vacation block and
    # activates it, which deactivates Stalwart's script. One that is off leaves the script as it
    # is: a rebuild drops any rule the script holds that Mailbox Settings has no copy of.
    doc = frappe.new_doc("Vacation Response")
    doc.update(
        {
            "account": account,
            "enabled": int(enabled),
            "from_date": from_utc_z(normalize_utc_z(vr.get("fromDate"))),
            "to_date": from_utc_z(normalize_utc_z(vr.get("toDate"))),
            "subject": vr.get("subject"),
            "text_body": vr.get("textBody"),
            "html_body": vr.get("htmlBody"),
        }
    )
    if enabled:
        doc.insert(ignore_permissions=True)
    else:
        with pause_automation_sieve_build():
            doc.insert(ignore_permissions=True)


def _is_vacation_script_active(account: str) -> bool:
    if not (active_id := get_active_sieve_script_id(account)):
        return False

    scripts = SieveScript._get_sieve_scripts(account, [active_id])
    return bool(scripts) and scripts[0]["_name"].lower() == "vacation"


def _keep_automation_active(account: str) -> None:
    """Activate the automation script if turning Stalwart's reply off left no script active."""

    if not get_active_sieve_script_id(account):
        build_automation_sieve(account, activate=True, raise_exception=True)
