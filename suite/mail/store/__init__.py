from enum import Enum

import frappe
from frappe import _
from frappe.utils import create_batch

from suite.mail.store.indexes import EmailAddressIndex, LocalEmailAddressIndex
from suite.store import (
    destroy_namespace,
    get_blob_base_path,
    get_data_base_path,
    get_search_base_path,
)
from suite.store.blob_store import BlobStore
from suite.store.data_store import DataStore
from suite.utils import enqueue_job
from suite.utils.user import RESERVED_USERS

# Root namespace segment under which all of mail's stores live, e.g. ``mail/<account>``.
# Destroying this segment clears every mail store while leaving other apps' stores intact.
MAIL_NAMESPACE = "mail"

# Cached records processed per index write while rebuilding, bounding memory and commit size.
_REBUILD_BATCH_SIZE = 500

# Accounts rebuilt per long-queue job when rebuilding every account's index.
_ACCOUNTS_PER_REBUILD_BATCH = 25


class Entity(Enum):
    """Defines the different types of entities that can be stored in the DataStore."""

    STATE = "state"

    IDENTITY = "identity"
    MAILBOX = "mailbox"
    EMAIL = "email"

    PARTICIPANT_IDENTITY = "participant_identity"
    CALENDAR = "calendar"
    EVENT = "event"

    ADDRESS_BOOK = "address_book"
    CONTACT_CARD = "contact_card"


def get_account_namespace(account: str) -> tuple[str, str]:
    """Return the namespace for a JMAP account: ``("mail", <account>)``.

    Each account's data store, blob store and search indexes live at ``mail/<account>`` under
    their respective base paths, so accounts are isolated from one another and from other apps.
    """

    return (MAIL_NAMESPACE, account)


def get_data_store(account: str) -> DataStore:
    """Factory function to create a DataStore instance for the given JMAP account ID.

    The store is keyed solely by the account, so every user with access to a shared account
    reads and writes the same cache. LMDB serves concurrent access natively — many lock-free
    readers via MVCC snapshots and a single serialized writer — so multiple users (and worker
    processes) can hit the same account's store safely.
    """

    return DataStore(base_path=get_data_base_path(), namespace=get_account_namespace(account))


def get_blob_store(account: str) -> BlobStore:
    """Factory function to create a BlobStore instance for the given JMAP account ID.

    Each account's blobs live in their own directory, so the blob cache is shared across every
    user of an account. Writes are atomic (temp file + ``os.replace``) and reads open the file
    independently, so concurrent access from multiple users/processes is safe.
    """

    return BlobStore(base_path=get_blob_base_path(), namespace=get_account_namespace(account))


def get_email_address_index(account: str) -> EmailAddressIndex:
    """Get the EmailAddressIndex for the given JMAP account ID."""

    return EmailAddressIndex(get_account_namespace(account))


def get_local_email_address_index() -> LocalEmailAddressIndex:
    """Get the site-wide index of local users' and JMAP accounts' addresses, at ``mail/local_email_address``."""

    return LocalEmailAddressIndex((MAIL_NAMESPACE,))


def search_email_addresses(account: str, query: str, limit: int = 10) -> list[dict]:
    """Return up to `limit` {name, email} addresses matching `query` for the JMAP account.

    Local users and accounts come first, followed by the account's own correspondents and contacts
    not already listed; each group keeps its own relevance order.
    """

    local = get_local_email_address_index().search_email_addresses(query, limit=limit)
    listed = {address["email"].lower() for address in local}
    others = [
        address
        for address in get_email_address_index(account).search_email_addresses(query, limit=limit)
        if address["email"].lower() not in listed
    ]

    return (local + others)[:limit]


def rebuild_local_email_address_index(in_background: bool = True) -> None:
    """Replace the local address index with every enabled user's email and every JMAP account's name.

    Runs in a background job enqueued after the current commit by default, so it reads the change
    that triggered it; pass `in_background=False` to run inline.
    """

    if in_background:
        enqueue_job(
            rebuild_local_email_address_index,
            job_id="rebuild-local-email-address-index",
            deduplicate=True,
            enqueue_after_commit=True,
            in_background=False,
        )
        return

    users = frappe.get_all(
        "User",
        filters={"enabled": 1, "name": ["not in", RESERVED_USERS]},
        fields=["full_name", "email"],
    )
    accounts = frappe.get_all("JMAP Account", pluck="_name")

    # Users first, so an address that is both keeps the user's full name.
    addresses = [{"name": user.full_name, "email": user.email} for user in users]
    addresses += [{"email": name} for name in accounts]
    get_local_email_address_index().replace_addresses(addresses)


