import time
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Literal
from urllib.parse import urljoin

import frappe
import httpx
from cachetools import TTLCache
from frappe import _
from frappe.utils import cint
from frappe.utils.caching import request_cache
from jmap import Id, MethodError, RequestError, SetError, TransportError
from jmap.auth import BasicAuth
from jmap.blobs import UploadResult
from jmap.client import JMAPClient
from jmap.core.retry import RetryPolicy
from jmap.core.session import Session
from jmap.defaults import default_registry
from jmap.models.responses import SetResponse

from suite.mail.doctype.user_account.user_account import get_user_for_jmap_account
from suite.mail.jmap.connection import (
    UNAVAILABLE_STATUS_CODES,
    JMAPConnection,
    JMAPConnectionInfo,
    JMAPSessionManager,
    MailServerUnavailableError,
)
from suite.mail.jmap.services.blob.blob import BlobService
from suite.mail.jmap.services.calendars.calendar import CalendarService
from suite.mail.jmap.services.calendars.calendar_event import CalendarEventService
from suite.mail.jmap.services.calendars.calendar_event_notification import CalendarEventNotificationService
from suite.mail.jmap.services.calendars.participant_identity import ParticipantIdentityService
from suite.mail.jmap.services.contacts.address_book import AddressBookService
from suite.mail.jmap.services.contacts.contact_card import ContactCardService
from suite.mail.jmap.services.core import CoreService
from suite.mail.jmap.services.mail.email import EmailService
from suite.mail.jmap.services.mail.identity import IdentityService
from suite.mail.jmap.services.mail.mailbox import MailboxService
from suite.mail.jmap.services.mail.submission.email_submission import EmailSubmissionService
from suite.mail.jmap.services.mail.thread import ThreadService
from suite.mail.jmap.services.principals.principal import PrincipalService
from suite.mail.jmap.services.push_subscription import PushSubscriptionService
from suite.mail.jmap.services.quota.quota import QuotaService
from suite.mail.jmap.services.sieve.sieve_script import SieveScriptService
from suite.mail.jmap.services.vacationresponse.vacation_response import VacationResponseService
from suite.mail.jmap.services.websocket.websocket import WebSocketService
from suite.mail.store import Entity, get_data_store
from suite.mail.utils import get_config
from suite.utils.user import is_system_manager


@request_cache
def get_jmap_connection(
    user: str, ignore_permissions: bool = False, timeout: tuple[float, float] = (30.0, 60.0)
) -> JMAPConnection:
    """Returns a JMAPConnection instance for the specified user, using the user's settings for connection details.

    Cached per request so the many service factories that resolve a connection for the same
    user reuse one instance (and skip the repeated password decryption / session lookup).
    """

    if not ignore_permissions:
        if user != frappe.session.user and not is_system_manager(frappe.session.user):
            frappe.throw(
                _("You do not have permission to access the JMAPConnection for user {0}.").format(
                    frappe.bold(user)
                ),
                frappe.PermissionError,
            )

    if not frappe.get_cached_value("User", user, "enabled"):
        frappe.throw(_("User {0} does not exist or is disabled.").format(frappe.bold(user)))

    settings = frappe.db.exists("User Settings", {"user": user, "username": ["!=", None]})
    if not settings:
        frappe.throw(_("User {0} does not have JMAP settings configured.").format(frappe.bold(user)))

    user_settings = frappe.get_cached_doc("User Settings", settings)
    server_url, verify_ssl = get_config(("server_url", "verify_ssl"))

    return JMAPConnection(
        JMAPConnectionInfo(
            server_url,
            user_settings.username,
            user_settings.get_password("app_password"),
            timeout,
            verify_ssl=bool(verify_ssl),
        ),
        session_manager=get_jmap_session_manager(user),
        user=user,
    )


def get_jmap_session_manager(user) -> JMAPSessionManager:
    """Returns a JMAPSessionManager instance for the specified user, using the data store for session management."""

    return JMAPSessionManager(
        get_session=lambda: frappe.cache.hget("jmap:sessions", user),
        set_session=lambda session: frappe.cache.hset("jmap:sessions", user, session),
        clear_session=lambda: frappe.cache.hdel("jmap:sessions", user),
    )


