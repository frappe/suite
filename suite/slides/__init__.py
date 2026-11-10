"""What other Suite modules may ask of Slides."""

import json

import frappe
from frappe import _


def create_deck(parent: str, title: str, slides: list[list[dict]]) -> str:
    """Create a deck in the Drive folder `parent` with `slides`, and return its node.

    Each slide is its list of elements, as the editor stores them. The session
    user must be able to add to `parent`. With Slides collaboration on, the
    converter writes the slides in a background job once this transaction
    commits, and a deck someone edits before then keeps only their edits.
    """
    # Local: Slides' own DocTypes import this package, so it loads nothing from Drive up front.
    from suite import content, drive
    from suite.content import scheduling
    from suite.slides.content import APP
    from suite.slides.drive import DOCTYPE, docname_for_node

    node = drive.create_document(parent, title, content_doctype=DOCTYPE)
    docname = docname_for_node(node)
    if not docname:
        raise drive.DriveNotFound(_("That presentation was not found"))

    rows = [slide_row(elements) for elements in slides]
    # The log is the deck once it has one, so the rows would never be read
    if content.find(APP, node):
        seed = "suite.slides.content.conversion.seed"
        scheduling.enqueue(
            seed, f"suite-slides-seed-{node}", node=node, slides=rows, enqueue_after_commit=True
        )
        return node

    deck = frappe.get_doc(DOCTYPE, docname)
    deck.slides = []
    for row in rows:
        deck.append("slides", row)

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
