import time
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal
from urllib.parse import urljoin
from uuid import uuid7

import frappe
import httpx
from cachetools import TTLCache
from frappe import _
from frappe.utils import cint
from frappe.utils.caching import request_cache
from jmap import AuthenticationError, Id, MethodError, RequestError, SetError, TransportError
from jmap.auth import BasicAuth
from jmap.batch import (
    MISSING_RESPONSE,
    NoAccountError,
    ReadOnlyAccountError,
    all_mutations_guarded,
    is_mutating,
)
from jmap.blobs import UploadResult
from jmap.capabilities.mail import MailCapability, SubmissionCapability
from jmap.client import JMAPClient
from jmap.core.errors import CapabilityFieldError, CapabilityNotSupportedError
from jmap.core.retry import RetryPolicy
from jmap.core.session import Session
from jmap.defaults import default_registry
from jmap.models.responses import SetResponse

from suite.mail.doctype.user_account.user_account import get_user_for_jmap_account
from suite.mail.store import Entity, get_data_store
from suite.mail.utils import get_config, log_mail_error
from suite.utils.user import is_system_manager

# Gateway statuses a reverse proxy returns when the JMAP server behind it is down or overloaded,
# and the rate limit a retry did not clear: all of them "try again shortly", none a bug here.
UNAVAILABLE_STATUS_CODES = (429, 502, 503, 504)


class MailServerUnavailableError(Exception):
    """The JMAP server could not be reached (connection refused, DNS failure, timeout) or an
    upstream gateway reported it down.

    ``http_status_code`` makes Frappe respond with 503 instead of a generic 500, so clients can
    distinguish "the mail server is temporarily down" from an application bug and show a friendly
    message. The original transport exception is always chained for diagnosis.
    """

    http_status_code = 503
    #: Whether the failure proves the request did nothing on the server: the connection was never
    #: made, or the server turned the request away unread (429). False is "it may have" - a
    #: timeout, a dropped connection, a gateway's 502/503/504 (see never_applied).
    not_applied = False

    def __init__(
        self, message: str = "The mail server is temporarily unavailable.", *, not_applied: bool = False
    ) -> None:
        super().__init__(message)
        self.not_applied = not_applied


def invalidate_jmap_identities_cache(account: str) -> None:
    """Invalidates every JMAP identities cache (in-process TTL + LMDB store) for the account."""

    _lookup_cache.pop(("identities", account), None)
    store = get_data_store(account)
    store.delete_all(Entity.IDENTITY)


def invalidate_jmap_mailboxes_cache(account: str) -> None:
    """Invalidates every JMAP mailboxes cache (in-process TTL + LMDB store) for the account."""

    _lookup_cache.pop(("mailboxes", account), None)
    store = get_data_store(account)
    store.delete_all(Entity.MAILBOX)


def get_identities(account: str) -> list[dict]:
    """Returns the list of identities for the specified account."""

    user = get_user_for_jmap_account(account, raise_exception=True)

    return [
        {
            "name": f"{account}|{i['id']}",
            "account": account,
            "user": user,
            "id": i["id"],
            "_name": i["name"],
            "email": i["email"].lower(),
            "bcc": [{"display_name": b["name"], "email": b["email"].lower()} for b in i.get("bcc") or []],
            "reply_to": [
                {"display_name": r["name"], "email": r["email"].lower()} for r in i.get("replyTo") or []
            ],
            "html_signature": i["htmlSignature"],
            "text_signature": i["textSignature"],
            "may_delete": cint(i["mayDelete"]),
        }
        for i in get_cached_identities(account)
    ]


def get_participant_identities(account: str) -> list[dict]:
    """Returns the list of participant identities for the specified account."""

    user = get_user_for_jmap_account(account, raise_exception=True)

    return [
        {
            "name": f"{account}|{i['id']}",
            "account": account,
            "user": user,
            "id": i["id"],
            "_name": i["name"],
            "email": i["calendarAddress"].lower().replace("mailto:", ""),
            "default": cint(bool(i["isDefault"])),
        }
        for i in get_cached_participant_identities(account)
    ]


def get_identity_id_by_email(account: str, email: str, raise_exception: bool = False) -> str | None:
    """Returns the identity ID for the specified email address, or None if not found."""

    for identity in get_cached_identities(account):
        if identity["email"].lower() == email.lower():
            return identity["id"]

    if raise_exception:
        raise ValueError(f"No identity found for email: {email}")


def get_mailboxes(account: str) -> list[dict]:
    """Returns the list of mailboxes for the specified account."""

    user = get_user_for_jmap_account(account, raise_exception=True)

    return [
        {
            "name": f"{account}|{m['id']}",
            "account": account,
            "user": user,
            "id": m["id"],
            "role": m["role"],
            "_name": m["name"],
            "_parent": f"{account}|{m['parentId']}" if m.get("parentId") else None,
            "parent_id": m["parentId"],
            "subscribed": m["isSubscribed"],
        }
        for m in get_cached_mailboxes(account)
    ]


