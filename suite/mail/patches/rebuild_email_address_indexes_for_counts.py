from suite.mail.store import rebuild_all_email_address_indexes


def execute() -> None:
    """Rebuild every account's email-address index so its entries carry an interaction count.

    The index gained a `count` field, and a schema change drops the index rather than migrating it,
    so suggestions stay empty until each account is rebuilt from the messages already cached. This
    fans the accounts out into long-queue background jobs (rather than indexing inline during
    migrate), each recounting from the cache.
    """

    rebuild_all_email_address_indexes()
