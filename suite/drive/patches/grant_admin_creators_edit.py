import frappe

from suite.drive._core.access import add_creator_grant
from suite.drive._core.nodes import _node
from suite.drive.framework import principals_for

# Nodes a Suite Admin created without a link and holds no grant on. The old
# override skipped the creator grant for them (ADR 0001).
UNGRANTED_SQL = """
SELECT n.name, n.owner, n.parent_node
FROM `tabDrive Node` n
LEFT JOIN `tabDrive Node` p ON p.name = n.parent_node
WHERE n.owner IN %(admins)s
  AND n.kind <> 'root'
  AND n.parent_node IS NOT NULL
  -- Media under a presentation takes its rights from it: the rule of `build.grants.is_presentation_media`
  AND COALESCE(p.content_doctype, '') <> 'Presentation'
  AND NOT EXISTS (
    SELECT 1 FROM `tabDrive Grant` g WHERE g.node = n.name AND g.principal = n.owner
  )
  AND NOT EXISTS (
    SELECT 1 FROM `tabDrive Activity` a
    WHERE a.node = n.name AND a.action = 'create' AND COALESCE(a.via_link, '') <> ''
  )
ORDER BY n.creation
"""


def execute() -> None:
    """Give Suite Admins the creator grant their override used to skip.

    A Suite Admin no longer edits through the override, so what they created
    needs the Edit grant anyone else got at creation. The rule is the one
    creation applies: Edit when the parent gives the creator less. It only
    adds a grant where the creator has no row of their own on the node.
    """
    admins = tuple(
        user
        for user in frappe.get_all(
            "Has Role", filters={"role": "Suite Admin", "parenttype": "User"}, pluck="parent", distinct=True
        )
        if user not in ("Administrator", "Guest")
    )
    if not admins:
        return
    principals = {}
    parents = {}
    for row in frappe.db.sql(UNGRANTED_SQL, {"admins": admins}, as_dict=True):
        if row.owner not in principals:
            principals[row.owner] = principals_for(row.owner)
        if row.parent_node not in parents:
            parents[row.parent_node] = _node(row.parent_node)
        add_creator_grant({"name": row.name}, parents[row.parent_node], principals[row.owner])
