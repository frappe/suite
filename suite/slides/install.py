"""Seed the two shipped template decks, Light and Dark, on install and migrate.

§8.10 puts a shipped template in Administrator's Personal root under a
`Templates` folder, as a document whose node carries `is_template`, with a
`$GENERAL` READ grant so every signed-in user may start from it and a
logged-out visitor may not. The template picker (`get_templates`) finds a
system template by its node title and draws the shipped layout thumbnails for
it, so the titles here are the ones `SYSTEM_TEMPLATE_TITLES` names.

Each ships as a ready-made presentation in `templates/system_templates.json`,
the state the converter made once from the old rows file, and that state is
the new deck's start. A template's
`theme` is empty by rule (a deck made from a template names the template in
`theme`; the template itself names nothing), so neither file carries one.

The seed is idempotent: a title that already has an Active template node is
left alone, so a migrated site keeps the decks Build converted and a rerun
after a failed migrate creates only what is missing. Everything runs as
Administrator inside the caller's transaction and commits nothing.

Two steps reach below the `suite.drive` facade, each marked where it happens:
`ensure_personal_root` refuses Administrator by design, and the facade exposes
no grant workflow. Both are debt owed to Drive, not a Slides decision.
"""

import base64
import json
from pathlib import Path

import frappe

from suite import content, drive
from suite.content import checkpoints
from suite.slides import drive as slides_drive
from suite.slides.content import APP, SCHEMA

ADMINISTRATOR = "Administrator"
TEMPLATES_FOLDER = "Templates"
SHIPPED_FILE = Path(__file__).with_name("templates") / "system_templates.json"


def seed_system_templates() -> list[str]:
    """Create the shipped template decks that are missing; answer the new nodes."""
    user = frappe.session.user
    frappe.set_user(ADMINISTRATOR)
    try:
        missing = _missing_templates()
        if not missing:
            return []
        folder = _templates_folder()
        return [_seed(folder, title) for title in missing]
    finally:
        frappe.set_user(user)


def _missing_templates() -> list[str]:
    titles = [template["title"] for template in shipped_templates()]
    present = set(
        frappe.get_all(
            "Drive Node",
            filters={
                "content_doctype": slides_drive.DOCTYPE,
                "is_template": 1,
                "state": "Active",
                "title": ["in", titles],
            },
            pluck="title",
        )
    )
    return [title for title in titles if title not in present]


def shipped_templates() -> list[dict]:
    """Answer each shipped template's title and the presentation state it starts from, base64."""
    return json.loads(SHIPPED_FILE.read_text(encoding="utf-8"))


def _templates_folder() -> str:
    root = drive.personal_root_for(ADMINISTRATOR) or _administrator_root()
    return drive.ensure_folder(root, TEMPLATES_FOLDER)


def _administrator_root() -> str:
    # Below the facade: `drive.ensure_personal_root` answers None for
    # Administrator, and §8.10 places shipped templates in Administrator's
    # Personal root. Build (`patches/build/templates.py`) makes the same root.
    from suite.drive._core.roots import PERSONAL, create_root

    return create_root(kind=PERSONAL, title="My Drive", user=ADMINISTRATOR).name


def _seed(folder: str, title: str) -> str:
    node = drive.create_document(folder, title, content_doctype=slides_drive.DOCTYPE, is_template=True)
    found = content.find(APP, node)
    if found is None:
        raise RuntimeError(f"Slides collaboration must be on to seed {title!r}")

    state = next(template["state"] for template in shipped_templates() if template["title"] == title)
    checkpoints.replace_start(APP, found.id, base64.b64decode(state), SCHEMA.version)
    _grant_general_read(node)
    return node


def _grant_general_read(node: str) -> None:
    # Below the facade: `suite.drive` exposes no grant workflow. The grant sits
    # on the deck, not the folder, as §8.10 and Build both place it, so the
    # folder itself is nobody's shared item.
    from suite.drive._core.access import grant
    from suite.drive.framework import principals_for_request

    grant(node, "$GENERAL", drive.READ, principals_for_request())