def get_address_book_service(
    account: str,
    ignore_permissions: bool = False,
) -> AddressBookService:
    """Returns an instance of AddressBookService for the specified account."""

    user = get_user_for_jmap_account(account, raise_exception=True)
    connection = get_jmap_connection(user, ignore_permissions=ignore_permissions)
    return AddressBookService(account, connection)


def get_core_service(
    account: str,
    ignore_permissions: bool = False,
) -> CoreService:
    """Returns an instance of CoreService for the specified account."""

    user = get_user_for_jmap_account(account, raise_exception=True)
    connection = get_jmap_connection(user, ignore_permissions=ignore_permissions)
    return CoreService(account, connection)


def get_blob_service(
    account: str,
    ignore_permissions: bool = False,
) -> BlobService:
    """Returns an instance of BlobService for handling blob-related operations for the specified account."""

    user = get_user_for_jmap_account(account, raise_exception=True)
    connection = get_jmap_connection(user, ignore_permissions=ignore_permissions)
    return BlobService(account, connection)


def get_calendar_event_notification_service(
    account: str,
    ignore_permissions: bool = False,
) -> CalendarEventNotificationService:
    """Returns an instance of CalendarEventNotificationService for handling calendar event notification-related operations for the specified account."""

    user = get_user_for_jmap_account(account, raise_exception=True)
    connection = get_jmap_connection(user, ignore_permissions=ignore_permissions)
    return CalendarEventNotificationService(account, connection)


def get_calendar_event_service(
    account: str,
    ignore_permissions: bool = False,
) -> CalendarEventService:
    """Returns an instance of CalendarEventService for handling calendar event-related operations for the specified account."""

    user = get_user_for_jmap_account(account, raise_exception=True)
    connection = get_jmap_connection(user, ignore_permissions=ignore_permissions)
    return CalendarEventService(account, connection)


def get_calendar_service(
    account: str,
    ignore_permissions: bool = False,
) -> CalendarService:
    """Returns an instance of CalendarService for handling calendar-related operations for the specified account."""

    user = get_user_for_jmap_account(account, raise_exception=True)
    connection = get_jmap_connection(user, ignore_permissions=ignore_permissions)
    return CalendarService(account, connection)


def get_contact_card_service(
    account: str,
    ignore_permissions: bool = False,
) -> ContactCardService:
    """Returns an instance of ContactCardService for handling contact card-related operations for the specified account."""

    user = get_user_for_jmap_account(account, raise_exception=True)
    connection = get_jmap_connection(user, ignore_permissions=ignore_permissions)
    return ContactCardService(account, connection)


def get_email_service(
    account: str,
    ignore_permissions: bool = False,
) -> EmailService:
    """Returns an instance of EmailService for handling email-related operations for the specified account."""

    user = get_user_for_jmap_account(account, raise_exception=True)
    connection = get_jmap_connection(user, ignore_permissions=ignore_permissions)
    return EmailService(account, connection)


def get_email_submission_service(
    account: str,
    ignore_permissions: bool = False,
) -> EmailSubmissionService:
    """Returns an instance of EmailSubmissionService for handling email submission-related operations for the specified account."""

    user = get_user_for_jmap_account(account, raise_exception=True)
    connection = get_jmap_connection(user, ignore_permissions=ignore_permissions)
    return EmailSubmissionService(account, connection)


def get_identity_service(
    account: str,
    ignore_permissions: bool = False,
) -> IdentityService:
    """Returns an instance of IdentityService for handling identity-related operations for the specified account."""

    user = get_user_for_jmap_account(account, raise_exception=True)
    connection = get_jmap_connection(user, ignore_permissions=ignore_permissions)
    return IdentityService(account, connection)


def get_mailbox_service(
    account: str,
    ignore_permissions: bool = False,
) -> MailboxService:
    """Returns an instance of MailboxService for handling mailbox-related operations for the specified account."""

    user = get_user_for_jmap_account(account, raise_exception=True)
    connection = get_jmap_connection(user, ignore_permissions=ignore_permissions)
    return MailboxService(account, connection)


