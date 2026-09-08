# Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

import base64
import uuid
from contextlib import contextmanager

import frappe

from suite import drive
from suite.drive._core.access import grant, revoke
from suite.drive._core.nodes import update
from suite.drive._core.principals import Principals
from suite.drive._core.roles import READ
from suite.slides import drive as slides_drive
from suite.tests.utils import ensure_user

# Ticket 29 registered `Presentation` in `drive_content_types`, so a deck with
# no node cannot be inserted any more (`content.require_node`). Every fixture
# here is a Drive-native deck, and a deck lives under a Personal root, which
# §7 gives only to an ordinary Suite user. A fixture run as Administrator
# borrows this one rather than inventing a root Drive would refuse.
FIXTURE_OWNER = "slides-fixture-owner@example.com"

PNG_1PX = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
WEBP_1PX = "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v02aAA="


def unique_bytes(base64_data):
    # unique trailing bytes per call: frappe dedupes Files by content hash, which
    # would otherwise share one file_url across unrelated test fixtures
    return base64.b64decode(base64_data.split(",", 1)[-1]) + uuid.uuid4().bytes


def make_thumbnail_data():
    """A distinct webp data URI, in the only format save_presentation_thumbnail accepts."""
    return "data:image/webp;base64," + base64.b64encode(unique_bytes(WEBP_1PX)).decode()


def make_presentation(title, parent=None, **fields):
    """One node-backed deck, the only kind `Presentation` can be (§5.13).

    `drive.create_document` inserts the node, runs Slides' `create_empty`
    factory (one empty slide, as this fixture always made), links the two, and
    charges the owning root — all in one savepoint. The returned document is
    the deck, so every caller that reads `.name`, `.slides`, or saves it keeps
    working. `.title` stays empty: Drive owns the title and the legacy column
    is frozen (§10.2), so writing it here would make the next `save()` refuse.
    Read it with `title_of` instead.

    `fields` are extra legacy body columns a case needs (`is_composite`,
    `reference_presentations`), written after the deck exists.
    """
    with _deck_owner() as owner:
        node = drive.create_document(
            parent or _personal_root(owner),
            title,
            content_doctype=slides_drive.DOCTYPE,
            is_template=bool(fields.pop("is_template", False)),
        )
        deck = frappe.get_doc(slides_drive.DOCTYPE, slides_drive.docname_for_node(node))
        if fields:
            deck.update(fields)
            deck.save()
    return deck


def node_of(presentation_name):
    """The Drive node one fixture deck lives on."""
    return frappe.db.get_value("Presentation", presentation_name, slides_drive.NODE_FIELD)


def title_of(presentation_name):
    """One deck's title, which lives on its node (§10.2)."""
    return frappe.db.get_value("Drive Node", node_of(presentation_name), "title")


@contextmanager
def _deck_owner():
    """Run the create as somebody who may own a Personal root (§7)."""
    user = frappe.session.user
    if user not in ("Guest", "Administrator"):
        yield user
        return
    ensure_user(FIXTURE_OWNER)
    frappe.set_user(FIXTURE_OWNER)
    try:
        yield FIXTURE_OWNER
    finally:
        frappe.set_user(user)


def _personal_root(user):
    return drive.personal_root_for(user) or drive.ensure_personal_root(user)


def _principals():
    user = frappe.session.user
    return Principals(user, (user, "$GENERAL"), ("$PUBLIC",), is_admin=user == "Administrator")


def make_private_image(presentation_name, content=None):
    if content is None:
        content = unique_bytes(PNG_1PX)

    return frappe.get_doc(
        {
            "doctype": "File",
            "file_name": "private-image.png",
            "content": content,
            "is_private": 1,
            "attached_to_doctype": "Presentation",
            "attached_to_name": presentation_name,
        }
    ).insert()


def make_public(presentation_name):
    """Publish one deck: `$PUBLIC` READ on its node, which is what §6.1 calls open."""
    grant(node_of(presentation_name), "$PUBLIC", READ, _principals())


def make_private(presentation_name):
    """Undo `make_public`. §5.10 keeps removal and denial apart, so this removes."""
    revoke(node_of(presentation_name), "$PUBLIC", _principals())


def share(presentation_name, user, role=READ):
    """Give one person a role on a deck, so a case can separate the two refusals.

    §5.4 answers `DriveNotFound` below Read and `DriveForbidden` at or above
    it, so a case that wants the second one has to grant the first.
    """
    grant(node_of(presentation_name), user, role, _principals())


def trash(presentation_name):
    """Put one deck in the trash, the way Drive's own delete does.

    A trashed node is still a row, and its `Presentation` row is untouched, so
    a case can tell "Drive hides it" apart from "it is gone".
    """
    frappe.set_user("Administrator")
    admin = Principals("Administrator", ("Administrator",), (), is_admin=True)
    update(admin, node_of(presentation_name), state="Trashed")
