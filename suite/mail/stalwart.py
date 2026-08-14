import hashlib
import time
from contextlib import contextmanager
from urllib.parse import urljoin

import frappe
import httpx
from frappe import _
from frappe.utils import random_string
from frappe.utils.caching import redis_cache, request_cache
from jmap import JMAPError, MethodError
from jmap.auth import BasicAuth
from jmap.capabilities.registry import Registry
from jmap.capabilities.spec import CapabilitySpec, DataTypeSpec, MethodKind, MethodSpec
from jmap.client import JMAPClient
from jmap.core.retry import RetryPolicy
from jmap.core.session import Session

from suite.mail.doctype.user_account.user_account import get_user_personal_jmap_account
from suite.mail.utils import get_config, is_stalwart_configured, log_mail_error
from suite.utils.dt import utcnow

CORE_CAPABILITY = "urn:ietf:params:jmap:core"
STALWART_URN = "urn:stalwart:jmap"

# Shown to the user for any Stalwart failure; the real cause is written to the error log instead.
GENERIC_ERROR = "The mail server could not process this request. Please try again or contact your administrator if the problem persists."

# Cache key under which the discovered management JMAP session is stored.
MANAGEMENT_SESSION_CACHE_KEY = "stalwart:management:sessions"

# Setting ``nextRetry`` to a time in the past tells Stalwart to attempt delivery immediately.
RETRY_NOW = "2000-01-01T00:00:00Z"

# Stalwart requires every account to carry a locale, so one is picked when none was chosen.
DEFAULT_LOCALE = "en_US"

DEFAULT_TIMEOUT: tuple[float, float] = (30.0, 60.0)

# Common metadata carried by every received (external) / generated (internal) report.
_EXTERNAL_REPORT_PROPERTIES = [
    "id",
    "from",
    "subject",
    "to",
    "receivedAt",
    "expiresAt",
    "memberTenantId",
    "report",
]
_INTERNAL_REPORT_PROPERTIES = ["id", "domain", "createdAt", "deliverAt", "report"]

# Properties fetched when the caller passes none, per management type (absent -> server default).
DEFAULT_PROPERTIES: dict[str, list[str]] = {
    "Account": [
        "@type",
        "id",
        "name",
        "description",
        "emailAddress",
        "aliases",
        "domainId",
        "locale",
        "memberGroupIds",
        "quotas",
        "roles",
        "timeZone",
        "usedDiskQuota",
    ],
    "Domain": ["id", "name", "description", "isEnabled", "createdAt"],
    "DkimSignature": ["id", "selector", "domainId", "stage"],
    "Role": ["id", "description", "roleIds", "enabledPermissions", "disabledPermissions"],
    "MailingList": ["id", "name", "emailAddress", "domainId", "recipients", "description"],
    "OAuthClient": ["id", "clientId", "description", "contacts", "redirectUris", "expiresAt"],
    "QueuedMessage": [
        "id",
        "returnPath",
        "recipients",
        "size",
        "priority",
        "envId",
        "flags",
        "nextRetry",
        "nextNotify",
        "receivedFromIp",
        "receivedViaPort",
        "createdAt",
        "blobId",
    ],
    "Log": ["id", "timestamp", "level", "event", "details"],
    "DmarcExternalReport": _EXTERNAL_REPORT_PROPERTIES,
    "DmarcInternalReport": [*_INTERNAL_REPORT_PROPERTIES, "rua", "policyIdentifier"],
    "TlsExternalReport": _EXTERNAL_REPORT_PROPERTIES,
    "TlsInternalReport": [*_INTERNAL_REPORT_PROPERTIES, "mailRua", "httpRua", "policyIdentifiers"],
    "ArfExternalReport": _EXTERNAL_REPORT_PROPERTIES,
}

# The log store rejects offset paging ("Pagination is only possible using anchors for logs").
_CURSOR_PAGINATED = frozenset({"Log"})

# Report kinds keyed by ``(kind, direction)``. ``direction`` is ``inbound`` for reports received
# from other servers and ``outbound`` for reports Stalwart generates and sends.
_REPORT_TYPES = {
    ("dmarc", "inbound"): "DmarcExternalReport",
    ("dmarc", "outbound"): "DmarcInternalReport",
    ("tls", "inbound"): "TlsExternalReport",
    ("tls", "outbound"): "TlsInternalReport",
    ("arf", "inbound"): "ArfExternalReport",
}

_MANAGEMENT_TYPES = (
    "Account",
    "Domain",
    "DkimSignature",
    "Role",
    "MailingList",
    "OAuthClient",
    "AppPassword",
    "QueuedMessage",
    "Log",
    "Action",
    "DmarcExternalReport",
    "DmarcInternalReport",
    "TlsExternalReport",
    "TlsInternalReport",
    "ArfExternalReport",
)


def report_type_name(kind: str, direction: str) -> str:
    """Returns the management type for ``(kind, direction)``, or throws if unsupported."""

    type_ = _REPORT_TYPES.get((kind, direction))
    if not type_:
        frappe.throw(_("Unsupported report type: {0} {1}").format(kind, direction))

    return type_


