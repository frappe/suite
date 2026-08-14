import csv
import io
import json
from contextlib import suppress
from typing import Any, Literal

import frappe
from frappe import _
from frappe.query_builder.functions import Max
from frappe.utils import cint, flt, validate_email_address
from pypika import Case, Order

from suite.mail import stalwart
from suite.mail.api.utils import get_avatar_url
from suite.mail.doctype.user_account.user_account import get_user_personal_jmap_account
from suite.mail.stalwart import (
    get_account_metadata,
    get_action_types,
    get_log_labels,
    get_queue_metadata,
)
from suite.mail.stalwart import get_domains as get_stalwart_domains
from suite.mail.stalwart import get_permissions as get_stalwart_permissions
from suite.mail.utils import get_config
from suite.mail.utils.dns import parse_dns_zone_file
from suite.mail.utils.dt import from_utc_z, normalize_utc_z, to_utc_z
from suite.mail.utils.logger import log_admin_action
from suite.mail.utils.validation import is_subaddressed_email
from suite.utils import execute_with_logging
from suite.utils.rate_limiter import dynamic_rate_limit
from suite.utils.user import is_suite_admin, is_system_manager, is_user_enabled


def check_admin_permission(action: str, target: Any = None) -> str:
    """Ensure the session user is an enabled Suite Admin or System Manager, returning the user.

    The enabled check is defense-in-depth: a disabled admin holding a still-valid session (or an
    API key) must not be able to perform admin actions, e.g. re-enable their own account via
    enable_members. Throws frappe.PermissionError otherwise.

    Every action that changes something is also written to the admin log with ``target`` (the object
    acted on), so a shared inbox of administrators stays accountable. Reads are not logged: each
    dashboard page issues several and they change nothing.
    """

    user = frappe.session.user
    if (not is_suite_admin(user) and not is_system_manager(user)) or not is_user_enabled(user):
        frappe.throw(
            _("User {0} does not have permission to {1}.").format(frappe.bold(user), action),
            frappe.PermissionError,
        )

    if not action.startswith("view "):
        log_admin_action(action, target)

    return user


def check_member_target(member_id: str) -> str:
    """Ensure ``member_id`` is a mail member the session user may act on, returning it.

    The member endpoints save the target User with ``ignore_permissions=True``, which bypasses the
    framework's own guard against editing Administrator and other standard users. Without this check
    a Suite Admin - a role ordinary members get when created with ``is_admin`` - could name any User
    at all and, via change_member_password, take over the Administrator account.

    So the target must be a real mail member (the same predicate get_members lists on), never a
    standard user, and never a System Manager unless the caller is one too.
    """

    if not member_id or member_id in frappe.STANDARD_USERS:
        frappe.throw(_("{0} is not a mail member.").format(frappe.bold(member_id)), frappe.PermissionError)

    if not frappe.db.exists("User Settings", {"user": member_id, "username": ["is", "set"]}):
        frappe.throw(_("{0} is not a mail member.").format(frappe.bold(member_id)), frappe.PermissionError)

    if is_system_manager(member_id) and not is_system_manager(frappe.session.user):
        frappe.throw(
            _("You do not have permission to act on {0}.").format(frappe.bold(member_id)),
            frappe.PermissionError,
        )

    return member_id


def _get_stalwart_domain(domain_id: str) -> dict:
    """Helper function to get a domain by ID from Stalwart, throwing a DoesNotExistError if not found."""

    domains = get_stalwart_domains()
    domain = next((d for d in domains if d["id"] == domain_id), None)

    if not domain:
        frappe.throw(_("Domain not found"), frappe.DoesNotExistError)

    return domain


@frappe.whitelist()
@dynamic_rate_limit()
def add_domain(name: str, description: str | None = None) -> str:
    """Adds a new domain to Stalwart with the specified name and description, returning the new domain's ID."""

    check_admin_permission("add domains", name)

    for domain in get_stalwart_domains():
        if domain["name"].lower() == name.lower():
            frappe.throw(_("Domain {0} already exists.").format(name))

    domain_id = execute_with_logging(
        func=lambda: stalwart.manage_create("Domain", stalwart.domain_payload(name, description=description))[
            "id"
        ],
        title=_("Failed to add domain {0}").format(name),
        user_message=_("An error occurred while adding the domain, check error logs for more details."),
        with_context=False,
        module="Mail",
    )

    get_stalwart_domains.clear_cache()
    return domain_id


@frappe.whitelist()
def get_domains(txt: str | None = None, is_enabled: bool | None = None) -> list[dict]:
    """Returns the list of domains configured in Stalwart, with optional filtering by name/description and enabled status"""

    check_admin_permission("view domains")

    result = []

    with suppress(Exception):
        for domain in get_stalwart_domains():
            if txt and (
                txt.lower() not in domain["name"].lower()
                and txt.lower() not in (domain.get("description") or "").lower()
            ):
                continue

            if is_enabled is not None and domain["isEnabled"] != bool(is_enabled):
                continue

            result.append(
                {
                    "id": domain["id"],
                    "name": domain["name"],
                    "description": domain.get("description", ""),
                    "is_enabled": domain["isEnabled"],
                    "created_at": normalize_utc_z(domain["createdAt"]),
                }
            )

    return result


@frappe.whitelist()
def get_domain(domain_id: str) -> dict:
    """Returns the details of a domain, including its DNS records parsed from the zone file"""

    check_admin_permission("view domains")

    def infer_category(record: dict) -> str:
        """Infers the category of the DNS record based on its type and name."""

        t = record["type"]
        name = record["name"]

        if t == "MX":
            return "Receiving"

        if t == "TXT":
            value = record["value"] or ""
            if name.startswith("_dmarc"):
                return "DMARC"
            if "spf1" in value:
                return "Sending"
            if "domainkey" in name:
                return "DKIM"
            if name.startswith("_smtp._tls"):
                return "TLS Reporting"
            return "TXT"

        if t == "CNAME":
            if "autoconfig" in name:
                return "Auto-config"
            if "autodiscover" in name:
                return "Auto-discover"
            return "Alias"

        if t == "SRV":
            if "_imap" in name or "_pop3" in name:
                return "Receiving"
            if "_submission" in name or "_submissions" in name:
                return "Sending"
            return "Server"

        return "Other"

    def is_mandatory(record: dict) -> bool:
        """Define which DNS records are required."""

        category = record["category"]
        value = record["value"]

        if category == "Sending" and "spf1" in value:
            return True
        if category == "DMARC":
            return True
        if category == "DKIM":
            return True
        if record["type"] == "MX":
            return False

        return False

    domain = _get_stalwart_domain(domain_id)

    default_ttl = get_config("default_dns_ttl")
    dns_records = parse_dns_zone_file(domain["dnsZoneFile"])
    for record in dns_records:
        if not record["ttl"]:
            record["ttl"] = default_ttl
        record["category"] = infer_category(record)
        record["mandatory"] = is_mandatory(record)

    return {
        "id": domain["id"],
        "name": domain["name"],
        "description": domain.get("description", ""),
        "is_enabled": domain["isEnabled"],
        "created_at": normalize_utc_z(domain["createdAt"]),
        "dns_records": dns_records,
    }


@frappe.whitelist()
def delete_domain(domain_id: str) -> None:
    """Deletes a domain identified by Stalwart domain ID."""

    check_admin_permission("delete domains", domain_id)

    execute_with_logging(
        func=lambda: stalwart.delete_domains([domain_id]),
        title=_("Failed to delete domain with ID {0}").format(domain_id),
        user_message=_("An error occurred while deleting the domain, check error logs for more details."),
        with_context=False,
        module="Mail",
    )

    get_stalwart_domains.clear_cache()


@frappe.whitelist()
def get_enabled_domains() -> list[str]:
    """Returns the list of enabled domains"""

    check_admin_permission("view domains")

    try:
        return list(set([d["name"] for d in get_stalwart_domains() if d["isEnabled"]]))
    except Exception:
        return []


@frappe.whitelist()
def get_domain_dns_zone(domain_id: str) -> str:
    """Returns the DNS zone file of the domain"""

    check_admin_permission("view domains")

    domain = _get_stalwart_domain(domain_id)
    return domain["dnsZoneFile"]


@frappe.whitelist()
def get_domain_dns_csv(domain_id: str) -> str:
    """Returns the DNS records of the domain as a CSV string"""

    check_admin_permission("view domains")

    domain = _get_stalwart_domain(domain_id)
    dns_records = parse_dns_zone_file(domain["dnsZoneFile"])

    fieldnames = ["name", "ttl", "class", "type", "value"]

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()

    for record in dns_records:
        writer.writerow(record)

    return output.getvalue()


@frappe.whitelist()
def get_domain_dns_json(domain_id: str) -> str:
    """Returns the DNS records of the domain as a JSON object"""

    check_admin_permission("view domains")

    domain = _get_stalwart_domain(domain_id)
    dns_records = parse_dns_zone_file(domain["dnsZoneFile"])
    return json.dumps(dns_records, indent=4)


