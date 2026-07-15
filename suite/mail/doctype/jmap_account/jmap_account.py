# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from typing import TYPE_CHECKING

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint

from suite.mail.jmap import (
	get_core_service,
	get_mailbox_id_by_role,
	invalidate_jmap_identities_cache,
	invalidate_jmap_mailboxes_cache,
)
from suite.mail.storage import get_blob_store, get_data_store
from suite.mail.storage.data_store import Entity

if TYPE_CHECKING:
	from suite.mail.jmap.services.core import CoreService

from suite.mail.doctype.sieve_script.sieve_script import build_automation_sieve, maybe_build_automation_sieve
from suite.mail.doctype.user_account.user_account import get_user_jmap_accounts
from suite.mail.utils.user import get_account_emails
from suite.utils import execute_with_logging
from suite.utils.lock import acquire_lock, release_lock
from suite.utils.user import is_system_manager


class JMAPAccount(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		_name: DF.Data
		account_id: DF.Data
		block_remote_images: DF.Check
		create_contacts_after_email_submit: DF.Check
		default_outgoing_email: DF.Data | None
		destroy_email_after_submit: DF.Check
		destroy_newsletter_after_submit: DF.Check
		enable_screening: DF.Check
		is_personal: DF.Check
		is_readonly: DF.Check
		last_active_sieve_script_id: DF.Data | None
		on_mark_as_junk: DF.Literal["Junk Sender's Mail", "Ask to Block Sender"]
	# end: auto-generated types

	"""Per-account settings shared across every user that has JMAP access to the account.

	The document is named by the bare JMAP account ID. Cache-related fields and actions
	operate on the *session user's* local store for the account, since the cache is kept
	per (user, account).
	"""

	@property
	def _user(self) -> str:
		"""The user whose JMAP connection backs per-user operations on this shared account.

		Uses the creating user during insert (set via flags) and the session user otherwise,
		so cache lookups reflect the user currently viewing the document.
		"""

		return self.flags.get("user") or frappe.session.user

	@property
	def core_service(self) -> "CoreService" | None:
		"""Return the JMAP core service for the account, or None if there is an error."""

		if self.flags.in_delete or not self.name:
			return None

		try:
			return get_core_service(self.name)
		except Exception:
			frappe.msgprint(f"Error getting JMAP core service for account {self.name}")
			return None

	@property
	def has_cached_jmap_identities(self) -> int:
		"""Check if there are cached JMAP identities for the account."""

		service = self.core_service
		if not service:
			return 0

		return cint(bool(service.cache.get("identities")))

	@property
	def has_cached_jmap_mailboxes(self) -> int:
		"""Check if there are cached JMAP mailboxes for the account."""

		service = self.core_service
		if not service:
			return 0

		return cint(bool(service.cache.get("mailboxes")))

	@property
	def total_cached_blobs(self) -> int:
		"""Get the total number of cached blobs for the account."""

		return get_blob_store(self.name).count()

	@property
	def total_cached_mail_messages(self) -> int:
		"""Get the total number of cached mail messages for the account."""

		return get_data_store(self.name).count(Entity.EMAIL)

	@property
	def total_cached_contact_cards(self) -> int:
		"""Get the total number of cached contact cards for the account."""

		return get_data_store(self.name).count(Entity.CONTACT_CARD)

	def validate(self) -> None:
		self.validate_default_outgoing_email()

	def validate_default_outgoing_email(self) -> None:
		"""Keep the default outgoing email valid: fall back to the account's first identity
		when the chosen one isn't one of the account's identities."""

		if not self.default_outgoing_email or frappe.flags.in_migrate:
			return

		try:
			emails = get_account_emails(self._user, self.name)
		except Exception:
			return

		if self.default_outgoing_email not in emails:
			frappe.throw(
				_("Default Outgoing Email {0} is not one of the account's identities.").format(
					frappe.bold(self.default_outgoing_email)
				)
			)

	def after_insert(self) -> None:
		maybe_create_archive_mailbox(self.name)

	def on_update(self) -> None:
		if frappe.flags.in_migrate:
			return

		if self.has_value_changed("enable_screening"):
			maybe_build_automation_sieve(self.name, activate=self.enable_screening)

	def after_delete(self) -> None:
		"""Clear all caches related to the account when the settings are deleted."""

		self.clear_cached_jmap_identities()
		self.clear_cached_jmap_mailboxes()
		self.clear_cached_mail_messages()
		self.clear_cached_contact_cards()
		self.clear_cached_blobs()

	@frappe.whitelist()
	def clear_cached_jmap_identities(self) -> None:
		"""Clear all cached JMAP identities for the current account."""

		if self.has_clear_cache_permission():
			invalidate_jmap_identities_cache(self.name)

	@frappe.whitelist()
	def clear_cached_jmap_mailboxes(self) -> None:
		"""Clear all cached JMAP mailboxes for the current account."""

		if self.has_clear_cache_permission():
			invalidate_jmap_mailboxes_cache(self.name)

	@frappe.whitelist()
	def clear_cached_blobs(self) -> None:
		"""Clear all cached JMAP blobs for the current account."""

		if not self.has_clear_cache_permission():
			return

		get_blob_store(self.name).delete_all()

	@frappe.whitelist()
	def clear_cached_mail_messages(self) -> None:
		"""Clear all cached mail messages for the current account."""

		if not self.has_clear_cache_permission():
			return

		get_data_store(self.name).delete_all(Entity.EMAIL)

	@frappe.whitelist()
	def clear_cached_contact_cards(self) -> None:
		"""Clear all cached contact cards for the current account."""

		if not self.has_clear_cache_permission():
			return

		get_data_store(self.name).delete_all(Entity.CONTACT_CARD)

	def has_clear_cache_permission(self) -> bool:
		"""Check if the session user has permission to clear cache."""

		if has_permission(self, "write"):
			return True

		frappe.throw(
			_("You do not have permission to clear the cache for this account."), frappe.PermissionError
		)

	def _db_set(
		self,
		update_modified: bool = True,
		commit: bool = False,
		notify: bool = False,
		**kwargs,
	) -> None:
		"""Updates the document with the given key-value pairs."""

		self.db_set(kwargs, update_modified=update_modified, notify=notify, commit=commit)


def delete_orphaned_jmap_accounts() -> None:
	"""Delete JMAP Accounts that are no longer linked to any user.

	JMAP Account settings are shared by account ID across every user with access, so a JMAP
	Account is only orphaned once the last user's User Account link is gone.
	"""

	linked_accounts = frappe.db.get_all("User Account", distinct=True, pluck="account")
	orphaned_accounts = frappe.db.get_all(
		"JMAP Account", filters={"name": ["not in", linked_accounts]}, pluck="name"
	)

	for account in orphaned_accounts:
		frappe.delete_doc("JMAP Account", account, ignore_permissions=True, delete_permanently=True)


def sync_jmap_accounts(user: str, accounts: dict[str, dict]) -> None:
	"""Ensure a shared JMAP Account document exists for each of the user's accounts.

	Settings are shared by account ID across every user with access, so documents for
	accounts the user can no longer see are intentionally left untouched.

	Serialized per user with a distributed lock: this runs on every User Settings save,
	including session-state changes that can fire concurrently from multiple tabs or jobs.
	Without it, two overlapping runs would both read an empty User Account set and each
	insert a link, leaving duplicate (user, account) rows (the doctype has no unique key).
	If the lock can't be acquired, another run is already syncing the same session snapshot,
	so skipping is safe.
	"""

	lockname = f"sync_jmap_accounts:{user}"
	identifier = acquire_lock(lockname, acquire_timeout=0)
	if not identifier:
		return

	try:
		frappe.flags.skip_automation_sieve_build = True
		frappe.flags.skip_archive_mailbox_creation = True

		new_accounts = _ensure_jmap_account_docs(user, accounts)
		_sync_user_accounts(user, set(accounts.keys()))

		for account in new_accounts:
			create_archive_mailbox(account)
			build_automation_sieve(account, activate=True)
	finally:
		release_lock(lockname, identifier)


def _ensure_jmap_account_docs(user: str, accounts: dict[str, dict]) -> list[str]:
	"""Create the shared JMAP Account document for each account that doesn't have one yet.

	Returns the list of newly created account IDs. Existing documents are left untouched.
	"""

	new_accounts = []
	for account_id, details in accounts.items():
		if frappe.db.exists("JMAP Account", account_id):
			continue

		doc = frappe.new_doc("JMAP Account")
		doc._name = details["name"]
		doc.account_id = account_id
		doc.is_personal = details["isPersonal"]
		doc.is_readonly = details["isReadOnly"]

		# Carry the user so after_insert / validate can reach JMAP for this account.
		doc.flags.user = user

		doc.flags.ignore_links = True

		try:
			doc.insert(ignore_permissions=True)
		except frappe.DuplicateEntryError:
			continue

		new_accounts.append(doc.name)

	return new_accounts


def _sync_user_accounts(user: str, account_ids: set[str]) -> None:
	"""Reconcile the user's User Account links with the given set of account IDs.

	Guards against duplicate (user, account) links at two levels alongside the DB unique index:
	pre-existing duplicates are collapsed to a single row, and inserts tolerate the index
	rejecting a link that a concurrent sync created first.
	"""

	user_account_map = {}
	duplicate_names = []
	for user_account in frappe.db.get_all("User Account", {"user": user}, ["name", "account"]):
		if user_account.account in user_account_map:
			duplicate_names.append(user_account.name)
		else:
			user_account_map[user_account.account] = user_account.name

	existing_account_ids = set(user_account_map.keys())

	accounts_to_add = account_ids - existing_account_ids
	accounts_to_remove = existing_account_ids - account_ids

	if accounts_to_add:
		user_settings = frappe.get_doc("User Settings", {"user": user})
		for account_id in accounts_to_add:
			doc = frappe.new_doc("User Account")
			doc.user = user
			doc.account = account_id
			doc.user_settings = user_settings.name
			try:
				doc.insert(ignore_permissions=True)
			except frappe.UniqueValidationError:
				continue

	names_to_remove = duplicate_names + [user_account_map[account] for account in accounts_to_remove]
	if names_to_remove:
		frappe.db.delete("User Account", {"name": ["in", names_to_remove]})


def maybe_create_archive_mailbox(account: str) -> None:
	"""Create the archive mailbox for the account if it does not already exist."""

	if frappe.flags.get("skip_archive_mailbox_creation"):
		return

	create_archive_mailbox(account)


def create_archive_mailbox(account: str) -> None:
	"""Create the archive mailbox for the account if it does not already exist."""

	execute_with_logging(
		lambda: get_mailbox_id_by_role(account, "archive", create_if_not_exists=True),
		title=_("Archive Mailbox Creation Error"),
		user_message=_("Failed to create archive mailbox for account {0}").format(frappe.bold(account)),
		with_context=False,
	)


def get_permission_query_condition(user: str | None = None) -> str | None:
	user = user or frappe.session.user
	if is_system_manager(user):
		return ""

	accounts = get_user_jmap_accounts(user)
	if not accounts:
		return "1=0"

	return f"""`tabJMAP Account`.name in ({", ".join(frappe.db.escape(account) for account in accounts)})"""


def has_permission(doc: "Document", ptype: str, user: str | None = None) -> bool:
	if doc.doctype != "JMAP Account":
		return False

	user = user or frappe.session.user

	if is_system_manager(user):
		return True

	accounts = get_user_jmap_accounts(user)
	if not accounts:
		return False

	return doc.name in accounts