# --- capability + client ----------------------------------------------------


def _management_capability() -> CapabilitySpec:
    """Describes Stalwart's management JMAP dialect so jmaplib will speak it.

    Every type gets all four standard verbs; the server simply never receives the ones a type
    lacks (e.g. ``x:Log/set``), because nothing here calls them. ``attr`` stays ``None``: the
    ``x:`` prefix is not a Python identifier, so calls go through ``batch.add`` by name.
    """

    return CapabilitySpec(
        urn=STALWART_URN,
        reference="Stalwart management JMAP dialect",
        data_types=tuple(DataTypeSpec(name=f"x:{t}") for t in _MANAGEMENT_TYPES),
        methods=tuple(
            MethodSpec(f"x:{t}/{verb}", kind, mutating=(kind is MethodKind.SET))
            for t in _MANAGEMENT_TYPES
            for verb, kind in (
                ("get", MethodKind.GET),
                ("set", MethodKind.SET),
                ("query", MethodKind.QUERY),
                ("changes", MethodKind.CHANGES),
            )
        ),
    )


def _registry() -> Registry:
    from jmap.capabilities.core import CORE

    registry = Registry()
    registry.register(CORE)
    registry.register(_management_capability())
    return registry


def _fail(type_: str, detail: str) -> None:
    """Logs the real Stalwart error and raises a generic message so it is never shown to the user."""

    log_mail_error(title=_("Stalwart {0} request failed").format(type_), message=detail)
    frappe.throw(_(GENERIC_ERROR))


@contextmanager
def _guarded(type_: str):
    """Converts any transport/request/method failure into the logged generic throw."""

    try:
        yield
    except MethodError as e:
        _fail(type_, frappe.as_json({"type": e.type, **e.arguments}))
    except (JMAPError, httpx.HTTPError) as e:
        _fail(type_, str(e))


class ManagementClient(JMAPClient):
    """JMAP client for the management dialect; keeps the cached admin session fresh."""

    cache_key: str | None = None

    def execute(self, batch, *, extra_using: frozenset[str] = frozenset()) -> None:
        super().execute(batch, extra_using=extra_using)
        if self.session_stale:
            self.refresh_session()
            self.rescope()
            if self.cache_key:
                frappe.cache.hset(
                    MANAGEMENT_SESSION_CACHE_KEY, self.cache_key, _session_payload(self.session)
                )

    def rescope(self) -> None:
        """Points the client at the session's management account and re-resolves capabilities.

        Stalwart advertises ``urn:stalwart:jmap`` only per-account, so resolving with the wrong
        account would leave the management methods unregistered.
        """

        account = self.session.primary_account_for(STALWART_URN)
        if account is None:
            _fail("Session", f"Server does not advertise {STALWART_URN} in primaryAccounts.")

        self.default_account = account
        self.capabilities = self.registry.resolve(self.session, account)


def _session_payload(session: Session) -> dict:
    """The session document with absolutized endpoint URLs, revivable offline."""

    doc = dict(session.raw)
    doc.update(
        {
            "apiUrl": session.api_url,
            "downloadUrl": session.download_url,
            "uploadUrl": session.upload_url,
            "eventSourceUrl": session.event_source_url,
            "timestamp": time.time(),
        }
    )
    return doc


def _connect(username: str, cache_key: str | None, timeout: tuple[float, float]) -> ManagementClient:
    """Builds a management client for ``username`` using the configured admin password.

    ``cache_key`` persists the discovered session; pass ``None`` to always re-discover it.
    """

    is_stalwart_configured(raise_exception=True)

    server_url, password, verify_ssl = get_config(("server_url", "password", "verify_ssl"))

    auth = BasicAuth(username, password)
    connect_timeout, read_timeout = timeout
    http = httpx.Client(
        follow_redirects=True,
        auth=auth,
        verify=bool(verify_ssl),
        timeout=httpx.Timeout(
            connect=connect_timeout, read=read_timeout, write=read_timeout, pool=connect_timeout
        ),
    )
    session_url = urljoin(server_url, "/.well-known/jmap")
    registry = _registry()

    try:
        cached = frappe.cache.hget(MANAGEMENT_SESSION_CACHE_KEY, cache_key) if cache_key else None
        if cached:
            session = Session.from_wire(cached)
            client = ManagementClient(
                session,
                registry.resolve(session, None),
                http,
                registry=registry,
                retry_policy=RetryPolicy(max_attempts=1),
                owns_http=True,
                session_url=session_url,
            )
        else:
            with _guarded("Session"):
                client = ManagementClient.connect(
                    session_url,
                    auth=auth,
                    http=http,
                    registry=registry,
                    retry_policy=RetryPolicy(max_attempts=1),
                )
            if cache_key:
                frappe.cache.hset(MANAGEMENT_SESSION_CACHE_KEY, cache_key, _session_payload(client.session))
    except Exception:
        http.close()
        raise

    client.cache_key = cache_key
    client.rescope()
    return client


