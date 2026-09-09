"""The site's mail directory as Suite Cloud holds it.

Accounts, groups, mailing lists and domains are identified by their addresses. Everything here
goes through the Suite Cloud client; nothing touches the cluster directly.
"""

import frappe
from frappe import _
from frappe.utils.caching import redis_cache

from suite.mail.suite_cloud import get_client, is_suite_cloud_configured
from suite.mail.utils import log_mail_error
from suite.mail.utils.user import get_account_email

GB = 1024**3
# Suite Cloud hands out recipients a page at a time; this is its largest page.
RECIPIENT_PAGE = 1000


def get_domains() -> list[dict]:
    """The site's domains, read from Suite Cloud on every call so the dashboard is never stale."""

    return get_client().call("mail.domains.list_domains")


def get_active_domain_names() -> list[str]:
    """Domains that take new accounts, groups and lists: enabled and verified on Suite Cloud."""

    return sorted(d["domain"] for d in get_domains() if d.get("enabled") and d.get("is_verified"))


@redis_cache(ttl=60)
def get_mailing_list_index() -> dict[str, list[str]]:
    """``{list address: [recipient addresses]}`` for every list (cached briefly).

    Membership edits are visible once the cache expires; mail routing itself is unaffected, so the
    only window is between a membership change and the next calendar invitation.
    """

    client = get_client()
    index = {}
    for mailing_list in client.call("mail.mailing_lists.list_mailing_lists"):
        index[mailing_list["email"]] = _all_recipients(client, mailing_list["email"])
    return index


def _all_recipients(client, email: str) -> list[str]:
    """Every enabled recipient of a list, paged through in full so no list is silently cut."""

    recipients: list[str] = []
    start = 0
    while True:
        page = client.call(
            "mail.mailing_lists.list_recipients", email=email, start=start, limit=RECIPIENT_PAGE
        )
        recipients.extend(r["email"] for r in page["items"] if r.get("enabled", True))
        start += len(page["items"])
        if not page["items"] or start >= page["total"]:
            return recipients


def get_account_metadata() -> dict:
    """Locale and time zone choices as ``{value, label}`` lists."""

    options = get_client().call("mail.meta.get_account_options")
    return {
        "locales": [{"value": o["value"], "label": o["label"]} for o in options.get("locales") or []],
        "time_zones": [{"value": o["value"], "label": o["label"]} for o in options.get("time_zones") or []],
    }


def create_account(
    email: str,
    password: str,
    display_name: str | None = None,
    aliases: list[str] | None = None,
    groups: list[str] | None = None,
    mailing_lists: list[str] | None = None,
    disk_quota_gb: float | None = None,
    locale: str | None = None,
    time_zone: str | None = None,
) -> dict:
    """Creates the account and returns its payload, including the app password (shown once)."""

    return get_client().call(
        "mail.accounts.create_account",
        email=email,
        password=password,
        display_name=display_name,
        aliases=aliases or None,
        groups=groups or None,
        mailing_lists=mailing_lists or None,
        disk_quota_gb=disk_quota_gb,
        locale=locale,
        time_zone=time_zone,
    )


def update_password(user: str | None = None, new_password: str | None = None) -> None:
    """Sets the password of the user's mail account (no-op if they have none)."""

    if not user or not new_password:
        frappe.throw(_("User and new password are required to update the mail password."))
    if email := get_account_email(user):
        get_client().call("mail.accounts.set_password", email=email, password=new_password)


def delete_account(user: str) -> None:
    """Deletes the user's mail account (no-op if they have none)."""

    if email := get_account_email(user):
        delete_account_by_email(email)


def delete_account_by_email(email: str) -> None:
    try:
        get_client().call("mail.accounts.delete_account", email=email)
    except frappe.DoesNotExistError:
        pass  # already gone: nothing to delete


def set_account_enabled(user: str, enabled: bool) -> None:
    """Locks or unlocks the user's mail account; a locked one keeps receiving mail."""

    if email := get_account_email(user):
        get_client().call("mail.accounts.set_account_enabled", email=email, enabled=bool(enabled))


def push_site_profile(**changes: str) -> None:
    """Sends the workspace name (as the site's title) and contact email to Suite Cloud.

    Called from the Suite Settings save; a Suite Cloud that is unreachable or not configured must
    not stop an admin from editing the settings, so failures are logged rather than raised.
    """

    if not changes or not is_suite_cloud_configured():
        return
    try:
        get_client().call("site.update_site_profile", **changes)
    except Exception:
        log_mail_error("Failed to push the site profile to Suite Cloud", frappe.get_traceback())
