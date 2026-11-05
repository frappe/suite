"""Find the people a Suite user can name: users and user groups (ask S1).

One search serves every picker. Drive's share dialog maps a user to its
email principal and a group to `$GROUP:<name>`; "principal" stays a Drive
word, so this module does not use it.
"""

from __future__ import annotations

from typing import Literal, NotRequired, TypedDict

import frappe
from frappe import _

from suite import drive

PAGE_SIZE = 20

# A cursor is an offset. Nine digits is far past any real directory, and it
# keeps a crafted cursor out of `int()` and out of the SQL OFFSET.
_CURSOR_DIGITS = 9

_DIRECTORY_USERS = f"""
    SELECT 'user' AS kind, name, IF(IFNULL(full_name, '') = '', name, full_name) AS label
    FROM `tabUser`
    WHERE {drive.IN_DIRECTORY_SQL}
"""

_USERS = f"""
    {_DIRECTORY_USERS}
        AND (full_name LIKE %(pattern)s OR name LIKE %(pattern)s OR email LIKE %(pattern)s)
"""

_USERS_AMONG = f"""
    {_DIRECTORY_USERS}
        AND name IN %(users)s
"""

_PEOPLE = f"""
    {_USERS}
    UNION ALL
    SELECT 'group' AS kind, name, name AS label
    FROM `tabUser Group`
    WHERE name LIKE %(pattern)s
    ORDER BY label, kind, name
    LIMIT %(limit)s OFFSET %(offset)s
"""


# People a node names who are not in the directory above: Administrator as a
# document's creator. They match the same text.
_NAMED_USERS = """
    SELECT name, IF(IFNULL(full_name, '') = '', name, full_name) AS label
    FROM `tabUser`
    WHERE name IN %(users)s AND enabled = 1 AND name != 'Guest'
        AND (full_name LIKE %(pattern)s OR name LIKE %(pattern)s OR email LIKE %(pattern)s)
"""


class BadCursor(frappe.ValidationError):
    http_status_code = 400


class BadLookup(frappe.ValidationError):
    http_status_code = 400


class PersonUser(TypedDict):
    kind: Literal["user"]
    name: str
    email: str
    full_name: str | None
    user_image: str | None
    # Only with `node`: whether they can open it.
    has_access: NotRequired[bool]
    # Only with `node`, for a manager: whether a deny naming them or their group keeps them out.
    is_blocked: NotRequired[bool]


class PersonGroup(TypedDict):
    kind: Literal["group"]
    name: str
    member_count: int


Person = PersonUser | PersonGroup


class PeoplePage(TypedDict):
    rows: list[Person]
    next_cursor: str | None


def search(
    query: str | None = None,
    cursor: str | None = None,
    node: str | None = None,
    users: list[str] | None = None,
) -> PeoplePage:
    """Page the users and groups whose name or email contains `query`.

    Rows sort by what a picker shows: a user's full name, or else their
    email, and a group's name. The cursor is opaque to callers.

    With `node`, the page is for naming someone on that node, as a mention
    does: users only, not the caller, the ones who can open the node first,
    each marked with `has_access`. Only someone who manages the node also gets `is_blocked`:
    to anyone else a block looks like any other lack of access. It adds the people the node
    names, such as its creator, and is one page with no cursor.

    With `node` and `users`, the page answers exactly those people, in place of
    a search. It offers no one a search on the node would not.
    """
    frappe.only_for("Suite User")
    if users is not None:
        return _look_up_on(node, users)
    if node:
        return _search_on(node, query or "")
    offset = _offset(cursor)
    found = frappe.db.sql(
        _PEOPLE,
        {"pattern": _contains(query or ""), "limit": PAGE_SIZE + 1, "offset": offset},
        as_dict=True,
    )
    more = len(found) > PAGE_SIZE
    found = found[:PAGE_SIZE]
    found_users = _users([row.name for row in found if row.kind == "user"])
    counts = _member_counts([row.name for row in found if row.kind == "group"])
    rows: list[Person] = [
        found_users[row.name]
        if row.kind == "user"
        else {"kind": "group", "name": row.name, "member_count": counts.get(row.name, 0)}
        for row in found
    ]
    return {"rows": rows, "next_cursor": str(offset + PAGE_SIZE) if more else None}


def _search_on(node: str, query: str) -> PeoplePage:
    pattern = _contains(query)
    found = frappe.db.sql(
        f"{_USERS} ORDER BY label, name LIMIT %(limit)s",
        {"pattern": pattern, "limit": PAGE_SIZE},
        as_dict=True,
    )
    labels = {row.name: row.label for row in found}
    return _page_on(labels, drive.people_on(node, labels), pattern, PAGE_SIZE)


def _look_up_on(node: str | None, users: list[str]) -> PeoplePage:
    if not node:
        frappe.throw(_("Looking up people needs a document"), BadLookup)
    # A lookup answers one comment, so it names as many people as a comment can.
    if len(users) > drive.MAX_MENTIONS:
        frappe.throw(_("A lookup can name at most {0} people").format(drive.MAX_MENTIONS), BadLookup)
    found = frappe.db.sql(_USERS_AMONG, {"users": users}, as_dict=True) if users else []
    labels = {row.name: row.label for row in found}
    access = drive.people_on(node, labels)
    asked = {user: answer for user, answer in access.items() if user in labels or user in users}
    return _page_on(labels, asked, _contains(""), drive.MAX_MENTIONS)


def _page_on(
    labels: dict[str, str], access: dict[str, drive.PersonOnNode], pattern: str, limit: int
) -> PeoplePage:
    named = [user for user in access if user not in labels]
    if named:
        rows = frappe.db.sql(_NAMED_USERS, {"users": named, "pattern": pattern}, as_dict=True)
        labels |= {row.name: row.label for row in rows}
    labels.pop(frappe.session.user, None)
    ranked = sorted(labels, key=lambda user: (not access[user]["has_access"], labels[user].casefold(), user))[
        :limit
    ]
    users = _users(ranked)
    return {
        "rows": [{**users[user], **access[user]} for user in ranked if user in users],
        "next_cursor": None,
    }


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