@request_cache
def get_management_client(timeout: tuple[float, float] = DEFAULT_TIMEOUT) -> ManagementClient:
    """Returns a management client authenticated as the Stalwart administrator.

    Used for all server-scoped directory management (Accounts, Groups, Mailing Lists, Roles,
    Domains, OAuth). Cached per request so the many helpers reuse one instance.
    """

    server_url, username = get_config(("server_url", "username"))
    cache_key = hashlib.sha1(f"{server_url}|{username}".encode()).hexdigest()

    return _connect(username, cache_key, timeout)


@request_cache
def get_account_management_client(
    account: str, timeout: tuple[float, float] = DEFAULT_TIMEOUT
) -> ManagementClient:
    """Returns a management client authenticated as ``account`` via Stalwart master-user auth.

    Stalwart lets an administrator authenticate as any account by logging in with the username
    ``<account>%<admin_username>`` and the admin password. This is required for account-scoped
    management objects such as App Passwords, which are created within the target account.

    The session is deliberately not persisted. It carries the account's id, and that id changes
    whenever an account is deleted and recreated on the same address — a cached session then scopes
    every call to the id of the account that is gone, which the server rejects with "You are not an
    owner of account <id>". These clients are short-lived (one app password when an account is
    set up) and ``request_cache`` already shares them within a request, so rediscovering costs a
    single request and keeps the account id honest.
    """

    admin_username = get_config("username")

    return _connect(f"{account}%{admin_username}", None, timeout)


# --- generic management verbs ----------------------------------------------


def _resolve_properties(type_: str, properties: list[str] | None) -> list[str] | None:
    """Falls back to the type's default property list when ``properties`` is not given."""

    return properties if properties is not None else DEFAULT_PROPERTIES.get(type_)


def _args(**kwargs) -> dict:
    """Builds a wire arguments dict, dropping ``None`` values."""

    return {k: v for k, v in kwargs.items() if v is not None}


def manage_get(
    type_: str, id: str, properties: list[str] | None = None, *, client: ManagementClient | None = None
) -> dict | None:
    """Returns a single object by id, or ``None`` if it does not exist."""

    client = client or get_management_client()
    with _guarded(type_):
        with client.batch() as b:
            h = b.add(
                f"x:{type_}/get",
                _args(ids=[id], properties=_resolve_properties(type_, properties)),
            )
        objects = h.result.items

    return objects[0].raw if objects else None


def manage_get_all(
    type_: str,
    filter: dict | None = None,
    sort: list[dict] | None = None,
    limit: int | None = None,
    properties: list[str] | None = None,
    *,
    client: ManagementClient | None = None,
) -> list[dict]:
    """Returns every matching object in a single request.

    With no filter, one ``get`` (ids omitted) returns all objects. With a filter, ``query`` and
    ``get`` are chained through a JMAP result reference so the query's ids feed the get without a
    second round-trip.
    """

    client = client or get_management_client()
    properties = _resolve_properties(type_, properties)

    with _guarded(type_):
        if filter is None and sort is None and limit is None:
            with client.batch() as b:
                h = b.add(f"x:{type_}/get", _args(properties=properties))
            return [o.raw for o in h.result.items]

        with client.batch() as b:
            q = b.add(f"x:{type_}/query", _args(filter=filter, sort=sort, limit=limit))
            g = b.add(f"x:{type_}/get", _args(ids=q.ref_ids(), properties=properties))
        return [o.raw for o in g.result.items]


def manage_query(
    type_: str,
    filter: dict | None = None,
    sort: list[dict] | None = None,
    position: int = 0,
    limit: int | None = None,
    anchor: str | None = None,
    *,
    client: ManagementClient | None = None,
) -> dict:
    """Returns ``{"ids", "total"}`` without fetching the objects, paging until ``limit``/exhausted.

    Pages by offset (``position``) unless the type is cursor-paginated or an ``anchor`` is given,
    in which case each page starts *after* that id — the anchor is exclusive, and the server
    ignores any offset alongside it.
    """

    client = client or get_management_client()

    ids: list[str] = []
    total: int | None = None
    page = client.capabilities.limits.max_objects_in_get
    by_cursor = type_ in _CURSOR_PAGINATED or anchor is not None
    cursor = anchor

    with _guarded(type_):
        while True:
            take = page if limit is None else min(page, limit - len(ids))
            paging = {"anchor": cursor} if by_cursor else {"position": position}
            with client.batch() as b:
                h = b.add(
                    f"x:{type_}/query",
                    _args(filter=filter, sort=sort, limit=take, calculateTotal=total is None, **paging),
                )
            result = h.result

            batch_ids = result.ids
            ids.extend(batch_ids)
            if total is None:
                total = result.total

            if by_cursor:
                cursor = batch_ids[-1] if batch_ids else cursor
            else:
                position += len(batch_ids)
            done = (
                not batch_ids
                or (total is not None and len(ids) >= total)
                or (limit is not None and len(ids) >= limit)
            )
            if done:
                break

    return {"ids": ids if limit is None else ids[:limit], "total": total}