def get_participant_identity_service(
    account: str,
    ignore_permissions: bool = False,
) -> ParticipantIdentityService:
    """Returns an instance of ParticipantIdentityService for handling participant identity-related operations for the specified account."""

    user = get_user_for_jmap_account(account, raise_exception=True)
    connection = get_jmap_connection(user, ignore_permissions=ignore_permissions)
    return ParticipantIdentityService(account, connection)


def get_principal_service(
    account: str,
    ignore_permissions: bool = False,
) -> PrincipalService:
    """Returns an instance of PrincipalService for handling principal-related operations for the specified account."""

    user = get_user_for_jmap_account(account, raise_exception=True)
    connection = get_jmap_connection(user, ignore_permissions=ignore_permissions)
    return PrincipalService(account, connection)


def get_push_subscription_service(
    user: str,
    ignore_permissions: bool = False,
) -> PushSubscriptionService:
    """Returns an instance of PushSubscriptionService for handling push subscription-related operations for the specified user."""

    connection = get_jmap_connection(user, ignore_permissions=ignore_permissions)
    return PushSubscriptionService(connection)


def get_quota_service(
    account: str,
    ignore_permissions: bool = False,
) -> QuotaService:
    """Returns an instance of QuotaService for handling quota-related operations for the specified account."""

    user = get_user_for_jmap_account(account, raise_exception=True)
    connection = get_jmap_connection(user, ignore_permissions=ignore_permissions)
    return QuotaService(account, connection)


def get_sieve_script_service(
    account: str,
    ignore_permissions: bool = False,
) -> SieveScriptService:
    """Returns an instance of SieveScriptService for handling sieve script-related operations for the specified account."""

    user = get_user_for_jmap_account(account, raise_exception=True)
    connection = get_jmap_connection(user, ignore_permissions=ignore_permissions)
    return SieveScriptService(account, connection)


def get_thread_service(
    account: str,
    ignore_permissions: bool = False,
) -> ThreadService:
    """Returns an instance of ThreadService for handling thread-related operations for the specified account."""

    user = get_user_for_jmap_account(account, raise_exception=True)
    connection = get_jmap_connection(user, ignore_permissions=ignore_permissions)
    return ThreadService(account, connection)


def get_vacation_response_service(
    account: str,
    ignore_permissions: bool = False,
) -> VacationResponseService:
    """Returns an instance of VacationResponseService for handling vacation response-related operations for the specified account."""

    user = get_user_for_jmap_account(account, raise_exception=True)
    connection = get_jmap_connection(user, ignore_permissions=ignore_permissions)
    return VacationResponseService(account, connection)


def get_websocket_service(
    account: str,
    ignore_permissions: bool = False,
) -> WebSocketService:
    """Returns an instance of WebSocketService for handling WebSocket-related operations for the specified account."""

    user = get_user_for_jmap_account(account, raise_exception=True)
    connection = get_jmap_connection(user, ignore_permissions=ignore_permissions)
    return WebSocketService(account, connection)


def invalidate_jmap_identities_cache(account: str) -> None:
    """Invalidates every JMAP identities cache (in-process TTL + LMDB store) for the account."""

    _lookup_cache.pop(("identities", account), None)
    CoreService.invalidate_cache(account, "identities")
    store = get_data_store(account)
    store.delete_all(Entity.IDENTITY)


def invalidate_jmap_mailboxes_cache(account: str) -> None:
    """Invalidates every JMAP mailboxes cache (in-process TTL + LMDB store) for the account."""

    _lookup_cache.pop(("mailboxes", account), None)
    CoreService.invalidate_cache(account, "mailboxes")
    store = get_data_store(account)
    store.delete_all(Entity.MAILBOX)


def get_identities(account: str) -> list[dict]:
    """Returns the list of identities for the specified account."""

    user = get_user_for_jmap_account(account, raise_exception=True)
    connection = get_jmap_connection(user)
    service = IdentityService(account, connection)

    identities = [
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
        for i in service.identities
    ]

    return identities


def get_participant_identities(account: str) -> list[dict]:
    """Returns the list of participant identities for the specified account."""

    user = get_user_for_jmap_account(account, raise_exception=True)
    connection = get_jmap_connection(user)
    service = ParticipantIdentityService(account, connection)

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
        for i in service.get()
    ]