def get_mailbox_id_by_role(
    account: str,
    role: str,
    create_if_not_exists: bool = False,
    raise_exception: bool = False,
) -> str | None:
    """Returns the mailbox ID for the specified role, or None if not found. Optionally creates the mailbox if it does not exist."""

    def find_id() -> str | None:
        wanted = role.lower()
        for mailbox in get_cached_mailboxes(account):
            if (mailbox.get("role") or "").lower() == wanted:
                return mailbox["id"]

    if mailbox_id := find_id():
        return mailbox_id

    if not create_if_not_exists:
        if raise_exception:
            raise ValueError(f"No mailbox found with role '{role}'")
        return None

    client = get_account_client(account)
    with client.batch() as b:
        h = b.mail.mailbox.set(
            create={str(uuid7()): {"name": role.title(), "role": role, "isSubscribed": True}}
        )

    if h.result.not_created and raise_exception:
        raise ValueError(f"Failed to create mailbox with role '{role}'")

    invalidate_jmap_mailboxes_cache(account)
    return find_id()


def get_mailbox_role_by_id(account: str, id: str, raise_exception: bool = False) -> str | None:
    """Returns the mailbox role for the specified mailbox ID, or None if not found."""

    for mailbox in get_cached_mailboxes(account):
        if mailbox["id"] == id:
            return mailbox["role"]

    if raise_exception:
        raise ValueError(f"No mailbox found with ID '{id}'")


def get_mailbox_name_by_id(account: str, id: str, raise_exception: bool = False) -> str | None:
    """Returns the mailbox name for the specified mailbox ID, or None if not found."""

    for mailbox in get_cached_mailboxes(account):
        if id and mailbox["id"] == id:
            return mailbox["name"]

    if raise_exception:
        raise ValueError(f"No mailbox found with ID '{id}'")


def get_mailbox_id_by_name(account: str, name: str, raise_exception: bool = False) -> str | None:
    """Returns the mailbox ID for the specified mailbox name, or None if not found."""

    for mailbox in get_cached_mailboxes(account):
        if name and mailbox["name"] == name:
            return mailbox["id"]

    if raise_exception:
        raise ValueError(f"No mailbox found with name '{name}'")


def get_default_address_book_id(account: str, raise_exception: bool = False) -> str | None:
    """Returns the ID of the default address book for the specified account, or None if not found."""

    for address_book in get_cached_address_books(account):
        if address_book.get("isDefault"):
            return address_book["id"]

    if raise_exception:
        raise ValueError("No default address book found.")


def get_default_calendar_id(account: str, raise_exception: bool = False) -> str | None:
    """Returns the ID of the default calendar for the specified account, or None if not found."""

    for calendar in get_cached_calendars(account):
        if calendar.get("isDefault"):
            return calendar["id"]

    if raise_exception:
        raise ValueError("No default calendar found.")


@frappe.whitelist()
def get_user_accounts(user: str) -> list[str]:
    """Returns a list of account names for the specified user."""

    if user != frappe.session.user and not is_system_manager(frappe.session.user):
        frappe.throw(
            _("Not permitted to view accounts for user {0}.").format(frappe.bold(user)),
            frappe.PermissionError,
        )

    from suite.mail.doctype.user_account.user_account import get_user_jmap_accounts

    return get_user_jmap_accounts(user)


@frappe.whitelist()
def get_user_account_ids(user: str) -> list[str]:
    """Returns the JMAP account IDs the specified user has access to."""

    if user != frappe.session.user and not is_system_manager(frappe.session.user):
        frappe.throw(
            _("Not permitted to view accounts for user {0}.").format(frappe.bold(user)),
            frappe.PermissionError,
        )

    from suite.mail.doctype.user_account.user_account import get_user_jmap_accounts

    return get_user_jmap_accounts(user)


@frappe.whitelist()
def get_mailboxes_for_account(account: str) -> list[dict]:
    """Returns the list of mailboxes for the specified account."""

    return get_mailboxes(account)


def format_jmap_error(error: dict | None) -> str:
    """Returns a readable message for a JMAP error object.

    Only `type` is mandatory on a JMAP error object; `description` is optional and may be null,
    so never index into it directly.
    """

    error = error or {}

    return error.get("description") or error.get("type") or _("An unknown error occurred.")


# ---------------------------------------------------------------------------
# jmaplib client glue
# ---------------------------------------------------------------------------

DEFAULT_TIMEOUT: tuple[float, float] = (30.0, 60.0)
EXCHANGE_TIMEOUT: tuple[float, float] = (60.0, 180.0)

# One retry, for what cannot be done twice: a read, or a write every mutation of which a literal
# ifInState guards. A Retry-After past a few seconds is not waited out, since that would park the
# web worker holding the request.
RETRY_POLICY = RetryPolicy(max_attempts=2, max_retry_after=5.0)
# Any other write goes out once. jmaplib counts a 429 or a 503 as "never reached the server" and
# would re-send it, but a proxy can answer 503 after it forwarded the request - and a mail
# submitted twice is worse than one reported as failed.
NO_RETRY = RetryPolicy(max_attempts=1)

# What a call can be refused with, short of the transport failing: by the server (a method
# error) or by jmaplib before anything is sent - a limit the account advertises, a read-only
# account, a method or account the session does not offer.
JMAP_REFUSALS = (
    MethodError,
    CapabilityFieldError,
    CapabilityNotSupportedError,
    ReadOnlyAccountError,
    NoAccountError,
)

