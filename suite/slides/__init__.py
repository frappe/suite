"""What other Suite modules may ask of Slides."""

import json

import frappe
from frappe import _


def create_deck(parent: str, title: str, slides: list[list[dict]]) -> str:
    """Create a deck in the Drive folder `parent` with `slides`, and return its node.

    Each slide is its list of elements, as the editor stores them. The slides
    have a white background and no transition. The session user must be able to
    add to `parent`.
    """
    # Local: Slides' own DocTypes import this package, so it loads nothing from Drive up front.
    from suite import drive
    from suite.slides.drive import DOCTYPE, docname_for_node

    node = drive.create_document(parent, title, content_doctype=DOCTYPE)
    docname = docname_for_node(node)
    if not docname:
        raise drive.DriveNotFound(_("That presentation was not found"))
    deck = frappe.get_doc(DOCTYPE, docname)
    deck.slides = []
    for elements in slides:
        deck.append(
            "slides",
            {
                "background": "#FFFFFFFF",
                "elements": json.dumps(elements),
                "transition": "None",
                "transition_duration": "0",
            },
        )
    deck.save(ignore_permissions=True)
    return node
