"""The mail dashboard's admin API: members, groups, mailing lists and domains.

The site holds its members as Frappe Users; the mail directory behind them (accounts, groups,
lists, domains) lives on Suite Cloud, which owns the cluster. Every directory read or change
here goes through the Suite Cloud client, scoped to this site. Objects are identified by their
address, which the dashboard uses as the id.
"""

import csv
import io
import json
from contextlib import suppress
from typing import Any, Literal

import frappe
from frappe import _
from frappe.query_builder.functions import Count, Max
from frappe.utils import cint, flt, validate_email_address
from pypika import Case, Order

from suite.mail.api.utils import get_avatar_url
from suite.mail.directory import GB, get_account_metadata, get_active_domain_names
from suite.mail.directory import get_domains as get_site_domains
from suite.mail.suite_cloud import get_client
from suite.mail.utils import get_config
from suite.mail.utils.dt import from_utc_z, to_utc_z
from suite.mail.utils.logger import log_admin_action
from suite.mail.utils.user import get_account_email
from suite.mail.utils.validation import is_subaddressed_email
from suite.utils.rate_limiter import dynamic_rate_limit
from suite.utils.user import is_suite_admin, is_system_manager, is_user_enabled

# Desk-style paging: the same page lengths as the list view, 100 by default.
PAGE_LENGTHS = (20, 100, 500)
DEFAULT_PAGE_LENGTH = 100


PICKER_PAGE = 20  # rows an account picker shows per search


# --- permissions ------------------------------------------------------------------------------


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
        frappe.throw(_("{0} is not a mail account.").format(frappe.bold(member_id)), frappe.PermissionError)
    if not frappe.db.exists("User Settings", {"user": member_id, "username": ["is", "set"]}):
        frappe.throw(_("{0} is not a mail account.").format(frappe.bold(member_id)), frappe.PermissionError)
    if is_system_manager(member_id) and not is_system_manager(frappe.session.user):
        frappe.throw(
            _("You do not have permission to act on {0}.").format(frappe.bold(member_id)),
            frappe.PermissionError,
        )
    return member_id


# --- domains ------------------------------------------------------------------------------------


DOMAIN_STATUSES = ("Active", "Pending Verification", "Disabled")


def _domain_status(domain: dict) -> str:
    """One status for every domain view: a domain goes live once its mandatory records resolve."""

    if not domain.get("enabled"):
        return "Disabled"
    return "Active" if domain.get("is_verified") else "Pending Verification"


def _domain_row(domain: dict) -> dict:
    return {
        "id": domain["domain"],
        "name": domain["domain"],
        "description": domain.get("description") or "",
        "status": _domain_status(domain),
        "is_enabled": bool(domain.get("enabled")),
        "catch_all_address": domain.get("catch_all_address") or "",
        "sub_addressing": bool(domain.get("sub_addressing")),
        "is_verified": bool(domain.get("is_verified")),
        "last_verified_at": to_utc_z(domain.get("last_verified_at")),
        "created_at": to_utc_z(domain.get("created_at")),
    }


def _dns_record_row(record: dict) -> dict:
    """The record as Suite Cloud's Mail Domain holds it: relative host, raw value, SRV fields apart."""

    # The integer fields default to 0 on Suite Cloud; they only mean something for MX and SRV.
    record_type = record.get("type")
    has_priority = record_type in ("MX", "SRV")
    has_srv_fields = record_type == "SRV"
    return {
        "type": record_type,
        "host": record.get("host") or "@",
        "fqdn": record.get("fqdn") or record.get("host"),
        "value": record.get("value") or "",
        "priority": record.get("priority") if has_priority else None,
        "weight": record.get("weight") if has_srv_fields else None,
        "port": record.get("port") if has_srv_fields else None,
        "ttl": record.get("ttl"),
        "category": record.get("category"),
        "group": record.get("group"),
        "is_mandatory": bool(record.get("is_mandatory")),
        "is_verified": bool(record.get("is_verified")),
        "last_checked_at": to_utc_z(record.get("last_checked_at")),
    }


def _zone_rdata(record: dict) -> str:
    """The record's data the way a zone file line carries it."""

    value = record["value"]
    if record["type"] == "MX":
        return f"{record.get('priority') or 10} {value}"
    if record["type"] == "SRV":
        return f"{record.get('priority') or 0} {record.get('weight') or 0} {record.get('port') or 0} {value}"
    if record["type"] == "TXT":
        return json.dumps(value)
    return value


