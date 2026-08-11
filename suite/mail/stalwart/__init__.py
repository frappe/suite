from urllib.parse import urljoin

import frappe
from frappe import _
from frappe.utils import random_string
from frappe.utils.caching import redis_cache

from suite.mail.doctype.user_account.user_account import get_user_personal_jmap_account
from suite.mail.stalwart.account import (
    DEFAULT_LOCALE,
    Account,
    AccountService,
    Credential,
    CustomRoles,
    EmailAlias,
    PasswordCredential,
    RoleType,
    StorageQuota,
    UserRoles,
)
from suite.mail.stalwart.actions import Action, ActionService
from suite.mail.stalwart.app_password import AppPassword, AppPasswordService
from suite.mail.stalwart.connection import get_account_management_connection, get_management_connection
from suite.mail.stalwart.domain import DkimSignatureService, Domain, DomainService
from suite.mail.stalwart.group import Group, GroupService
from suite.mail.stalwart.logs import LogService
from suite.mail.stalwart.mailing_list import MailingList, MailingListService
from suite.mail.stalwart.oauth import OAuthClient, OAuthClientService
from suite.mail.stalwart.queue import QueuedMessageService
from suite.mail.stalwart.reports import (
    ArfExternalReportService,
    DmarcExternalReportService,
    DmarcInternalReportService,
    TlsExternalReportService,
    TlsInternalReportService,
)
from suite.mail.stalwart.role import Role, RoleService
from suite.mail.stalwart.service import ManagementService
from suite.utils.dt import utcnow

__all__ = [
    "Account",
    "AccountService",
    "Action",
    "ActionService",
    "AppPassword",
    "AppPasswordService",
    "ArfExternalReportService",
    "DmarcExternalReportService",
    "DmarcInternalReportService",
    "Domain",
    "DomainService",
    "Group",
    "GroupService",
    "LogService",
    "MailingList",
    "MailingListService",
    "ManagementService",
    "OAuthClient",
    "OAuthClientService",
    "QueuedMessageService",
    "Role",
    "RoleService",
    "TlsExternalReportService",
    "TlsInternalReportService",
]


# --- service factories -----------------------------------------------------


def get_account_service() -> AccountService:
    """Returns an AccountService bound to the admin management connection."""

    return AccountService(get_management_connection())


def get_group_service() -> GroupService:
    """Returns a GroupService bound to the admin management connection."""

    return GroupService(get_management_connection())


def get_domain_service() -> DomainService:
    """Returns a DomainService bound to the admin management connection."""

    return DomainService(get_management_connection())


def get_dkim_signature_service() -> DkimSignatureService:
    """Returns a DkimSignatureService bound to the admin management connection."""

    return DkimSignatureService(get_management_connection())


def get_role_service() -> RoleService:
    """Returns a RoleService bound to the admin management connection."""

    return RoleService(get_management_connection())


def get_mailing_list_service() -> MailingListService:
    """Returns a MailingListService bound to the admin management connection."""

    return MailingListService(get_management_connection())


def get_oauth_client_service() -> OAuthClientService:
    """Returns an OAuthClientService bound to the admin management connection."""

    return OAuthClientService(get_management_connection())


def get_app_password_service(account: str) -> AppPasswordService:
    """App passwords are account-scoped, so the returned service authenticates as ``account``."""

    return AppPasswordService(get_account_management_connection(account))


def get_queued_message_service() -> QueuedMessageService:
    """Returns a QueuedMessageService bound to the admin management connection."""

    return QueuedMessageService(get_management_connection())


def get_log_service() -> LogService:
    """Returns a LogService bound to the admin management connection."""

    return LogService(get_management_connection())


def get_action_service() -> ActionService:
    """Returns an ActionService bound to the admin management connection."""

    return ActionService(get_management_connection())


# Report kinds keyed by ``(kind, direction)`` → service factory. ``direction`` is ``inbound`` for
# reports received from other servers and ``outbound`` for reports Stalwart generates and sends.
_REPORT_SERVICES = {
    ("dmarc", "inbound"): DmarcExternalReportService,
    ("dmarc", "outbound"): DmarcInternalReportService,
    ("tls", "inbound"): TlsExternalReportService,
    ("tls", "outbound"): TlsInternalReportService,
    ("arf", "inbound"): ArfExternalReportService,
}


def get_report_service(kind: str, direction: str) -> ManagementService:
    """Returns the report service for ``(kind, direction)``, or throws if the pair is unsupported."""

    service = _REPORT_SERVICES.get((kind, direction))
    if not service:
        frappe.throw(_("Unsupported report type: {0} {1}").format(kind, direction))

    return service(get_management_connection())


# --- cached lookups + resolvers --------------------------------------------


@redis_cache(ttl=60)
def get_domains() -> list[dict]:
    """Returns all domains on the server (cached briefly)."""

    return get_domain_service().get_all(
        properties=["id", "name", "description", "isEnabled", "createdAt", "dnsZoneFile"]
    )