def get_identity_id_by_email(account: str, email: str, raise_exception: bool = False) -> str | None:
    """Returns the identity ID for the specified email address, or None if not found."""

    user = get_user_for_jmap_account(account, raise_exception=True)
    connection = get_jmap_connection(user)
    service = IdentityService(account, connection)
    return service.get_identity_id_by_email(email, raise_exception=raise_exception)


def get_mailboxes(account: str) -> list[dict]:
    """Returns the list of mailboxes for the specified account."""

    user = get_user_for_jmap_account(account, raise_exception=True)
    connection = get_jmap_connection(user)
    service = MailboxService(account, connection)

    mailboxes = [
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
        for m in service.mailboxes
    ]

    return mailboxes


def get_mailbox_id_by_role(
    account: str,
    role: str,
    create_if_not_exists: bool = False,
    raise_exception: bool = False,
) -> str | None:
    """Returns the mailbox ID for the specified role, or None if not found. Optionally creates the mailbox if it does not exist."""

    user = get_user_for_jmap_account(account, raise_exception=True)
    connection = get_jmap_connection(user)
    service = MailboxService(account, connection)
    return service.get_mailbox_id_by_role(
        role, create_if_not_exists=create_if_not_exists, raise_exception=raise_exception
    )


def get_mailbox_role_by_id(account: str, id: str, raise_exception: bool = False) -> str | None:
    """Returns the mailbox role for the specified mailbox ID, or None if not found."""

    user = get_user_for_jmap_account(account, raise_exception=True)
    connection = get_jmap_connection(user)
    service = MailboxService(account, connection)
    return service.get_mailbox_role_by_id(id, raise_exception=raise_exception)


def get_mailbox_name_by_id(account: str, id: str, raise_exception: bool = False) -> str | None:
    """Returns the mailbox name for the specified mailbox ID, or None if not found."""

    user = get_user_for_jmap_account(account, raise_exception=True)
    connection = get_jmap_connection(user)
    service = MailboxService(account, connection)
    return service.get_mailbox_name_by_id(id, raise_exception=raise_exception)


def get_mailbox_id_by_name(account: str, name: str, raise_exception: bool = False) -> str | None:
    """Returns the mailbox ID for the specified mailbox name, or None if not found."""

    user = get_user_for_jmap_account(account, raise_exception=True)
    connection = get_jmap_connection(user)
    service = MailboxService(account, connection)
    return service.get_mailbox_id_by_name(name, raise_exception=raise_exception)


def get_default_address_book_id(account: str, raise_exception: bool = False) -> str | None:
    """Returns the ID of the default address book for the specified account, or None if not found."""

    user = get_user_for_jmap_account(account, raise_exception=True)
    connection = get_jmap_connection(user)
    service = AddressBookService(account, connection)
    return service.get_default(raise_exception=raise_exception)


def get_default_calendar_id(account: str, raise_exception: bool = False) -> str | None:
    """Returns the ID of the default calendar for the specified account, or None if not found."""

    user = get_user_for_jmap_account(account, raise_exception=True)
    connection = get_jmap_connection(user)
    service = CalendarService(account, connection)
    return service.get_default(raise_exception=raise_exception)


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


def get_jmap_set_error_message(response: dict, not_done_key: str, id: str) -> str:
    """Returns a readable message for a failed JMAP `set` call.

    A `set` can fail per object (reported under `not_done_key`, keyed by the object id) or at the
    method level (reported under `error`), and neither is guaranteed to be present — nor is the
    per-object error guaranteed to be keyed by the id we asked about — so every source is probed
    before falling back to a generic message.
    """

    not_done = response.get(not_done_key) or {}
    error = not_done.get(id) or next(iter(not_done.values()), None) or response.get("error")

    return format_jmap_error(error)


# ---------------------------------------------------------------------------
# jmaplib-based client glue. Everything below replaces the service/model layer
# above; the classes and factories above are kept only until every consumer is
# migrated, then deleted.
# ---------------------------------------------------------------------------

