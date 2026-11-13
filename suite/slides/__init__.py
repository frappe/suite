"""What other Suite modules may ask of Slides."""

import json

import frappe
from frappe import _


def create_deck(parent: str, title: str, slides: list[list[dict]]) -> str:
    """Create a deck in the Drive folder `parent` with `slides`, and return its node.

    Each slide is its list of elements, as the editor stores them. The session
    user must be able to add to `parent`. With Slides collaboration on, the
    deck starts from `slides` in this transaction, so they must be starter
    text elements (`suite.slides.content.starter`).
    """
    # Local: Slides' own DocTypes import this package, so it loads nothing from Drive up front.
    from suite import content, drive
    from suite.content import checkpoints
    from suite.slides.content import APP, SCHEMA, starter
    from suite.slides.drive import DOCTYPE, docname_for_node

    node = drive.create_document(parent, title, content_doctype=DOCTYPE)
    docname = docname_for_node(node)
    if not docname:
        raise drive.DriveNotFound(_("That presentation was not found"))

    # The log is the deck once it has one, so rows would never be read
    found = content.find(APP, node)
    if found:
        checkpoints.replace_start(APP, found.id, starter.deck_state(slides), SCHEMA.version)
        return node

    deck = frappe.get_doc(DOCTYPE, docname)
    deck.slides = []
    for elements in slides:
        deck.append("slides", slide_row(elements))

    deck.save(ignore_permissions=True)
    return node


def slide_row(elements: list[dict]) -> dict:
    """One slide's row: `elements` on a white background, with no transition."""
    return {
        "background": "#FFFFFFFF",
        "elements": json.dumps(elements),
        "transition": "None",
        "transition_duration": "0",
    }