@frappe.whitelist()
@dynamic_rate_limit()
def add_member(
    username: str,
    domain: str,
    is_admin: bool,
    send_invite: bool,
    backup_email: str,
    first_name: str | None = None,
    last_name: str | None = None,
    password: str | None = None,
    expires_at: str | None = None,
    aliases: list | None = None,
    groups: list | None = None,
    mailing_lists: list | None = None,
    quota_gb: float | None = None,
    locale: str | None = None,
    time_zone: str | None = None,
) -> None:
    """Create a new Mail Account Request for adding a member.

    ``username``/``domain`` are the primary address (becomes the User); ``aliases`` are additional
    full email addresses attached as aliases to the same account. ``groups`` and ``mailing_lists``
    are ids the account joins once it is created — right away when invites are off, on verification
    otherwise. ``quota_gb`` is the account's disk quota, where ``0`` means unlimited and ``None``
    falls back to the configured default.

    ``locale`` and ``time_zone``, like the name and password, only apply when the account is created
    right away; an invited member picks their own on the setup form.
    """

    account_request = frappe.new_doc("Mail Account Request")
    account_request.account = f"{username}@{domain}"
    account_request.aliases = "\n".join(_listify(aliases))
    account_request.groups = "\n".join(str(g) for g in _listify(groups))
    account_request.mailing_lists = "\n".join(str(ml) for ml in _listify(mailing_lists))
    if quota_gb is not None:
        account_request.quota_gb = flt(quota_gb)
    account_request.is_admin = cint(is_admin)
    account_request.invited_by = frappe.session.user
    account_request.backup_email = backup_email
    account_request.send_invite = cint(send_invite)
    # Arrives as UTC like every other timestamp; the doctype field holds system time.
    account_request.expires_at = from_utc_z(expires_at)
    # Insert first: create permission on Mail Account Request is what gates this endpoint, so the
    # action is only authorized (and worth recording) once the request exists.
    account_request.insert()
    log_admin_action("add members", account_request.account)

    if not send_invite:
        account_request.force_verify_and_create_account(first_name, last_name, password, locale, time_zone)


@frappe.whitelist()
def get_members(
    search: str | None = None, is_admin: bool | None = None, is_enabled: bool | None = None
) -> list:
    check_admin_permission("view members")

    USER = frappe.qb.DocType("User")
    HAS_ROLE = frappe.qb.DocType("Has Role")
    USER_SETTINGS = frappe.qb.DocType("User Settings")

    admin_case = Case().when(HAS_ROLE.role == "Suite Admin", 1).else_(0)
    is_admin_expr = Max(admin_case)

    query = (
        frappe.qb.from_(USER)
        .left_join(HAS_ROLE)
        .on(USER.name == HAS_ROLE.parent)
        .left_join(USER_SETTINGS)
        .on(USER.name == USER_SETTINGS.user)
        .select(
            USER.name,
            USER.full_name,
            USER.user_image,
            USER.last_active,
            USER.enabled,
            is_admin_expr.as_("is_admin"),
        )
        .where(USER_SETTINGS.username.isnotnull())
        .groupby(USER.name)
    )

    if is_enabled is not None:
        query = query.where(USER.enabled == (1 if is_enabled else 0))

    if search:
        query = query.where(USER.name.like(f"%{search}%") | USER.full_name.like(f"%{search}%"))

    if is_admin is not None:
        query = query.having(is_admin_expr == (1 if is_admin else 0))

    users = (
        query.orderby(is_admin_expr, order=Order.desc).orderby(USER.name, order=Order.asc).run(as_dict=True)
    )

    for user in users:
        if not user.get("user_image"):
            user["user_image"] = get_avatar_url(user["name"])

        user["is_admin"] = bool(user.get("is_admin"))
        user["enabled"] = bool(user.get("enabled"))
        # Stored in system time; the API speaks UTC, like every other timestamp it returns.
        user["last_active"] = to_utc_z(user.get("last_active"))

    return users


def _build_quota_usage(total: int, used: int) -> dict:
    """Normalizes raw disk-quota byte counts into the shape the member page renders.

    A total of 0 (Stalwart omits maxDiskQuota) means unlimited storage, so percentages and the
    available figure are meaningless and reported as such.
    """

    total = max(total or 0, 0)
    used = max(used or 0, 0)

    if total <= 0:
        return {
            "total": 0,
            "used": used,
            "available": 0,
            "used_percentage": 0,
            "available_percentage": 0,
            "unlimited": True,
        }

    available = max(total - used, 0)
    used_percentage = min((used / total) * 100, 100)

    return {
        "total": total,
        "used": used,
        "available": available,
        "used_percentage": used_percentage,
        "available_percentage": 100 - used_percentage,
        "unlimited": False,
    }


@frappe.whitelist()
def get_member(member_id: str) -> dict:
    """Returns a member's profile along with their Stalwart quota usage and email addresses.

    Quota and email addresses are read live from the member's personal Stalwart account via the CLI;
    when the member has no personal account configured, those sections come back empty rather than
    failing the whole page.
    """

    check_admin_permission("view members")

    user = frappe.db.get_value(
        "User",
        member_id,
        ["name", "full_name", "user_image", "last_active", "enabled", "creation"],
        as_dict=True,
    )
    if not user:
        frappe.throw(_("Member not found"), frappe.DoesNotExistError)

    is_admin = bool(frappe.db.exists("Has Role", {"parent": member_id, "role": "Suite Admin"}))

    result = {
        "name": user.name,
        "full_name": user.full_name,
        "user_image": user.user_image or get_avatar_url(user.name),
        "description": user.full_name,
        # Both are stored in system time; the API speaks UTC.
        "last_active": to_utc_z(user.last_active),
        "joined_on": to_utc_z(user.creation),
        "enabled": bool(user.enabled),
        "is_admin": is_admin,
        "email_addresses": [],
        "groups": [],
        "mailing_lists": [],
        "quota": _build_quota_usage(0, 0),
        "locale": None,
        "time_zone": None,
    }

    account_id = get_user_personal_jmap_account(member_id)
    if not account_id:
        return result

    with suppress(Exception):
        account = stalwart.manage_get(
            "Account",
            account_id,
            properties=[
                "emailAddress",
                "aliases",
                "quotas",
                "usedDiskQuota",
                "memberGroupIds",
                "description",
                "locale",
                "timeZone",
            ],
        )
        if not account:
            return result

        result["locale"] = account.get("locale")
        result["time_zone"] = account.get("timeZone")

        # Each address carries a description used as its Identity display name: the primary uses the
        # account description, each alias its own.
        email_addresses = []
        if primary := account.get("emailAddress"):
            email_addresses.append(
                {
                    "email": primary,
                    "description": account.get("description"),
                    "is_primary": True,
                    "enabled": True,
                }
            )

        aliases = account.get("aliases") or {}
        if aliases:
            domain_names = {d["id"]: d["name"] for d in get_stalwart_domains()}
            for alias in aliases.values():
                name = alias.get("name")
                domain_name = domain_names.get(alias.get("domainId"))
                if name and domain_name:
                    email_addresses.append(
                        {
                            "email": f"{name}@{domain_name}",
                            "description": alias.get("description"),
                            "is_primary": False,
                            "enabled": bool(alias.get("enabled", True)),
                        }
                    )

        emails = [entry["email"] for entry in email_addresses]
        result["email_addresses"] = email_addresses
        result["quota"] = _build_quota_usage(
            (account.get("quotas") or {}).get("maxDiskQuota") or 0,
            account.get("usedDiskQuota") or 0,
        )

        # Groups the account belongs to (membership lives on the account's memberGroupIds).
        group_ids = _keys(account.get("memberGroupIds"))
        if group_ids:
            group_map = {
                g["id"]: g for g in stalwart.get_all_groups(properties=["id", "name", "emailAddress"])
            }
            result["groups"] = [
                {"id": gid, "name": group_map[gid].get("name"), "email": group_map[gid].get("emailAddress")}
                for gid in group_ids
                if gid in group_map
            ]

        # Mailing lists that include the member as a recipient. Recipients are email addresses
        # (internal or external), so match against the member's own addresses, not the account id.
        member_emails = {email.lower() for email in emails}
        result["mailing_lists"] = [
            {"id": ml["id"], "name": ml.get("name"), "email": ml.get("emailAddress")}
            for ml in stalwart.manage_get_all(
                "MailingList", properties=["id", "name", "emailAddress", "recipients"]
            )
            if member_emails & {recipient.lower() for recipient in _keys(ml.get("recipients"))}
        ]

    return result


@frappe.whitelist()
def get_account_requests(
    search: str | None = None, status: Literal["All", "Pending", "Accepted", "Expired"] = "All"
) -> list[dict]:
    """Returns the list of account invites"""

    check_admin_permission("view account requests")

    ACC_REQ = frappe.qb.DocType("Mail Account Request")
    query = (
        frappe.qb.from_(ACC_REQ)
        .select(
            ACC_REQ.name,
            ACC_REQ.account,
            ACC_REQ.is_admin,
            ACC_REQ.backup_email,
            ACC_REQ.invited_by,
            ACC_REQ.is_verified,
        )
        .orderby(ACC_REQ.creation, order=Order.desc)
    )

    if search:
        query = query.where(ACC_REQ.account.like(f"%{search}%"))

    if status == "Pending":
        query = query.where((ACC_REQ.is_verified == 0) & (ACC_REQ.expires_at > frappe.utils.now()))
    elif status == "Accepted":
        query = query.where(ACC_REQ.is_verified == 1)
    elif status == "Expired":
        query = query.where((ACC_REQ.is_verified == 0) & (ACC_REQ.expires_at <= frappe.utils.now()))

    invites = query.run(as_dict=True)

    return invites


@frappe.whitelist()
def delete_account_requests(names: list) -> None:
    """Delete Mail Account Requests"""

    check_admin_permission("delete account requests", names)

    for d in names:
        frappe.delete_doc("Mail Account Request", d)


@frappe.whitelist()
def delete_members(names: list) -> None:
    """Delete member users. The User on_trash hooks cascade to their Stalwart account and settings."""

    user = check_admin_permission("delete members", names)

    if user in names:
        frappe.throw(_("You cannot delete your own account."))

    for name in names:
        check_member_target(name)
        frappe.delete_doc("User", name)


