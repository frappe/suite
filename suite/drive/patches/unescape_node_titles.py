import frappe

from suite.drive._core.nodes import _free_title

# What Frappe's HTML sanitizer wrote for these characters in titles created before
# `Drive Node.title` ignored the XSS filter. `&amp;` goes last so `&amp;lt;` reads `&lt;`.
ESCAPED = (("&lt;", "<"), ("&gt;", ">"), ("&nbsp;", "\u00a0"), ("&amp;", "&"))


def unescape_title(title: str) -> str:
    for entity, character in ESCAPED:
        title = title.replace(entity, character)
    return title


def execute() -> None:
    """Undo the HTML escaping that node titles got on insert, keeping sibling titles unique."""
    condition = " OR ".join(f"title LIKE '%%{entity}%%'" for entity, _ in ESCAPED)
    nodes = frappe.db.sql(
        f"SELECT name, parent_node, title FROM `tabDrive Node` WHERE {condition} ORDER BY creation",
        as_dict=True,
    )
    for node in nodes:
        title = unescape_title(node.title)
        if node.parent_node:
            title = _free_title(node.parent_node, title, exclude=node.name, for_update=False)
        frappe.db.set_value("Drive Node", node.name, "title", title, update_modified=False)
