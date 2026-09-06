"""Slides' one declaration to Drive (§10.7).

Drive owns a deck's title, place, grants, lifecycle, versions, comments,
previews, and byte charge. Slides owns the body: the `Slide` child rows, their
`elements` JSON, the `theme`, and the composite's reference list. Everything
Drive needs is the `SPEC` below, registered through the `drive_content_types`
hook.

Every callable here takes and returns names, never documents, and reaches Drive
only through `from suite import drive` (ARCHITECTURE.md, rule 2.2).

## Where a media id lives in a deck

A Drive-native deck names its pictures by node id, in three places (§10.7,
§14.7):

- `Slide.background`, when the slide has a picture behind it;
- an element's `src`, for an image or a video;
- an element's `poster`, which is a string today and may be a dict in a legacy
  row Build rewrites.

A node name is an opaque hash, so a value is read as a media reference when it
is one whole id-shaped token. That is deliberately loose in one direction and
never in the other. A colour (`#00ff00ff`) and a legacy URL (`/private/files/…`)
carry characters an id cannot, so they are never mistaken for one. A bare word
that happens to be id-shaped is reported as used and is left unmapped by a copy,
because `used_nodes` over-reporting only keeps media alive and `remap_media`
rewrites nothing it was not given.

An `elements` column that will not parse is not folded into "this slide names
nothing". `used_nodes` falls back to a raw token scan, which over-reports; the
same column refuses a copy, because a copy whose pictures still point at the
source's nodes is worse than a refused copy.

## Media across decks

`adopt_media` is the Drive workflow behind a cross-deck paste. Slides hands it
the ids a pasted slide names and applies the mapping it answers. Blobs are
shared, the destination deck owns the new nodes, and one deck holds one node per
blob however many times a picture is pasted.

## Versions

`version_bytes` writes one `presentation/1` JSON envelope carrying the slides,
the theme, and the composite reference list. `restore_version` reads the same
envelope back and refuses anything else, so a payload written before Drive
history cannot half-restore a deck. §14.7 does not migrate deck history, so
Build owes no envelope; see the ticket 18 handoffs.

## Transactions

Drive runs every callback inside the savepoint of the workflow that calls it, so
any refusal rolls the node, the deck, and the copied media back together. A
callback that cannot honour its contract raises rather than half-writing, and
none of them commits. `content.call_app` and `content.call_app_stream` enforce
that last part.
"""

import io
import json
import re

import frappe
from frappe import _

from suite import drive

DOCTYPE = "Presentation"
MIME = "frappe/slides"
NODE_FIELD = "node"

# §10.7: the deck's slides take their rights from the deck's node. Drive
# supplies the row check and the list filter; Slides writes no permission code.
SATELLITE_DOCTYPE = "Slide"
SATELLITE_LINK_FIELD = "parent"
SATELLITE_PARENT_FIELD = "slides"

VERSION_SCHEMA = "presentation/1"
VERSION_MIME = "application/json"

PREVIEW_MIME = "image/webp"

# A media reference is one whole node id. Node names are opaque hashes, so a
# colour and a `/files/` URL both fail this and a body value is never mistaken
# for a picture.
MEDIA_ID = re.compile(r"[A-Za-z0-9_-]{1,140}")
# What a raw scan of an unparseable `elements` column may look at. It
# over-reports, which only keeps media alive.
MEDIA_TOKEN = re.compile(r"[A-Za-z0-9_-]{6,140}")

# The element keys that carry a picture (§10.7). `attachmentName` is the legacy
# `File` name beside them; §14.7 drops it at Build and nothing here writes one.
ELEMENT_MEDIA_KEYS = ("src", "poster")

SLIDE_BODY_FIELDS = (
    "background",
    "elements",
    "client_id",
    "thumbnail",
    "transition",
    "transition_duration",
    "fade_unmatched_elements",
)


class UnreadableBody(frappe.ValidationError):
    """One deck body Slides could not read."""


def create_empty(node: str) -> str:
    """Insert one empty deck bound to `node`.

    The deck carries no title: Drive owns it, and §10.2 forbids a mirror in
    either direction. `title` survives as a legacy column until Cleanup drops
    it, and nothing here reads or writes it.
    """
    deck = frappe.new_doc(DOCTYPE)
    deck.node = node
    deck.append("slides", {"elements": "[]"})
    deck.insert(ignore_permissions=True)
    return deck.name


def duplicate(source_docname: str, node: str) -> str:
    """Copy one deck body under a new node, for copy and new-from-template.

    The slides, the theme, and the composite reference list are carried. The
    title, the template flag, and the legacy thumbnail are not: Drive owns the
    first two, and §8.9 copies the preview row itself.
    """
    source = frappe.get_doc(DOCTYPE, source_docname)
    deck = frappe.new_doc(DOCTYPE)
    deck.node = node
    deck.theme = source.theme
    deck.is_composite = source.is_composite
    for slide in source.slides:
        deck.append("slides", {field: slide.get(field) for field in SLIDE_BODY_FIELDS})
    for reference in source.reference_presentations:
        deck.append("reference_presentations", {"presentation": reference.presentation})
    deck.insert(ignore_permissions=True)
    return deck.name


