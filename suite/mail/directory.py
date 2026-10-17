"""The site's mail directory as Suite Cloud holds it.

Accounts, groups, mailing lists and domains are identified by their addresses. Everything here
goes through the Suite Cloud client; nothing touches the cluster directly.
"""

import frappe
from frappe import _

from suite.mail.suite_cloud import SuiteCloudUnavailableError, get_client, is_suite_cloud_configured
from suite.mail.utils import log_mail_error
from suite.mail.utils.user import get_account_email

GB = 1024**3
# Suite Cloud hands out recipients a page at a time; this is its largest page.
RECIPIENT_PAGE = 1000
LIST_PAGE = 500  # groups and lists per call, the cap Suite Cloud allows
MAX_PAGES = 200  # more than any site holds; a peer that never ends must not hold a worker
INDEX_KEY = "mail:mailing_list_index"
INDEX_FRESH_KEY = "mail:mailing_list_index:fresh"
INDEX_TTL = 60  # seconds an index is served before Suite Cloud is asked again
INDEX_KEEP = 24 * 3600  # the last good index stays this long to cover a refresh Suite Cloud refuses


class ListingCutShortError(frappe.ValidationError):
    """A paged listing was still going after ``MAX_PAGES``; what came back is not the whole set."""


def get_domains() -> list[dict]:
    """The site's domains, read from Suite Cloud on every call so the dashboard is never stale."""

    return get_client().call("mail.domains.list_domains")


def get_active_domain_names() -> list[str]:
    """Domains that take new accounts, groups and lists: enabled and verified on Suite Cloud."""

    return sorted(d["domain"] for d in get_domains() if d.get("enabled") and d.get("is_verified"))


def get_mailing_list_index() -> dict[str, list[str]]:
    """``{list address: [recipient addresses]}`` for every list, refreshed once a minute.

    Membership edits are visible once the index expires; mail routing itself is unaffected, so the
    only window is between a membership change and the next calendar invitation. When Suite Cloud
    refuses or cannot answer a refresh, the last good index is served for another minute before
    the next attempt: a rate limit hit by other traffic must not turn a list invitation into one
    sent to nobody, and retrying on every lookup would only keep the site over the limit.
    """

    index = frappe.cache.get_value(INDEX_KEY)
    if index is not None and frappe.cache.get_value(INDEX_FRESH_KEY, expires=True):
        return index

    try:
        index = build_mailing_list_index()
    except (frappe.TooManyRequestsError, SuiteCloudUnavailableError, ListingCutShortError) as e:
        if index is None:
            raise
        log_mail_error("Mailing list index could not be refreshed; the previous one is in use", str(e))
    else:
        # Only a successful build writes the index, so a failed one cannot undo a parallel success.
        frappe.cache.set_value(INDEX_KEY, index, expires_in_sec=INDEX_KEEP)

    frappe.cache.set_value(INDEX_FRESH_KEY, 1, expires_in_sec=INDEX_TTL)
    return index


def build_mailing_list_index() -> dict[str, list[str]]:
    """The index read from Suite Cloud: every list, with its enabled recipients in address order."""

    index = {ml["email"]: [] for ml in all_pages("mail.mailing_lists.list_mailing_lists")}
    for row in all_pages("mail.mailing_lists.list_all_recipients", limit=RECIPIENT_PAGE):
        if row.get("enabled", True):
            index.setdefault(row["mailing_list"], []).append(row["email"])
    return index


def clear_mailing_list_index() -> None:
    frappe.cache.delete_value([INDEX_KEY, INDEX_FRESH_KEY])


def all_pages(method: str, limit: int = LIST_PAGE, **params) -> list[dict]:
    """Every item of a paged listing (``{items, total}``), read page by page.

    Raises ``ListingCutShortError`` rather than return part of the set: a caller that checks for
    a duplicate or expands a list must not act on a listing with the tail missing.
    """

    client = get_client()
    items: list[dict] = []
    start = 0
    for _page in range(MAX_PAGES):
        page = client.call(method, start=start, limit=limit, **params)
        items.extend(page["items"])
        start += len(page["items"])
        if not page["items"] or start >= page["total"]:
            return items
    raise ListingCutShortError(f"{method} kept answering after {MAX_PAGES} pages")


def get_group_addresses() -> set[str]:
    return {g["email"] for g in all_pages("mail.groups.list_groups")}


def get_mailing_list_addresses() -> set[str]:
    return {ml["email"] for ml in all_pages("mail.mailing_lists.list_mailing_lists")}


def get_account_metadata() -> dict:
    """Locale and time zone choices as ``{value, label}`` lists."""

    options = get_client().call("mail.meta.get_account_options")
    return {
        "locales": [{"value": o["value"], "label": o["label"]} for o in options.get("locales") or []],
        "time_zones": [{"value": o["value"], "label": o["label"]} for o in options.get("time_zones") or []],
    }


def account_exists(email: str) -> bool:
    try:
        get_client().call("mail.accounts.get_account", email=email)
    except frappe.DoesNotExistError:
        return False
    return True


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
    disable_receiving: bool = False,
    operation: str | None = None,
) -> dict:
    """Creates the account and returns its payload, including the app password (shown once).

    ``disable_receiving`` makes it send-only: mail addressed to it bounces back to the sender.
    """

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
        disable_receiving=disable_receiving or None,
        description=f"Suite setup {operation}" if operation else None,
    )


def provision_account(email: str, password: str, *, operation: str, **options) -> dict:
    """Retry only an account positively identified as this operation's resource.

    A durable non-secret description bridges provider/local transactions. A lost
    response is recovered by rotating the app credential, never deleting an
    account whose ownership is uncertain or retrieving a previous secret.
    """
    client = get_client()
    try:
        existing = client.call("mail.accounts.get_account", email=email)
    except frappe.DoesNotExistError:
        return create_account(email, password, operation=operation, **options)
    if existing.get("description") != f"Suite setup {operation}":
        frappe.throw(_("This business address is already claimed by another account"), frappe.ValidationError)
    client.call("mail.accounts.set_password", email=email, password=password)
    return {**existing, **client.call("mail.accounts.rotate_app_password", email=email)}


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


def push_tenant_profile(**changes: str) -> None:
    """Sends the workspace name (as the tenant's title) and contact email to Suite Cloud.

    Queued by the Suite Settings save; a Suite Cloud that is unreachable or not configured must
    not stop an admin from editing the settings, so failures are logged rather than raised.
    """

    if not changes or not is_suite_cloud_configured():
        return
    try:
        get_client().call("tenant.update_tenant_profile", **changes)
    except Exception:
        log_mail_error("Failed to push the tenant profile to Suite Cloud", frappe.get_traceback())