@frappe.whitelist()
def get_domain_ownership_record(name: str) -> dict:
    """The DNS record the site must publish before ``name`` can be added, and whether it is free."""

    check_admin_permission("view domains")
    return get_client().call("mail.domains.check_domain", domain=name)


@frappe.whitelist()
@dynamic_rate_limit()
def add_domain(name: str, description: str | None = None) -> str:
    """Adds the domain to the site; Suite Cloud requires its ownership record to resolve first."""

    check_admin_permission("add domains", name)
    domain = get_client().call("mail.domains.create_domain", domain=name, description=description)
    return domain["domain"]


@frappe.whitelist()
def get_domains(
    txt: str | None = None, status: str | None = None, start: int = 0, page_length: int = DEFAULT_PAGE_LENGTH
) -> dict:
    check_admin_permission("view domains")
    if status and status not in DOMAIN_STATUSES:
        frappe.throw(_("Unknown domain status {0}.").format(status))
    # No suppress here: a Suite Cloud refusal must reach the page, not read as "no domains".
    rows = [_domain_row(domain) for domain in get_site_domains()]
    if status:
        rows = [row for row in rows if row["status"] == status]
    return _page(_search(rows, txt, ("name", "description")), start, page_length)


@frappe.whitelist()
def get_domain(domain_id: str) -> dict:
    """The domain with the DNS records its owner has to publish, as Suite Cloud lists them."""

    check_admin_permission("view domains")
    domain = get_client().call("mail.domains.get_domain", domain=domain_id)
    return {
        **_domain_row(domain),
        "dns_record_groups": domain.get("dns_record_groups") or [],
        "dns_records": [_dns_record_row(r) for r in domain.get("dns_records") or []],
    }


@frappe.whitelist()
def verify_domain(domain_id: str) -> dict:
    """Asks Suite Cloud to resolve the domain's records now instead of at the next hourly check."""

    check_admin_permission("verify domains", domain_id)
    result = get_client().call("mail.domains.verify_dns_records", domain=domain_id)
    return result


@frappe.whitelist()
def update_domain(
    domain_id: str,
    description: str | None = None,
    catch_all_address: str | None = None,
    sub_addressing: bool | None = None,
) -> dict:
    """Description, catch-all and sub-addressing; an empty catch-all means unknown addresses bounce."""

    check_admin_permission("update domains", domain_id)
    changes: dict[str, Any] = {}
    if description is not None:
        changes["description"] = description.strip()
    if catch_all_address is not None:
        catch_all_address = catch_all_address.strip().lower()
        if catch_all_address:
            validate_email_address(catch_all_address, throw=True)
        changes["catch_all_address"] = catch_all_address
    if sub_addressing is not None:
        changes["sub_addressing"] = bool(sub_addressing)
    if not changes:
        return get_domain(domain_id)
    return _domain_row(get_client().call("mail.domains.update_domain", domain=domain_id, **changes))


@frappe.whitelist()
def set_domain_enabled(domain_id: str, enabled: bool) -> dict:
    """Disabling also drops the domain's verification on Suite Cloud; enabling needs a fresh verify."""

    check_admin_permission("enable domains" if enabled else "disable domains", domain_id)
    return _domain_row(
        get_client().call("mail.domains.update_domain", domain=domain_id, enabled=bool(enabled))
    )


@frappe.whitelist()
def delete_domain(domain_id: str) -> None:
    check_admin_permission("delete domains", domain_id)
    get_client().call("mail.domains.delete_domain", domain=domain_id)


@frappe.whitelist()
def get_enabled_domains() -> list[str]:
    """Domains offered when adding accounts, groups and lists: only active ones take them."""

    check_admin_permission("view domains")
    try:
        return get_active_domain_names()
    except Exception:
        return []


def _domain_records(domain_id: str) -> list[dict]:
    domain = get_client().call("mail.domains.get_domain", domain=domain_id)
    return [_dns_record_row(r) for r in domain.get("dns_records") or []]


@frappe.whitelist()
def get_domain_dns_zone(domain_id: str) -> str:
    """The records as zone-file lines, for pasting into a provider that accepts them."""

    check_admin_permission("view domains")
    lines = []
    for record in _domain_records(domain_id):
        lines.append(
            f"{record['fqdn']}.\t{record.get('ttl') or ''}\tIN\t{record['type']}\t{_zone_rdata(record)}"
        )
    return "\n".join(lines) + "\n"