@frappe.whitelist()
def disable_members(names: list) -> None:
    """Disable member users. Disabled users can no longer log in and their sessions are cleared."""

    user = check_admin_permission("disable members", names)

    if user in names:
        frappe.throw(_("You cannot disable your own account."))

    for name in names:
        check_member_target(name)
        member = frappe.get_doc("User", name)
        if not member.enabled:
            continue

        member.enabled = 0
        member.save(ignore_permissions=True)


@frappe.whitelist()
def enable_members(names: list) -> None:
    """Enable member users. The configured disabled account role is removed and the users can log in again."""

    check_admin_permission("enable members", names)

    for name in names:
        check_member_target(name)
        member = frappe.get_doc("User", name)
        if member.enabled:
            continue

        member.enabled = 1
        member.save(ignore_permissions=True)


@frappe.whitelist()
@dynamic_rate_limit()
def change_member_password(member_id: str, new_password: str) -> None:
    """Set a member's password directly.

    Saving the User with `new_password` set triggers the update_account_password hook, which
    propagates the new password to the member's Stalwart account.
    """

    check_admin_permission("change member password", member_id)
    check_member_target(member_id)

    if not new_password:
        frappe.throw(_("New password is required."))

    member = frappe.get_doc("User", member_id)
    member.new_password = new_password
    member.save(ignore_permissions=True)


# ---------------------------------------------------------------------------
# Member editing (Frappe User + Stalwart account)
# ---------------------------------------------------------------------------

_GB = 1024**3


def _member_account(member_id: str) -> str | None:
    """Returns the member's personal Stalwart account id, or None if they have none."""

    return get_user_personal_jmap_account(member_id, raise_exception=False)


def _require_member_account(member_id: str) -> str:
    account_id = _member_account(member_id)
    if not account_id:
        frappe.throw(_("This member does not have a mail account."))

    return account_id


def _alias_emails(account: dict, domain_names: dict) -> list[str]:
    """Builds the account's alias email addresses from its raw ``aliases`` map."""

    emails = []
    for alias in (account.get("aliases") or {}).values():
        name = alias.get("name")
        domain = domain_names.get(alias.get("domainId"))
        if name and domain:
            emails.append(f"{name}@{domain}")

    return emails


def _rebuild_aliases(account: dict, *, keep: callable) -> list[dict]:
    """Rebuilds the account's alias objects, keeping those for which ``keep(email)`` is True."""

    domain_names = {d["id"]: d["name"] for d in get_stalwart_domains()}
    aliases = []
    for alias in (account.get("aliases") or {}).values():
        domain = domain_names.get(alias.get("domainId"))
        email = f"{alias.get('name')}@{domain}" if domain else None
        if email and not keep(email.lower()):
            continue

        aliases.append(
            stalwart.email_alias(
                alias["name"],
                alias["domainId"],
                enabled=alias.get("enabled", True),
                description=alias.get("description"),
            )
        )

    return aliases


def _locale_patch(locale: str | None, time_zone: str | None) -> dict:
    """Builds the account patch for the locale and time zone, skipping whatever was not passed.

    The two differ on the server: a locale is required, so an empty one leaves it alone, while the
    time zone is nullable and an empty one clears it back to "unset".
    """

    patch = {}
    if locale:
        patch["locale"] = locale
    if time_zone is not None:
        patch["timeZone"] = time_zone or None
    return patch


@frappe.whitelist()
def get_account_options() -> dict:
    """Returns the locale and time zone choices for editing a member or group."""

    check_admin_permission("view account options")
    return get_account_metadata()


@frappe.whitelist()
def update_member(
    member_id: str,
    role: str | None = None,
    description: str | None = None,
    quota_gb: float | None = None,
    locale: str | None = None,
    time_zone: str | None = None,
) -> None:
    """Updates a member's role, display name, quota, locale and time zone.

    The role only toggles the Suite Admin role on Frappe; Stalwart roles stay untouched, since
    Suite Admin calls are proxied through the configured Stalwart admin credentials.
    """

    check_admin_permission("update members", member_id)
    check_member_target(member_id)

    member = frappe.get_doc("User", member_id)

    if role is not None:
        if role == "admin":
            member.append_roles("Suite Admin")
        else:
            member.set("roles", [r for r in member.get("roles") if r.role != "Suite Admin"])

    description = (description or "").strip()
    if description:
        first, _sep, last = description.partition(" ")
        member.first_name = first
        member.last_name = last or None

    member.save(ignore_permissions=True)

    account_id = _member_account(member_id)
    if not account_id:
        return

    if description:
        execute_with_logging(
            func=lambda: stalwart.manage_update("Account", account_id, {"description": description}),
            title=_("Failed to update description for {0}").format(member_id),
            user_message=_(
                "An error occurred while updating the description, check error logs for more details."
            ),
            with_context=False,
            module="Mail",
        )

    if quota_gb is not None:
        quota_bytes = cint(float(quota_gb) * _GB)
        execute_with_logging(
            func=lambda: stalwart.manage_update("Account", account_id, {"quotas/maxDiskQuota": quota_bytes}),
            title=_("Failed to update quota for {0}").format(member_id),
            user_message=_("An error occurred while updating the quota, check error logs for more details."),
            with_context=False,
            module="Mail",
        )

    if patch := _locale_patch(locale, time_zone):
        execute_with_logging(
            func=lambda: stalwart.manage_update("Account", account_id, patch),
            title=_("Failed to update locale for {0}").format(member_id),
            user_message=_("An error occurred while updating the locale, check error logs for more details."),
            with_context=False,
            module="Mail",
        )


def _add_alias(type_: str, resource_id: str, email: str, description: str | None = None) -> None:
    """Adds ``email`` as an alias (with optional description) to the given account or mailing list."""

    email = (email or "").strip().lower()
    validate_email_address(email, throw=True)
    is_subaddressed_email(email, raise_exception=True)

    local, _sep, domain = email.partition("@")
    domain_id = stalwart.get_domain_by_name(domain, raise_exception=True)["id"]

    obj = stalwart.manage_get(type_, resource_id, properties=["emailAddress", "aliases"])
    if email == (obj.get("emailAddress") or "").lower():
        frappe.throw(_("{0} is already the primary address.").format(email))

    domain_names = {d["id"]: d["name"] for d in get_stalwart_domains()}
    if email in {e.lower() for e in _alias_emails(obj, domain_names)}:
        return

    aliases = _rebuild_aliases(obj, keep=lambda _e: True)
    aliases.append(stalwart.email_alias(local, domain_id, description=(description or "").strip() or None))

    execute_with_logging(
        func=lambda: stalwart.set_aliases(type_, resource_id, aliases),
        title=_("Failed to add email {0}").format(email),
        user_message=_("An error occurred while adding the email, check error logs for more details."),
        with_context=False,
        module="Mail",
    )


def _remove_alias(type_: str, resource_id: str, email: str) -> None:
    """Removes the alias ``email`` from the given account or mailing list (the primary cannot be removed)."""

    email = (email or "").strip().lower()
    obj = stalwart.manage_get(type_, resource_id, properties=["emailAddress", "aliases"])
    if email == (obj.get("emailAddress") or "").lower():
        frappe.throw(_("The primary address cannot be removed."))

    aliases = _rebuild_aliases(obj, keep=lambda e: e != email)

    execute_with_logging(
        func=lambda: stalwart.set_aliases(type_, resource_id, aliases),
        title=_("Failed to remove email {0}").format(email),
        user_message=_("An error occurred while removing the email, check error logs for more details."),
        with_context=False,
        module="Mail",
    )


def _set_alias_enabled(type_: str, resource_id: str, email: str, enabled: bool) -> None:
    """Enables or disables the alias ``email`` (the primary address is always enabled)."""

    email = (email or "").strip().lower()
    obj = stalwart.manage_get(type_, resource_id, properties=["emailAddress", "aliases"])
    if not obj or email == (obj.get("emailAddress") or "").lower():
        return

    domain_names = {d["id"]: d["name"] for d in get_stalwart_domains()}
    aliases = []
    for alias in (obj.get("aliases") or {}).values():
        domain = domain_names.get(alias.get("domainId"))
        alias_email = f"{alias.get('name')}@{domain}" if domain else None
        is_target = bool(alias_email) and alias_email.lower() == email
        aliases.append(
            stalwart.email_alias(
                alias["name"],
                alias["domainId"],
                enabled=enabled if is_target else alias.get("enabled", True),
                description=alias.get("description"),
            )
        )

    execute_with_logging(
        func=lambda: stalwart.set_aliases(type_, resource_id, aliases),
        title=_("Failed to update email {0}").format(email),
        user_message=_("An error occurred while updating the email, check error logs for more details."),
        with_context=False,
        module="Mail",
    )


@frappe.whitelist()
def add_member_email(member_id: str, email: str, description: str | None = None) -> None:
    """Adds an email address to the member's account as an alias with an optional description."""

    check_admin_permission("update members", f"{member_id} ({email})")
    _add_alias("Account", _require_member_account(member_id), email, description)


@frappe.whitelist()
def remove_member_email(member_id: str, email: str) -> None:
    """Removes an alias email address from the member's account (the primary cannot be removed)."""

    check_admin_permission("update members", f"{member_id} ({email})")
    _remove_alias("Account", _require_member_account(member_id), email)


@frappe.whitelist()
def set_member_email_enabled(member_id: str, email: str, enabled: int) -> None:
    """Enables or disables one of the member's alias email addresses."""

    check_admin_permission("update members", f"{member_id} ({email})")
    _set_alias_enabled("Account", _require_member_account(member_id), email, bool(cint(enabled)))