# Method errors after which the call may nonetheless have been applied: `serverPartialFail` (RFC
# 8620 §3.6.2, the one error after which server state may have changed) and the two jmaplib
# raises itself, for an answer it could not read and for a call the server left unanswered.
MAYBE_APPLIED_ERRORS = ("serverPartialFail", "malformedResult", MISSING_RESPONSE)

# The httpx failures after which nothing can have been sent: the same three jmaplib counts as
# "the connection never established" (jmap.client), a URL httpx will not open at all, and a proxy
# that refused the tunnel (httpcore raises ProxyError only for a CONNECT or SOCKS handshake that
# failed, before the request is written).
NEVER_SENT = (
    httpx.ConnectError,
    httpx.ConnectTimeout,
    httpx.PoolTimeout,
    httpx.UnsupportedProtocol,
    httpx.ProxyError,
)

# How long a failed JMAP Account sync is left alone (seconds), so that one which keeps failing is
# not run, and logged, by every request.
SYNC_BACK_OFF = 5 * 60

MAIL_URN = "urn:ietf:params:jmap:mail"
SUBMISSION_URN = "urn:ietf:params:jmap:submission"

# Same shape the old CoreService class cache had: shared across requests in one process,
# keyed per account so the data is reused by every user with access to the account.
_lookup_cache: TTLCache = TTLCache(maxsize=100_000, ttl=60 * 60)

# Named rather than left to the server: Stalwart's default set leaves out `isVisible`, which
# read as every calendar being hidden.
CALENDAR_PROPERTIES = [
    "id",
    "name",
    "description",
    "color",
    "timeZone",
    "sortOrder",
    "isDefault",
    "isSubscribed",
    "isVisible",
    "includeInAvailability",
    "myRights",
    "shareWith",
]


def omit_none(**kwargs) -> dict:
    """Keyword arguments minus the Nones.

    Stalwart rejects an explicit ``null`` for arguments like ``filter`` with ``notRequest``;
    the old transport dropped None arguments entirely, so callers splat this instead of
    passing a possibly-None value straight to a batch call.
    """

    return {k: v for k, v in kwargs.items() if v is not None}


class SuiteHTTPClient(httpx.Client):
    """An httpx.Client that remembers why its last request failed.

    jmaplib reports a failed API call as a bare TransportError, without the httpx error behind
    it - and that error is what tells a request that never left from one the server may have
    acted on (see translated_errors).
    """

    last_error: Exception | None = None

    def send(self, request: httpx.Request, **kwargs) -> httpx.Response:
        self.last_error = None
        try:
            return super().send(request, **kwargs)
        except Exception as e:
            self.last_error = e
            raise


@contextmanager
def translated_errors(http: httpx.Client | None = None) -> Iterator[None]:
    """Translate transport-level failures into MailServerUnavailableError (HTTP 503).

    Gateway statuses mean the JMAP server behind a reverse proxy is down, not that the
    request was bad. AuthenticationError deliberately passes through: bad credentials are
    a configuration problem, not "the mail server is down".

    `http` is the client the requests go through. jmaplib chains the httpx error it wraps on
    the session, upload and download paths but not on an API call; a SuiteHTTPClient supplies
    it there.
    """

    try:
        yield
    except TransportError as e:
        cause = e.__cause__ or getattr(http, "last_error", None)
        if isinstance(cause, httpx.UnsupportedProtocol):
            # A server URL httpx cannot speak to is a misconfiguration, not an outage.
            raise
        raise MailServerUnavailableError(not_applied=isinstance(cause, NEVER_SENT)) from e
    except RequestError as e:
        if e.status in UNAVAILABLE_STATUS_CODES:
            raise MailServerUnavailableError(not_applied=e.status == 429) from e
        raise


def never_applied(error: Exception) -> bool:
    """Whether `error`, raised by a request that was to change something, proves it changed
    nothing - so that sending it again cannot do the work twice.

    True when the request never left (jmaplib refused it, the connection was never made, the URL
    cannot be opened), the server turned it away without running it (bad credentials, a 4xx
    problem, a rate limit), or the call was answered with a method error, which leaves the server
    as it was (but see MAYBE_APPLIED_ERRORS). Anything else leaves it open: a timeout or a dropped
    connection after the bytes went out, and a 5xx - a gateway's 502, 503 or 504 included, which
    it can answer after it forwarded the request.
    """

    if isinstance(error, MethodError):
        return error.type not in MAYBE_APPLIED_ERRORS
    if isinstance(error, MailServerUnavailableError):
        return error.not_applied
    if isinstance(error, RequestError):
        return error.status is not None and error.status < 500
    if isinstance(error, TransportError):
        # translated_errors lets one through only for a URL that cannot be opened.
        return True

    refused_unsent = (CapabilityFieldError, CapabilityNotSupportedError, ReadOnlyAccountError, NoAccountError)
    return isinstance(error, (AuthenticationError, httpx.InvalidURL, *refused_unsent))


def maybe_applied(error: Exception) -> bool:
    """Whether `error` is the mail server, or the way to it, failing in a manner that leaves open
    whether the request was applied. False for an error never_applied vouches for - and for one
    that is not about the server at all, such as a bug on this side."""

    about_the_server = (MethodError, MailServerUnavailableError, RequestError, TransportError)
    return isinstance(error, about_the_server) and not never_applied(error)