@frappe.whitelist()
def get_domain_dns_csv(domain_id: str) -> str:
    check_admin_permission("view domains")
    output = io.StringIO()
    writer = csv.DictWriter(
        output,
        fieldnames=["type", "host", "fqdn", "value", "priority", "weight", "port", "ttl"],
        extrasaction="ignore",
    )
    writer.writeheader()
    for record in _domain_records(domain_id):
        writer.writerow(record)
    return output.getvalue()


@frappe.whitelist()
def get_domain_dns_json(domain_id: str) -> str:
    check_admin_permission("view domains")
    return json.dumps(_domain_records(domain_id), indent=4)


# --- members --------------------------------------------------------------------------------------


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
    """Creates a member, right away or by invitation.

    ``username``/``domain`` are the primary address (becomes the User); ``aliases`` are additional
    full email addresses attached to the same account. ``groups`` and ``mailing_lists`` are the
    addresses of groups and lists the account joins once it is created — right away when invites
    are off, on verification otherwise. ``quota_gb`` unset means Suite Cloud's default for the site.

    ``locale`` and ``time_zone``, like the name and password, only apply when the account is created
    right away; an invited member picks their own on the setup form.
    """

    check_admin_permission("add members", f"{username}@{domain}")
    account_request = frappe.new_doc("Mail Account Request")
    account_request.account = f"{username}@{domain}"
    account_request.aliases = "\n".join(_listify(aliases))
    account_request.groups = "\n".join(str(g) for g in _listify(groups))
    account_request.mailing_lists = "\n".join(str(ml) for ml in _listify(mailing_lists))
    if quota_gb is not None and flt(quota_gb) > 0:
        account_request.quota_gb = flt(quota_gb)
    account_request.is_admin = cint(is_admin)
    account_request.invited_by = frappe.session.user
    account_request.backup_email = backup_email
    account_request.send_invite = cint(send_invite)
    # Arrives as UTC like every other timestamp; the doctype field holds system time.
    account_request.expires_at = from_utc_z(expires_at)
    account_request.insert()

    if not send_invite:
        account_request.force_verify_and_create_account(first_name, last_name, password, locale, time_zone)


@frappe.whitelist()
def get_members(
    search: str | None = None,
    is_admin: bool | None = None,
    is_enabled: bool | None = None,
    start: int = 0,
    page_length: int = DEFAULT_PAGE_LENGTH,
) -> dict:
    check_admin_permission("view members")
    start, page_length = _paging(start, page_length)

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
            USER_SETTINGS.username.as_("account"),
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

    # The grouped query is the row source; counting it as a subquery keeps the admin filter honest.
    total = frappe.qb.from_(query.as_("members")).select(Count("*")).run()[0][0]
    users = (
        query.orderby(is_admin_expr, order=Order.desc)
        .orderby(USER.name, order=Order.asc)
        .limit(page_length)
        .offset(start)
        .run(as_dict=True)
    )
    for user in users:
        if not user.get("user_image"):
            user["user_image"] = get_avatar_url(user["name"])
        user["is_admin"] = bool(user.get("is_admin"))
        user["enabled"] = bool(user.get("enabled"))
        # Stored in system time; the API speaks UTC, like every other timestamp it returns.
        user["last_active"] = to_utc_z(user.get("last_active"))

    _attach_quotas(users)
    return {"items": users, "total": total}


def _attach_quotas(users: list[dict]) -> None:
    """The allotted quota per listed account, one Suite Cloud call for the page; None when unknown."""

    for user in users:
        user["quota_gb"] = None
    emails = [user["account"] for user in users if user.get("account")]
    if not emails:
        return
    with suppress(Exception):
        quotas = get_client().call("mail.accounts.get_quotas", emails=emails)
        for user in users:
            if user.get("account") in quotas:
                user["quota_gb"] = flt(quotas[user["account"]])


def _quota_usage(account: dict) -> dict:
    return _build_quota_usage(
        int(flt(account.get("disk_quota_gb")) * GB), cint(account.get("used_disk_bytes"))
    )


def _build_quota_usage(total: int, used: int) -> dict:
    """A total of 0 means unlimited storage, so percentages and the available figure are meaningless."""

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


def _email_addresses(primary: str, display_name: str | None, aliases: list[dict]) -> list[dict]:
    """The primary address first, then every alias with its own flag and note."""

    rows = [{"email": primary, "description": display_name, "is_primary": True, "enabled": True}]
    for alias in aliases:
        rows.append(
            {
                "email": alias["email"],
                "description": alias.get("description"),
                "is_primary": False,
                "enabled": bool(alias.get("enabled", True)),
            }
        )
    return rows


