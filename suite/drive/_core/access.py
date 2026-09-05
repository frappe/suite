"""Point access resolution for Drive nodes."""

import dataclasses
from collections.abc import Mapping

import frappe
from frappe import _
from frappe.utils import now

from suite.drive._core.errors import DriveForbidden, DriveNotFound
from suite.drive._core.principals import Principals
from suite.drive._core.roles import EDIT, MANAGE, READ

POINT_SQL = """
SELECT node, principal, role
FROM `tabDrive Grant`
WHERE node IN %(chain)s
  AND principal IN %(principals)s
  AND (expires_on IS NULL OR expires_on > %(now)s)
"""


def chain_ids(node: Mapping) -> list[str]:
    """Return a root-first chain without querying the database."""
    if node.get("kind") == "root":
        return [node.get("name")]

    ids = [node.get("root")]
    if node.get("path"):
        ids.extend(node.get("path").strip("/").split("/"))
    ids.append(node.get("name"))
    return ids


def own_tier(principal: str, user: str) -> int:
    """Order own principals: the user, then groups, then the site principal."""
    if principal == user:
        return 0
    if principal.startswith("$GROUP:"):
        return 1
    return 2


@dataclasses.dataclass
class Acc:
    """Nearest-wins state for one node."""

    own: int | None = None
    own_depth: int = -1
    own_tier: int = 9
    open: int | None = None
    open_depth: int = -1

    def copy(self) -> "Acc":
        return dataclasses.replace(self)

    def offer(self, principal: str, role: int, depth: int, principals: Principals) -> None:
        if principal in principals.own:
            tier = own_tier(principal, principals.user)
            if depth > self.own_depth:
                self.own, self.own_depth, self.own_tier = role, depth, tier
            elif depth == self.own_depth and tier < self.own_tier:
                self.own, self.own_tier = role, tier
            elif depth == self.own_depth and tier == self.own_tier:
                if self.own == 0 or role == 0:
                    self.own = 0
                else:
                    self.own = max(self.own, role)
        elif principal in principals.open:
            if depth > self.open_depth:
                self.open, self.open_depth = role, depth
            elif depth == self.open_depth and role > (self.open or 0):
                self.open = role

    def answer(self) -> int:
        if self.own == 0:
            return 0
        return max(self.own or 0, self.open or 0)


def effective_role(node: Mapping, principals: Principals) -> int:
    """Resolve one node from its materialized ancestry and current grant rows."""
    if principals.is_admin:
        return MANAGE
    if not principals.all():
        return 0

    chain = chain_ids(node)
    depth = {node_id: index for index, node_id in enumerate(chain)}
    rows = frappe.db.sql(
        POINT_SQL,
        {"chain": chain, "principals": principals.all(), "now": now()},
        as_dict=True,
    )
    acc = Acc()
    for row in rows:
        acc.offer(row.principal, row.role, depth[row.node], principals)
    return acc.answer()


def check(node: Mapping, need: int, principals: Principals) -> bool:
    return effective_role(node, principals) >= need


def require(node: Mapping, need: int, principals: Principals) -> None:
    """Require a role while hiding unreadable nodes behind a not-found failure."""
    role = effective_role(node, principals)
    if role >= need:
        return
    if role < READ:
        raise DriveNotFound(_("Drive node {0} was not found").format(node.get("name")))
    raise DriveForbidden(
        _("You do not have the required access to Drive node {0}").format(node.get("name"))
    )


def add_creator_grant(
    node: Mapping,
    parent: Mapping,
    principals: Principals,
    *,
    via_link: str | None = None,
) -> bool:
    """Give a signed-in non-link creator EDIT when the parent gives less than EDIT."""
    if principals.user == "Guest" or via_link or effective_role(parent, principals) >= EDIT:
        return False

    frappe.get_doc(
        {
            "doctype": "Drive Grant",
            "node": node.get("name"),
            "principal": principals.user,
            "role": EDIT,
        }
    ).insert(ignore_permissions=True)
    return True
