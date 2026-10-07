import frappe
from frappe.utils import now

ROLE = "Suite User"

# Non-virtual Mail/Calendar doctypes whose access moved to the owner-scoped "Suite User"
# role via Frappe's `if_owner`. `if_owner` keys off the standard `owner` field, so existing
# records must have `owner` aligned with their `user` field (see `suite.utils.permissions`).
OWNER_SCOPED_DOCTYPES = (
    "Mail Exchange",
    "Mail Queue",
    "User Account",
    "User Settings",
    "Contacts Exchange",
    "Calendar Exchange",
    "Mail Signature",
)


def execute() -> None:
    """Grant the Suite User role to existing users and align record ownership.

    The non-virtual Mail/Calendar doctypes moved from the blanket "All" role to an
    owner-scoped "Suite User" role. Existing users therefore need the role assigned
    explicitly, and existing records need `owner` pinned to their `user` field, otherwise
    users would lose access to their own records on upgrade. Mail users are identified by
    having a User Settings or User Account record.

    The role itself is shipped as a fixture (see ``suite/fixtures/role.json``), but fixtures
    sync only after post_model_sync patches, so it is created here first if still missing.
    """

    if not frappe.db.exists("Role", ROLE):
        frappe.get_doc({"doctype": "Role", "role_name": ROLE, "desk_access": 0}).insert(
            ignore_permissions=True
        )

    users = set(frappe.get_all("User Settings", pluck="user"))
    users |= set(frappe.get_all("User Account", pluck="user"))
    users.discard(None)
    users.discard("Administrator")

    _assign_role(users)

    for doctype in OWNER_SCOPED_DOCTYPES:
        table = f"tab{doctype}"
        frappe.db.sql(f"UPDATE `{table}` SET `owner` = `user` WHERE `user` IS NOT NULL AND `owner` != `user`")


def _assign_role(users: set[str]) -> None:
    """Grant ROLE to ``users`` with one bulk insert into ``Has Role``.

    Going through ``User.add_roles`` would fetch and save every User document (an N+1 on
    migrate). ROLE has ``desk_access = 0``, so it never changes a user's ``user_type`` —
    inserting the child rows directly is safe. A single query both skips users who already
    hold the role and finds the next ``idx`` per user; caches are cleared at the end of the
    migrate.
    """

    if not users:
        return

    existing = frappe.get_all(
        "Has Role",
        filters={"parenttype": "User", "parent": ("in", list(users))},
        fields=["parent", "role", "idx"],
    )
    already_has = {row.parent for row in existing if row.role == ROLE}
    next_idx = {}
    for row in existing:
        next_idx[row.parent] = max(next_idx.get(row.parent, 0), row.idx)

    timestamp = now()
    rows = [
        (
            frappe.generate_hash(length=10),
            user,
            "User",
            "roles",
            ROLE,
            "Administrator",
            timestamp,
            timestamp,
            "Administrator",
            next_idx.get(user, 0) + 1,
            0,
        )
        for user in users
        if user not in already_has
    ]
    if not rows:
        return

    frappe.db.bulk_insert(
        "Has Role",
        fields=[
            "name",
            "parent",
            "parenttype",
            "parentfield",
            "role",
            "owner",
            "creation",
            "modified",
            "modified_by",
            "idx",
            "docstatus",
        ],
        values=rows,
    )