@frappe.whitelist()
def add_member_to_groups(member_id: str, group_ids: list) -> None:
    """Adds the member to the given groups."""

    check_admin_permission("update members", member_id)
    account_id = _require_member_account(member_id)

    for group_id in _listify(group_ids):
        stalwart.add_group_members(group_id, [account_id])


@frappe.whitelist()
def remove_member_from_group(member_id: str, group_id: str) -> None:
    """Removes the member from the given group."""

    check_admin_permission("update members", f"{member_id} ({group_id})")
    account_id = _require_member_account(member_id)
    stalwart.remove_group_members(group_id, [account_id])


@frappe.whitelist()
def add_member_to_mailing_lists(member_id: str, list_ids: list) -> None:
    """Adds the member's primary address as a recipient of the given mailing lists."""

    check_admin_permission("update members", member_id)
    account_id = _require_member_account(member_id)

    account = stalwart.manage_get("Account", account_id, properties=["emailAddress"]) or {}
    email = account.get("emailAddress")
    if not email:
        return

    for list_id in _listify(list_ids):
        stalwart.add_list_recipients(list_id, [email])


@frappe.whitelist()
def remove_member_from_mailing_list(member_id: str, list_id: str) -> None:
    """Removes all of the member's addresses from the given mailing list's recipients."""

    check_admin_permission("update members", f"{member_id} ({list_id})")
    account_id = _require_member_account(member_id)

    account = stalwart.manage_get("Account", account_id, properties=["emailAddress", "aliases"])
    domain_names = {d["id"]: d["name"] for d in get_stalwart_domains()}
    member_emails = {
        (account.get("emailAddress") or "").lower(),
        *[e.lower() for e in _alias_emails(account, domain_names)],
    }

    stalwart.remove_list_recipients(list_id, list(member_emails))


# ---------------------------------------------------------------------------
# Directory: shared helpers
# ---------------------------------------------------------------------------


def _listify(value) -> list:
    """Coerces a whitelisted argument (which may arrive as a JSON string) into a list."""

    if value is None:
        return []
    if isinstance(value, str):
        value = frappe.parse_json(value)
    return list(value or [])


def _keys(value) -> list[str]:
    """Returns the keys of a JMAP id-keyed map, or the list as-is."""

    return list(value.keys()) if isinstance(value, dict) else list(value or [])


def _search(rows: list[dict], search: str | None, fields: tuple[str, ...]) -> list[dict]:
    """Filters rows whose given fields contain the search text (case-insensitive)."""

    if not search:
        return rows

    needle = search.lower()
    return [r for r in rows if any(needle in (str(r.get(f) or "")).lower() for f in fields)]


@frappe.whitelist()
def get_accounts(search: str | None = None) -> list[dict]:
    """Returns Stalwart user accounts (id + email) for member/recipient pickers."""

    check_admin_permission("view accounts")

    accounts = stalwart.manage_get_all(
        "Account", filter={"@type": "User"}, properties=["id", "name", "emailAddress"]
    )
    rows = [{"id": a["id"], "name": a.get("name"), "email": a.get("emailAddress")} for a in accounts]
    return _search(rows, search, ("name", "email"))


# ---------------------------------------------------------------------------
# Directory: Groups
# ---------------------------------------------------------------------------


@frappe.whitelist()
def get_groups(search: str | None = None) -> list[dict]:
    """Returns all groups."""

    check_admin_permission("view groups")

    groups = stalwart.get_all_groups(properties=["id", "name", "emailAddress", "description", "createdAt"])
    rows = [
        {
            "id": g["id"],
            "name": g.get("name"),
            "email": g.get("emailAddress"),
            "description": g.get("description"),
            "created_at": normalize_utc_z(g.get("createdAt")),
        }
        for g in groups
    ]
    return _search(rows, search, ("name", "email", "description"))


@frappe.whitelist()
def get_group(group_id: str) -> dict:
    """Returns a group with its members and assigned role ids."""

    check_admin_permission("view groups")

    group = stalwart.manage_get(
        "Account",
        group_id,
        properties=[
            "id",
            "name",
            "emailAddress",
            "description",
            "createdAt",
            "roles",
            "aliases",
            "quotas",
            "usedDiskQuota",
            "locale",
            "timeZone",
        ],
    )
    if not group:
        frappe.throw(_("Group not found"), frappe.DoesNotExistError)

    # Email addresses mirror the member page: primary uses the group description, aliases their own.
    email_addresses = []
    if primary := group.get("emailAddress"):
        email_addresses.append(
            {"email": primary, "description": group.get("description"), "is_primary": True, "enabled": True}
        )

    aliases = group.get("aliases") or {}
    if aliases:
        domain_names = {d["id"]: d["name"] for d in get_stalwart_domains()}
        for alias in aliases.values():
            name = alias.get("name")
            domain_name = domain_names.get(alias.get("domainId"))
            if name and domain_name:
                email_addresses.append(
                    {
                        "email": f"{name}@{domain_name}",
                        "description": alias.get("description"),
                        "is_primary": False,
                        "enabled": bool(alias.get("enabled", True)),
                    }
                )

    members = stalwart.get_group_members(group_id, properties=["id", "name", "emailAddress"])

    return {
        "id": group["id"],
        "name": group.get("name"),
        "email": group.get("emailAddress"),
        "description": group.get("description"),
        "created_at": normalize_utc_z(group.get("createdAt")),
        "role_ids": _keys((group.get("roles") or {}).get("roleIds")),
        "locale": group.get("locale"),
        "time_zone": group.get("timeZone"),
        "email_addresses": email_addresses,
        "members": [{"id": m["id"], "name": m.get("name"), "email": m.get("emailAddress")} for m in members],
        "quota": _build_quota_usage(
            (group.get("quotas") or {}).get("maxDiskQuota") or 0,
            group.get("usedDiskQuota") or 0,
        ),
    }


@frappe.whitelist()
@dynamic_rate_limit()
def add_group(
    name: str,
    domain: str,
    description: str | None = None,
    members: list | None = None,
    roles: list | None = None,
) -> str:
    """Creates a group and returns its id. ``members`` and ``roles`` are account/role ids."""

    check_admin_permission("add groups", f"{name}@{domain}")

    member_ids = _listify(members)
    role_ids = _listify(roles)

    def _create() -> str:
        domain_id = stalwart.get_domain_by_name(domain, raise_exception=True)["id"]
        group_id = stalwart.manage_create(
            "Account",
            stalwart.group_payload(name, domain_id, description=description, role_ids=role_ids or None),
        )["id"]
        if member_ids:
            stalwart.add_group_members(group_id, member_ids)
        return group_id

    return execute_with_logging(
        func=_create,
        title=_("Failed to add group {0}").format(name),
        user_message=_("An error occurred while adding the group, check error logs for more details."),
        with_context=False,
        module="Mail",
    )


@frappe.whitelist()
def update_group(
    group_id: str,
    description: str | None = None,
    roles: list | None = None,
    quota_gb: float | None = None,
    locale: str | None = None,
    time_zone: str | None = None,
) -> None:
    """Updates a group's description (full name), roles, quota, locale and time zone."""

    check_admin_permission("update groups", group_id)

    patch = _locale_patch(locale, time_zone)
    if description is not None:
        patch["description"] = description
    if roles is not None:
        patch["roles"] = stalwart.roles_union(_listify(roles), empty_type="Default")
    if quota_gb is not None:
        patch["quotas/maxDiskQuota"] = cint(float(quota_gb) * _GB)

    if patch:
        stalwart.manage_update("Account", group_id, patch)


@frappe.whitelist()
def add_group_email(group_id: str, email: str, description: str | None = None) -> None:
    """Adds an alias email address to the group with an optional description."""

    check_admin_permission("update groups", f"{group_id} ({email})")
    _add_alias("Account", group_id, email, description)


@frappe.whitelist()
def remove_group_email(group_id: str, email: str) -> None:
    """Removes an alias email address from the group (the primary cannot be removed)."""

    check_admin_permission("update groups", f"{group_id} ({email})")
    _remove_alias("Account", group_id, email)


@frappe.whitelist()
def set_group_email_enabled(group_id: str, email: str, enabled: int) -> None:
    """Enables or disables one of the group's alias email addresses."""

    check_admin_permission("update groups", f"{group_id} ({email})")
    _set_alias_enabled("Account", group_id, email, bool(cint(enabled)))


@frappe.whitelist()
def add_group_members(group_id: str, account_ids: list) -> None:
    """Adds the given accounts to the group."""

    check_admin_permission("update groups", group_id)
    stalwart.add_group_members(group_id, _listify(account_ids))


@frappe.whitelist()
def remove_group_member(group_id: str, account_id: str) -> None:
    """Removes the given account from the group."""

    check_admin_permission("update groups", f"{group_id} ({account_id})")
    stalwart.remove_group_members(group_id, [account_id])


@frappe.whitelist()
def delete_groups(ids: list) -> None:
    """Deletes the given groups."""

    check_admin_permission("delete groups", ids)
    stalwart.delete_groups(_listify(ids))


# ---------------------------------------------------------------------------
# Directory: Mailing Lists
# ---------------------------------------------------------------------------


@frappe.whitelist()
def get_mailing_lists(search: str | None = None) -> list[dict]:
    """Returns all mailing lists."""

    check_admin_permission("view mailing lists")

    lists = stalwart.manage_get_all(
        "MailingList", properties=["id", "name", "emailAddress", "description", "recipients"]
    )
    rows = [
        {
            "id": ml["id"],
            "name": ml.get("name"),
            "email": ml.get("emailAddress"),
            "description": ml.get("description"),
            "recipient_count": len(_keys(ml.get("recipients"))),
        }
        for ml in lists
    ]
    return _search(rows, search, ("name", "email", "description"))