def _address_ref(email: str) -> dict:
    return {"id": email, "name": email.split("@", 1)[0], "email": email}


@frappe.whitelist()
def get_member(member_id: str) -> dict:
    """The member with their account as Suite Cloud holds it.

    When the member has no account, or Suite Cloud cannot be reached, the account sections come
    back empty rather than failing the whole page.
    """

    check_admin_permission("view members")

    user = frappe.db.get_value(
        "User",
        member_id,
        ["name", "full_name", "user_image", "last_active", "enabled", "creation"],
        as_dict=True,
    )
    if not user:
        frappe.throw(_("Account not found"), frappe.DoesNotExistError)

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
        "account": None,
        "email_addresses": [],
        "groups": [],
        "mailing_lists": [],
        "quota": _build_quota_usage(0, 0),
        "locale": None,
        "time_zone": None,
    }

    email = get_account_email(member_id)
    if not email:
        return result
    result["account"] = email

    with suppress(Exception):
        account = get_client().call("mail.accounts.get_account", email=email)
        result["locale"] = account.get("locale")
        result["time_zone"] = account.get("time_zone")
        result["email_addresses"] = _email_addresses(
            account["email"], account.get("display_name"), account.get("aliases") or []
        )
        result["quota"] = _quota_usage(account)
        result["groups"] = [_address_ref(g) for g in account.get("groups") or []]
        result["mailing_lists"] = [_address_ref(ml) for ml in account.get("mailing_lists") or []]
    return result


@frappe.whitelist()
def get_account_requests(
    search: str | None = None,
    status: Literal["All", "Pending", "Accepted", "Expired"] = "All",
    start: int = 0,
    page_length: int = DEFAULT_PAGE_LENGTH,
) -> dict:
    check_admin_permission("view account requests")
    start, page_length = _paging(start, page_length)

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
    total = frappe.qb.from_(query.as_("requests")).select(Count("*")).run()[0][0]
    return {"items": query.limit(page_length).offset(start).run(as_dict=True), "total": total}


@frappe.whitelist()
def delete_account_requests(names: list) -> None:
    check_admin_permission("delete account requests", names)
    for name in names:
        frappe.delete_doc("Mail Account Request", name)


@frappe.whitelist()
def delete_members(names: list) -> None:
    user = check_admin_permission("delete members", names)
    if user in names:
        frappe.throw(_("You cannot delete your own account."))
    for name in names:
        check_member_target(name)
        frappe.delete_doc("User", name)


@frappe.whitelist()
def disable_members(names: list) -> None:
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
    """Saving the User with ``new_password`` triggers the update_account_password hook, which
    propagates the new password to the member's mail account."""

    check_admin_permission("change member password", member_id)
    check_member_target(member_id)
    if not new_password:
        frappe.throw(_("New password is required."))
    member = frappe.get_doc("User", member_id)
    member.new_password = new_password
    member.save(ignore_permissions=True)


def _require_member_account(member_id: str) -> str:
    email = get_account_email(member_id)
    if not email:
        frappe.throw(_("This account has no mailbox on the mail server."))
    return email


@frappe.whitelist()
def get_account_options() -> dict:
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
    """The role only toggles the Suite Admin role on Frappe; the mail account carries no roles."""

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

    email = get_account_email(member_id)
    if not email:
        return
    changes = {}
    if description:
        changes["display_name"] = description
    if quota_gb is not None:
        changes["disk_quota_gb"] = flt(quota_gb)
    if locale is not None:
        changes["locale"] = locale or ""
    if time_zone is not None:
        changes["time_zone"] = time_zone or ""
    if changes:
        get_client().call("mail.accounts.update_account", email=email, **changes)


# --- aliases (accounts, groups and lists alike) ------------------------------------------------------


# Suite Cloud changes one alias at a time under a row lock, so two admins editing the same
# object never drop each other's rows.
_ALIAS_CALLS = {
    "accounts": ("add_alias", "remove_alias", "set_alias_enabled"),
    "groups": ("add_group_alias", "remove_group_alias", "set_group_alias_enabled"),
    "mailing_lists": (
        "add_mailing_list_alias",
        "remove_mailing_list_alias",
        "set_mailing_list_alias_enabled",
    ),
}


def _add_alias(kind: str, email_id: str, alias: str, description: str | None) -> None:
    alias = (alias or "").strip().lower()
    validate_email_address(alias, throw=True)
    is_subaddressed_email(alias, raise_exception=True)
    get_client().call(
        f"mail.{kind}.{_ALIAS_CALLS[kind][0]}",
        email=email_id,
        alias=alias,
        description=(description or "").strip() or None,
    )