def version_bytes(docname: str) -> tuple[io.BytesIO, str]:
    """Return the bytes Drive stores as one immutable version."""
    deck = frappe.db.get_value(DOCTYPE, docname, ("theme", "is_composite"), as_dict=True)
    if not deck:
        frappe.throw(_("That presentation was not found"), frappe.DoesNotExistError)
    payload = {
        "schema": VERSION_SCHEMA,
        "theme": deck.theme,
        "is_composite": int(deck.is_composite or 0),
        "slides": [{field: row.get(field) for field in SLIDE_BODY_FIELDS} for row in _slide_rows(docname)],
        "references": _reference_names(docname),
    }
    return io.BytesIO(json.dumps(payload).encode("utf-8")), VERSION_MIME


def restore_version(docname: str, stream) -> None:
    """Put one stored version back into the deck.

    Drive has already taken a version of the current state, so this is not
    destructive. A payload that is not a `presentation/1` envelope is refused
    rather than half-applied.
    """
    payload = _version_payload(stream.read())
    deck = frappe.get_doc(DOCTYPE, docname)
    deck.theme = payload["theme"]
    deck.is_composite = payload["is_composite"]
    deck.slides = []
    for slide in payload["slides"]:
        deck.append("slides", {field: slide.get(field) for field in SLIDE_BODY_FIELDS})
    deck.reference_presentations = []
    for reference in payload["references"]:
        deck.append("reference_presentations", {"presentation": reference})
    deck.save(ignore_permissions=True)


def on_purge(docname: str) -> None:
    """Delete the deck and the app-owned rows behind it.

    `delete_permanently` is what makes a purge a purge. Without it Frappe keeps
    the whole row as JSON in `Deleted Document`
    (`frappe/model/delete_doc.py:add_to_deleted_document`), so every slide would
    outlive the §8.8 purge that was meant to remove it.

    What still survives is the framework's own deletion feed: `delete_doc` ends
    with `insert_feed`, which writes a `Comment` naming the doctype, the deck
    name, and the owner's full name, with no `reference_name` for
    `delete_references` to match (`frappe/model/delete_doc.py:554-573`). It
    carries no deck body. Every Drive purge of every content type has it, so
    removing it is a framework decision, not this adapter's.
    """
    frappe.delete_doc(
        DOCTYPE,
        docname,
        force=1,
        ignore_permissions=True,
        ignore_missing=True,
        delete_permanently=True,
    )


def used_nodes(docname: str) -> set[str]:
    """Answer the media node ids this deck still names (§10.6)."""
    found: set[str] = set()
    for row in _slide_rows(docname):
        found |= _value_ids(row.get("background"))
        found |= _slide_element_ids(row)
    return found


def remap_media(docname: str, mapping: dict[str, str]) -> None:
    """Repoint this deck at the media nodes Drive copied for it (§8.9)."""
    if not mapping:
        return
    for row in _slide_rows(docname):
        values = {}
        background = mapping.get(row.get("background"))
        if background is not None:
            values["background"] = background
        elements = _elements_or_refuse(row)
        # Every element, not the first one that changes: `any` over a generator
        # stops at the first True and would leave the rest of the slide pointing
        # at the source deck's nodes.
        rewritten = [_remap_element(element, mapping) for element in elements]
        if any(rewritten):
            values["elements"] = json.dumps(elements)
        if values:
            frappe.db.set_value(SATELLITE_DOCTYPE, row["name"], values, update_modified=False)


SPEC = drive.ContentTypeSpec(
    doctype=DOCTYPE,
    mime=MIME,
    node_field=NODE_FIELD,
    # §10.7, accepted 2026-09-05: every content app stays hidden over WebDAV in
    # this release, and Slides offers no export format of its own.
    default_export=None,
    export_formats=(),
    create_empty=create_empty,
    duplicate=duplicate,
    export=None,
    version_bytes=version_bytes,
    restore_version=restore_version,
    # The browser captures the deck preview and pushes it through Drive (§9.2,
    # [012 §8]). Drive never renders a deck and gives it no gap sweep.
    pushes_preview=True,
    on_purge=on_purge,
    satellites=(drive.Satellite(doctype=SATELLITE_DOCTYPE, link_field=SATELLITE_LINK_FIELD),),
    # §14.7 reads this column at Build and §14.10 drops it at Cleanup, one
    # release after activation. Declaring it here is what lets ticket 29
    # activate without dropping a Build source early: the column stays, frozen,
    # and `refuse_legacy_field_write` refuses every write to it. `is_template`
    # and `thumbnail` need no entry; §10.2 forbids neither.
    legacy_fields=("title",),
    used_nodes=used_nodes,
    remap_media=remap_media,
)