DEFAULT_TIMEOUT: tuple[float, float] = (30.0, 60.0)
EXCHANGE_TIMEOUT: tuple[float, float] = (60.0, 180.0)

SUBMISSION_URN = "urn:ietf:params:jmap:submission"

# Same shape the old CoreService class cache had: shared across requests in one process,
# keyed per account so the data is reused by every user with access to the account.
_lookup_cache: TTLCache = TTLCache(maxsize=100_000, ttl=60 * 60)


@contextmanager
def translated_errors() -> Iterator[None]:
    """Translate transport-level failures into MailServerUnavailableError (HTTP 503).

    Gateway statuses mean the JMAP server behind a reverse proxy is down, not that the
    request was bad. AuthenticationError deliberately passes through: bad credentials are
    a configuration problem, not "the mail server is down".
    """

    try:
        yield
    except TransportError as e:
        raise MailServerUnavailableError() from e
    except httpx.HTTPError as e:
        # The blob endpoints call httpx directly, so connect/timeout errors surface raw.
        raise MailServerUnavailableError() from e
    except RequestError as e:
        if e.status in UNAVAILABLE_STATUS_CODES:
            raise MailServerUnavailableError() from e
        raise


class SuiteJMAPClient(JMAPClient):
    """JMAPClient that speaks Frappe: 503 translation on every request, and Redis session
    upkeep (re-cache + JMAP Account resync) when the server reports a new session state."""

    user: str | None = None

    def execute(self, batch, *, extra_using: frozenset[str] = frozenset()) -> None:
        with translated_errors():
            super().execute(batch, extra_using=extra_using)
        if self.session_stale:
            self._refresh_and_sync()

    def upload(self, content: bytes, **kwargs) -> UploadResult:
        with translated_errors():
            return super().upload(content, **kwargs)

    def download(self, blob_id: str, **kwargs) -> bytes:
        with translated_errors():
            return super().download(blob_id, **kwargs)

    def _refresh_and_sync(self) -> None:
        with translated_errors():
            self.refresh_session()

        # refresh_session() re-resolves without experimental=True, silently dropping the
        # calendars namespace — redo the resolution with the opt-in.
        self.capabilities = self.registry.resolve(self.session, self.default_account, experimental=True)

        if not self.user:
            return

        store_cached_session(self.user, self.session)

        # Lazy import to avoid a circular dependency (jmap_account -> suite.mail.jmap).
        from suite.mail.doctype.jmap_account.jmap_account import sync_jmap_accounts

        # The session state only changes when the set of accounts available to the user
        # changes on the server, so the local JMAP Account documents may be stale.
        sync_jmap_accounts(self.user, self.session.raw.get("accounts") or {})


@request_cache
def get_jmap_client(
    user: str, ignore_permissions: bool = False, timeout: tuple[float, float] = DEFAULT_TIMEOUT
) -> SuiteJMAPClient:
    """Returns an authenticated JMAP client for the user, reviving the Redis-cached session
    when possible so no discovery round trip is made.

    Cached per request so the many helpers that resolve a client for the same user reuse one
    instance (and skip the repeated password decryption / session parsing).
    """

    if not ignore_permissions:
        if user != frappe.session.user and not is_system_manager(frappe.session.user):
            frappe.throw(
                _("You do not have permission to access the JMAPConnection for user {0}.").format(
                    frappe.bold(user)
                ),
                frappe.PermissionError,
            )

    if not frappe.get_cached_value("User", user, "enabled"):
        frappe.throw(_("User {0} does not exist or is disabled.").format(frappe.bold(user)))

    settings = frappe.db.exists("User Settings", {"user": user, "username": ["!=", None]})
    if not settings:
        frappe.throw(_("User {0} does not have JMAP settings configured.").format(frappe.bold(user)))

    user_settings = frappe.get_cached_doc("User Settings", settings)
    server_url, verify_ssl = get_config(("server_url", "verify_ssl"))

    auth = BasicAuth(user_settings.username, user_settings.get_password("app_password"))
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
                retry_policy=RetryPolicy(max_attempts=1),
                default_account=account,
                owns_http=True,
                session_url=session_url,
            )
        else:
            with translated_errors():
                client = SuiteJMAPClient.connect(
                    session_url,
                    auth=auth,
                    http=http,
                    experimental=True,
                    retry_policy=RetryPolicy(max_attempts=1),
                )
            store_cached_session(user, client.session)
    except Exception:
        http.close()
        raise

    client.user = user
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
    )
    view.user = client.user
    return view