@redis_cache(ttl=60)
def get_mailing_list_index() -> dict[str, list[str]]:
    """Returns ``{list address: [recipient addresses]}`` for every mailing list (cached briefly).

    Membership edits are visible once the cache expires; mail routing itself is unaffected, so the
    only window is between a membership change and the next calendar invitation.
    """

    return get_mailing_list_service().get_address_index()


@redis_cache(ttl=3600)
def get_permissions() -> list[dict]:
    """Returns all assignable permissions as ``{value, label}`` from the Stalwart server schema.

    The management API only carries raw permission keys; the server's schema endpoint provides the
    human-readable labels (version-accurate), so we read them from there.
    """

    from suite.mail.utils import get_config

    schema = get_management_connection().request(
        method="GET", url=urljoin(get_config("server_url"), "/api/schema"), return_json=True
    )
    permissions = (schema.get("enums") or {}).get("Permission") or []
    return [{"value": p["name"], "label": p.get("label") or p["name"]} for p in permissions]


@redis_cache(ttl=3600)
def get_action_types() -> list[dict]:
    """Returns the executable server actions as ``{value, label, schema_name, options}`` from the schema.

    ``schema_name`` is set only for actions that take extra input (e.g. DMARC troubleshooting and
    spam classification); parameterless actions leave it ``None``. ``options`` holds the choices for
    each enum input of that schema, so a select can be rendered without restating the server's enums —
    which matters because the server is the only authority on the exact accepted values.
    """

    from suite.mail.utils import get_config

    schema = get_management_connection().request(
        method="GET", url=urljoin(get_config("server_url"), "/api/schema"), return_json=True
    )
    enums = schema.get("enums") or {}
    fields = schema.get("fields") or {}

    def choice(variant: dict) -> dict:
        # A few enum variants ship with an empty label and the description folded into the name
        # ("bit8Mime - 8-bit MIME message content"); the name is still the only accepted value.
        name = variant["name"]
        label = variant.get("label") or (name.split(" - ", 1)[1] if " - " in name else name)
        return {"value": name, "label": label}

    def enum_options(schema_name: str | None) -> dict:
        properties = (fields.get(schema_name) or {}).get("properties") or {}
        options = {}
        for name, spec in properties.items():
            type = spec.get("type") or {}
            if spec.get("update") == "serverSet" or type.get("type") != "enum":
                continue
            options[name] = [choice(v) for v in enums.get(type.get("enumName")) or []]
        return options

    variants = (schema.get("schemas") or {}).get("x:Action", {}).get("variants") or []
    return [
        {
            "value": v["name"],
            "label": v.get("label") or v["name"],
            "schema_name": v.get("schemaName"),
            "options": enum_options(v.get("schemaName")),
        }
        for v in variants
    ]


@redis_cache(ttl=3600)
def get_account_metadata() -> dict:
    """Returns the locale and time zone choices for an account, each as ``{value, label}``.

    The locale label leads with the code so it stays scannable, and keeps the schema's description
    after it because the picker matches on the label — which is what makes searching by language
    rather than by code work.
    """

    from suite.mail.utils import get_config

    schema = get_management_connection().request(
        method="GET", url=urljoin(get_config("server_url"), "/api/schema"), return_json=True
    )
    enums = schema.get("enums") or {}
    return {
        "locales": [
            {"value": v["name"], "label": f"{v['name']} · {v['label']}" if v.get("label") else v["name"]}
            for v in enums.get("Locale") or []
        ],
        # The time zone label is only the id with its underscores spaced out, so the id itself reads
        # better and matches what the member and group pages show.
        "time_zones": [{"value": v["name"], "label": v["name"]} for v in enums.get("TimeZone") or []],
    }


@redis_cache(ttl=3600)
def get_log_labels() -> dict:
    """Returns the display labels for log entries as ``{"events": {...}, "levels": {...}}``.

    Log entries carry raw identifiers (``smtp.dmarc-fail``, ``warn``); the schema's ``EventType`` and
    ``TracingLevel`` enums hold the human labels for them, so they stay version-accurate rather than
    being duplicated here.
    """

    from suite.mail.utils import get_config

    schema = get_management_connection().request(
        method="GET", url=urljoin(get_config("server_url"), "/api/schema"), return_json=True
    )

    def labels(items: list[dict]) -> dict:
        return {i["name"]: i.get("label") or i["name"] for i in items}

    enums = schema.get("enums") or {}
    return {"events": labels(enums.get("EventType") or []), "levels": labels(enums.get("TracingLevel") or [])}


@redis_cache(ttl=3600)
def get_queue_metadata() -> dict:
    """Returns the enum/variant option lists used to render and edit queued messages.

    All values come from the server schema so labels stay version-accurate: message flags, recipient
    status types, delivery error types and expiry types (each as ``{value, label}``).
    """

    from suite.mail.utils import get_config

    schema = get_management_connection().request(
        method="GET", url=urljoin(get_config("server_url"), "/api/schema"), return_json=True
    )

    def options(items: list[dict]) -> list[dict]:
        return [{"value": i["name"], "label": i.get("label") or i["name"]} for i in items]

    enums = schema.get("enums") or {}
    schemas = schema.get("schemas") or {}
    return {
        "message_flags": options(enums.get("MessageFlag") or []),
        "status_types": options((schemas.get("x:RecipientStatus") or {}).get("variants") or []),
        "error_types": options(enums.get("DeliveryErrorType") or []),
        "expiry_types": options((schemas.get("x:QueueExpiry") or {}).get("variants") or []),
    }