@frappe.whitelist()
def get_mailing_list(list_id: str) -> dict:
    """Returns a mailing list with its email addresses and recipients."""

    check_admin_permission("view mailing lists")

    ml = stalwart.manage_get(
        "MailingList",
        list_id,
        properties=["id", "name", "emailAddress", "description", "aliases", "recipients"],
    )
    if not ml:
        frappe.throw(_("Mailing list not found"), frappe.DoesNotExistError)

    # Email addresses mirror the member/group pages: primary uses the description, aliases their own.
    email_addresses = []
    if primary := ml.get("emailAddress"):
        email_addresses.append(
            {"email": primary, "description": ml.get("description"), "is_primary": True, "enabled": True}
        )
    aliases = ml.get("aliases") or {}
    if aliases:
        domain_names = {d["id"]: d["name"] for d in get_stalwart_domains()}
        for alias in aliases.values():
            name = alias.get("name")
            domain_name = domain_names.get(alias.get("domainId"))
            if name and domain_name:
                email_addresses.append(
                    {
                        "email": f"{name}@{domain_name}",
                        "description": alias.get("description"),
                        "is_primary": False,
                        "enabled": bool(alias.get("enabled", True)),
                    }
                )

    return {
        "id": ml["id"],
        "name": ml.get("name"),
        "email": ml.get("emailAddress"),
        "description": ml.get("description"),
        "email_addresses": email_addresses,
        # Recipients are email addresses (internal accounts or external).
        "recipients": _keys(ml.get("recipients")),
    }


@frappe.whitelist()
@dynamic_rate_limit()
def add_mailing_list(
    name: str, domain: str, recipients: list | None = None, description: str | None = None
) -> str:
    """Creates a mailing list and returns its id."""

    check_admin_permission("add mailing lists", f"{name}@{domain}")

    recipient_list = _listify(recipients)

    def _create() -> str:
        domain_id = stalwart.get_domain_by_name(domain, raise_exception=True)["id"]
        return stalwart.manage_create(
            "MailingList",
            stalwart.mailing_list_payload(
                name, domain_id, recipients=recipient_list or None, description=description
            ),
        )["id"]

    return execute_with_logging(
        func=_create,
        title=_("Failed to add mailing list {0}").format(name),
        user_message=_("An error occurred while adding the mailing list, check error logs for more details."),
        with_context=False,
        module="Mail",
    )


@frappe.whitelist()
def update_mailing_list(list_id: str, description: str | None = None) -> None:
    """Updates a mailing list's description."""

    check_admin_permission("update mailing lists", list_id)

    if description is not None:
        stalwart.manage_update("MailingList", list_id, {"description": description})


@frappe.whitelist()
def add_mailing_list_email(list_id: str, email: str, description: str | None = None) -> None:
    """Adds an alias email address to the mailing list."""

    check_admin_permission("update mailing lists", f"{list_id} ({email})")
    _add_alias("MailingList", list_id, email, description)


@frappe.whitelist()
def remove_mailing_list_email(list_id: str, email: str) -> None:
    """Removes an alias email address from the mailing list (the primary cannot be removed)."""

    check_admin_permission("update mailing lists", f"{list_id} ({email})")
    _remove_alias("MailingList", list_id, email)


@frappe.whitelist()
def set_mailing_list_email_enabled(list_id: str, email: str, enabled: int) -> None:
    """Enables or disables one of the mailing list's alias email addresses."""

    check_admin_permission("update mailing lists", f"{list_id} ({email})")
    _set_alias_enabled("MailingList", list_id, email, bool(cint(enabled)))


@frappe.whitelist()
def add_mailing_list_recipients(list_id: str, recipients: list) -> None:
    """Adds recipient email addresses to the mailing list."""

    check_admin_permission("update mailing lists", list_id)

    emails = [e for e in ((email or "").strip() for email in _listify(recipients)) if e]
    if emails:
        stalwart.add_list_recipients(list_id, emails)


@frappe.whitelist()
def remove_mailing_list_recipient(list_id: str, email: str) -> None:
    """Removes a recipient email address from the mailing list."""

    check_admin_permission("update mailing lists", f"{list_id} ({email})")

    stalwart.remove_list_recipients(list_id, [(email or "").strip()])


@frappe.whitelist()
def delete_mailing_lists(ids: list) -> None:
    """Deletes the given mailing lists."""

    check_admin_permission("delete mailing lists", ids)
    stalwart.manage_delete("MailingList", _listify(ids))


# ---------------------------------------------------------------------------
# Directory: Roles
# ---------------------------------------------------------------------------


@frappe.whitelist()
def get_roles_list(search: str | None = None) -> list[dict]:
    """Returns all roles with permission counts."""

    check_admin_permission("view roles")

    roles = stalwart.manage_get_all("Role")
    rows = [
        {
            "id": r["id"],
            "description": r.get("description"),
            "enabled_count": len(_keys(r.get("enabledPermissions"))),
            "disabled_count": len(_keys(r.get("disabledPermissions"))),
        }
        for r in roles
    ]
    return _search(rows, search, ("description",))


@frappe.whitelist()
def get_role(role_id: str) -> dict:
    """Returns a role with its permissions and inherited role ids."""

    check_admin_permission("view roles")

    role = stalwart.manage_get("Role", role_id)
    if not role:
        frappe.throw(_("Role not found"), frappe.DoesNotExistError)

    return {
        "id": role["id"],
        "description": role.get("description"),
        "enabled_permissions": _keys(role.get("enabledPermissions")),
        "disabled_permissions": _keys(role.get("disabledPermissions")),
        "role_ids": _keys(role.get("roleIds")),
    }


@frappe.whitelist()
def get_permissions() -> list[dict]:
    """Returns the assignable permissions as ``{value, label}`` for the role editor."""

    check_admin_permission("view roles")
    return get_stalwart_permissions()


@frappe.whitelist()
@dynamic_rate_limit()
def add_role(
    description: str,
    enabled_permissions: list | None = None,
    disabled_permissions: list | None = None,
    role_ids: list | None = None,
) -> str:
    """Creates a role and returns its id."""

    check_admin_permission("add roles", description)

    def _create() -> str:
        return stalwart.manage_create(
            "Role",
            stalwart.role_payload(
                description,
                role_ids=_listify(role_ids),
                enabled_permissions=_listify(enabled_permissions),
                disabled_permissions=_listify(disabled_permissions),
            ),
        )["id"]

    return execute_with_logging(
        func=_create,
        title=_("Failed to add role {0}").format(description),
        user_message=_("An error occurred while adding the role, check error logs for more details."),
        with_context=False,
        module="Mail",
    )


@frappe.whitelist()
def update_role(
    role_id: str,
    description: str | None = None,
    enabled_permissions: list | None = None,
    disabled_permissions: list | None = None,
    role_ids: list | None = None,
) -> None:
    """Updates a role's description/permissions/inherited roles."""

    check_admin_permission("update roles", role_id)

    patch = {}
    if description is not None:
        patch["description"] = description
    if enabled_permissions is not None:
        patch["enabledPermissions"] = {p: True for p in _listify(enabled_permissions)}
    if disabled_permissions is not None:
        patch["disabledPermissions"] = {p: True for p in _listify(disabled_permissions)}
    if role_ids is not None:
        patch["roleIds"] = {rid: True for rid in _listify(role_ids)}

    if patch:
        stalwart.manage_update("Role", role_id, patch)


@frappe.whitelist()
def delete_roles(ids: list) -> None:
    """Deletes the given roles."""

    check_admin_permission("delete roles", ids)
    stalwart.manage_delete("Role", _listify(ids))


# ---------------------------------------------------------------------------
# Directory: OAuth Clients
# ---------------------------------------------------------------------------


@frappe.whitelist()
def get_oauth_clients(search: str | None = None) -> list[dict]:
    """Returns all OAuth clients."""

    check_admin_permission("view oauth clients")

    clients = stalwart.manage_get_all(
        "OAuthClient", properties=["id", "clientId", "description", "createdAt"]
    )
    rows = [
        {
            "id": c["id"],
            "client_id": c.get("clientId"),
            "description": c.get("description"),
            "created_at": normalize_utc_z(c.get("createdAt")),
        }
        for c in clients
    ]
    return _search(rows, search, ("client_id", "description"))


@frappe.whitelist()
def get_oauth_client(client_id: str) -> dict:
    """Returns an OAuth client with its redirect URIs and contacts."""

    check_admin_permission("view oauth clients")

    client = stalwart.manage_get(
        "OAuthClient",
        client_id,
        properties=[
            "id",
            "clientId",
            "description",
            "createdAt",
            "expiresAt",
            "redirectUris",
            "contacts",
            "logo",
        ],
    )
    if not client:
        frappe.throw(_("OAuth client not found"), frappe.DoesNotExistError)

    return {
        "id": client["id"],
        "client_id": client.get("clientId"),
        "description": client.get("description"),
        "created_at": normalize_utc_z(client.get("createdAt")),
        "expires_at": normalize_utc_z(client.get("expiresAt")),
        "redirect_uris": _keys(client.get("redirectUris")),
        "contacts": _keys(client.get("contacts")),
        "logo": client.get("logo"),
    }


@frappe.whitelist()
@dynamic_rate_limit()
def add_oauth_client(
    client_id: str,
    description: str | None = None,
    contacts: list | None = None,
    redirect_uris: list | None = None,
    secret: str | None = None,
    logo: str | None = None,
    expires_at: str | None = None,
) -> str:
    """Creates an OAuth client and returns its id."""

    check_admin_permission("add oauth clients", client_id)

    uris = _listify(redirect_uris)
    contact_list = _listify(contacts)
    expires = normalize_utc_z(expires_at)

    def _create() -> str:
        return stalwart.manage_create(
            "OAuthClient",
            stalwart.oauth_client_payload(
                client_id,
                description=description,
                contacts=contact_list or None,
                redirect_uris=uris or None,
                secret=(secret or "").strip() or None,
                logo=(logo or "").strip() or None,
                expires_at=expires,
            ),
        )["id"]

    return execute_with_logging(
        func=_create,
        title=_("Failed to add OAuth client {0}").format(client_id),
        user_message=_("An error occurred while adding the OAuth client, check error logs for more details."),
        with_context=False,
        module="Mail",
    )