class SuiteJMAPClient(JMAPClient):
    """JMAPClient that speaks Frappe: 503 translation on every request, and Redis session
    upkeep (re-cache + JMAP Account resync) when the server reports a new session state."""

    user: str | None = None
    #: When the JMAP Account sync a session refresh owes may be tried again (time.time()), after
    #: one that failed; None when none is owed. Shared by the peers, and kept with the cached
    #: session for the requests that follow.
    sync_owed_after: float | None = None
    #: This client and every account view made from it, which share one session: a refresh on
    #: any of them is a refresh for all. get_jmap_client and account_view keep the list.
    peers: list[SuiteJMAPClient] | tuple[SuiteJMAPClient, ...] = ()

    def execute(self, batch, *, extra_using: frozenset[str] = frozenset()) -> None:
        policy = self.retry_policy
        if is_mutating(batch, self.capabilities) and not all_mutations_guarded(batch, self.capabilities):
            self.retry_policy = NO_RETRY
        try:
            with translated_errors(self.http):
                super().execute(batch, extra_using=extra_using)
        finally:
            self.retry_policy = policy

        # The batch is answered and its handles are resolved: a refresh or a sync that fails must
        # not turn an applied write into a failure the caller retries. A session that could not
        # be refreshed stays marked stale, so the next call tries again.
        try:
            if self.session_stale:
                self._refresh_and_sync()
            elif self.sync_owed_after is not None and time.time() >= self.sync_owed_after:
                self._sync_accounts()
        except Exception:
            log_mail_error("Failed to refresh the JMAP session", frappe.get_traceback(with_context=True))

    def upload(self, content: bytes, **kwargs) -> UploadResult:
        with translated_errors():
            return super().upload(content, **kwargs)

    def download(self, blob_id: str, **kwargs) -> bytes:
        with translated_errors():
            return super().download(blob_id, **kwargs)

    def _refresh_and_sync(self) -> None:
        with translated_errors():
            self.refresh_session()

        # Move the peers on too, or each would notice the same change on its next call and
        # fetch the session and resync the accounts again in its turn.
        for peer in self.peers:
            if peer is not self:
                peer.session = self.session
                peer.capabilities = peer.registry.resolve(
                    self.session, peer.default_account, experimental=True
                )
                peer.session_stale = False

        if self.user:
            self._sync_accounts()

    def _sync_accounts(self) -> None:
        """Brings the JMAP Account documents in line with the session, and caches the session.

        The session state only changes when the set of accounts available to the user changes
        on the server, so after a refresh the local documents may be stale. A sync that fails
        stays owed: the session is cached all the same - it is good, and need not be fetched by
        every request - together with the time from which the sync may be tried again.

        When another run is already syncing for the user, the outcome is that run's to record:
        caching from here would put "nothing owed" over the mark of a sync that failed there.
        """

        # Lazy import to avoid a circular dependency (jmap_account -> suite.mail.jmap).
        from suite.mail.doctype.jmap_account.jmap_account import sync_jmap_accounts

        owed_after = None
        try:
            if not sync_jmap_accounts(self.user, self.session.raw.get("accounts") or {}):
                return
        except Exception:
            owed_after = time.time() + SYNC_BACK_OFF
            log_mail_error("Failed to sync the JMAP accounts", frappe.get_traceback(with_context=True))

        for peer in self.peers or (self,):
            peer.sync_owed_after = owed_after
        store_cached_session(self.user, self.session, sync_owed_after=owed_after)


@request_cache
def get_jmap_client(
    user: str,
    ignore_permissions: bool = False,
    timeout: tuple[float, float] = DEFAULT_TIMEOUT,
    allow_disabled: bool = False,
) -> SuiteJMAPClient:
    """Returns an authenticated JMAP client for the user, reviving the Redis-cached session
    when possible so no discovery round trip is made.

    Cached per request so the many helpers that resolve a client for the same user reuse one
    instance (and skip the repeated password decryption / session parsing).
    ``allow_disabled`` is for server-side cleanup that must still reach the mail server on
    behalf of a user who has just been disabled; requests never pass it.
    """

    if not ignore_permissions:
        if user != frappe.session.user and not is_system_manager(frappe.session.user):
            frappe.throw(
                _("You do not have permission to access the JMAPConnection for user {0}.").format(
                    frappe.bold(user)
                ),
                frappe.PermissionError,
            )

    enabled = frappe.get_cached_value("User", user, "enabled")
    if enabled is None or (not enabled and not allow_disabled):
        frappe.throw(_("User {0} does not exist or is disabled.").format(frappe.bold(user)))

    settings = frappe.db.exists("User Settings", {"user": user, "username": ["!=", None]})
    if not settings:
        frappe.throw(_("User {0} does not have JMAP settings configured.").format(frappe.bold(user)))

    user_settings = frappe.get_cached_doc("User Settings", settings)
    server_url, verify_ssl = get_config(("server_url", "verify_ssl"))

    auth = BasicAuth(user_settings.username, user_settings.get_password("app_password"))
    connect_timeout, read_timeout = timeout
    http = SuiteHTTPClient(
        follow_redirects=True,
        auth=auth,
        verify=bool(verify_ssl),
        timeout=httpx.Timeout(
            connect=connect_timeout, read=read_timeout, write=read_timeout, pool=connect_timeout
        ),
    )
    session_url = urljoin(server_url, "/.well-known/jmap")

    try:
        if cached := get_cached_session(user):
            session = Session.from_wire(cached)
            registry = default_registry()
            account = session.primary_account_for("urn:ietf:params:jmap:core")
            client = SuiteJMAPClient(
                session,
                registry.resolve(session, account, experimental=True),
                http,
                registry=registry,
                retry_policy=RETRY_POLICY,
                default_account=account,
                owns_http=True,
                session_url=session_url,
                experimental=True,
            )
            client.sync_owed_after = cached.get("accountSyncOwedAfter")
        else:
            with translated_errors():
                client = SuiteJMAPClient.connect(
                    session_url,
                    auth=auth,
                    http=http,
                    experimental=True,
                    retry_policy=RETRY_POLICY,
                )
            store_cached_session(user, client.session)
    except Exception:
        http.close()
        raise

    client.user = user
    client.peers = [client]
    return client