@redis_cache(ttl=3600)
def get_roles(description: str | None = None) -> list[dict]:
    """Returns roles on the server, optionally filtered by description (cached)."""

    filter = {"description": description} if description else None
    return get_role_service().get_all(filter=filter, properties=["id", "description"])


def resolve_domain_id(name: str, raise_exception: bool = True) -> str | None:
    """Resolves a domain name to its Stalwart id."""

    domain = get_domain_service().get_by_name(name, raise_exception=raise_exception)
    return domain["id"] if domain else None


def resolve_role_ids(descriptions: list[str] | None) -> list[str]:
    if not descriptions:
        return []

    role_map = {r["description"]: r["id"] for r in get_roles()}

    role_ids = []
    for description in descriptions:
        role_id = role_map.get(description)
        if not role_id:
            frappe.throw(_("Role {0} does not exist on the Stalwart server.").format(description))

        role_ids.append(role_id)

    return role_ids


def _resolve_alias(alias: str) -> tuple[str, str]:
    """Splits a full email address into its local-part and domain."""

    alias = (alias or "").strip()
    name, _, domain = alias.partition("@")
    if not name or not domain:
        frappe.throw(_("Alias must be a complete email address: {0}").format(alias))

    return name, domain


# --- high-level conveniences used by hooks, doctypes and admin APIs --------


def create_account(
    name: str,
    domain: str,
    password: str | None = None,
    description: str | None = None,
    aliases: list[str] | None = None,
    groups: list[str] | None = None,
    roles: list[str] | None = None,
    quota: int | None = None,
    locale: str | None = None,
    timezone: str | None = None,
) -> str:
    """Creates a user account, resolving domain/group/role names to ids."""

    account_service = get_account_service()
    domain_service = get_domain_service()

    domain_id = domain_service.get_by_name(domain, raise_exception=True)["id"]

    email_aliases = []
    domain_ids = {domain: domain_id}
    for alias in aliases or []:
        if not alias:
            continue

        alias_name, alias_domain = _resolve_alias(alias)
        if alias_domain not in domain_ids:
            domain_ids[alias_domain] = domain_service.get_by_name(alias_domain, raise_exception=True)["id"]

        email_aliases.append(EmailAlias(name=alias_name, domain_id=domain_ids[alias_domain]))

    member_group_ids = [
        account_service.get_by_name(group, raise_exception=True)["id"] for group in groups or [] if group
    ]

    role_ids = resolve_role_ids(roles)
    user_roles = (
        UserRoles(type=RoleType.CUSTOM, roles=CustomRoles(role_ids=role_ids))
        if role_ids
        else UserRoles(type=RoleType.USER)
    )

    account = Account(
        name=name,
        domain_id=domain_id,
        credentials=[Credential(password=PasswordCredential(secret=password or random_string(12)))],
        member_group_ids=member_group_ids or None,
        roles=user_roles,
        quotas=StorageQuota(max_disk_quota=quota) if quota is not None else StorageQuota(),
        aliases=email_aliases or None,
        description=description,
        locale=locale or DEFAULT_LOCALE,
        timezone=timezone,
    )

    return account_service.create(account)


def create_app_password(account: str, description: str | None = None) -> str:
    """Creates an app password for ``account`` and returns the generated secret."""

    description = description or f"App Password for {frappe.local.site} - {utcnow()}"
    return get_app_password_service(account).create(AppPassword(description=description))


def update_password(user: str | None = None, new_password: str | None = None) -> None:
    """Sets the password of the user's personal Stalwart account (no-op if they have none)."""

    if not user or not new_password:
        frappe.throw(_("User and new password are required to update the Stalwart password."))

    if account := get_user_personal_jmap_account(user, raise_exception=False):
        get_account_service().set_password(account, new_password)


def delete_account(user: str) -> None:
    """Deletes the user's personal Stalwart account (no-op if they have none)."""

    if account := get_user_personal_jmap_account(user, raise_exception=False):
        get_account_service().delete(account)


def add_account_role(user: str, role: str) -> None:
    """Applies a role (by description) to the user's personal account (no-op if they have none)."""

    if account := get_user_personal_jmap_account(user, raise_exception=False):
        role_id = get_role_service().get_by_description(role, raise_exception=True)["id"]
        get_account_service().add_roles(account, [role_id])


def remove_account_role(user: str, role: str) -> None:
    """Removes a role (by description) from the user's personal account (no-op if they have none)."""

    if account := get_user_personal_jmap_account(user, raise_exception=False):
        role_id = get_role_service().get_by_description(role, raise_exception=True)["id"]
        get_account_service().remove_roles(account, [role_id])
