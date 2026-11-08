"""Who can open a node, as a kind and a head count, for a listing's Access column.

An audience names nobody. It says how wide a node's sharing is: public on the
web, everyone at the organization, anyone with a link, or a number of people.
The share dialog is where names are shown, to those who manage the node.
"""

from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping
from typing import Literal

import frappe
from frappe.utils import now

from suite.drive._core.access import EXPLAIN_SQL, Acc, chain_ids
from suite.drive._core.principals import Principals

AudienceKind = Literal["public", "organization", "link", "people"]


def audiences(rows: Iterable[Mapping]) -> dict[str, dict]:
    """Answer each row's audience, keyed by node name.

    A page costs two queries whatever its size: the live grants on every row's
    chain, and the members of the groups among them.
    """
    chains = {row["name"]: chain_ids(row) for row in rows}
    if not chains:
        return {}
    every_node = sorted({node for chain in chains.values() for node in chain})
    grants = frappe.db.sql(EXPLAIN_SQL, {"chain": every_node, "now": now()}, as_dict=True)
    by_node = defaultdict(list)
    for grant in grants:
        by_node[grant.node].append(grant)
    members = _group_members({grant.principal for grant in grants})
    return {name: _audience(chain, by_node, members) for name, chain in chains.items()}


def _audience(chain: list[str], by_node: Mapping[str, list], members: Mapping[str, set[str]]) -> dict:
    # Root first, so a grant nearer the node comes after one further up.
    grants = [grant for node in chain for grant in by_node.get(node, ())]
    depth = {node: index for index, node in enumerate(chain)}
    return {"kind": _kind(grants), "people": _people(grants, depth, members)}


def _kind(grants: list) -> AudienceKind:
    nearest = {grant.principal: grant.role for grant in grants}
    allowed = {principal for principal, role in nearest.items() if role}
    if "$PUBLIC" in allowed:
        return "public"
    if "$GENERAL" in allowed:
        return "organization"
    if any(principal.startswith("$LINK:") for principal in allowed):
        return "link"
    return "people"


def _people(grants: list, depth: Mapping[str, int], members: Mapping[str, set[str]]) -> int:
    """Count the named people `Acc` lets open the node.

    People who hold the same grants get the same answer, so a large group costs one resolution.
    """
    on_chain = {grant.principal for grant in grants}
    groups_of = defaultdict(list)
    for group in on_chain & members.keys():
        for user in members[group]:
            groups_of[user].append(group)
    named = {principal for principal in on_chain if _is_user(principal)}
    held_by = Counter(
        tuple(principal for principal in (user, *groups_of[user], "$GENERAL") if principal in on_chain)
        for user in named | groups_of.keys()
    )
    return sum(count for held, count in held_by.items() if _can_open(held, grants, depth))


def _can_open(held: tuple[str, ...], grants: list, depth: Mapping[str, int]) -> bool:
    user = next((principal for principal in held if _is_user(principal)), "")
    principals = Principals(user=user, own=held, open=())
    acc = Acc()
    for grant in grants:
        acc.offer(grant.principal, grant.role, depth[grant.node], principals)
    return acc.answer() > 0


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
    return members


def _is_user(principal: str) -> bool:
    """Every principal that is not a user starts with `$` (§4.4)."""
    return not principal.startswith("$")