def _remove_alias(kind: str, email_id: str, alias: str) -> None:
    get_client().call(
        f"mail.{kind}.{_ALIAS_CALLS[kind][1]}", email=email_id, alias=(alias or "").strip().lower()
    )


def _set_alias_enabled(kind: str, email_id: str, alias: str, enabled: bool) -> None:
    get_client().call(
        f"mail.{kind}.{_ALIAS_CALLS[kind][2]}",
        email=email_id,
        alias=(alias or "").strip().lower(),
        enabled=bool(enabled),
    )


@frappe.whitelist()
def add_member_email(member_id: str, email: str, description: str | None = None) -> None:
    check_admin_permission("update members", f"{member_id} ({email})")
    _add_alias("accounts", _require_member_account(member_id), email, description)


@frappe.whitelist()
def remove_member_email(member_id: str, email: str) -> None:
    check_admin_permission("update members", f"{member_id} ({email})")
    _remove_alias("accounts", _require_member_account(member_id), email)


@frappe.whitelist()
def set_member_email_enabled(member_id: str, email: str, enabled: int) -> None:
    check_admin_permission("update members", f"{member_id} ({email})")
    _set_alias_enabled("accounts", _require_member_account(member_id), email, bool(cint(enabled)))


# --- membership ----------------------------------------------------------------------------------------


@frappe.whitelist()
def add_member_to_groups(member_id: str, group_ids: list) -> None:
    check_admin_permission("update members", member_id)
    email = _require_member_account(member_id)
    account = get_client().call("mail.accounts.get_account", email=email)
    groups = list(dict.fromkeys([*(account.get("groups") or []), *_listify(group_ids)]))
    get_client().call("mail.accounts.set_groups", email=email, groups=groups)


@frappe.whitelist()
def remove_member_from_group(member_id: str, group_id: str) -> None:
    check_admin_permission("update members", f"{member_id} ({group_id})")
    email = _require_member_account(member_id)
    account = get_client().call("mail.accounts.get_account", email=email)
    groups = [g for g in account.get("groups") or [] if g != group_id]
    get_client().call("mail.accounts.set_groups", email=email, groups=groups)


@frappe.whitelist()
def add_member_to_mailing_lists(member_id: str, list_ids: list) -> None:
    check_admin_permission("update members", member_id)
    email = _require_member_account(member_id)
    for list_id in _listify(list_ids):
        get_client().call("mail.mailing_lists.add_recipients", email=list_id, recipients=[email])


@frappe.whitelist()
def remove_member_from_mailing_list(member_id: str, list_id: str) -> None:
    """Removes every address of the member from the list, aliases included."""

    check_admin_permission("update members", f"{member_id} ({list_id})")
    email = _require_member_account(member_id)
    account = get_client().call("mail.accounts.get_account", email=email)
    addresses = [email, *[a["email"] for a in account.get("aliases") or []]]
    get_client().call("mail.mailing_lists.remove_recipients", email=list_id, recipients=addresses)


# --- helpers ----------------------------------------------------------------------------------------------


def _listify(value) -> list:
    if value is None:
        return []
    if isinstance(value, str):
        value = frappe.parse_json(value)
    return list(value or [])


def _paging(start: int | None, page_length: int | None) -> tuple[int, int]:
    page_length = cint(page_length) or DEFAULT_PAGE_LENGTH
    if page_length not in PAGE_LENGTHS:
        frappe.throw(_("Page length must be one of {0}.").format(", ".join(map(str, PAGE_LENGTHS))))
    return max(cint(start), 0), page_length


def _page(rows: list[dict], start: int | None, page_length: int | None) -> dict:
    """A slice plus the total, for the lists the site holds in full."""

    start, page_length = _paging(start, page_length)
    return {"items": rows[start : start + page_length], "total": len(rows)}


def _search(rows: list[dict], search: str | None, fields: tuple[str, ...]) -> list[dict]:
    if not search:
        return rows
    needle = search.lower()
    return [r for r in rows if any(needle in (str(r.get(f) or "")).lower() for f in fields)]


@frappe.whitelist()
def get_accounts(search: str | None = None, limit: int = PICKER_PAGE) -> list[dict]:
    """The accounts matching ``search``, for pickers; a short page, searched on Suite Cloud."""

    check_admin_permission("view accounts")
    page = get_client().call(
        "mail.accounts.list_accounts", search=search, limit=max(1, min(cint(limit) or PICKER_PAGE, 100))
    )
    return [
        {"id": a["email"], "name": a.get("display_name") or a["email"].split("@", 1)[0], "email": a["email"]}
        for a in page["items"]
    ]


