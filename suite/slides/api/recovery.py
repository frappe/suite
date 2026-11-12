"""Names for the recovery copies a device keeps of presentations (Q16).

An old draft names only its presentation and a page copy only its node, so the
recovery page reads each one's node and title here. A presentation the person
can't read answers nothing, so a copy never tells them a title they could not see.
"""

import frappe
from frappe import _

from suite.slides import drive as slides_drive

# Far more copies than one device keeps, so the page's one read stays small
NAMES_LIMIT = 200


@frappe.whitelist(methods=["POST"])
def recovery_names(presentations: list[str], nodes: list[str]) -> list[dict]:
    """Each named presentation the person can read, with its node and title."""
    if len(presentations) + len(nodes) > NAMES_LIMIT:
        frappe.throw(_("Too many presentations"), frappe.ValidationError)

    if not presentations and not nodes:
        return []

    rows = frappe.get_all(
        "Presentation",
        or_filters={"name": ["in", presentations or [""]], "node": ["in", nodes or [""]]},
        filters={"node": ["is", "set"]},
        fields=["name", "node"],
    )
    names: list[dict] = []
    for row in rows:
        if slides_drive.node_is_readable(row.node):
            title = slides_drive.node_title_of(row.node)
            names.append({"presentation": row.name, "node": row.node, "title": title})

    return names
