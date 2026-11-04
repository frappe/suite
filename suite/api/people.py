"""Find the people a Suite user can name: users and user groups (ask S1).

One search serves every picker. Drive's share dialog maps a user to its
email principal and a group to `$GROUP:<name>`; "principal" stays a Drive
word, so this module does not use it.
"""

from __future__ import annotations

from typing import Literal, TypedDict

import frappe
from frappe import _

PAGE_SIZE = 20

# A cursor is an offset. Nine digits is far past any real directory, and it
# keeps a crafted cursor out of `int()` and out of the SQL OFFSET.
_CURSOR_DIGITS = 9

# The narrowest rule the tickets allow. A disabled account and a user without
# the Suite User role cannot use Suite, so nobody picks them. The role is the
# test, not `user_type`: it does not open Desk, so a Suite user is a Website
# User like any signed-up visitor. Administrator and Guest are system
# identities, not people.
_PEOPLE = """
    SELECT 'user' AS kind, name, IF(IFNULL(full_name, '') = '', name, full_name) AS label
    FROM `tabUser`
    WHERE enabled = 1
        AND EXISTS (
            SELECT 1 FROM `tabHas Role`
            WHERE parenttype = 'User' AND parent = `tabUser`.name AND role = 'Suite User'
        )
        AND name NOT IN ('Administrator', 'Guest')
        AND (full_name LIKE %(pattern)s OR name LIKE %(pattern)s OR email LIKE %(pattern)s)
    UNION ALL
    SELECT 'group' AS kind, name, name AS label
    FROM `tabUser Group`
    WHERE name LIKE %(pattern)s
    ORDER BY label, kind, name
    LIMIT %(limit)s OFFSET %(offset)s
"""


class BadCursor(frappe.ValidationError):
    http_status_code = 400


class PersonUser(TypedDict):
    kind: Literal["user"]
    name: str
    email: str
    full_name: str | None
    user_image: str | None


class PersonGroup(TypedDict):
    kind: Literal["group"]
    name: str
    member_count: int


Person = PersonUser | PersonGroup


class PeoplePage(TypedDict):
    rows: list[Person]
    next_cursor: str | None


def search(query: str | None = None, cursor: str | None = None) -> PeoplePage:
    """Page the users and groups whose name or email contains `query`.

    Rows sort by what a picker shows: a user's full name, or else their
    email, and a group's name. The cursor is opaque to callers.
    """
    frappe.only_for("Suite User")
    offset = _offset(cursor)
    found = frappe.db.sql(
        _PEOPLE,
        {"pattern": _contains(query or ""), "limit": PAGE_SIZE + 1, "offset": offset},
        as_dict=True,
    )
    more = len(found) > PAGE_SIZE
    found = found[:PAGE_SIZE]
    users = _users([row.name for row in found if row.kind == "user"])
    counts = _member_counts([row.name for row in found if row.kind == "group"])
    rows: list[Person] = [
        users[row.name]
        if row.kind == "user"
        else {"kind": "group", "name": row.name, "member_count": counts.get(row.name, 0)}
        for row in found
    ]
    return {"rows": rows, "next_cursor": str(offset + PAGE_SIZE) if more else None}


def _offset(cursor: str | None) -> int:
    if not cursor:
        return 0
    if len(cursor) > _CURSOR_DIGITS or not (cursor.isascii() and cursor.isdecimal()):
        frappe.throw(_("That page of people does not exist"), BadCursor)
    return int(cursor)


def _contains(query: str) -> str:
    escaped = query.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _users(names: list[str]) -> dict[str, PersonUser]:
    if not names:
        return {}
    rows = frappe.get_all(
        "User",
        filters={"name": ["in", names]},
        fields=["name", "email", "full_name", "user_image"],
    )
    return {
        row.name: {
            "kind": "user",
            "name": row.name,
            "email": row.email,
            "full_name": row.full_name,
            "user_image": row.user_image,
        }
        for row in rows
    }


def _member_counts(groups: list[str]) -> dict[str, int]:
    if not groups:
        return {}
    return dict(
        frappe.db.sql(
            """SELECT parent, COUNT(DISTINCT user) FROM `tabUser Group Member`
            WHERE parenttype = 'User Group' AND parent IN %(groups)s GROUP BY parent""",
            {"groups": groups},
        )
    )