def _group_row(group: dict) -> dict:
    return {
        "id": group["email"],
        "name": group["email"].split("@", 1)[0],
        "email": group["email"],
        "description": group.get("description"),
        "quota_gb": flt(group.get("disk_quota_gb")),
        "created_at": to_utc_z(group.get("created_at")),
    }


@frappe.whitelist()
def get_groups(search: str | None = None, start: int = 0, page_length: int = DEFAULT_PAGE_LENGTH) -> dict:
    check_admin_permission("view groups")
    start, page_length = _paging(start, page_length)
    page = get_client().call("mail.groups.list_groups", search=search, start=start, limit=page_length)
    return {"items": [_group_row(g) for g in page["items"]], "total": page["total"]}


@frappe.whitelist()
def get_group(group_id: str) -> dict:
    check_admin_permission("view groups")
    group = get_client().call("mail.groups.get_group", email=group_id)
    return {
        **_group_row(group),
        "email_addresses": _email_addresses(
            group["email"], group.get("description"), group.get("aliases") or []
        ),
        "members": [_address_ref(m) for m in group.get("members") or []],
        "quota": _build_quota_usage(int(flt(group.get("disk_quota_gb")) * GB), 0),
    }


@frappe.whitelist()
@dynamic_rate_limit()
def add_group(
    name: str,
    domain: str,
    description: str | None = None,
    members: list | None = None,
    quota_gb: float | None = None,
) -> str:
    email = f"{name}@{domain}"
    check_admin_permission("add groups", email)
    group = get_client().call(
        "mail.groups.create_group",
        email=email,
        description=description,
        members=_listify(members) or None,
        # Unset means the Mail Settings default, as for accounts; Suite Cloud's own default is the
        # last resort when that is blank too.
        disk_quota_gb=flt(quota_gb) or flt(get_config("default_disk_quota_gb")) or None,
    )
    return group["email"]


@frappe.whitelist()
def update_group(group_id: str, description: str | None = None, quota_gb: float | None = None) -> None:
    check_admin_permission("update groups", group_id)
    changes = {}
    if description is not None:
        changes["description"] = description
    if quota_gb is not None:
        changes["disk_quota_gb"] = flt(quota_gb)
    if changes:
        get_client().call("mail.groups.update_group", email=group_id, **changes)


@frappe.whitelist()
def add_group_email(group_id: str, email: str, description: str | None = None) -> None:
    check_admin_permission("update groups", f"{group_id} ({email})")
    _add_alias("groups", group_id, email, description)


@frappe.whitelist()
def remove_group_email(group_id: str, email: str) -> None:
    check_admin_permission("update groups", f"{group_id} ({email})")
    _remove_alias("groups", group_id, email)


@frappe.whitelist()
def set_group_email_enabled(group_id: str, email: str, enabled: int) -> None:
    check_admin_permission("update groups", f"{group_id} ({email})")
    _set_alias_enabled("groups", group_id, email, bool(cint(enabled)))


@frappe.whitelist()
def add_group_members(group_id: str, account_ids: list) -> None:
    check_admin_permission("update groups", group_id)
    group = get_client().call("mail.groups.get_group", email=group_id)
    members = list(dict.fromkeys([*(group.get("members") or []), *_listify(account_ids)]))
    get_client().call("mail.groups.set_group_members", email=group_id, members=members)


@frappe.whitelist()
def remove_group_member(group_id: str, account_id: str) -> None:
    check_admin_permission("update groups", f"{group_id} ({account_id})")
    group = get_client().call("mail.groups.get_group", email=group_id)
    members = [m for m in group.get("members") or [] if m != account_id]
    get_client().call("mail.groups.set_group_members", email=group_id, members=members)


@frappe.whitelist()
def delete_groups(ids: list) -> None:
    check_admin_permission("delete groups", ids)
    for group_id in _listify(ids):
        get_client().call("mail.groups.delete_group", email=group_id)


# --- mailing lists ----------------------------------------------------------------------------------------------


def _list_row(mailing_list: dict) -> dict:
    return {
        "id": mailing_list["email"],
        "name": mailing_list["email"].split("@", 1)[0],
        "email": mailing_list["email"],
        "description": mailing_list.get("description"),
        "recipient_count": cint(mailing_list.get("recipient_count")),
    }


