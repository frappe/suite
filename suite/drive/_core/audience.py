"""Who can open a node, as a kind and a head count, for a listing's Access column.

An audience names nobody. It says how wide a node's sharing is: public on the
web, everyone at the organization, anyone with a link, or a number of people.
The share dialog is where names are shown, to those who manage the node.
"""

from collections import defaultdict
from collections.abc import Iterable, Mapping
from typing import Literal

import frappe
from frappe.utils import now

from suite.drive._core.access import chain_ids

AudienceKind = Literal["public", "organization", "link", "people"]

GRANTS_SQL = """
SELECT node, principal, role
FROM `tabDrive Grant`
WHERE node IN %(chain)s
  AND (expires_on IS NULL OR expires_on > %(now)s)
"""


def audiences(rows: Iterable[Mapping]) -> dict[str, dict]:
    """Answer each row's audience, keyed by node name.

    A page costs two queries whatever its size: the live grants on every row's
    chain, and the members of the groups among them.
    """
    chains = {row["name"]: chain_ids(row) for row in rows}
    if not chains:
        return {}
    every_node = sorted({node for chain in chains.values() for node in chain})
    grants = frappe.db.sql(GRANTS_SQL, {"chain": every_node, "now": now()}, as_dict=True)
    by_node = defaultdict(list)
    for grant in grants:
        by_node[grant.node].append(grant)
    members = _group_members({grant.principal for grant in grants})
    return {name: _audience(chain, by_node, members) for name, chain in chains.items()}


def _audience(chain: list[str], by_node: Mapping[str, list], members: Mapping[str, set[str]]) -> dict:
    # Root first, so a grant nearer the node replaces one further up.
    nearest: dict[str, int] = {}
    for node in chain:
        for grant in by_node.get(node, ()):
            nearest[grant.principal] = grant.role
    allowed = {principal for principal, role in nearest.items() if role}
    denied = {principal for principal, role in nearest.items() if not role}
    people = set()
    for principal in allowed:
        people |= members.get(principal, {principal} if _is_user(principal) else set())
    return {"kind": _kind(allowed), "people": len(people - denied)}


def _kind(allowed: set[str]) -> AudienceKind:
    if "$PUBLIC" in allowed:
        return "public"
    if "$GENERAL" in allowed:
        return "organization"
    if any(principal.startswith("$LINK:") for principal in allowed):
        return "link"
    return "people"


def _group_members(principals: Iterable[str]) -> dict[str, set[str]]:
    """Answer each `$GROUP:<name>` principal's users, in one query."""
    groups = {
        principal.removeprefix("$GROUP:") for principal in principals if principal.startswith("$GROUP:")
    }
    if not groups:
        return {}
    members = defaultdict(set)
    for row in frappe.get_all(
        "User Group Member",
        filters={"parenttype": "User Group", "parent": ("in", sorted(groups))},
        fields=["parent", "user"],
    ):
        members[f"$GROUP:{row.parent}"].add(row.user)
    # A group with no members still answers, so it is not counted as one person.
    return {f"$GROUP:{group}": members[f"$GROUP:{group}"] for group in groups}


def _is_user(principal: str) -> bool:
    """Every principal that is not a user starts with `$` (§4.4)."""
    return not principal.startswith("$")
