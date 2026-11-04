"""The one shape a user is published in, and the one lookup that builds it.

A Drive row names a user by their `User` id: `owner`, a grant `principal`, an
activity `actor`. A page shows the person, not the id, so wherever a user is
published they are published as a `Person`: the id, the full name, and the
avatar. One lookup answers a whole response: a children page, a view, or a
grant list collects the ids it names and calls `people` once.
"""

from collections.abc import Iterable
from typing import TypedDict

import frappe


class Person(TypedDict):
    # The `User` id, the value stored in `owner`, `principal`, and `actor`.
    id: str
    # Falls back to the id when the User row is gone.
    full_name: str
    # `User.user_image` as stored: a `/files` or `/private/files` URL.
    user_image: str | None


def people(ids: Iterable[str | None]) -> dict[str, Person]:
    """Answer one Person per distinct id in one query.

    A deleted user, or an id that never named one, answers a fallback Person
    whose name is the id, so a row that names them still publishes.
    """
    wanted = sorted({user for user in ids if user})
    if not wanted:
        return {}
    rows = frappe.get_all(
        "User",
        filters={"name": ["in", wanted]},
        fields=["name", "full_name", "user_image"],
    )
    found = {row.name: person(row.name, row.full_name, row.user_image) for row in rows}
    return {user: found.get(user) or person(user, None, None) for user in wanted}


def enabled_people(ids: Iterable[str]) -> dict[str, bool]:
    """Answer each enabled user among `ids` by stored name, and whether people search lists them.

    The test is the one `suite.api.people` uses for its directory: the Suite User role. Administrator
    is a system identity, not listed. Guest is no one. One query answers any number of ids.
    """
    wanted = list({user for user in ids if user})
    if not wanted:
        return {}
    rows = frappe.db.sql(
        """
        SELECT name, name != 'Administrator' AND EXISTS (
            SELECT 1 FROM `tabHas Role`
            WHERE parenttype = 'User' AND parent = `tabUser`.name AND role = 'Suite User'
        ) AS in_directory
        FROM `tabUser`
        WHERE name IN %(ids)s AND enabled = 1 AND name != 'Guest'
        """,
        {"ids": wanted},
        as_dict=True,
    )
    return {row.name: bool(row.in_directory) for row in rows}


def person(user: str, full_name: str | None, user_image: str | None) -> Person:
    return {"id": user, "full_name": full_name or user, "user_image": user_image or None}