@frappe.whitelist()
def get_mailing_lists(
    search: str | None = None, start: int = 0, page_length: int = DEFAULT_PAGE_LENGTH
) -> dict:
    check_admin_permission("view mailing lists")
    start, page_length = _paging(start, page_length)
    page = get_client().call(
        "mail.mailing_lists.list_mailing_lists", search=search, start=start, limit=page_length
    )
    return {"items": [_list_row(ml) for ml in page["items"]], "total": page["total"]}


@frappe.whitelist()
def get_mailing_list(list_id: str, start: int = 0, limit: int = 200, search: str | None = None) -> dict:
    """The list with one page of its recipients; large lists page through ``start``/``limit``."""

    check_admin_permission("view mailing lists")
    client = get_client()
    mailing_list = client.call("mail.mailing_lists.get_mailing_list", email=list_id)
    page = client.call(
        "mail.mailing_lists.list_recipients",
        email=list_id,
        start=cint(start),
        limit=cint(limit) or 200,
        search=search,
    )
    return {
        **_list_row(mailing_list),
        "email_addresses": _email_addresses(
            mailing_list["email"], mailing_list.get("description"), mailing_list.get("aliases") or []
        ),
        "recipients": [r["email"] for r in page["items"]],
        "recipient_rows": page["items"],
        "recipient_total": page["total"],
    }


@frappe.whitelist()
def get_mailing_list_recipients(
    list_id: str, search: str | None = None, start: int = 0, page_length: int = DEFAULT_PAGE_LENGTH
) -> dict:
    """One page of a list's recipients, searched and paged on Suite Cloud."""

    check_admin_permission("view mailing lists")
    start, page_length = _paging(start, page_length)
    page = get_client().call(
        "mail.mailing_lists.list_recipients",
        email=list_id,
        start=start,
        limit=page_length,
        search=(search or "").strip() or None,
    )
    return {
        "items": [{"email": r["email"], "enabled": bool(r.get("enabled", True))} for r in page["items"]],
        "total": page["total"],
    }


@frappe.whitelist()
@dynamic_rate_limit()
def add_mailing_list(
    name: str, domain: str, recipients: list | None = None, description: str | None = None
) -> str:
    email = f"{name}@{domain}"
    check_admin_permission("add mailing lists", email)
    mailing_list = get_client().call(
        "mail.mailing_lists.create_mailing_list",
        email=email,
        description=description,
        recipients=_listify(recipients) or None,
    )
    return mailing_list["email"]


@frappe.whitelist()
def update_mailing_list(list_id: str, description: str | None = None) -> None:
    check_admin_permission("update mailing lists", list_id)
    if description is not None:
        get_client().call("mail.mailing_lists.update_mailing_list", email=list_id, description=description)


@frappe.whitelist()
def add_mailing_list_email(list_id: str, email: str, description: str | None = None) -> None:
    check_admin_permission("update mailing lists", f"{list_id} ({email})")
    _add_alias("mailing_lists", list_id, email, description)


@frappe.whitelist()
def remove_mailing_list_email(list_id: str, email: str) -> None:
    check_admin_permission("update mailing lists", f"{list_id} ({email})")
    _remove_alias("mailing_lists", list_id, email)


@frappe.whitelist()
def set_mailing_list_email_enabled(list_id: str, email: str, enabled: int) -> None:
    check_admin_permission("update mailing lists", f"{list_id} ({email})")
    _set_alias_enabled("mailing_lists", list_id, email, bool(cint(enabled)))


@frappe.whitelist()
def add_mailing_list_recipients(list_id: str, recipients: list) -> None:
    check_admin_permission("update mailing lists", list_id)
    emails = [e.strip() for e in _listify(recipients) if e and str(e).strip()]
    if emails:
        get_client().call("mail.mailing_lists.add_recipients", email=list_id, recipients=emails)


@frappe.whitelist()
def remove_mailing_list_recipient(list_id: str, email: str) -> None:
    check_admin_permission("update mailing lists", f"{list_id} ({email})")
    get_client().call(
        "mail.mailing_lists.remove_recipients", email=list_id, recipients=[(email or "").strip()]
    )


@frappe.whitelist()
def delete_mailing_lists(ids: list) -> None:
    check_admin_permission("delete mailing lists", ids)
    for list_id in _listify(ids):
        get_client().call("mail.mailing_lists.delete_mailing_list", email=list_id)


# --- overview ------------------------------------------------------------------------------------------------------