# ---------------------------------------------------------------------------
# The Drive calls Slides makes. Every one of them is a linked-row path: a deck
# with no node keeps its legacy behaviour in `presentation.py` until Build links
# it (§14.7) and ticket 29 activates the registry.
# ---------------------------------------------------------------------------


def node_of(docname: str) -> str:
    """Return one deck's node, or refuse. A linked deck never answers from a File."""
    node = frappe.db.get_value(DOCTYPE, docname, NODE_FIELD)
    if not node:
        frappe.throw(_("That presentation is not in Drive yet"), frappe.ValidationError)
    return node


def elements_of(slide: dict) -> list[dict]:
    """Parse one slide's elements, or refuse. The caller owns the slide payload."""
    return _element_list(slide.get("elements"))


def adopt_slide_media(docname: str, slide: dict) -> dict:
    """Bring the media one pasted slide names under this deck, and repoint it.

    Cross-deck paste. `drive.adopt_media` shares the blob, gives this deck its
    own node, and reuses a node the deck already holds for the same picture, so
    pasting one logo onto twenty slides is one node and one charge (§8.9).
    """
    elements = _element_list(slide.get("elements"))
    named = _value_ids(slide.get("background"))
    for element in elements:
        named |= _element_ids(element)
    mapping = drive.adopt_media(node_of(docname), sorted(named))
    if not mapping:
        slide["elements"] = json.dumps(elements)
        return slide
    background = mapping.get(slide.get("background"))
    if background is not None:
        slide["background"] = background
    for element in elements:
        _remap_element(element, mapping)
    slide["elements"] = json.dumps(elements)
    return slide


def adopt_element_media(docname: str, elements: list[dict]) -> list[dict]:
    """The same adoption for a loose list of pasted elements."""
    named: set[str] = set()
    for element in elements:
        named |= _element_ids(element)
    mapping = drive.adopt_media(node_of(docname), sorted(named))
    for element in elements:
        _remap_element(element, mapping)
    return elements


def push_deck_preview(docname: str, image_bytes: bytes) -> None:
    """Push one browser-captured deck preview through Drive (§9.2, [012 §8]).

    Conversion to webp happens in the browser, before the node is asked for
    anything [012 §9]. Drive checks EDIT at the node and replaces the preview
    without stamping the deck.
    """
    drive.push_preview(node_of(docname), image_bytes, PREVIEW_MIME)


def refuse_unreadable_references(deck) -> None:
    """§6.6: you may reference what you can read.

    This replaces the save-time "every reference must be public" invariant and
    the forced-public row that enforced it. Being named by a composite grants
    nothing, so the only question a save has to answer is whether the saver can
    read what it is naming.

    A reference with no node is refused: a Drive-native composite is a live view
    over Drive decks, and a legacy row carries no node for the read check to ask
    about. Build links every deck before ticket 29 activates.
    """
    for reference in deck.reference_presentations:
        node = frappe.db.get_value(DOCTYPE, reference.presentation, NODE_FIELD)
        if not node:
            frappe.throw(
                _("Reference presentation {0} is not in Drive yet").format(reference.presentation),
                frappe.ValidationError,
            )
        if not _readable(node):
            frappe.throw(
                _("You cannot reference presentation {0}").format(reference.presentation),
                frappe.PermissionError,
            )


def composite_references(docname: str) -> list[dict]:
    """Answer one READ point check per referenced deck (§6.6).

    Being named by a composite grants nothing and nothing is copied: the
    composite stays a live view. A reference the caller cannot read is marked,
    never dropped silently, so the client can decide whether to draw a
    placeholder. Ticket 20 owns the grouped load that batches these checks.
    """
    answered = []
    for name in _reference_names(docname):
        node = frappe.db.get_value(DOCTYPE, name, NODE_FIELD)
        answered.append(
            {
                "presentation": name,
                "node": node,
                "readable": bool(node) and _readable(node),
            }
        )
    return answered


def _readable(node: str) -> bool:
    try:
        drive.check(node, drive.READ)
    except frappe.ValidationError:
        # `require` answers `DriveNotFound` below Read, because an unreadable
        # node is never disclosed (§5.4). A locked or expired link raises its
        # own error; none of them means "readable".
        return False
    return True


# ---------------------------------------------------------------------------
# Reading and rewriting the body
# ---------------------------------------------------------------------------