@request_cache
def get_account_client(
    account: str, ignore_permissions: bool = False, timeout: tuple[float, float] = DEFAULT_TIMEOUT
) -> SuiteJMAPClient:
    """Returns a JMAP client scoped to the given account (calls default to its accountId)."""

    user = get_user_for_jmap_account(account, raise_exception=True)
    return account_view(
        get_jmap_client(user, ignore_permissions=ignore_permissions, timeout=timeout), account
    )


def account_view(client: SuiteJMAPClient, account: str) -> SuiteJMAPClient:
    """Re-scopes a client to another account, sharing its session and HTTP pool."""

    view = SuiteJMAPClient(
        client.session,
        client.registry.resolve(client.session, Id(account), experimental=True),
        client.http,
        registry=client.registry,
        retry_policy=client.retry_policy,
        default_account=Id(account),
        owns_http=False,
        session_url=client.session_url,
        experimental=True,
    )
    view.user = client.user
    view.sync_owed_after = client.sync_owed_after
    if not isinstance(client.peers, list):
        client.peers = [client]
    client.peers.append(view)
    view.peers = client.peers
    return view


# -- Redis session cache ---------------------------------------------------


def get_cached_session(user: str) -> dict | None:
    """Returns the cached JMAP session document for the user, if any."""

    return frappe.cache.hget("jmap:sessions", user)


def store_cached_session(user: str, session: Session, sync_owed_after: float | None = None) -> None:
    """Caches the session document with absolutized endpoint URLs so it can be revived
    offline (`Session.from_wire` without a base_url does not resolve relative URLs).
    `sync_owed_after` travels with it: see SuiteJMAPClient.sync_owed_after."""

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
    # A revived session's document is the cached one, mark and all: set or cleared, never kept.
    doc.pop("accountSyncOwedAfter", None)
    if sync_owed_after is not None:
        doc["accountSyncOwedAfter"] = sync_owed_after
    frappe.cache.hset("jmap:sessions", user, doc)


def clear_jmap_session(user: str) -> None:
    """Drops the cached JMAP session for the user."""

    frappe.cache.hdel("jmap:sessions", user)


# -- error formatting -------------------------------------------------------


def format_set_error(error: SetError | dict | None) -> str:
    """Readable message for a per-object /set failure (typed SetError or raw wire dict)."""

    if isinstance(error, SetError):
        return error.description or error.type or _("An unknown error occurred.")

    error = error or {}
    return error.get("description") or error.get("type") or _("An unknown error occurred.")


def format_method_error(error: Exception) -> str:
    """Readable message for any of JMAP_REFUSALS: a method-level error, or a request jmaplib
    refused before sending - because it breaks a limit the server advertises (a name too long for
    maxSizeMailboxName, say), or aims at a read-only account or a method the session lacks."""

    if isinstance(error, CapabilityFieldError):
        return _("{0}: the server allows {1}, {2} was requested.").format(
            error.field, error.advertised, error.requested
        )

    if isinstance(error, MethodError):
        return error.arguments.get("description") or error.type or _("An unknown error occurred.")

    # jmaplib's own text names account ids, methods and capability URNs: for the log, not the
    # user. The refusals a user can run into are noted; anything else is an error to look at.
    expected = {
        ReadOnlyAccountError: _("This account is read-only."),
        NoAccountError: _("This account is not available on the mail server."),
        CapabilityNotSupportedError: _("The mail server does not support this action."),
    }
    for refusal, message in expected.items():
        if isinstance(error, refusal):
            frappe.logger("mail").info(f"JMAP call refused before sending: {error}")
            return message

    log_mail_error("JMAP call refused before sending", str(error))
    return _("An unknown error occurred.")


def get_set_error_message(
    response: SetResponse, kind: Literal["create", "update", "destroy"], key: str
) -> str:
    """Readable message for a failed object in a /set response.

    The per-object error is not guaranteed to be keyed by the id we asked about, so fall
    back to the first error of that kind before giving up.
    """

    errors = {
        "create": response.not_created,
        "update": response.not_updated,
        "destroy": response.not_destroyed,
    }[kind]
    return format_set_error(errors.get(key) or next(iter(errors.values()), None))