# -- Redis session cache ---------------------------------------------------


def get_cached_session(user: str) -> dict | None:
    """Returns the cached JMAP session document for the user, if any."""

    return frappe.cache.hget("jmap:sessions", user)


def store_cached_session(user: str, session: Session) -> None:
    """Caches the session document with absolutized endpoint URLs so it can be revived
    offline (`Session.from_wire` without a base_url does not resolve relative URLs)."""

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


def format_method_error(error: MethodError) -> str:
    """Readable message for a method-level JMAP error."""

    return error.arguments.get("description") or error.type or _("An unknown error occurred.")


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
        h = b.calendars.calendar.get()

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
    """

    size = chunk_size or client.capabilities.limits.max_objects_in_set
    chunks = chunk_dict(items, size) if isinstance(items, dict) else chunk_list(items, size)

    result = SetResult()
    for chunk in chunks:
        with client.batch() as b:
            handle = run(b, chunk)
        result.absorb(handle.result)

    return result


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
        draft["header:Reply-To"] = ", ".join(f'"{r.get("name")}" <{r["email"]}>' for r in reply_to)

    if in_reply_to:
        draft["header:In-Reply-To"] = f"<{in_reply_to}>"

    for header in headers or []:
        draft[f"header:{header['name']}"] = header["value"]

    draft["bodyValues"] = {}
    text_part = html_part = None

    if text_body:
        text_part = {"partId": "text", "type": "text/plain"}
        draft["bodyValues"]["text"] = {"value": text_body, "charset": "utf-8", "isTruncated": False}

    if html_body:
        html_part = {"partId": "html", "type": "text/html"}
        draft["bodyValues"]["html"] = {"value": html_body, "charset": "utf-8", "isTruncated": False}

    attachments = attachments or []
    inline_attachments = [a for a in attachments if a["disposition"] == "inline"]
    regular_attachments = [a for a in attachments if a["disposition"] != "inline"]
    body_parts = [p for p in (text_part, html_part) if p]

    if inline_attachments and body_parts:
        # Inline images are referenced from the HTML body via `cid:` URLs. Build an
        # explicit MIME structure that nests them inside a `multipart/related` container
        # (next to the body) instead of letting them become plain siblings of the body in
        # `multipart/mixed`. Some providers (e.g. AWS) treat every `multipart/mixed` part
        # as a regular attachment and reject inline images by extension, whereas clients
        # like Gmail wrap them in `multipart/related` so they are recognized as inline.
        body_root = (
            {"type": "multipart/alternative", "subParts": body_parts}
            if len(body_parts) > 1
            else body_parts[0]
        )

        body_structure = {
            "type": "multipart/related",
            "subParts": [body_root, *(_attachment_body_part(a) for a in inline_attachments)],
        }

        if regular_attachments:
            body_structure = {
                "type": "multipart/mixed",
                "subParts": [body_structure, *(_attachment_body_part(a) for a in regular_attachments)],
            }

        draft["bodyStructure"] = body_structure
    else:
        # No inline images: let the server assemble the structure from the convenience
        # properties (`multipart/alternative` for the body, `multipart/mixed` for attachments).
        if text_part:
            draft["textBody"] = [text_part]
        if html_part:
            draft["htmlBody"] = [html_part]
        if attachments:
            draft["attachments"] = [_attachment_body_part(a) for a in attachments]

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
        parameters["HOLDUNTIL"] = str(hold_until)

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


def get_max_delayed_send(client: SuiteJMAPClient, account: str) -> int:
    """Maximum delay in seconds allowed for a FUTURERELEASE (RFC 4865) submission,
    defaulting to 30 days."""

    caps = client.session.capability_value(SUBMISSION_URN, Id(account))
    return int(caps.get("maxDelayedSend") or 2_592_000)
