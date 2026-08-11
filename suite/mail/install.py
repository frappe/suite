import frappe
from frappe.core.api.file import create_new_folder

from suite.suite_core.doctype.rate_limit.rate_limit import create_rate_limit


def after_install() -> None:
    add_rate_limits()
    create_new_folder("Frappe Mail", "Home")
    generate_jmap_push_keys()


def after_migrate() -> None:
    pass


def add_rate_limits() -> None:
    """Add rate limits.

    Every limit here is per client IP and is an abuse backstop, not a quota: the numbers are
    sized so normal use never reaches them. Guest-facing and credential-adjacent endpoints get
    tight hourly windows (they are the ones worth brute-forcing), interactive lookups get a
    per-minute burst window on top so a form that fires per keystroke still works, and the
    machine-facing APIs (inbound/outbound/spamd) are limited per minute.
    """

    rate_limits = [
        # suite.mail.api.account — public signup / password reset
        # Availability check runs while the user types, so it needs a burst window; the hourly
        # one is what keeps it from being used to enumerate existing addresses.
        {"method_path": "suite.mail.api.account.validate_email_assigned", "limit": 20, "seconds": 60},
        {
            "method_path": "suite.mail.api.account.validate_email_assigned",
            "limit": 100,
            "seconds": 60 * 60,
        },
        {"method_path": "suite.mail.api.account.signup", "limit": 5, "seconds": 60 * 60},
        {"method_path": "suite.mail.api.account.resend_otp", "limit": 5, "seconds": 60 * 60},
        # The only guard on a 6-digit signup OTP - kept low enough that guessing is hopeless,
        # high enough to survive a few typos.
        {"method_path": "suite.mail.api.account.verify_otp", "limit": 10, "seconds": 60 * 60},
        # Read-only, gated on an unguessable request key: sized for page reloads during setup.
        {"method_path": "suite.mail.api.account.get_account_request", "limit": 60, "seconds": 60 * 60},
        {"method_path": "suite.mail.api.account.get_account_setup_options", "limit": 20, "seconds": 60 * 60},
        {"method_path": "suite.mail.api.account.create_account", "limit": 10, "seconds": 60 * 60},
        {"method_path": "suite.mail.api.account.send_reset_password_link", "limit": 5, "seconds": 60 * 60},
        {
            "method_path": "suite.mail.api.account.get_user_for_reset_password_key",
            "limit": 20,
            "seconds": 60 * 60,
        },
        # suite.mail.api.account — import/export (each one submits a long-running background job)
        {"method_path": "suite.mail.api.account.create_mail_import", "limit": 10, "seconds": 60 * 60},
        {"method_path": "suite.mail.api.account.create_mail_export", "limit": 10, "seconds": 60 * 60},
        {"method_path": "suite.mail.api.account.create_calendar_import", "limit": 10, "seconds": 60 * 60},
        {"method_path": "suite.mail.api.account.create_calendar_export", "limit": 10, "seconds": 60 * 60},
        {"method_path": "suite.mail.api.account.create_contacts_import", "limit": 10, "seconds": 60 * 60},
        {"method_path": "suite.mail.api.account.create_contacts_export", "limit": 10, "seconds": 60 * 60},
        # suite.mail.api.auth
        # Mail clients call this before a send, so it tracks the outbound per-minute tier.
        {"method_path": "suite.mail.api.auth.validate", "limit": 60, "seconds": 60},
        # suite.mail.api.admin — hourly windows, sized for real onboarding (a batch of members,
        # a handful of domains) rather than for a single admin action.
        {"method_path": "suite.mail.api.admin.add_domain", "limit": 20, "seconds": 60 * 60},
        {"method_path": "suite.mail.api.admin.add_member", "limit": 60, "seconds": 60 * 60},
        {"method_path": "suite.mail.api.admin.add_group", "limit": 60, "seconds": 60 * 60},
        {"method_path": "suite.mail.api.admin.add_mailing_list", "limit": 60, "seconds": 60 * 60},
        {"method_path": "suite.mail.api.admin.add_role", "limit": 60, "seconds": 60 * 60},
        {"method_path": "suite.mail.api.admin.add_oauth_client", "limit": 20, "seconds": 60 * 60},
        {"method_path": "suite.mail.api.admin.change_member_password", "limit": 10, "seconds": 60 * 60},
        # Each call holds a worker on an upstream SSE stream for up to five minutes.
        {"method_path": "suite.mail.api.admin.stream_delivery_test", "limit": 20, "seconds": 60 * 60},
        # suite.mail.api.inbound
        {"method_path": "suite.mail.api.inbound.fetch_blob", "limit": 120, "seconds": 60},
        {"method_path": "suite.mail.api.inbound.pull", "limit": 10, "seconds": 60},
        {"method_path": "suite.mail.api.inbound.pull_raw", "limit": 10, "seconds": 60},
        # suite.mail.api.mail
        # Large attachments and import archives arrive as 24 MB chunks, one request each.
        {"method_path": "suite.mail.api.mail.upload_file", "limit": 120, "seconds": 60},
        # suite.mail.api.outbound
        {"method_path": "suite.mail.api.outbound.upload_attachment", "limit": 60, "seconds": 60},
        # The per-priority limits below stack on top of these, so the ceiling has to leave room
        # for a caller mixing all three tiers (100 + 50 + 10); it is also the only limit that
        # applies when the caller sends no explicit priority.
        {"method_path": "suite.mail.api.outbound.send", "limit": 200, "seconds": 60},
        {"method_path": "suite.mail.api.outbound.send_raw", "limit": 200, "seconds": 60},
        # suite.mail.api.outbound — priority-based limits (per minute). Higher priority jumps the
        # delivery queue, so the more privileged the tier the tighter the allowance.
        {
            "method_path": "suite.mail.api.outbound.send",
            "key": "priority",
            "value": "Low",
            "limit": 100,
            "seconds": 60,
        },
        {
            "method_path": "suite.mail.api.outbound.send",
            "key": "priority",
            "value": "Normal",
            "limit": 50,
            "seconds": 60,
        },
        {
            "method_path": "suite.mail.api.outbound.send",
            "key": "priority",
            "value": "High",
            "limit": 10,
            "seconds": 60,
        },
        {
            "method_path": "suite.mail.api.outbound.send_raw",
            "key": "priority",
            "value": "Low",
            "limit": 100,
            "seconds": 60,
        },
        {
            "method_path": "suite.mail.api.outbound.send_raw",
            "key": "priority",
            "value": "Normal",
            "limit": 50,
            "seconds": 60,
        },
        {
            "method_path": "suite.mail.api.outbound.send_raw",
            "key": "priority",
            "value": "High",
            "limit": 10,
            "seconds": 60,
        },
        # suite.mail.api.spamd
        {"method_path": "suite.mail.api.spamd.scan", "limit": 60, "seconds": 60},
        {"method_path": "suite.mail.api.spamd.get_spam_score", "limit": 60, "seconds": 60},
    ]

    for rl in rate_limits:
        create_rate_limit(**rl)


def generate_jmap_push_keys() -> None:
    """Generates new JMAP push subscription encryption keys and saves them in Mail Settings."""

    settings = frappe.get_single("Mail Settings")
    if not settings.jmap_push_p256dh or not settings.jmap_push_private_key or not settings.jmap_push_auth:
        settings._generate_jmap_push_keys()
