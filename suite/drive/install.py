import frappe


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


def index_group_membership() -> None:
    """Index `User Group Member.user`, which Drive reads on every request.

    A bare `add_index` is not enough: Frappe's schema sync drops any index whose field lacks
    `search_index`, so the next `bench migrate` would remove it. A Property Setter keeps it, and
    `add_index` only creates one outside install and migrate, so this sets both explicitly.
    Safe to repeat: the setter is upserted and the index is created only when missing.
    """
    from frappe.custom.doctype.property_setter.property_setter import make_property_setter

    make_property_setter(
        "User Group Member",
        "user",
        "search_index",
        "1",
        "Check",
        for_doctype=False,
        validate_fields_for_doctype=False,
    )
    frappe.db.add_index("User Group Member", ["user"])