# -- cached lookups ---------------------------------------------------------


def get_cached_identities(account: str) -> list[dict]:
    """Raw identity objects for the account, TTL-cached across requests."""

    client = get_account_client(account)  # permission gates run even on a cache hit
    if value := _lookup_cache.get(("identities", account)):
        return value

    with client.batch() as b:
        h = b.submission.identity.get()

    value = [i.to_wire() for i in h.result.items]
    _lookup_cache[("identities", account)] = value
    return value


def get_cached_mailboxes(account: str) -> list[dict]:
    """Raw mailbox objects for the account, TTL-cached across requests."""

    client = get_account_client(account)  # permission gates run even on a cache hit
    if value := _lookup_cache.get(("mailboxes", account)):
        return value

    with client.batch() as b:
        h = b.mail.mailbox.get()

    value = [m.to_wire() for m in h.result.items]
    _lookup_cache[("mailboxes", account)] = value
    return value


def has_cached_identities(account: str) -> bool:
    return bool(_lookup_cache.get(("identities", account)))


def has_cached_mailboxes(account: str) -> bool:
    return bool(_lookup_cache.get(("mailboxes", account)))


@request_cache
def get_cached_address_books(account: str) -> list[dict]:
    """Raw address book objects for the account, cached for the current request."""

    client = get_account_client(account)
    with client.batch() as b:
        h = b.contacts.address_book.get()

    return [a.to_wire() for a in h.result.items]


@request_cache
def get_cached_calendars(account: str) -> list[dict]:
    """Raw calendar objects for the account, cached for the current request."""

    client = get_account_client(account)
    with client.batch() as b:
        h = b.calendars.calendar.get(properties=CALENDAR_PROPERTIES)

    return [c.to_wire() for c in h.result.items]


@request_cache
def get_cached_participant_identities(account: str) -> list[dict]:
    """Raw participant identity objects for the account, cached for the current request."""

    client = get_account_client(account)
    with client.batch() as b:
        h = b.calendars.participant_identity.get()

    return [p.to_wire() for p in h.result.items]


def get_default_participant_identity(account: str, raise_exception: bool = False) -> str | None:
    """Returns the email (mailto: stripped) of the default participant identity."""

    for identity in get_cached_participant_identities(account):
        if identity.get("isDefault"):
            return identity["calendarAddress"].lower().replace("mailto:", "")

    if raise_exception:
        raise ValueError("No default participant identity found.")


# -- bulk /set + blob helpers ------------------------------------------------


@dataclass
class SetResult:
    """Merged outcome of a chunked /set."""

    created: dict[str, Any] = field(default_factory=dict)
    updated: dict[str, Any] = field(default_factory=dict)
    destroyed: list[str] = field(default_factory=list)
    not_created: dict[str, dict] = field(default_factory=dict)
    not_updated: dict[str, dict] = field(default_factory=dict)
    not_destroyed: dict[str, dict] = field(default_factory=dict)

    def absorb(self, response: SetResponse) -> None:
        self.created.update(response.created)
        self.updated.update(response.updated)
        self.destroyed.extend(response.destroyed)
        self.not_created.update(response.not_created)
        self.not_updated.update(response.not_updated)
        self.not_destroyed.update(response.not_destroyed)


def chunked_set(
    client: SuiteJMAPClient,
    run: Callable[[Any, Any], Any],
    items: dict | list,
    chunk_size: int | None = None,
) -> SetResult:
    """Runs a /set over `items` in chunks the server accepts.

    jmaplib refuses a /set larger than maxObjectsInSet instead of splitting it, so bulk
    callers chunk here. `run(batch, chunk)` must queue exactly one /set for the chunk and
    return its handle; `items` is a dict (create/update payloads) or a list (destroy ids).
    When a chunk raises, the exception carries the merged outcome of the chunks before it as
    `applied`.
    """

    size = chunk_size or client.capabilities.limits.max_objects_in_set
    chunks = chunk_dict(items, size) if isinstance(items, dict) else chunk_list(items, size)

    result = SetResult()
    for chunk in chunks:
        try:
            with client.batch() as b:
                handle = run(b, chunk)
            result.absorb(handle.result)
        except Exception as e:
            # The chunks before this one are applied. The error travels with what they did
            # (`applied`), so a caller can report a partial outcome rather than a total failure.
            e.applied = result
            raise

    return result


def chunked_get(
    client: SuiteJMAPClient,
    run: Callable[[Any, list], Any],
    ids: list,
    chunk_size: int | None = None,
) -> list:
    """Runs a /get over `ids` in separate per-chunk requests and concatenates the items.

    jmaplib auto-chunks an oversized /get but refuses to merge chunks whose type states
    differ (TornReadError); the bulk read/export paths keep the old client's semantics
    instead — a concurrent mailbox change must not abort a large read.
    """

    size = chunk_size or client.capabilities.limits.max_objects_in_get
    items: list = []
    for chunk in chunk_list(list(ids), size):
        with client.batch() as b:
            handle = run(b, chunk)
        items.extend(handle.result.items)

    return items


