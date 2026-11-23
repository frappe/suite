import frappe

from suite.slides.drive import light_template


def execute():
    """Name the Light theme on decks Drive created blank before `create_empty` did.

    A deck with no `theme` cannot add a slide: the layout picker finds no
    template. Templates keep their empty theme by rule.
    """
    theme = light_template()
    if not theme:
        return

    presentation = frappe.qb.DocType("Presentation")
    node = frappe.qb.DocType("Drive Node")
    (
        frappe.qb.update(presentation)
        .join(node)
        .on(node.name == presentation.node)
        .set(presentation.theme, theme)
        .where((presentation.theme.isnull()) | (presentation.theme == ""))
        .where(node.is_template == 0)
        .run()
    )