def manage_find(
    type_: str,
    filter: dict,
    properties: list[str] | None = None,
    *,
    client: ManagementClient | None = None,
) -> dict | None:
    """Returns the first object matching ``filter``, or ``None``."""

    matches = manage_get_all(type_, filter=filter, limit=1, properties=properties, client=client)
    return matches[0] if matches else None


def manage_list_page(
    type_: str,
    filter: dict | None = None,
    sort: list[dict] | None = None,
    position: int = 0,
    limit: int | None = None,
    properties: list[str] | None = None,
    anchor: str | None = None,
    *,
    client: ManagementClient | None = None,
) -> dict:
    """Returns ``{"items", "total"}`` — one page of full objects in query order.

    Unlike ``manage_get_all`` (which fetches everything), this pages via ``position``/``limit``
    for large collections such as the queue, or via ``anchor`` for cursor-only ones such as the
    log, and preserves the query's ordering.
    """

    client = client or get_management_client()
    page = manage_query(
        type_, filter=filter, sort=sort, position=position, limit=limit, anchor=anchor, client=client
    )

    items: list[dict] = []
    if page["ids"]:
        with _guarded(type_):
            with client.batch() as b:
                h = b.add(
                    f"x:{type_}/get",
                    _args(ids=page["ids"], properties=_resolve_properties(type_, properties)),
                )
            by_id = {o["id"]: o.raw for o in h.result.items}
        items = [by_id[id] for id in page["ids"] if id in by_id]

    return {"items": items, "total": page["total"]}


def manage_set(
    type_: str,
    *,
    create: dict | None = None,
    update: dict | None = None,
    destroy: list[str] | None = None,
    client: ManagementClient | None = None,
) -> dict:
    """Runs chunked ``set`` calls and raises if the server reports any object it could not mutate.

    jmaplib refuses an oversized ``set`` instead of splitting it, so the payloads are chunked here
    by ``maxObjectsInSet`` before calling. Returns merged ``{"created", "updated", "destroyed"}``.
    """

    client = client or get_management_client()
    size = client.capabilities.limits.max_objects_in_set

    merged: dict = {"created": {}, "updated": [], "destroyed": []}
    calls: list[dict] = []
    for chunk in _chunk_dict(create or {}, size):
        calls.append({"create": chunk})
    for chunk in _chunk_dict(update or {}, size):
        calls.append({"update": chunk})
    for chunk in _chunks(list(destroy or []), size):
        calls.append({"destroy": chunk})

    with _guarded(type_):
        for call_args in calls:
            with client.batch() as b:
                h = b.add(f"x:{type_}/set", call_args)
            result = h.result

            for key, failures in (
                ("notCreated", result.not_created),
                ("notUpdated", result.not_updated),
                ("notDestroyed", result.not_destroyed),
            ):
                if failures:
                    _fail(type_, frappe.as_json({key: failures}))

            merged["created"].update({k: v.raw for k, v in result.created.items()})
            merged["updated"].extend(result.updated)
            merged["destroyed"].extend(result.destroyed)

    return merged


def manage_create(type_: str, obj: dict, *, client: ManagementClient | None = None) -> dict:
    """Creates one object and returns it including server-set fields."""

    return manage_set(type_, create={"0": obj}, client=client)["created"]["0"]


def manage_create_many(type_: str, objs: list[dict], *, client: ManagementClient | None = None) -> list[str]:
    """Creates objects in batches and returns their ids in the same order."""

    created = manage_set(type_, create={str(i): obj for i, obj in enumerate(objs)}, client=client)["created"]
    return [created[str(i)]["id"] for i in range(len(objs))]


def manage_update(type_: str, id: str, patch: dict, *, client: ManagementClient | None = None) -> None:
    """Applies a partial update. ``patch`` keys may be property names or JSON-pointer paths."""

    manage_set(type_, update={id: patch}, client=client)


def manage_update_many(
    type_: str, patches: dict[str, dict], *, client: ManagementClient | None = None
) -> None:
    """Applies partial updates to many objects (``{id: patch}``) in batches."""

    manage_set(type_, update=patches, client=client)


def manage_delete(type_: str, ids: str | list[str], *, client: ManagementClient | None = None) -> None:
    """Deletes one id or a list of ids in batches."""

    manage_set(type_, destroy=[ids] if isinstance(ids, str) else list(ids), client=client)


def manage_changes(type_: str, since_state: str, *, client: ManagementClient | None = None) -> dict:
    """Returns the ids changed since ``since_state`` for delta sync."""

    client = client or get_management_client()
    with _guarded(type_):
        with client.batch() as b:
            h = b.add(f"x:{type_}/changes", {"sinceState": since_state})
        result = h.result

    return {
        "created": result.created,
        "updated": result.updated,
        "destroyed": result.destroyed,
        "newState": result.new_state,
        "hasMoreChanges": result.has_more_changes,
    }


def set_aliases(type_: str, id: str, aliases: list[dict]) -> None:
    """Replaces the object's aliases with the given set (index-keyed map on the wire).

    Shared by types that carry an ``aliases`` map (accounts, groups, mailing lists).
    """

    manage_update(type_, id, {"aliases": {f"{idx}": alias for idx, alias in enumerate(aliases)}})


