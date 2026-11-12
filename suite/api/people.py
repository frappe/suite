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

_MATCHES_TEXT = "(full_name LIKE %(pattern)s OR name LIKE %(pattern)s OR email LIKE %(pattern)s)"

_USERS = f"""
    {_DIRECTORY_USERS}
        AND {_MATCHES_TEXT}
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
# document's creator.
_NAMED_USERS = f"""
    SELECT name, IF(IFNULL(full_name, '') = '', name, full_name) AS label
    FROM `tabUser`
    WHERE name IN %(users)s AND enabled = 1 AND name != 'Guest' AND {_MATCHES_TEXT}
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


def search(query: str | None = None, cursor: str | None = None, node: str | None = None) -> PeoplePage:
    """Page the users and groups whose name or email contains `query`.

    Rows sort by what a picker shows: a user's full name, or else their
    email, and a group's name. The cursor is opaque to callers.

    With `node`, it is one page with no cursor for naming someone there: users only, not the
    caller, those who can open the node first, plus the people it names, such as its creator.
    """
    frappe.only_for("Suite User")
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


def look_up(node: str, users: list[str]) -> list[PersonUser]:
    """Answer whether exactly `users` can open `node`, as `search` marks them with `node`.

    It offers no one a search on the node would not, and names at most as many as a comment can.
    """
    frappe.only_for("Suite User")
    if len(users) > drive.MAX_MENTIONS:
        frappe.throw(_("A lookup can name at most {0} people").format(drive.MAX_MENTIONS), BadLookup)
    labels = _labels(_USERS_AMONG, {"users": users}) if users else {}
    access = drive.people_on(node, labels)
    asked = {user: answer for user, answer in access.items() if user in labels or user in users}
    named = [user for user in asked if user not in labels]
    if named:
        labels |= _labels(_NAMED_USERS, {"users": named, "pattern": _contains("")})
    return _ranked_on(labels, asked, drive.MAX_MENTIONS)


def _search_on(node: str, query: str) -> PeoplePage:
    pattern = _contains(query)
    labels = _labels(
        f"{_USERS} ORDER BY label, name LIMIT %(limit)s", {"pattern": pattern, "limit": PAGE_SIZE}
    )
    access = drive.people_on(node, labels)
    named = [user for user in access if user not in labels]
    if named:
        labels |= _labels(_NAMED_USERS, {"users": named, "pattern": pattern})
    return {"rows": [*_ranked_on(labels, access, PAGE_SIZE)], "next_cursor": None}


def _labels(query: str, values: dict[str, object]) -> dict[str, str]:
    return {row.name: row.label for row in frappe.db.sql(query, values, as_dict=True)}


def _ranked_on(labels: dict[str, str], access: dict[str, drive.PersonOnNode], limit: int) -> list[PersonUser]:
    labels.pop(frappe.session.user, None)
    ranked = sorted(labels, key=lambda user: (not access[user]["has_access"], labels[user].casefold(), user))[
        :limit
    ]
    users = _users(ranked)
    return [{**users[user], **access[user]} for user in ranked if user in users]


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
