def after_user_insert(doc, method: str | None = None) -> None:
    """Give a new ordinary user a Personal Drive root."""
    from suite.drive._core.roots import provision_personal_root

    provision_personal_root(doc.name)


def on_user_trash(doc, method: str | None = None) -> None:
    """Offboard a Drive user: archive the root, discard their private records.

    The node tree, its grants, its byte charges, and every attributed record
    stay exactly as they are. Only the rows keyed by the departing email that
    carry no shared meaning go, so recreating the address cannot hand the next
    person the previous one's recents, favourites, or notification inbox.
    """
    from suite.drive._core.activity import discard_personal_records
    from suite.drive._core.roots import archive_personal_root

    archive_personal_root(doc.name)
    discard_personal_records(doc.name)
