from suite.mail.store import rebuild_local_email_address_index


def execute() -> None:
    """Build the local email-address index from existing users and JMAP accounts.

    Enqueued like any rebuild, so a site's existing local addresses are suggested without waiting
    for a user or account to change.
    """

    rebuild_local_email_address_index()
