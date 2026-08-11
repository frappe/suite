import frappe

from suite.mail.doctype.sieve_script.sieve_script import (
    AUTOMATION_SCRIPT_NAME,
    SieveScript,
    build_automation_sieve,
    get_active_sieve_script_id,
)
from suite.mail.utils import log_mail_error


def execute() -> None:
    """Turn screening on by default for existing personal accounts that haven't customised filtering.

    Screening now defaults to on for newly created *personal* accounts (JMAP Account.enable_screening),
    but personal accounts created before that may still have it off. This backfills them, limited to
    *personal* accounts (a user's own account, not a shared or delegated one) that don't have a custom
    Sieve script active — if the account's active script is one the user wrote themselves, they've taken
    over their own filtering and we leave it untouched. Our own scripts (the frappe_mail_automation
    script and the read-only vacation auto-responder) don't count as custom, and neither does having
    no active script at all.

    Enabling screening means the automation Sieve must be rebuilt so its screening gate is emitted,
    which needs a live JMAP session — not reliably reachable during `bench migrate` — so the work is
    deferred to a background job. It also self-heals: accounts already screening or already carrying a
    custom active script are skipped, so a re-run is a no-op for them.
    """

    frappe.enqueue(enable_screening_for_personal_accounts, queue="long", enqueue_after_commit=True)


def enable_screening_for_personal_accounts() -> None:
    """Enable screening and rebuild the automation Sieve for each eligible personal account."""

    for account in get_eligible_personal_accounts():
        try:
            if has_custom_sieve_script_active(account):
                continue

            # Set the flag first so build_automation_sieve() sees screening as enabled and emits the gate.
            frappe.db.set_value("JMAP Account", account, "enable_screening", 1, update_modified=False)
            build_automation_sieve(account, activate=True)
            frappe.db.commit()
        except Exception:
            frappe.db.rollback()
            log_mail_error(
                "Enable Screening Patch Error",
                f"Failed to enable screening for JMAP account {account}",
            )


def get_eligible_personal_accounts() -> list[str]:
    """Deduplicated personal accounts to backfill, scoped to users with push subscriptions enabled.

    A JMAP Account is shared across every user with access to it, so User Account links it to one
    or more users. We only want personal accounts (is_personal) that don't already have screening
    on (enable_screening = 0), and only for enabled users who have JMAP configured (username set)
    and whose User Settings leaves push subscriptions enabled (disable_push_subscriptions = 0)
    — enabling screening relies on push-driven change fetching to keep the Screening folder
    current, so disabled users, unconfigured users, and users who opted out are left alone.

    `.distinct()` collapses the per-user User Account rows down to one entry per account.
    """

    USER = frappe.qb.DocType("User")
    USER_SETTINGS = frappe.qb.DocType("User Settings")
    USER_ACCOUNT = frappe.qb.DocType("User Account")
    JMAP_ACCOUNT = frappe.qb.DocType("JMAP Account")

    return (
        frappe.qb.from_(USER_ACCOUNT)
        .join(USER_SETTINGS)
        .on(USER_ACCOUNT.user_settings == USER_SETTINGS.name)
        .join(USER)
        .on(USER_SETTINGS.user == USER.name)
        .join(JMAP_ACCOUNT)
        .on(USER_ACCOUNT.account == JMAP_ACCOUNT.name)
        .where(USER.enabled == 1)
        .where(USER_SETTINGS.username.isnotnull() & (USER_SETTINGS.username != ""))
        .where(USER_SETTINGS.disable_push_subscriptions == 0)
        .where(JMAP_ACCOUNT.is_personal == 1)
        .where(JMAP_ACCOUNT.enable_screening == 0)
        .select(USER_ACCOUNT.account)
        .distinct()
    ).run(pluck="account")


def has_custom_sieve_script_active(account: str) -> bool:
    """Whether the account's currently active Sieve script is one the user wrote themselves.

    The frappe_mail_automation script and the read-only vacation auto-responder are ours, not custom;
    so is having no active script at all. Anything else active means the user manages their own
    filtering and screening should not be forced on.
    """

    active_id = get_active_sieve_script_id(account)
    if not active_id:
        return False

    scripts = SieveScript._get_sieve_scripts(account, [active_id])
    if not scripts:
        return False

    script = scripts[0]
    return script.get("_name") != AUTOMATION_SCRIPT_NAME and not script.get("read_only")