@frappe.whitelist()
def update_oauth_client(
    oauth_client_id: str,
    client_id: str | None = None,
    description: str | None = None,
    redirect_uris: list | None = None,
    contacts: list | None = None,
    secret: str | None = None,
    logo: str | None = None,
    expires_at: str | None = None,
) -> None:
    """Updates an OAuth client's clientId, description, redirect URIs, contacts, secret, logo and expiry."""

    check_admin_permission("update oauth clients", oauth_client_id)

    patch = {}
    if client_id is not None and client_id.strip():
        patch["clientId"] = client_id.strip()
    if description is not None:
        patch["description"] = description
    if redirect_uris is not None:
        patch["redirectUris"] = {uri: True for uri in _listify(redirect_uris)}
    if contacts is not None:
        patch["contacts"] = {contact: True for contact in _listify(contacts)}
    # A blank secret leaves the existing one untouched (it is never read back).
    if secret is not None and secret.strip():
        patch["secret"] = secret.strip()
    if logo is not None:
        patch["logo"] = logo.strip() or None
    if expires_at is not None:
        # Blank clears the expiry.
        patch["expiresAt"] = normalize_utc_z(expires_at)

    if patch:
        stalwart.manage_update("OAuthClient", oauth_client_id, patch)


@frappe.whitelist()
def add_oauth_client_contacts(client_id: str, contacts: list) -> None:
    """Adds contact email addresses to the OAuth client."""

    check_admin_permission("update oauth clients", client_id)

    current = dict(
        (stalwart.manage_get("OAuthClient", client_id, properties=["contacts"]) or {}).get("contacts") or {}
    )
    for contact in _listify(contacts):
        contact = (contact or "").strip()
        if contact:
            current[contact] = True

    stalwart.manage_update("OAuthClient", client_id, {"contacts": current})


@frappe.whitelist()
def remove_oauth_client_contact(client_id: str, contact: str) -> None:
    """Removes a contact email address from the OAuth client."""

    check_admin_permission("update oauth clients", f"{client_id} ({contact})")

    current = (stalwart.manage_get("OAuthClient", client_id, properties=["contacts"]) or {}).get(
        "contacts"
    ) or {}
    remaining = {c: v for c, v in current.items() if c.lower() != (contact or "").strip().lower()}
    stalwart.manage_update("OAuthClient", client_id, {"contacts": remaining})


@frappe.whitelist()
def add_oauth_client_redirect_uris(client_id: str, redirect_uris: list) -> None:
    """Adds redirect URIs to the OAuth client."""

    check_admin_permission("update oauth clients", client_id)

    current = dict(
        (stalwart.manage_get("OAuthClient", client_id, properties=["redirectUris"]) or {}).get("redirectUris")
        or {}
    )
    for uri in _listify(redirect_uris):
        uri = (uri or "").strip()
        if uri:
            current[uri] = True

    stalwart.manage_update("OAuthClient", client_id, {"redirectUris": current})


@frappe.whitelist()
def remove_oauth_client_redirect_uri(client_id: str, uri: str) -> None:
    """Removes a redirect URI from the OAuth client."""

    check_admin_permission("update oauth clients", f"{client_id} ({uri})")

    current = (stalwart.manage_get("OAuthClient", client_id, properties=["redirectUris"]) or {}).get(
        "redirectUris"
    ) or {}
    remaining = {u: v for u, v in current.items() if u != (uri or "").strip()}
    stalwart.manage_update("OAuthClient", client_id, {"redirectUris": remaining})


@frappe.whitelist()
def delete_oauth_clients(ids: list) -> None:
    """Deletes the given OAuth clients."""

    check_admin_permission("delete oauth clients", ids)
    stalwart.manage_delete("OAuthClient", _listify(ids))


# ---------------------------------------------------------------------------
# Domains: DKIM Signatures
# ---------------------------------------------------------------------------

# Maps Stalwart's DKIM signature @type to a human-readable algorithm label.
_DKIM_ALGORITHMS = {
    "Dkim1RsaSha256": "RSA-SHA256",
    "Dkim1Ed25519Sha256": "Ed25519-SHA256",
}


@frappe.whitelist()
def get_dkim_signatures(domain_id: str | None = None) -> list[dict]:
    """Returns DKIM signatures, optionally scoped to a single domain."""

    check_admin_permission("view dkim signatures")

    properties = ["id", "@type", "selector", "domainId", "createdAt"]
    signatures = (
        stalwart.get_dkim_signatures_by_domain(domain_id, properties=properties)
        if domain_id
        else stalwart.manage_get_all("DkimSignature", properties=properties)
    )

    domain_names = {d["id"]: d["name"] for d in get_stalwart_domains()}
    return [
        {
            "id": s["id"],
            "algorithm": _DKIM_ALGORITHMS.get(s.get("@type"), s.get("@type")),
            "domain": domain_names.get(s.get("domainId")),
            "selector": s.get("selector"),
            "created_at": normalize_utc_z(s.get("createdAt")),
        }
        for s in signatures
    ]


@frappe.whitelist()
def get_dkim_signature(signature_id: str) -> dict:
    """Returns a single DKIM signature's details (read-only; never the private key)."""

    check_admin_permission("view dkim signatures")

    sig = stalwart.manage_get(
        "DkimSignature",
        signature_id,
        properties=[
            "id",
            "@type",
            "selector",
            "domainId",
            "createdAt",
            "stage",
            "nextTransitionAt",
            "headers",
            "canonicalization",
            "expire",
            "report",
            "auid",
            "publicKey",
        ],
    )
    if not sig:
        frappe.throw(_("DKIM signature not found"), frappe.DoesNotExistError)

    domain_names = {d["id"]: d["name"] for d in get_stalwart_domains()}
    return {
        "id": sig["id"],
        "algorithm": _DKIM_ALGORITHMS.get(sig.get("@type"), sig.get("@type")),
        "selector": sig.get("selector"),
        "domain": domain_names.get(sig.get("domainId")),
        "signed_headers": _keys(sig.get("headers")),
        "canonicalization": sig.get("canonicalization"),
        "expiration": sig.get("expire"),
        "request_reports": bool(sig.get("report")),
        "auid": sig.get("auid"),
        "public_key": sig.get("publicKey"),
        "stage": sig.get("stage"),
        "created_at": normalize_utc_z(sig.get("createdAt")),
        "next_transition": normalize_utc_z(sig.get("nextTransitionAt")),
    }


@frappe.whitelist()
def delete_dkim_signatures(ids: list) -> None:
    """Deletes the given DKIM signatures."""

    check_admin_permission("delete dkim signatures", ids)
    stalwart.manage_delete("DkimSignature", _listify(ids))


# ---------------------------------------------------------------------------
# Emails: Queue
# ---------------------------------------------------------------------------


def _set_keys(value) -> list[str]:
    """Returns the members of a JMAP ``set`` property, whether it arrives as a map or a list."""

    if isinstance(value, dict):
        return sorted(value.keys())
    return _listify(value)


def _queue_row(message: dict) -> dict:
    """Maps a queued message to its list-row shape."""

    recipients = list((message.get("recipients") or {}).keys())
    return {
        "id": message["id"],
        "sender": message.get("returnPath"),
        "recipients": recipients,
        "recipient_count": len(recipients),
        "size": message.get("size"),
        "next_retry": normalize_utc_z(message.get("nextRetry")),
        "created_at": normalize_utc_z(message.get("createdAt")),
    }


def _queue_filter(search: str | None, to: str | None, sender: str | None) -> dict | None:
    """Builds a queue query filter from the provided, non-empty criteria."""

    filter = {}
    if search:
        filter["text"] = search
    if to:
        filter["to"] = to
    if sender:
        filter["returnPath"] = sender
    return filter or None


@frappe.whitelist()
def get_queued_messages(
    search: str | None = None,
    to: str | None = None,
    sender: str | None = None,
    page: int = 1,
    page_length: int = 50,
) -> dict:
    """Returns a page of messages pending outbound delivery with the total count."""

    check_admin_permission("view queued messages")

    page, page_length = cint(page) or 1, cint(page_length) or 50
    result = stalwart.manage_list_page(
        "QueuedMessage",
        filter=_queue_filter(search, to, sender),
        position=(page - 1) * page_length,
        limit=page_length,
        properties=["id", "returnPath", "recipients", "size", "nextRetry", "createdAt"],
    )
    return {"messages": [_queue_row(m) for m in result["items"]], "total": result["total"]}


def _recipient_detail(email: str, recipient: dict) -> dict:
    """Flattens a queued recipient (status/expiry unions included) into an editable row shape."""

    status = recipient.get("status") or {}
    expires = recipient.get("expires") or {}
    return {
        "email": email,
        "orcpt": recipient.get("orcpt"),
        "status_type": status.get("@type"),
        "error_type": status.get("errorType"),
        "error_message": status.get("errorMessage"),
        "smtp_command": status.get("errorCommand"),
        "hostname": status.get("responseHostname"),
        "response_code": status.get("responseCode"),
        "enhanced_code": status.get("responseEnhanced"),
        "message": status.get("responseMessage"),
        "next_retry": normalize_utc_z(recipient.get("retryDue")),
        "retry_count": recipient.get("retryCount"),
        "next_notification": normalize_utc_z(recipient.get("notifyDue")),
        "notify_count": recipient.get("notifyCount"),
        "expiry_type": expires.get("@type"),
        "expires_at": normalize_utc_z(expires.get("expiresAt")),
        "expires_attempts": expires.get("expiresAttempts"),
    }


