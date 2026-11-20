"""Names for the recovery copies a device keeps of presentations (Q16).

An old draft names only its presentation and a page copy only its node, so the
recovery page reads each one's node and title here. A presentation the person
can't read answers nothing, so a copy never tells them a title they could not see.
Each name says whether the person can edit, as the room checks it: only an editor is
shown a draft this device kept for no one.
"""

import frappe
from frappe import _

from suite import drive
from suite.content.http.routes import can_access
from suite.slides import drive as slides_drive

# The most names one read takes; the page reads in batches of this size
NAMES_LIMIT = 200


@frappe.whitelist(methods=["POST"])
def recovery_names(presentations: list[str], nodes: list[str]) -> list[dict]:
    """Each named presentation the person can read, with its node, title and whether they can edit."""
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
            can_edit = frappe.session.user != "Guest" and can_access(row.node, drive.EDIT)
            names.append({"presentation": row.name, "node": row.node, "title": title, "can_edit": can_edit})

    return names