def get_across_accounts(
    client: SuiteJMAPClient, accounts: list[str], run: Callable[[Any, Id], Any]
) -> dict[str, list[dict] | None]:
    """`<type>/get` for each of several accounts, in as few requests as the server allows.

    JMAP takes method calls addressed to different accounts in one request, so this costs
    one round trip however many accounts there are, not one each (jmaplib cuts the batch at
    maxCallsInRequest). `run(batch, account_id)` must queue one /get addressed to the account
    (pass ``accountId=account_id``) and return its handle. Keyed by account; `None` where the
    server refused the call, as it does for an account whose objects of this type the user
    has no access to.
    """

    with client.batch() as b:
        handles = {account: run(b, Id(account)) for account in accounts}

    return {
        account: None if h.error else [item.to_wire() for item in h.result.items]
        for account, h in handles.items()
    }


def get_email_state(client: SuiteJMAPClient) -> str | None:
    """The server's current Email state for the client's account, read via an empty /get.

    The state is what Email/changes diffs against; a refused call yields None.
    """

    with client.batch() as b:
        h = b.mail.email.get(ids=[], properties=["id"])

    return None if h.error else h.result.state


def chunk_list(items: list, size: int) -> Iterator[list]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def chunk_dict(d: dict, size: int) -> Iterator[dict]:
    keys = list(d)
    for i in range(0, len(keys), size):
        yield {k: d[k] for k in keys[i : i + size]}


def upload_blobs(
    client: SuiteJMAPClient,
    blobs: list[tuple[bytes, str | None]],
    account_id: str | None = None,
) -> list[UploadResult]:
    """Uploads (content, content_type) pairs concurrently; results keep input order."""

    if not blobs:
        return []

    if len(blobs) == 1:
        content, content_type = blobs[0]
        return [client.upload(content, content_type=content_type, account_id=account_id)]

    results: list = [None] * len(blobs)
    max_workers = client.capabilities.limits.max_concurrent_upload
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(client.upload, content, content_type=content_type, account_id=account_id): i
            for i, (content, content_type) in enumerate(blobs)
        }
        for future in as_completed(futures):
            results[futures[future]] = future.result()

    return results


def download_blobs(
    client: SuiteJMAPClient,
    blobs: list[tuple[str, str | None]],
    account_id: str | None = None,
) -> dict[str, bytes]:
    """Downloads (blob_id, name) pairs concurrently; returns blob_id -> content."""

    if len(blobs) == 1:
        blob_id, name = blobs[0]
        return {blob_id: client.download(blob_id, name=name or "blob", account_id=account_id)}

    results = {}
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {
            executor.submit(client.download, blob_id, name=name or "blob", account_id=account_id): blob_id
            for blob_id, name in blobs
        }
        for future in as_completed(futures):
            results[futures[future]] = future.result()

    return results


# -- send pipeline -----------------------------------------------------------

# RFC 3676. MailQueue guarantees the text body is encoded this way, generated or supplied.
# delsp=no keeps the space at a soft break, which is the word separator the reader rejoins on.
TEXT_PLAIN_FLOWED = "text/plain; format=flowed; delsp=no"


