from suite.mail.store import rebuild_all_email_address_indexes


def execute() -> None:
    """Build the email-address search index from data already cached for each JMAP account.

    Re-run whenever the index's schema changes: a changed schema wipes each account's index the next
    time it is opened, leaving suggestions empty until something re-indexes. This fans the accounts
    out into long-queue background jobs (rather than indexing inline during migrate), each
    rebuilding from the cache.
    """

    rebuild_all_email_address_indexes()
