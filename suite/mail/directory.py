"""The site's mail directory as Suite Cloud holds it.

Accounts, groups, mailing lists and domains are identified by their addresses. Everything here
goes through the Suite Cloud client; nothing touches the cluster directly.
"""

import frappe
from frappe import _
from frappe.utils.caching import redis_cache

from suite.mail.suite_cloud import get_client
from suite.mail.utils.user import get_account_email

GB = 1024**3
# Recipients read per list when building the calendar expansion index; larger lists are cut.
MAILING_LIST_INDEX_LIMIT = 5000


@redis_cache(ttl=60)
def get_domains() -> list[dict]:
    """The site's domains (cached briefly)."""

    return get_client().call("domains.list_domains")


def get_enabled_domain_names() -> list[str]:
    return sorted(d["domain"] for d in get_domains() if d.get("enabled"))


@redis_cache(ttl=60)
def get_mailing_list_index() -> dict[str, list[str]]:
    """``{list address: [recipient addresses]}`` for every list (cached briefly).

    Membership edits are visible once the cache expires; mail routing itself is unaffected, so the
    only window is between a membership change and the next calendar invitation.
    """

    client = get_client()
    index = {}
    for mailing_list in client.call("mailing_lists.list_mailing_lists"):
        page = client.call(
            "mailing_lists.list_recipients", email=mailing_list["email"], limit=MAILING_LIST_INDEX_LIMIT
        )
        index[mailing_list["email"]] = [r["email"] for r in page["items"] if r.get("enabled", True)]
    return index


@redis_cache(ttl=3600)
def get_account_metadata() -> dict:
    """Locale and time zone choices as ``{value, label}`` lists."""

    options = get_client().call("meta.get_account_options")
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
        "accounts.create_account",
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


def create_app_password(email: str, description: str | None = None) -> str:
    return get_client().call("accounts.create_app_password", email=email, description=description or "Suite")[
        "secret"
    ]


def update_password(user: str | None = None, new_password: str | None = None) -> None:
    """Sets the password of the user's mail account (no-op if they have none)."""

    if not user or not new_password:
        frappe.throw(_("User and new password are required to update the mail password."))
    if email := get_account_email(user):
        get_client().call("accounts.set_password", email=email, password=new_password)


def delete_account(user: str) -> None:
    """Deletes the user's mail account (no-op if they have none)."""

    if email := get_account_email(user):
        try:
            get_client().call("accounts.delete_account", email=email)
        except frappe.DoesNotExistError:
            pass  # already gone: nothing to delete


def set_account_enabled(user: str, enabled: bool) -> None:
    """Locks or unlocks the user's mail account; a locked one keeps receiving mail."""

    if email := get_account_email(user):
        get_client().call("accounts.set_account_enabled", email=email, enabled=bool(enabled))