def _message_flags(message: dict) -> list[dict]:
    """Returns the message flags as ``{value, label}`` using the server's flag labels."""

    labels = {f["value"]: f["label"] for f in get_queue_metadata()["message_flags"]}
    return [{"value": flag, "label": labels.get(flag, flag)} for flag in _set_keys(message.get("flags"))]


@frappe.whitelist()
def get_queued_message(message_id: str) -> dict:
    """Returns a queued message with its per-recipient delivery status."""

    check_admin_permission("view queued messages")

    message = stalwart.manage_get("QueuedMessage", message_id)
    if not message:
        frappe.throw(_("Queued message not found"), frappe.DoesNotExistError)

    recipients = [_recipient_detail(email, r) for email, r in (message.get("recipients") or {}).items()]
    return {
        "id": message["id"],
        "sender": message.get("returnPath"),
        "size": message.get("size"),
        "priority": message.get("priority"),
        "env_id": message.get("envId"),
        "flags": _message_flags(message),
        "next_retry": normalize_utc_z(message.get("nextRetry")),
        "next_notify": message.get("nextNotify"),
        "received_from_ip": message.get("receivedFromIp"),
        "received_via_port": message.get("receivedViaPort"),
        "created_at": normalize_utc_z(message.get("createdAt")),
        "recipients": recipients,
        "has_content": bool(message.get("blobId")),
    }


@frappe.whitelist()
def get_queue_recipient_options() -> dict:
    """Returns the option lists (status types, error types, expiry types) for editing recipients."""

    check_admin_permission("view queued messages")
    meta = get_queue_metadata()
    return {
        "status_types": meta["status_types"],
        "error_types": meta["error_types"],
        "expiry_types": meta["expiry_types"],
    }


def _utc_datetime(value: str | None) -> str | None:
    """Normalizes a timestamp the API was called with to the UTCDateTime Stalwart stores."""

    return normalize_utc_z(value)


def _status_object(
    status_type: str,
    error_type: str | None,
    error_message: str | None,
    smtp_command: str | None,
    hostname: str | None,
    response_code: str | int | None,
    enhanced_code: str | None,
    message: str | None,
) -> dict:
    """Builds a recipient status union member from the edited fields."""

    status = {"@type": status_type}
    response = {
        "responseHostname": hostname or None,
        "responseCode": cint(response_code) if str(response_code or "").strip() else None,
        "responseEnhanced": enhanced_code or None,
        "responseMessage": message or None,
    }
    if status_type in ("TemporaryFailure", "PermanentFailure"):
        status.update(
            {
                "errorType": error_type or None,
                "errorMessage": error_message or None,
                "errorCommand": smtp_command or None,
                **response,
            }
        )
    elif status_type == "Completed":
        status.update(response)

    # The whole status node is replaced, so absent keys are cleared; dropping None-valued keys also
    # avoids sending null for the non-nullable errorType enum.
    return {key: value for key, value in status.items() if value is not None}


def _expires_object(expiry_type: str, expires_at: str | None, expires_attempts: str | int | None) -> dict:
    """Builds a queue-expiry union member from the edited fields."""

    if expiry_type == "Attempts":
        return {"@type": "Attempts", "expiresAttempts": cint(expires_attempts)}
    return {"@type": "Ttl", "expiresAt": _utc_datetime(expires_at)}


@frappe.whitelist()
def update_queued_message(message_id: str, next_retry: str | None = None) -> None:
    """Updates a queued message's next retry time."""

    check_admin_permission("update queued messages", message_id)

    if next_retry is not None:
        stalwart.manage_update("QueuedMessage", message_id, {"nextRetry": _utc_datetime(next_retry)})


@frappe.whitelist()
def update_queued_recipient(
    message_id: str,
    email: str,
    new_email: str | None = None,
    orcpt: str | None = None,
    status_type: str | None = None,
    error_type: str | None = None,
    error_message: str | None = None,
    smtp_command: str | None = None,
    hostname: str | None = None,
    response_code: str | None = None,
    enhanced_code: str | None = None,
    message: str | None = None,
    next_retry: str | None = None,
    retry_count: str | None = None,
    next_notification: str | None = None,
    notify_count: str | None = None,
    expiry_type: str | None = None,
    expires_at: str | None = None,
    expires_attempts: str | None = None,
) -> None:
    """Updates a single recipient of a queued message (renames the address if ``new_email`` differs)."""

    check_admin_permission("update queued messages", f"{message_id} ({email})")

    # Scalar edits keyed by their JMAP property; a ``None`` argument means "leave unchanged".
    changed = {}
    if orcpt is not None:
        changed["orcpt"] = orcpt or None
    if next_retry is not None:
        changed["retryDue"] = _utc_datetime(next_retry)
    if retry_count is not None:
        changed["retryCount"] = cint(retry_count)
    if next_notification is not None:
        changed["notifyDue"] = _utc_datetime(next_notification)
    if notify_count is not None:
        changed["notifyCount"] = cint(notify_count)
    status = (
        _status_object(
            status_type,
            error_type,
            error_message,
            smtp_command,
            hostname,
            response_code,
            enhanced_code,
            message,
        )
        if status_type
        else None
    )
    expires = _expires_object(expiry_type, expires_at, expires_attempts) if expiry_type else None

    new_email = (new_email or "").strip()
    if new_email and new_email != email:
        # Rename: rebuild the recipient (minus server-set fields) under the new key.
        current = (
            (stalwart.manage_get("QueuedMessage", message_id, properties=["recipients"]) or {}).get(
                "recipients"
            )
            or {}
        ).get(email)
        if current is None:
            frappe.throw(_("Recipient not found"), frappe.DoesNotExistError)
        obj = {k: v for k, v in current.items() if k not in ("flags", "queueName")}
        obj.update(changed)
        if status is not None:
            obj["status"] = status
        if expires is not None:
            obj["expires"] = expires
        stalwart.manage_update(
            "QueuedMessage", message_id, {f"recipients/{email}": None, f"recipients/{new_email}": obj}
        )
        return

    patch = {f"recipients/{email}/{prop}": value for prop, value in changed.items()}
    if status is not None:
        patch[f"recipients/{email}/status"] = status
    if expires is not None:
        patch[f"recipients/{email}/expires"] = expires
    if patch:
        stalwart.manage_update("QueuedMessage", message_id, patch)


@frappe.whitelist()
def remove_queued_recipient(message_id: str, email: str) -> None:
    """Cancels delivery to one recipient of a queued message.

    The server keeps the recipient row for the delivery report and marks it permanently
    failed ("Delivery canceled."). Recipients cannot be added to a queued message - the
    server only patches recipients that exist in the envelope.
    """

    check_admin_permission("update queued messages", f"{message_id} ({email})")
    stalwart.manage_update("QueuedMessage", message_id, {f"recipients/{email}": None})


@frappe.whitelist()
def get_queued_message_source(message_id: str) -> dict:
    """Returns the raw RFC822 source of a queued message."""

    check_admin_permission("view queued messages")

    message = stalwart.manage_get("QueuedMessage", message_id, properties=["id", "blobId"])
    blob_id = (message or {}).get("blobId")
    if not blob_id:
        frappe.throw(_("Queued message content is not available"), frappe.DoesNotExistError)

    content = stalwart.download_message_blob(blob_id)
    return {"source": content.decode(errors="replace")}


@frappe.whitelist()
def retry_queued_messages(ids: list) -> None:
    """Schedules the given queued messages for immediate delivery."""

    check_admin_permission("retry queued messages", ids)
    stalwart.queue_retry(_listify(ids))


@frappe.whitelist()
def cancel_queued_messages(ids: list) -> None:
    """Cancels (deletes) the given queued messages."""

    check_admin_permission("cancel queued messages", ids)
    stalwart.manage_delete("QueuedMessage", _listify(ids))


@frappe.whitelist()
def retry_all_queued_messages(
    search: str | None = None, to: str | None = None, sender: str | None = None
) -> None:
    """Schedules every message matching the current filter for immediate delivery."""

    check_admin_permission("retry queued messages", "all")
    ids = stalwart.manage_query("QueuedMessage", filter=_queue_filter(search, to, sender))["ids"]
    stalwart.queue_retry(ids)


@frappe.whitelist()
def cancel_all_queued_messages(
    search: str | None = None, to: str | None = None, sender: str | None = None
) -> None:
    """Cancels (deletes) every message matching the current filter."""

    check_admin_permission("cancel queued messages", "all")
    ids = stalwart.manage_query("QueuedMessage", filter=_queue_filter(search, to, sender))["ids"]
    stalwart.manage_delete("QueuedMessage", ids)


# ---------------------------------------------------------------------------
# Emails: Delivery Test (live SMTP delivery trace)
# ---------------------------------------------------------------------------