@frappe.whitelist()
def get_overview() -> dict:
    """Counts for the dashboard landing page.

    The member figures are local; the directory counts come from Suite Cloud in one call and
    degrade to ``None`` when it cannot be reached, so one unreachable subsystem doesn't blank the
    whole page.
    """

    check_admin_permission("view overview")

    overview: dict = {
        "members": None,
        "pending_invites": None,
        "domains": None,
        "groups": None,
        "mailing_lists": None,
        "limits": None,
    }

    with suppress(Exception):
        disabled = _disabled_accounts()
        overview["disabled_accounts"] = disabled
        overview["members"] = {"total": _member_count(), "disabled": len(disabled)}

    with suppress(Exception):
        invites = _invite_counts()
        overview["invites"] = invites
        overview["pending_invites"] = invites["pending"]

    with suppress(Exception):
        site = get_client().call("site.ping")
        usage = site.get("usage") or {}
        limits = site.get("limits") or {}
        overview["domains"] = usage.get("domains")
        overview["groups"] = usage.get("groups")
        overview["mailing_lists"] = usage.get("mailing_lists")
        overview["limits"] = limits
        overview["storage"] = {
            "allocated_gb": usage.get("allocated_disk_gb"),
            "max_gb": limits.get("max_disk_gb"),
            "default_quota_gb": limits.get("default_disk_quota_gb"),
        }
        overview["site"] = {
            k: site.get(k)
            for k in ("site", "title", "status", "cluster", "mail_hostname", "jmap_url", "contact_email")
        }

    with suppress(Exception):
        # Domains that are not sending or receiving: the admin's first job on a fresh site.
        overview["domains_needing_attention"] = [
            {"name": row["name"], "status": row["status"], "last_verified_at": row["last_verified_at"]}
            for row in (_domain_row(d) for d in get_site_domains())
            if row["status"] != "Active"
        ]

    with suppress(Exception):
        overview["recent_accounts"] = _recent_accounts(RECENT_ACCOUNTS)

    with suppress(Exception):
        settings = frappe.get_cached_doc("Suite Settings")
        overview["workspace"] = {"name": settings.workspace_name, "logo": settings.workspace_logo}

    return overview


RECENT_ACCOUNTS = 6  # matches the six rows of the Mail Service panel beside it


def _member_count() -> int:
    USER = frappe.qb.DocType("User")
    USER_SETTINGS = frappe.qb.DocType("User Settings")
    return (
        frappe.qb.from_(USER)
        .join(USER_SETTINGS)
        .on(USER.name == USER_SETTINGS.user)
        .select(Count("*"))
        .where(USER_SETTINGS.username.isnotnull())
    ).run()[0][0]


def _invite_counts() -> dict:
    now = frappe.utils.now()
    soon = frappe.utils.add_to_date(now, hours=24)
    open_filters = {"is_verified": 0, "expires_at": [">", now]}
    return {
        "pending": frappe.db.count("Mail Account Request", open_filters),
        "expiring_soon": frappe.db.count(
            "Mail Account Request", {"is_verified": 0, "expires_at": ["between", [now, soon]]}
        ),
        "expired": frappe.db.count("Mail Account Request", {"is_verified": 0, "expires_at": ["<=", now]}),
    }


def _disabled_accounts() -> list[dict]:
    """Members with a mailbox who cannot sign in, by address, for the overview's attention list."""

    USER = frappe.qb.DocType("User")
    USER_SETTINGS = frappe.qb.DocType("User Settings")
    return (
        frappe.qb.from_(USER)
        .join(USER_SETTINGS)
        .on(USER.name == USER_SETTINGS.user)
        .select(USER.name, USER.full_name)
        .where(USER_SETTINGS.username.isnotnull() & (USER.enabled == 0))
        .orderby(USER.name, order=Order.asc)
    ).run(as_dict=True)


def _recent_accounts(limit: int) -> list[dict]:
    """The newest members with a mailbox, as the accounts list shows them."""

    USER = frappe.qb.DocType("User")
    USER_SETTINGS = frappe.qb.DocType("User Settings")
    rows = (
        frappe.qb.from_(USER)
        .join(USER_SETTINGS)
        .on(USER.name == USER_SETTINGS.user)
        .select(USER.name, USER.full_name, USER.user_image, USER.enabled, USER.creation)
        .where(USER_SETTINGS.username.isnotnull())
        .orderby(USER.creation, order=Order.desc)
        .limit(limit)
    ).run(as_dict=True)
    for row in rows:
        row["user_image"] = row.get("user_image") or get_avatar_url(row["name"])
        row["enabled"] = bool(row["enabled"])
        row["joined_on"] = to_utc_z(row.pop("creation"))
    return rows
