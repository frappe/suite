"""Seed the two shipped template decks, Light and Dark, on install and migrate.

§8.10 puts a shipped template in Administrator's Personal root under a
`Templates` folder, as a document whose node carries `is_template`, with a
`$GENERAL` READ grant so every signed-in user may start from it and a
logged-out visitor may not. The template picker (`get_templates`) finds a
system template by its node title and draws the shipped layout thumbnails for
it, so the titles here are the ones `SYSTEM_TEMPLATE_TITLES` names.

The deck bodies live in `templates/presentation_templates.json`: a title and
seven slides each. A template's `theme` is empty by rule (a deck made from a
template names the template in `theme`; the template itself names nothing), so
the file carries none.

The seed is idempotent: a title that already has an Active template node is
left alone, so a migrated site keeps the decks Build converted and a rerun
after a failed migrate creates only what is missing. Everything runs as
Administrator inside the caller's transaction and commits nothing.

Two steps reach below the `suite.drive` facade, each marked where it happens:
`ensure_personal_root` refuses Administrator by design, and the facade exposes
no grant workflow. Both are debt owed to Drive, not a Slides decision.
"""

import json
from pathlib import Path

import frappe

from suite import drive
from suite.slides import drive as slides_drive

ADMINISTRATOR = "Administrator"
TEMPLATES_FOLDER = "Templates"
TEMPLATES_FILE = Path(__file__).with_name("templates") / "presentation_templates.json"


def seed_system_templates() -> list[str]:
    """Create the shipped template decks that are missing; answer the new nodes."""
    user = frappe.session.user
    frappe.set_user(ADMINISTRATOR)
    try:
        missing = _missing_templates()
        if not missing:
            return []
        folder = _templates_folder()
        return [_seed(folder, template) for template in missing]
    finally:
        frappe.set_user(user)


def _missing_templates() -> list[dict]:
    templates = json.loads(TEMPLATES_FILE.read_text(encoding="utf-8"))
    present = set(
        frappe.get_all(
            "Drive Node",
            filters={
                "content_doctype": slides_drive.DOCTYPE,
                "is_template": 1,
                "state": "Active",
                "title": ["in", [template["title"] for template in templates]],
            },
            pluck="title",
        )
    )
    return [template for template in templates if template["title"] not in present]


def _templates_folder() -> str:
    root = drive.personal_root_for(ADMINISTRATOR) or _administrator_root()
    return drive.ensure_folder(root, TEMPLATES_FOLDER)


def _administrator_root() -> str:
    # Below the facade: `drive.ensure_personal_root` answers None for
    # Administrator, and §8.10 places shipped templates in Administrator's
    # Personal root. Build (`patches/build/templates.py`) makes the same root.
    from suite.drive._core.roots import PERSONAL, create_root

    return create_root(kind=PERSONAL, title="My Drive", user=ADMINISTRATOR).name


def _seed(folder: str, template: dict) -> str:
    node = drive.create_document(
        folder, template["title"], content_doctype=slides_drive.DOCTYPE, is_template=True
    )
    deck = frappe.get_doc(slides_drive.DOCTYPE, slides_drive.docname_for_node(node))
    # `create_empty` gave the deck one blank slide; the template body replaces it.
    deck.slides = []
    for slide in template["slides"]:
        deck.append("slides", slide)
    deck.save(ignore_permissions=True)
    _grant_general_read(node)
    return node


def _grant_general_read(node: str) -> None:
    # Below the facade: `suite.drive` exposes no grant workflow. The grant sits
    # on the deck, not the folder, as §8.10 and Build both place it, so the
    # folder itself is nobody's shared item.
    from suite.drive._core.access import grant
    from suite.drive.framework import principals_for_request

    grant(node, "$GENERAL", drive.READ, principals_for_request())