@frappe.whitelist(methods=["GET"])
@dynamic_rate_limit()
def stream_delivery_test(target: str):
    """Proxies Stalwart's live SMTP delivery trace for ``target`` as a Server-Sent Events stream.

    Stalwart sends no CORS headers and authenticates the trace with a short-lived token, so the
    browser cannot connect directly. This mints the token server-side and relays the event stream
    over the same origin instead.
    """

    from werkzeug.wrappers import Response

    check_admin_permission("run delivery test", target)

    return Response(
        stalwart.iter_delivery_trace(target),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# Reports: inbound (received) and outbound (generated) DMARC / TLS / ARF
# ---------------------------------------------------------------------------


def _report_row(direction: str, report: dict) -> dict:
    """Maps a report to its list-row shape (columns differ by direction)."""

    if direction == "inbound":
        return {
            "id": report["id"],
            "from": report.get("from"),
            "subject": report.get("subject"),
            "received_at": normalize_utc_z(report.get("receivedAt")),
        }
    return {
        "id": report["id"],
        "domain": report.get("domain"),
        "created_at": normalize_utc_z(report.get("createdAt")),
        "deliver_at": normalize_utc_z(report.get("deliverAt")),
    }


def _report_filter(kind: str, direction: str, search: str | None) -> dict | None:
    """Maps the search box onto the filter DMARC reports support; other kinds are unfiltered.

    Only DMARC is searchable, and each direction takes a different filter: received reports take
    Stalwart's free-text ``text`` filter (matching the sender/recipient addresses and the reported
    domain, not the subject), while the reports Stalwart generates take an exact ``domain`` match.
    Anything else is rejected as ``unsupportedFilter``.
    """

    search = (search or "").strip()
    if not search or kind != "dmarc":
        return None
    return {"text": search} if direction == "inbound" else {"domain": search}


@frappe.whitelist()
def get_reports(
    kind: str,
    direction: str,
    search: str | None = None,
    page: int = 1,
    page_length: int = 50,
) -> dict:
    """Returns a page of ``kind`` reports (dmarc/tls/arf) in the given direction (inbound/outbound)."""

    check_admin_permission("view reports")

    page, page_length = cint(page) or 1, cint(page_length) or 50
    result = stalwart.manage_list_page(
        stalwart.report_type_name(kind, direction),
        filter=_report_filter(kind, direction, search),
        position=(page - 1) * page_length,
        limit=page_length,
    )
    return {"reports": [_report_row(direction, r) for r in result["items"]], "total": result["total"]}


@frappe.whitelist()
def get_report(kind: str, direction: str, report_id: str) -> dict:
    """Returns a single report's metadata plus its parsed report body."""

    check_admin_permission("view reports")

    report = stalwart.manage_get(stalwart.report_type_name(kind, direction), report_id)
    if not report:
        frappe.throw(_("Report not found"), frappe.DoesNotExistError)

    meta = {"id": report["id"], "kind": kind, "direction": direction, "report": report.get("report")}
    if direction == "inbound":
        meta.update(
            {
                "from": report.get("from"),
                "subject": report.get("subject"),
                "to": _set_keys(report.get("to")),
                "received_at": normalize_utc_z(report.get("receivedAt")),
                "expires_at": normalize_utc_z(report.get("expiresAt")),
            }
        )
    else:
        meta.update(
            {
                "domain": report.get("domain"),
                "created_at": normalize_utc_z(report.get("createdAt")),
                "deliver_at": normalize_utc_z(report.get("deliverAt")),
            }
        )
        if kind == "dmarc":
            # `policyIdentifier` is a u64 hash that overflows JS's safe integer range, so send it as
            # a string to keep the browser from rounding it.
            identifier = report.get("policyIdentifier")
            meta.update(
                {
                    "rua": _set_keys(report.get("rua")),
                    "policy_identifier": str(identifier) if identifier is not None else None,
                }
            )
    return meta


@frappe.whitelist()
def delete_reports(kind: str, direction: str, ids: list) -> None:
    """Deletes the given reports."""

    check_admin_permission("delete reports", ids)
    stalwart.manage_delete(stalwart.report_type_name(kind, direction), _listify(ids))


# ---------------------------------------------------------------------------
# Observability: Logs
# ---------------------------------------------------------------------------


def _log_row(entry: dict, labels: dict) -> dict:
    """Maps a log entry to its row/detail shape, resolved against the schema's display labels.

    The raw ``level``/``event`` identifiers are kept so the UI can still key off them (e.g. to colour
    a level); ``labels`` comes from :func:`get_log_labels` and falls back to the identifier itself for
    anything the server's enums do not describe.
    """

    level, event = entry.get("level"), entry.get("event")
    return {
        "id": entry["id"],
        "timestamp": normalize_utc_z(entry.get("timestamp")),
        "level": level,
        "level_label": labels["levels"].get(level, level),
        "event": event,
        "event_label": labels["events"].get(event, event),
        "details": entry.get("details"),
    }


@frappe.whitelist()
def get_logs(search: str | None = None, anchor: str | None = None, page_length: int = 100) -> dict:
    """Returns a page of server log entries (most recent first), starting after ``anchor``.

    The log store only supports cursor pagination, so pages are walked one at a time using the
    ``next_anchor`` returned here instead of jumping to an arbitrary offset; ``next_anchor`` is
    ``None`` on the last page. ``total`` is how many entries the server retains and, unlike the other
    listings, is not narrowed by ``search``.
    """

    check_admin_permission("view logs")

    page_length = cint(page_length) or 100
    result = stalwart.manage_list_page(
        "Log",
        filter={"text": search} if search else None,
        anchor=anchor,
        limit=page_length,
    )
    labels = get_log_labels()
    items = result["items"]
    logs = [_log_row(e, labels) for e in items]
    # The log store orders by id, which is not reliably newest-first (a server upgrade that
    # changes the id format interleaves the epochs) and rejects a timestamp sort — so sort
    # the page for display. The anchor must stay in server order, or paging would loop.
    logs.sort(key=lambda row: row["timestamp"] or "", reverse=True)
    return {
        "logs": logs,
        "total": result["total"],
        "next_anchor": items[-1]["id"] if len(items) == page_length else None,
    }


@frappe.whitelist()
def get_log(log_id: str) -> dict:
    """Returns a single log entry."""

    check_admin_permission("view logs")

    entry = stalwart.manage_get("Log", log_id)
    if not entry:
        frappe.throw(_("Log entry not found"), frappe.DoesNotExistError)

    return _log_row(entry, get_log_labels())


# ---------------------------------------------------------------------------
# Actions: server management operations
# ---------------------------------------------------------------------------


# Pausing the queue stops delivery server-wide until someone resumes it, so it is kept to the
# Administrator; `run_action` refuses it for anyone else.
ADMINISTRATOR_ONLY_ACTIONS = frozenset({"PauseMtaQueue"})


@frappe.whitelist()
def get_actions() -> list[dict]:
    """Returns the executable server management actions (``{value, label, schema_name}``).

    Each one carries ``administrator_only`` so the UI can lock what ``run_action`` would refuse.
    """

    check_admin_permission("view actions")
    return [{**a, "administrator_only": a["value"] in ADMINISTRATOR_ONLY_ACTIONS} for a in get_action_types()]


@frappe.whitelist()
def run_action(action_type: str, params: dict | None = None) -> dict:
    """Executes a server management action and returns its result (empty for parameterless actions).

    Inputs the schema types as a JMAP ``set`` (e.g. the recipients of a spam classification) arrive as
    a list and are encoded here, since the server rejects a plain list for them.
    """

    user = check_admin_permission("run actions", action_type)
    if action_type in ADMINISTRATOR_ONLY_ACTIONS and user != "Administrator":
        frappe.throw(
            _("Only the Administrator can run this action."),
            frappe.PermissionError,
        )

    params = {k: dict.fromkeys(v, True) if isinstance(v, list) else v for k, v in (params or {}).items()}
    return stalwart.run_action(action_type, params=params or None)


@frappe.whitelist()
def get_overview() -> dict:
    """Aggregate counts and recent activity for the dashboard landing page.

    Each section is gathered independently and degrades to ``None`` (or an empty list) when its
    backing store is unavailable, so one unreachable subsystem doesn't blank the whole page.
    """

    check_admin_permission("view overview")

    overview: dict = {
        "members": None,
        "pending_invites": None,
        "domains": None,
        "groups": None,
        "mailing_lists": None,
        "queued_messages": None,
        "recent_logs": [],
    }

    with suppress(Exception):
        USER = frappe.qb.DocType("User")
        USER_SETTINGS = frappe.qb.DocType("User Settings")
        rows = (
            frappe.qb.from_(USER)
            .join(USER_SETTINGS)
            .on(USER.name == USER_SETTINGS.user)
            .select(USER.enabled)
            .where(USER_SETTINGS.username.isnotnull())
        ).run(as_dict=True)
        overview["members"] = {
            "total": len(rows),
            "disabled": sum(1 for row in rows if not row.enabled),
        }

    with suppress(Exception):
        overview["pending_invites"] = frappe.db.count(
            "Mail Account Request",
            {"is_verified": 0, "expires_at": [">", frappe.utils.now()]},
        )

    with suppress(Exception):
        domains = get_stalwart_domains()
        overview["domains"] = {
            "total": len(domains),
            "disabled": sum(1 for domain in domains if not domain["isEnabled"]),
        }

    with suppress(Exception):
        overview["groups"] = len(stalwart.get_all_groups(properties=["id"]))

    with suppress(Exception):
        overview["mailing_lists"] = len(stalwart.manage_get_all("MailingList", properties=["id"]))

    with suppress(Exception):
        result = stalwart.manage_list_page("QueuedMessage", filter=None, position=0, limit=1)
        overview["queued_messages"] = result["total"]

    with suppress(Exception):
        # A wider page, reduced to the 6 newest by timestamp: the store's id order is not
        # reliably newest-first (see get_logs), so the head alone may hold stale entries.
        result = stalwart.manage_list_page("Log", filter=None, anchor=None, limit=100)
        labels = get_log_labels()
        rows = [_log_row(entry, labels) for entry in result["items"]]
        rows.sort(key=lambda row: row["timestamp"] or "", reverse=True)
        overview["recent_logs"] = rows[:6]

    return overview