def _chunks(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def _chunk_dict(d: dict, size: int):
    keys = list(d)
    for i in range(0, len(keys), size):
        yield {k: d[k] for k in keys[i : i + size]}


# --- payload builders (the wire shapes the dataclasses used to produce) -----


def true_map(keys) -> dict:
    """A set-valued JMAP map: ``{key: True}``."""

    return {key: True for key in keys}


def credential_payload(secret: str) -> dict:
    return {"@type": "Password", "secret": secret}


def roles_union(role_ids: list[str] | None, empty_type: str = "User") -> dict:
    """The ``roles`` tagged union: custom ids when given, else the ``empty_type`` default.

    The union's ``@type`` discriminator can't be patched via a sub-path, so callers always
    replace the whole field with this value.
    """

    if role_ids:
        return {"@type": "Custom", "roleIds": true_map(dict.fromkeys(role_ids))}

    return {"@type": empty_type}


def email_alias(name: str, domain_id: str, enabled: bool = True, description: str | None = None) -> dict:
    return {"name": name, "domainId": domain_id, "enabled": enabled, "description": description}


def account_payload(
    name: str,
    domain_id: str,
    *,
    password: str | None = None,
    description: str | None = None,
    aliases: list[dict] | None = None,
    member_group_ids: list[str] | None = None,
    role_ids: list[str] | None = None,
    quota: int | None = None,
    locale: str | None = None,
    timezone: str | None = None,
) -> dict:
    """An ``x:Account`` create body for a user principal.

    ``credentials``, ``memberGroupIds`` and ``aliases`` are id-keyed maps on the wire, not arrays.
    """

    return {
        "@type": "User",
        "name": name,
        "domainId": domain_id,
        "credentials": {"0": credential_payload(password or random_string(20))},
        "memberGroupIds": true_map(member_group_ids or []),
        "roles": roles_union(role_ids),
        "permissions": {"@type": "Inherit"},
        "quotas": {"maxDiskQuota": quota} if quota is not None else {},
        "aliases": {f"{idx}": alias for idx, alias in enumerate(aliases or [])},
        "description": description,
        "locale": locale or DEFAULT_LOCALE,
        "timeZone": timezone,
        "encryptionAtRest": {"@type": "Disabled"},
    }


def group_payload(
    name: str,
    domain_id: str,
    *,
    description: str | None = None,
    role_ids: list[str] | None = None,
    aliases: list[dict] | None = None,
) -> dict:
    """An ``x:Account`` create body for a group principal.

    Groups carry no ``memberGroupIds`` — membership lives on each member account instead.
    """

    payload = {
        "@type": "Group",
        "name": name,
        "domainId": domain_id,
        "permissions": {"@type": "Inherit"},
        "quotas": {},
        "aliases": {f"{idx}": alias for idx, alias in enumerate(aliases or [])},
        "description": description,
    }

    if role_ids:
        payload["roles"] = roles_union(role_ids)

    return payload


def domain_payload(name: str, *, description: str | None = None) -> dict:
    """An ``x:Domain`` create body with the defaults the app has always used: manual certificates
    and DNS, automatic DKIM with both algorithms, sub-addressing enabled, no relaying."""

    return {
        "name": name,
        "aliases": {},
        "isEnabled": True,
        "description": description,
        "certificateManagement": {"@type": "Manual"},
        "dkimManagement": {
            "@type": "Automatic",
            "algorithms": {"Dkim1Ed25519Sha256": True, "Dkim1RsaSha256": True},
            "selectorTemplate": "v{version}-{algorithm}-{date-%Y%m%d}",
            "rotateAfter": 90 * 24 * 60 * 60 * 1000,
            "retireAfter": 7 * 24 * 60 * 60 * 1000,
            "deleteAfter": 30 * 24 * 60 * 60 * 1000,
        },
        "dnsManagement": {"@type": "Manual"},
        "catchAllAddress": None,
        "subAddressing": {"@type": "Enabled"},
        "allowRelaying": False,
        "reportAddressUri": "mailto:postmaster",
    }


def mailing_list_payload(
    name: str,
    domain_id: str,
    recipients: list[str] | None = None,
    description: str | None = None,
) -> dict:
    """An ``x:MailingList`` create body. ``recipients`` is a set-valued map keyed by recipient
    email address — internal or external (omitted when empty)."""

    payload = {"name": name, "domainId": domain_id, "description": description}
    if recipients:
        payload["recipients"] = true_map(recipients)

    return payload


def role_payload(
    description: str,
    role_ids: list[str] | None = None,
    enabled_permissions: list[str] | None = None,
    disabled_permissions: list[str] | None = None,
) -> dict:
    """An ``x:Role`` create body. The id and permission sets are id-keyed maps, not arrays."""

    return {
        "description": description,
        "roleIds": true_map(role_ids or []),
        "enabledPermissions": true_map(enabled_permissions or []),
        "disabledPermissions": true_map(disabled_permissions or []),
    }


def oauth_client_payload(
    client_id: str,
    *,
    description: str | None = None,
    contacts: list[str] | None = None,
    redirect_uris: list[str] | None = None,
    secret: str | None = None,
    logo: str | None = None,
    expires_at: str | None = None,
) -> dict:
    return {
        "clientId": client_id,
        "description": description,
        "contacts": true_map(contacts or []),
        "redirectUris": true_map(redirect_uris or []),
        "secret": secret,
        "logo": logo,
        "expiresAt": expires_at,
    }


def app_password_payload(description: str) -> dict:
    return {"description": description, "permissions": {"@type": "Inherit"}}


# --- resource helpers -------------------------------------------------------


def get_account_by_name(
    name: str, properties: list[str] | None = None, raise_exception: bool = True
) -> dict | None:
    """Returns the account with the given name, or ``None`` (throws if ``raise_exception``)."""

    account = manage_find("Account", {"name": name}, properties=properties or ["id"])
    if not account and raise_exception:
        frappe.throw(_("Account {0} not found on the Stalwart server.").format(name))

    return account


def get_domain_by_name(
    name: str, properties: list[str] | None = None, raise_exception: bool = True
) -> dict | None:
    """Returns the domain with the given name, or ``None`` (throws if ``raise_exception``)."""

    domain = manage_find("Domain", {"name": name}, properties=properties or ["id"])
    if not domain and raise_exception:
        frappe.throw(_("Domain {0} not found on the Stalwart server.").format(name))

    return domain


def get_role_by_description(
    description: str, properties: list[str] | None = None, raise_exception: bool = True
) -> dict | None:
    """Returns the role with the given description, or ``None`` (throws if ``raise_exception``)."""

    role = manage_find("Role", {"description": description}, properties=properties or ["id", "description"])
    if not role and raise_exception:
        frappe.throw(_("Role {0} not found on the Stalwart server.").format(description))

    return role


def _current_role_ids(account_id: str) -> list[str]:
    """Returns the account's currently assigned custom role ids."""

    roles = (manage_get("Account", account_id, properties=["roles"]) or {}).get("roles") or {}
    role_ids = roles.get("roleIds") or {}
    return list(role_ids.keys() if isinstance(role_ids, dict) else role_ids)


def set_account_roles(account_id: str, role_ids: list[str]) -> None:
    """Replaces the account's roles with the given ids (empty reverts to the default user role)."""

    manage_update("Account", account_id, {"roles": roles_union(role_ids)})


def add_account_roles(account_id: str, role_ids: list[str]) -> None:
    """Adds role ids to the account, keeping any it already has."""

    if role_ids:
        set_account_roles(account_id, [*_current_role_ids(account_id), *role_ids])


def remove_account_roles(account_id: str, role_ids: list[str]) -> None:
    """Removes the given role ids from the account."""

    if role_ids:
        remove = set(role_ids)
        set_account_roles(account_id, [r for r in _current_role_ids(account_id) if r not in remove])


def set_account_password(account_id: str, new_password: str) -> None:
    """Sets the account's primary password credential, leaving other credentials intact."""

    if not new_password:
        frappe.throw(_("New password cannot be empty."))

    credentials = (manage_get("Account", account_id, properties=["credentials"]) or {}).get(
        "credentials"
    ) or {}
    row_id = next((idx for idx, c in credentials.items() if c.get("@type") == "Password"), "0")

    manage_update("Account", account_id, {f"credentials/{row_id}/secret": new_password})


def get_all_groups(properties: list[str] | None = None) -> list[dict]:
    """Returns every group principal (groups share ``x:Account`` with users, discriminated by
    ``@type: "Group"``)."""

    return manage_get_all("Account", filter={"@type": "Group"}, properties=properties)


def get_group_members(group_id: str, properties: list[str] | None = None) -> list[dict]:
    """Returns the accounts that belong to the group.

    Membership lives on each member account's ``memberGroupIds``, not on the group itself.
    """

    return manage_get_all("Account", filter={"memberGroupIds": group_id}, properties=properties)


def add_group_members(group_id: str, account_ids: list[str]) -> None:
    """Adds the given accounts to the group by patching each account's membership."""

    for account_id in account_ids:
        manage_update("Account", account_id, {f"memberGroupIds/{group_id}": True})


def remove_group_members(group_id: str, account_ids: list[str]) -> None:
    """Removes the given accounts from the group by patching each account's membership."""

    for account_id in account_ids:
        manage_update("Account", account_id, {f"memberGroupIds/{group_id}": None})


def delete_groups(ids: str | list[str]) -> None:
    """Deletes groups, first clearing membership so the server's link check passes.

    Stalwart refuses to destroy a group while accounts still reference it as a member.
    """

    ids = [ids] if isinstance(ids, str) else list(ids)
    for group_id in ids:
        if member_ids := [m["id"] for m in get_group_members(group_id, properties=["id"])]:
            remove_group_members(group_id, member_ids)

    manage_delete("Account", ids)


def get_dkim_signatures_by_domain(domain_id: str, properties: list[str] | None = None) -> list[dict]:
    """Returns every DKIM signature linked to the given domain."""

    return manage_get_all("DkimSignature", filter={"domainId": domain_id}, properties=properties)


def delete_domains(ids: str | list[str]) -> None:
    """Deletes domains, first removing DKIM signatures that would block the delete.

    Stalwart refuses to delete a domain while DKIM signatures still reference it.
    """

    ids = [ids] if isinstance(ids, str) else list(ids)
    for domain_id in ids:
        if signature_ids := [s["id"] for s in get_dkim_signatures_by_domain(domain_id)]:
            manage_delete("DkimSignature", signature_ids)

    manage_delete("Domain", ids)


def get_mailing_list_addresses(mailing_list: dict, domain_names: dict[str, str]) -> list[str]:
    """Returns the list's primary address plus its enabled aliases, lowercased.

    Disabled aliases are skipped: the server stops routing mail to them, so an invitation sent to
    one would never reach the members either.
    """

    addresses = []
    if primary := (mailing_list.get("emailAddress") or "").lower():
        addresses.append(primary)

    for alias in (mailing_list.get("aliases") or {}).values():
        if not alias.get("enabled", True):
            continue

        name = alias.get("name")
        if name and (domain := domain_names.get(alias.get("domainId"))):
            addresses.append(f"{name}@{domain}".lower())

    return addresses


def get_mailing_list_address_index() -> dict[str, list[str]]:
    """Returns ``{list address: [recipient addresses]}`` for every list with recipients.

    A list is reachable at its primary address and at each of its enabled aliases, so all of
    them are indexed; the server resolves any of them to the same recipients.
    """

    domain_names = {d["id"]: d["name"] for d in get_domains()}
    index = {}
    for mailing_list in manage_get_all(
        "MailingList", properties=["id", "emailAddress", "aliases", "recipients"]
    ):
        recipients = sorted({r.lower() for r in (mailing_list.get("recipients") or {})})
        if not recipients:
            continue

        for address in get_mailing_list_addresses(mailing_list, domain_names):
            index[address] = recipients

    return index


def add_list_recipients(list_id: str, emails: list[str]) -> None:
    """Adds recipient addresses to a mailing list (read-merge-write of the recipients map)."""

    current = (manage_get("MailingList", list_id, properties=["recipients"]) or {}).get("recipients") or {}
    manage_update("MailingList", list_id, {"recipients": {**current, **true_map(emails)}})


def remove_list_recipients(list_id: str, emails: list[str]) -> None:
    """Removes recipient addresses from a mailing list (case-insensitive)."""

    remove = {e.lower() for e in emails}
    current = (manage_get("MailingList", list_id, properties=["recipients"]) or {}).get("recipients") or {}
    manage_update(
        "MailingList", list_id, {"recipients": {r: True for r in current if r.lower() not in remove}}
    )


def queue_retry(ids: list[str]) -> None:
    """Schedules the given queued messages for immediate delivery."""

    manage_update_many("QueuedMessage", {id: {"nextRetry": RETRY_NOW} for id in ids})


def run_action(action_type: str, params: dict | None = None) -> dict:
    """Executes a server management action and returns the created object, including any result.

    Actions are not queryable objects; running one is a ``set``/create whose created object
    carries any result (e.g. the DMARC troubleshooting outcome or the spam classification score).
    """

    return manage_create("Action", {"@type": action_type, **(params or {})})


# --- REST helpers (non-JMAP paths on the same authenticated client) ---------


def _schema() -> dict:
    """Fetches the server schema (labels + enum choices for the admin UI)."""

    response = get_management_client().http.get(urljoin(get_config("server_url"), "/api/schema"))
    response.raise_for_status()
    return response.json()


def get_delivery_token() -> str:
    """Mints a short-lived token for the live delivery trace endpoint."""

    response = get_management_client().http.get(urljoin(get_config("server_url"), "/api/token/delivery"))
    response.raise_for_status()
    return response.text


def iter_delivery_trace(target: str):
    """Relays Stalwart's live SMTP delivery trace for ``target`` as raw SSE byte chunks.

    A dedicated one-shot connection (never the pooled client) so a long-lived stream cannot pin
    the shared pool; closing the generator closes the upstream connection.
    """

    from urllib.parse import quote

    server_url, verify_ssl = get_config(("server_url", "verify_ssl"))
    token = get_delivery_token()
    url = urljoin(server_url, f"/api/live/delivery/{quote(target)}?token={quote(token)}")

    with httpx.stream(
        "GET", url, verify=bool(verify_ssl), timeout=httpx.Timeout(300.0, connect=10.0)
    ) as upstream:
        yield from (chunk for chunk in upstream.iter_raw() if chunk)


def download_message_blob(blob_id: str) -> bytes:
    """Downloads a queued message's raw RFC822 source via the session's download endpoint."""

    client = get_management_client()
    with _guarded("QueuedMessage"):
        return client.download(
            blob_id, name="message.eml", content_type="message/rfc822", account_id=client.default_account
        )


# --- cached lookups + resolvers ---------------------------------------------


@redis_cache(ttl=60)
def get_domains() -> list[dict]:
    """Returns all domains on the server (cached briefly)."""

    return manage_get_all(
        "Domain", properties=["id", "name", "description", "isEnabled", "createdAt", "dnsZoneFile"]
    )


@redis_cache(ttl=60)
def get_mailing_list_index() -> dict[str, list[str]]:
    """Returns ``{list address: [recipient addresses]}`` for every mailing list (cached briefly).

    Membership edits are visible once the cache expires; mail routing itself is unaffected, so the
    only window is between a membership change and the next calendar invitation.
    """

    return get_mailing_list_address_index()


@redis_cache(ttl=3600)
def get_permissions() -> list[dict]:
    """Returns all assignable permissions as ``{value, label}`` from the Stalwart server schema.

    The management API only carries raw permission keys; the server's schema endpoint provides the
    human-readable labels (version-accurate), so we read them from there.
    """

    permissions = (_schema().get("enums") or {}).get("Permission") or []
    return [{"value": p["name"], "label": p.get("label") or p["name"]} for p in permissions]


@redis_cache(ttl=3600)
def get_action_types() -> list[dict]:
    """Returns the executable server actions as ``{value, label, schema_name, options}`` from the schema.

    ``schema_name`` is set only for actions that take extra input (e.g. DMARC troubleshooting and
    spam classification); parameterless actions leave it ``None``. ``options`` holds the choices for
    each enum input of that schema, so a select can be rendered without restating the server's enums —
    which matters because the server is the only authority on the exact accepted values.
    """

    schema = _schema()
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

    enums = _schema().get("enums") or {}
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

    def labels(items: list[dict]) -> dict:
        return {i["name"]: i.get("label") or i["name"] for i in items}

    enums = _schema().get("enums") or {}
    return {"events": labels(enums.get("EventType") or []), "levels": labels(enums.get("TracingLevel") or [])}


@redis_cache(ttl=3600)
def get_queue_metadata() -> dict:
    """Returns the enum/variant option lists used to render and edit queued messages.

    All values come from the server schema so labels stay version-accurate: message flags, recipient
    status types, delivery error types and expiry types (each as ``{value, label}``).
    """

    schema = _schema()

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
    return manage_get_all("Role", filter=filter, properties=["id", "description"])


def resolve_domain_id(name: str, raise_exception: bool = True) -> str | None:
    """Resolves a domain name to its Stalwart id."""

    domain = get_domain_by_name(name, raise_exception=raise_exception)
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
    name, _sep, domain = alias.partition("@")
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

    domain_id = get_domain_by_name(domain, raise_exception=True)["id"]

    email_aliases = []
    domain_ids = {domain: domain_id}
    for alias in aliases or []:
        if not alias:
            continue

        alias_name, alias_domain = _resolve_alias(alias)
        if alias_domain not in domain_ids:
            domain_ids[alias_domain] = get_domain_by_name(alias_domain, raise_exception=True)["id"]

        email_aliases.append(email_alias(alias_name, domain_ids[alias_domain]))

    member_group_ids = [
        get_account_by_name(group, raise_exception=True)["id"] for group in groups or [] if group
    ]

    account = account_payload(
        name=name,
        domain_id=domain_id,
        password=password or random_string(12),
        description=description,
        aliases=email_aliases,
        member_group_ids=member_group_ids,
        role_ids=resolve_role_ids(roles),
        quota=quota,
        locale=locale,
        timezone=timezone,
    )

    return manage_create("Account", account)["id"]


def create_app_password(account: str, description: str | None = None) -> str:
    """Creates an app password for ``account`` and returns the generated secret.

    Returns the secret rather than the id because the server only exposes it at creation time.
    """

    description = description or f"App Password for {frappe.local.site} - {utcnow()}"
    created = manage_create(
        "AppPassword", app_password_payload(description), client=get_account_management_client(account)
    )

    secret = created.get("secret")
    if not secret:
        frappe.throw(_("The Stalwart server did not return a generated app password secret."))

    return secret


def update_password(user: str | None = None, new_password: str | None = None) -> None:
    """Sets the password of the user's personal Stalwart account (no-op if they have none)."""

    if not user or not new_password:
        frappe.throw(_("User and new password are required to update the Stalwart password."))

    if account := get_user_personal_jmap_account(user, raise_exception=False):
        set_account_password(account, new_password)


def delete_account(user: str) -> None:
    """Deletes the user's personal Stalwart account (no-op if they have none)."""

    if account := get_user_personal_jmap_account(user, raise_exception=False):
        manage_delete("Account", account)


def add_account_role(user: str, role: str) -> None:
    """Applies a role (by description) to the user's personal account (no-op if they have none)."""

    if account := get_user_personal_jmap_account(user, raise_exception=False):
        role_id = get_role_by_description(role, raise_exception=True)["id"]
        add_account_roles(account, [role_id])


def remove_account_role(user: str, role: str) -> None:
    """Removes a role (by description) from the user's personal account (no-op if they have none)."""

    if account := get_user_personal_jmap_account(user, raise_exception=False):
        role_id = get_role_by_description(role, raise_exception=True)["id"]
        remove_account_roles(account, [role_id])
