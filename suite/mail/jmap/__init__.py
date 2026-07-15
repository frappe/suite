from typing import Any

import frappe
from frappe import _
from frappe.utils import cint
from frappe.utils.caching import request_cache

from suite.mail.doctype.user_account.user_account import get_user_for_jmap_account
from suite.mail.jmap.connection import JMAPConnection, JMAPConnectionInfo, JMAPSessionManager
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
from suite.mail.storage import get_data_store
from suite.mail.storage.data_store import Entity
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
	"""Invalidates the JMAP identities cache for the specified account."""

	store = get_data_store(account)
	store.delete_all(Entity.IDENTITY)


def invalidate_jmap_mailboxes_cache(account: str) -> None:
	"""Invalidates the JMAP mailboxes cache for the specified account."""

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
