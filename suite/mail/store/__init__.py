from enum import Enum

import frappe
from frappe import _
from frappe.utils import create_batch

from suite.mail.store.indexes import EmailAddressIndex
from suite.store import (
    destroy_namespace,
    get_blob_base_path,
    get_data_base_path,
    get_search_base_path,
)
from suite.store.blob_store import BlobStore
from suite.store.data_store import DataStore
from suite.utils import enqueue_job

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
    # IDs of messages already counted towards their participants' interaction totals, recorded
    # apart from the messages themselves and outliving them: a message is evicted and fetched back
    # whenever the server reports it updated, and each round would otherwise count it again.
    COUNTED_EMAIL = "counted_email"

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

    Totals every cached mail message per address and writes those totals over whatever the index
    held, then re-indexes the cached contact cards. Runs in a background job by default; pass
    `in_background=False` to run inline (e.g. from within the job itself).

    Nothing is dropped first. A rebuild used to clear the index and count it back up, which meant
    anything a sync indexed while it ran was erased and never counted again; writing totals leaves
    a sync's work either counted in the totals or added on top of them. An address the cache no
    longer mentions keeps the count it had, in keeping with an index that outlives its messages.
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

    store = get_data_store(account)
    index = get_email_address_index(account)

    addresses = []
    for batch in create_batch(list(store.scan(Entity.EMAIL).items()), _REBUILD_BATCH_SIZE):
        # Claim as we go, so a sync reaching one of these messages afterwards adds nothing on top
        # of the total about to be written for it.
        store.set_many(Entity.COUNTED_EMAIL, items={message_id: True for message_id, _ in batch})
        addresses.extend(_message_addresses([message for _message_id, message in batch]))

    # One write, holding each address's total across every cached message — batching it would make
    # each batch overwrite the last, since these totals replace rather than add.
    index.index_addresses(addresses, merge=False)

    contact_cards = list(store.scan(Entity.CONTACT_CARD).values())
    for batch in create_batch(contact_cards, _REBUILD_BATCH_SIZE):
        index.index_addresses(_contact_addresses(batch))


@frappe.whitelist()
def rebuild_all_email_address_indexes() -> None:
    """Rebuild the email-address index for every JMAP account. System Manager only.

    Fans the accounts out into long-queue background jobs of `_ACCOUNTS_PER_REBUILD_BATCH` each;
    every job rebuilds its accounts inline. Safe to run from a scheduler or the console.
    """

    from suite.utils.user import is_system_manager

    if not is_system_manager(frappe.session.user):
        frappe.throw(_("Only System Manager can rebuild the email address indexes."))

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