def _slide_rows(docname: str) -> list[dict]:
    return frappe.get_all(
        SATELLITE_DOCTYPE,
        filters={"parent": docname, "parenttype": DOCTYPE, "parentfield": SATELLITE_PARENT_FIELD},
        fields=["name", "idx", *SLIDE_BODY_FIELDS],
        order_by="idx asc",
    )


def _reference_names(docname: str) -> list[str]:
    return frappe.get_all(
        "Reference Presentation",
        filters={"parent": docname, "parenttype": DOCTYPE},
        pluck="presentation",
        order_by="idx asc",
    )


def _slide_element_ids(row: dict) -> set[str]:
    """Read the ids one slide's elements name, or over-report rather than lose one.

    The sweep walks the whole parsed body, not only `src` and `poster`. Losing a
    picture here is what trashes it (§10.6), and no shape of a body Slides did
    not expect may cause that: a poster nested three levels down, a list of
    elements inside a list, a key a later release adds. Over-reporting costs the
    sweep a node it leaves alone, which the module's own rule already accepts.
    The narrow media-key walk stays where a rewrite needs it.
    """
    try:
        parsed = _parsed_elements(row.get("elements"))
    except UnreadableBody:
        frappe.log_error("Slides: could not read a slide body for the media sweep", frappe.get_traceback())
        return set(MEDIA_TOKEN.findall(row.get("elements") or ""))
    return _value_ids(parsed)


def _elements_or_refuse(row: dict) -> list[dict]:
    """Read one slide's elements for a rewrite, or refuse the whole write.

    A copy whose pictures still point at the source's nodes is worse than a
    refused copy, so an unreadable column raises here instead of being skipped.
    """
    return _element_list(row.get("elements"))


def _parsed_elements(raw) -> list:
    """Parse one `elements` column into whatever list it holds, or refuse."""
    if isinstance(raw, list):
        return raw
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError) as undecodable:
        raise UnreadableBody(_("This slide body cannot be read")) from undecodable
    if not isinstance(parsed, list):
        raise UnreadableBody(_("This slide body cannot be read"))
    return parsed


def _element_list(raw) -> list[dict]:
    return [element for element in _parsed_elements(raw) if isinstance(element, dict)]


def _element_ids(element: dict) -> set[str]:
    found: set[str] = set()
    for key in ELEMENT_MEDIA_KEYS:
        found |= _value_ids(element.get(key))
    return found


def _value_ids(value) -> set[str]:
    """Read the node ids one media value names, at whatever depth it holds them.

    §14.7 says a legacy `poster` may be a dict rather than a string, and it
    fixes no depth for that dict. A walk that stops one level down answers "this
    slide names nothing" for a picture the slide still shows, and the §10.6
    sweep then trashes it. Under-reporting is the one direction this must never
    take, so the walk follows every nested dict and list to the end.
    """
    if isinstance(value, str):
        return {value} if MEDIA_ID.fullmatch(value) else set()
    if isinstance(value, dict):
        return set().union(*(_value_ids(nested) for nested in value.values())) if value else set()
    if isinstance(value, list):
        return set().union(*(_value_ids(nested) for nested in value)) if value else set()
    return set()


def _remap_value(value, mapping: dict[str, str]) -> tuple[object, bool]:
    """Rewrite one media value in place, at the same depth `_value_ids` reads."""
    if isinstance(value, str):
        replacement = mapping.get(value)
        return (replacement, True) if replacement is not None else (value, False)
    changed = False
    if isinstance(value, dict):
        for key, nested in value.items():
            value[key], nested_changed = _remap_value(nested, mapping)
            changed = changed or nested_changed
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            value[index], nested_changed = _remap_value(nested, mapping)
            changed = changed or nested_changed
    return value, changed


def _remap_element(element: dict, mapping: dict[str, str]) -> bool:
    changed = False
    for key in ELEMENT_MEDIA_KEYS:
        # `in`, not `get`: writing back a key the element never had would add a
        # null `poster` to every image on the slide.
        if key not in element:
            continue
        element[key], key_changed = _remap_value(element[key], mapping)
        changed = changed or key_changed
    return changed


def _version_payload(raw: bytes) -> dict:
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        payload = None
    if not isinstance(payload, dict) or payload.get("schema") != VERSION_SCHEMA:
        frappe.throw(
            _("This version predates Drive history and cannot be restored"),
            frappe.ValidationError,
        )
    slides = payload.get("slides")
    references = payload.get("references")
    if not isinstance(slides, list) or not all(isinstance(slide, dict) for slide in slides):
        frappe.throw(_("This version cannot be read"), frappe.ValidationError)
    if not isinstance(references, list) or not all(isinstance(name, str) for name in references):
        frappe.throw(_("This version cannot be read"), frappe.ValidationError)
    return {
        "theme": payload.get("theme"),
        "is_composite": 1 if payload.get("is_composite") else 0,
        "slides": slides,
        "references": references,
    }
