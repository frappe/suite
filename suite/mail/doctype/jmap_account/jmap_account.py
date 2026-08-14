# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint

from suite.mail.doctype.sieve_script.sieve_script import build_automation_sieve, maybe_build_automation_sieve
from suite.mail.doctype.user_account.user_account import get_user_jmap_accounts
from suite.mail.jmap import (
    chunked_set,
    format_set_error,
    get_account_client,
    get_cached_mailboxes,
    get_mailbox_id_by_role,
    has_cached_identities,
    has_cached_mailboxes,
    invalidate_jmap_identities_cache,
    invalidate_jmap_mailboxes_cache,
)
from suite.mail.store import (
    Entity,
    get_account_namespace,
    get_blob_store,
    get_data_store,
    rebuild_email_address_index,
)
from suite.mail.utils.user import get_account_emails
from suite.store import destroy_namespace, get_search_base_path
from suite.utils import execute_with_logging, user_context
from suite.utils.lock import acquire_lock, release_lock
from suite.utils.user import is_suite_admin, is_system_manager

DEFAULT_MAILBOX_RENAMES = {
    "inbox": ("Inbox", "Inbox"),
    "sent": ("Sent Items", "Sent"),
    "drafts": ("Drafts", "Drafts"),
    "junk": ("Junk Mail", "Spam"),
    "trash": ("Deleted Items", "Trash"),
}


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
        keep_forwarded_email_in_thread: DF.Check
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
    def has_cached_jmap_identities(self) -> int:
        """Check if there are cached JMAP identities for the account."""

        if self.flags.in_delete or not self.name:
            return 0

        return cint(has_cached_identities(self.name))

    @property
    def has_cached_jmap_mailboxes(self) -> int:
        """Check if there are cached JMAP mailboxes for the account."""

        if self.flags.in_delete or not self.name:
            return 0

        return cint(has_cached_mailboxes(self.name))

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
        self.clear_search_indexes()

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

    @frappe.whitelist()
    def clear_search_indexes(self) -> None:
        """Delete all search indexes belonging to the current account.

        Removes only the account's namespace, leaving other accounts' indexes intact.
        """

        if not self.has_clear_cache_permission():
            return

        destroy_namespace(get_search_base_path(), get_account_namespace(self.name))

    @frappe.whitelist()
    def rebuild_search_index(self) -> None:
        """Rebuild the account's email-address index from its cached messages and contact cards."""

        if not self.has_clear_cache_permission():
            return

        rebuild_email_address_index(self.name)

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

    # The skip flags only pause hook-triggered builds during the bulk sync below and must not
    # leak: flags survive the request in long-lived processes (workers, tests), where a leaked
    # flag would silently no-op every later automation sieve rebuild.
    previous_sieve_flag = frappe.flags.get("skip_automation_sieve_build")
    previous_archive_flag = frappe.flags.get("skip_archive_mailbox_creation")

    try:
        frappe.flags.skip_automation_sieve_build = True
        frappe.flags.skip_archive_mailbox_creation = True

        new_accounts = _ensure_jmap_account_docs(user, accounts)
        _sync_user_accounts(user, set(accounts.keys()))

        # Reached over JMAP as ``user``, not as whoever triggered the save: these accounts are only
        # ever linked to ``user``, so an admin setting up a member's account (or any other user
        # saving someone else's settings) would otherwise resolve the account to nobody and fail
        # with "JMAP account <id> does not belong to the user <admin>".
        with user_context(user):
            for account in new_accounts:
                create_archive_mailbox(account)
                rename_default_mailboxes(account)
                build_automation_sieve(account, activate=True)
    finally:
        frappe.flags.skip_automation_sieve_build = previous_sieve_flag
        frappe.flags.skip_archive_mailbox_creation = previous_archive_flag
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

        # Screening is opt-in for shared/team accounts, but on by default for personal
        # ones. Account owners can still toggle it manually afterwards.
        doc.enable_screening = doc.is_personal

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
        module="Mail",
    )


def rename_default_mailboxes(account: str) -> int:
    """Rename the account's default mailboxes from their server-assigned names.

    Returns the number of mailboxes renamed."""

    return execute_with_logging(
        lambda: _rename_default_mailboxes(account),
        title=_("Default Mailbox Rename Error"),
        user_message=_("Failed to rename default mailboxes for account {0}").format(frappe.bold(account)),
        with_context=False,
        module="Mail",
    )


def _rename_default_mailboxes(account: str) -> int:
    updates = {}
    for mailbox in get_cached_mailboxes(account):
        current_name, new_name = DEFAULT_MAILBOX_RENAMES.get(
            (mailbox.get("role") or "").lower(), (None, None)
        )
        if current_name is None or mailbox["name"] != current_name or current_name == new_name:
            continue

        updates[mailbox["id"]] = {
            "name": new_name,
            "role": mailbox["role"],
            "parentId": mailbox["parentId"],
            "sortOrder": mailbox["sortOrder"],
            "isSubscribed": mailbox["isSubscribed"],
        }

    if not updates:
        return 0

    client = get_account_client(account)
    result = chunked_set(client, lambda b, chunk: b.mail.mailbox.set(update=chunk), updates)
    invalidate_jmap_mailboxes_cache(account)

    if result.not_updated:
        errors = ", ".join(f"{id}: {format_set_error(error)}" for id, error in result.not_updated.items())
        raise ValueError(f"Failed to rename mailbox(es): {errors}")

    return len(updates)


def get_permission_query_condition(user: str | None = None) -> str | None:
    user = user or frappe.session.user
    if is_system_manager(user) or is_suite_admin(user):
        return ""

    accounts = get_user_jmap_accounts(user)
    if not accounts:
        return "1=0"

    return f"""`tabJMAP Account`.name in ({", ".join(frappe.db.escape(account) for account in accounts)})"""


def has_permission(doc: Document, ptype: str, user: str | None = None) -> bool:
    if doc.doctype != "JMAP Account":
        return False

    user = user or frappe.session.user

    if is_system_manager(user) or is_suite_admin(user):
        return True

    accounts = get_user_jmap_accounts(user)
    if not accounts:
        return False

    return doc.name in accounts
