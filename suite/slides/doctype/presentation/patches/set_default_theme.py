import frappe

from suite.slides.doctype.presentation.presentation import default_theme


def execute():
    """Name the default theme on decks Drive created blank before `before_insert` did.

    A deck with no `theme` cannot add a slide: the layout picker finds no
    template. Templates keep their empty theme by rule.
    """
    theme = default_theme()
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