@frappe.whitelist()
def destroy_data_store() -> None:
    """Delete every mail data store for the current site. System Manager only.

    Removes only the ``mail`` namespace, leaving any other apps' data stores intact.
    """

    from suite.utils.user import is_system_manager

    if not is_system_manager(frappe.session.user):
        frappe.throw(_("Only System Manager can destroy the data store."))

    destroy_namespace(get_data_base_path(), MAIL_NAMESPACE)


@frappe.whitelist()
def destroy_blob_store() -> None:
    """Delete every mail blob store for the current site. System Manager only.

    Removes only the ``mail`` namespace, leaving any other apps' blob stores intact.
    """

    from suite.utils.user import is_system_manager

    if not is_system_manager(frappe.session.user):
        frappe.throw(_("Only System Manager can destroy the blob store."))

    destroy_namespace(get_blob_base_path(), MAIL_NAMESPACE)


@frappe.whitelist()
def destroy_search_index() -> None:
    """Delete every mail search index for the current site. System Manager only.

    Removes only the ``mail`` namespace, leaving any other apps' search indexes intact.
    """

    from suite.utils.user import is_system_manager

    if not is_system_manager(frappe.session.user):
        frappe.throw(_("Only System Manager can destroy the search index."))

    destroy_namespace(get_search_base_path(), MAIL_NAMESPACE)


def rebuild_email_address_index(account: str, in_background: bool = True) -> None:
    """Rebuild an account's email-address index from scratch.

    Drops the existing index, then re-indexes every cached mail message and contact card in
    batches (bounding memory and the size of each index commit). Runs in a background job by
    default; pass `in_background=False` to run inline (e.g. from within the job itself).

    Correspondence counts are recomputed from the messages the cache holds now, so a rebuild both
    clears the drift a re-fetched message leaves behind and forgets the addresses an evicted one
    contributed. They rank suggestions against each other; they are not a record of every message.
    """

    if in_background:
        enqueue_job(
            rebuild_email_address_index,
            job_id=f"rebuild-email-address-index::{account}",
            deduplicate=True,
            queue="long",
            timeout=3600,
            account=account,
            in_background=False,
        )
        return

    # Imported lazily: these modules import this package, so a top-level import would be circular.
    from suite.mail.doctype.contact_card.contact_card import _contact_addresses
    from suite.mail.doctype.mail_message.mail_message import _message_addresses

    # Drop the stale index, then take a fresh handle so its directory is recreated before writing.
    get_email_address_index(account).drop()
    index = get_email_address_index(account)

    store = get_data_store(account)

    messages = list(store.scan(Entity.EMAIL).values())
    for batch in create_batch(messages, _REBUILD_BATCH_SIZE):
        index.index_addresses(_message_addresses(batch))

    contact_cards = list(store.scan(Entity.CONTACT_CARD).values())
    for batch in create_batch(contact_cards, _REBUILD_BATCH_SIZE):
        index.index_addresses(_contact_addresses(batch), count=False)


@frappe.whitelist()
def rebuild_all_email_address_indexes() -> None:
    """Rebuild the local email-address index and the one for every JMAP account. System Manager only.

    Fans the accounts out into long-queue background jobs of `_ACCOUNTS_PER_REBUILD_BATCH` each;
    every job rebuilds its accounts inline. Safe to run from a scheduler or the console.
    """

    from suite.utils.user import is_system_manager

    if not is_system_manager(frappe.session.user):
        frappe.throw(_("Only System Manager can rebuild the email address indexes."))

    rebuild_local_email_address_index()

    accounts = frappe.db.get_all("JMAP Account", {}, pluck="name")
    for i, batch in enumerate(create_batch(accounts, _ACCOUNTS_PER_REBUILD_BATCH)):
        enqueue_job(
            _rebuild_email_address_indexes,
            job_id=f"rebuild-email-address-indexes::{i}",
            deduplicate=True,
            queue="long",
            timeout=3600,
            accounts=batch,
        )


def _rebuild_email_address_indexes(accounts: list[str]) -> None:
    """Rebuild each account's email-address index inline, isolating per-account failures."""

    from suite.mail.utils import log_mail_error

    for account in accounts:
        try:
            rebuild_email_address_index(account, in_background=False)
        except Exception:
            log_mail_error(
                _("Failed to rebuild email address index for account {0}").format(account),
                frappe.get_traceback(with_context=True),
            )
