"""What other Suite modules may ask of Slides."""

from frappe import _


def fill_new_deck(node: str, slides: list[list[dict]]) -> None:
    """Replace the blank slide of a deck that was just created with `slides`.

    Each slide is its list of elements, as the editor stores them. The slides
    have a white background and no transition. The session user must be able to
    write the deck.
    """
    import json

    import frappe

    from suite import drive
    from suite.slides.drive import DOCTYPE, docname_for_node

    docname = docname_for_node(node)
    if not docname:
        raise drive.DriveNotFound(_("That presentation was not found"))
    drive.check(node, drive.EDIT)
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