def build_email_draft(
    *,
    from_email: str,
    recipients: list[dict],
    draft_mailbox_id: str,
    queue_name: str,
    from_name: str | None = None,
    subject: str | None = None,
    sent_at: str | None = None,
    message_id: str | None = None,
    reply_to: list[dict] | None = None,
    in_reply_to: str | None = None,
    headers: list[dict] | None = None,
    text_body: str | None = None,
    html_body: str | None = None,
    attachments: list[dict] | None = None,
) -> dict:
    """Builds an Email/set create payload for a draft.

    `recipients` rows carry type ("to"/"cc"/"bcc"), name, email; `attachments` rows carry
    name, type, cid, blob_id, disposition; `reply_to` rows carry name, email.
    """

    from jmap.models.mail.create import validate_email_create

    from suite import __version__
    from suite.mail.utils.dt import to_utc_z

    draft = {
        "mailboxIds": {draft_mailbox_id: True},
        "keywords": {"$draft": True, "$seen": True},
        "from": [{"name": from_name, "email": from_email}],
    }

    for kind in ("to", "cc", "bcc"):
        if rcpts := [{"name": r.get("name"), "email": r["email"]} for r in recipients if r["type"] == kind]:
            draft[kind] = rcpts

    if subject:
        draft["subject"] = subject

    if sent_at:
        # Mail Queue's sent_at holds system time; Stalwart wants the UTC ``...Z`` form.
        draft["sentAt"] = to_utc_z(sent_at)
    if message_id:
        draft["header:Message-ID"] = f"<{message_id}>"

    draft.update(
        {
            "header:User-Agent": f"Frappe Mail v{__version__} (Frappe v{frappe.__version__})",
            "header:X-Mailer": "Frappe Mail",
            "header:X-Mail-Queue": queue_name,
        }
    )

    if reply_to:
        # The parsed property, like From and To: the server writes the header, so an address
        # without a name, or a name with quotes or commas in it, comes out well formed.
        draft["replyTo"] = [{"name": r.get("name"), "email": r["email"]} for r in reply_to]

    if in_reply_to:
        draft["header:In-Reply-To"] = f"<{in_reply_to}>"

    for header in headers or []:
        draft[f"header:{header['name']}"] = header["value"]

    draft["bodyValues"] = {}
    text_part = html_part = None

    if text_body:
        # The parameters ride in `type` because that string is written to the header
        # verbatim. They are only legal inside `bodyStructure`: reached through the
        # `textBody` convenience property the server demands `type` be exactly
        # "text/plain", and setting `header:Content-Type` on a part gets it a second
        # Content-Type rather than replacing the one the server builds.
        text_part = {"partId": "text", "type": TEXT_PLAIN_FLOWED}
        draft["bodyValues"]["text"] = {"value": text_body, "charset": "utf-8", "isTruncated": False}

    if html_body:
        html_part = {"partId": "html", "type": "text/html"}
        draft["bodyValues"]["html"] = {"value": html_body, "charset": "utf-8", "isTruncated": False}

    attachments = attachments or []
    inline_attachments = [a for a in attachments if a["disposition"] == "inline"]
    regular_attachments = [a for a in attachments if a["disposition"] != "inline"]
    body_parts = [p for p in (text_part, html_part) if p]

    if not body_parts:
        if attachments:
            draft["attachments"] = [_attachment_body_part(a) for a in attachments]
        validate_email_create(draft)
        return draft

    # The structure is always spelled out rather than left to the convenience properties,
    # because the text part's Content-Type parameters only survive this way.
    body_root = (
        {"type": "multipart/alternative", "subParts": body_parts} if len(body_parts) > 1 else body_parts[0]
    )

    if inline_attachments:
        # Inline images are referenced from the HTML body via `cid:` URLs. Nesting them in
        # a `multipart/related` container beside the body, rather than leaving them as
        # siblings in `multipart/mixed`, is what marks them inline: some providers (e.g.
        # AWS) treat every `multipart/mixed` part as a regular attachment and reject
        # inline images by extension.
        body_root = {
            "type": "multipart/related",
            "subParts": [body_root, *(_attachment_body_part(a) for a in inline_attachments)],
        }

    if regular_attachments:
        body_root = {
            "type": "multipart/mixed",
            "subParts": [body_root, *(_attachment_body_part(a) for a in regular_attachments)],
        }

    draft["bodyStructure"] = body_root
    validate_email_create(draft)
    return draft


def _attachment_body_part(attachment: dict) -> dict:
    """EmailBodyPart payload for an attachment row."""

    return {
        "name": attachment["name"],
        "type": attachment["type"],
        "cid": attachment["cid"],
        "blobId": attachment["blob_id"],
        "disposition": attachment["disposition"],
    }


def build_submission_envelope(
    from_email: str,
    rcpt_emails: set[str] | list[str],
    envelope_id: str,
    priority: int,
    hold_until: int | None = None,
) -> dict:
    """SMTP envelope for a submission; `hold_until` (epoch seconds) adds the RFC 4865
    HOLDUNTIL parameter so the server holds delivery."""

    parameters = {
        "RET": "FULL",
        "ENVID": envelope_id,
        "MT-PRIORITY": str(priority),
    }

    if hold_until:
        # RFC 4865 requires an RFC 3339 date-time; Stalwart >= 0.16.17 rejects epoch seconds.
        parameters["HOLDUNTIL"] = datetime.fromtimestamp(hold_until, tz=UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

    return {
        "mailFrom": {"email": from_email, "parameters": parameters},
        "rcptTo": [
            {
                "email": rcpt,
                "parameters": {"NOTIFY": "DELAY,FAILURE", "ORCPT": f"rfc822;{rcpt}"},
            }
            for rcpt in sorted(set(rcpt_emails))
        ],
    }


def get_mail_capability(client: SuiteJMAPClient, account: str) -> MailCapability:
    """What the account says about its mail: the limits jmaplib's ``check_*`` helpers take."""

    return MailCapability.of(client.session.capability_value(MAIL_URN, Id(account)))


def check_delayed_send(delay: float, max_delay: int) -> None:
    """Throws when a message may not be held for `delay` seconds by a server that holds one for
    at most `max_delay` (see get_max_delayed_send)."""

    if delay <= max_delay:
        return

    if not max_delay:
        frappe.throw(_("This mail server doesn't support scheduled sending."))

    frappe.throw(_("Send At cannot be more than {0} in the future.").format(_spoken_duration(max_delay)))


def _spoken_duration(seconds: int) -> str:
    """A limit in the largest unit that says it exactly: "30 days", "25 hours", "30 seconds"."""

    units = (
        (86400, _("day"), _("days")),
        (3600, _("hour"), _("hours")),
        (60, _("minute"), _("minutes")),
        (1, _("second"), _("seconds")),
    )
    for unit, singular, plural in units:
        if seconds % unit == 0:
            count = seconds // unit
            return f"{count} {singular if count == 1 else plural}"


def get_max_delayed_send(client: SuiteJMAPClient, account: str) -> int:
    """Maximum delay in seconds allowed for a FUTURERELEASE (RFC 4865) submission: 30 days
    when the server does not say, and 0 when it says it cannot hold a message at all."""

    capability = SubmissionCapability.of(client.session.capability_value(SUBMISSION_URN, Id(account)))
    return 2_592_000 if capability.max_delayed_send is None else capability.max_delayed_send
