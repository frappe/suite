# Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import base64
import json
import random
import re
import string

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.query_builder.functions import Count
from frappe.utils import cstr, flt

from suite import drive
from suite.slides import drive as slides_drive

SYSTEM_TEMPLATE_TITLES = {"Light", "Dark"}
MAX_THUMBNAIL_BYTES = 6 * 1024 * 1024

NODE_FIELD = slides_drive.NODE_FIELD


class Presentation(drive.DriveContent, Document):
    """One deck.

    Drive owns the deck's title, place, grants, lifecycle, versions, comments,
    preview, and byte charge; the `DriveContent` mixin supplies `node`,
    `node_title`, `drive_check`, `drive_touch`, and `drive_take_version`
    (§10.2). What is here is the body: slides, theme, and the references of a
    composite.
    """

    def validate(self):
        self.validate_advance_after()

        if not self.is_composite:
            return
        if not self.reference_presentations:
            frappe.throw("Please add at least one reference presentation to create a composite presentation.")
        # §6.6: you may reference what you can read. Nothing is copied and
        # nothing is forced public.
        slides_drive.refuse_unreadable_references(self)

    def validate_advance_after(self):
        for row in self.slides:
            if row.advance_after in (None, ""):
                continue
            if (
                not re.fullmatch(r"[0-9]+(\.[0-9]+)?", cstr(row.advance_after))
                or not 1 <= flt(row.advance_after) <= 3600
            ):
                frappe.throw(
                    _("Slide {0}: Advance After must be between 1 and 3600 seconds, not {1}").format(
                        row.idx, row.advance_after
                    )
                )

    def on_update(self):
        if self.flags.in_insert:
            # `create_document` stamps the new node itself. Touching here
            # would only add the row to the mixin's per-request debounce
            # set, and the first real save of the same request would then
            # be swallowed.
            return
        # The body changed, so the node's `content_modified` moves with it
        # (§8.11). It is the deck's only stamp and the daily media sweep's
        # cursor. Debounced to one write per request by the mixin.
        self.drive_touch()


def get_thumbnail_content(base64_data: str) -> tuple[bytes, str]:
    match = re.match(r"^data:(image/[^;]+);base64,(.+)$", base64_data or "", re.DOTALL)
    if not match:
        frappe.throw("Invalid thumbnail data")

    mime_type, encoded_content = match.groups()
    if mime_type != "image/webp":
        frappe.throw("Unsupported thumbnail image type")

    try:
        content = base64.b64decode(encoded_content, validate=True)
    except Exception:
        frappe.throw("Invalid thumbnail image data")

    if len(content) > MAX_THUMBNAIL_BYTES:
        frappe.throw("Thumbnail image is too large")

    return content, "webp"


@frappe.whitelist()
def save_presentation_thumbnail(presentation_name: str, base64_data: str) -> str:
    """Store the browser's deck capture.

    Drive checks EDIT at the node and replaces the `Drive Node Preview` row
    without stamping the deck ([012 §8]). Conversion to webp already happened
    in the browser [012 §9]. Nothing is minted on the deck itself, so the
    answer is empty.
    """
    content, _ext = get_thumbnail_content(base64_data)
    slides_drive.push_deck_preview(presentation_name, content)
    return ""


def slug(text: str) -> str:
    return text.lower().replace(" ", "-")


@frappe.whitelist()
def get_presentations() -> list[dict]:
    """The caller's own decks, newest change first, with their slide counts.

    Drive owns a deck's title, its template flag, and its lifecycle, so the
    node is read for those three answers: a trashed deck and a template are
    left out, and the title is the node's.

    LIMITATION: `thumbnail` is empty. A deck's preview is a `Drive Node
    Preview` served over §6.8's signed byte path, which this payload has no
    field for.
    """
    presentations = frappe.get_list(
        "Presentation",
        fields=["name", NODE_FIELD, "owner", "creation", "modified_by", "modified"],
        order_by="modified desc",
        filters=[["owner", "=", frappe.session.user]],
    )
    presentations = _published_decks(presentations)

    counts = get_slide_counts([p["name"] for p in presentations])
    for presentation in presentations:
        presentation["slide_count"] = counts.get(presentation["name"], 0)

    return presentations


def _published_decks(rows: list[dict]) -> list[dict]:
    """Name each deck from its node, and drop what Drive hides from this list."""
    nodes = [row[NODE_FIELD] for row in rows]
    published = {}
    if nodes:
        published = {
            row["name"]: row
            for row in frappe.get_all(
                "Drive Node",
                filters={"name": ["in", nodes], "state": "Active", "is_template": 0},
                fields=["name", "title"],
                ignore_permissions=True,
            )
        }
    kept = []
    for row in rows:
        listed = published.get(row.pop(NODE_FIELD))
        if not listed:
            # Trashed, or a template. Either way Drive hides it here.
            continue
        row["title"] = listed["title"]
        row["thumbnail"] = ""
        kept.append(row)
    return kept


def get_slide_counts(presentation_names: list[str]) -> dict[str, int]:
    """Returns a dict mapping presentation names to their slide count."""
    if not presentation_names:
        return {}

    Slide = frappe.qb.DocType("Slide")
    return dict(
        (
            frappe.qb.from_(Slide)
            .select(Slide.parent, Count("*"))
            .where(Slide.parenttype == "Presentation")
            .where(Slide.parent.isin(presentation_names))
            .groupby(Slide.parent)
        ).run()
    )


@frappe.whitelist()
def update_slide_attachments(parent: str, slide: dict | str):
    """Adopt a pasted slide's pictures under this deck and give its elements fresh ids.

    Drive shares the blob and reuses a node the deck already holds for the
    same picture (§8.9). The gate is UPLOAD at the deck node, and it is taken
    here rather than left to `adopt_media`: `adopt_media` answers an empty map
    before any check when the slide names no media, which would let a
    stranger learn the deck exists.
    """
    slide = json.loads(slide) if isinstance(slide, str) else slide
    drive.check(slides_drive.node_of(parent), drive.UPLOAD)
    elements = slides_drive.elements_of(slide)
    remap_element_ids(elements)
    slide["elements"] = elements
    return slides_drive.adopt_slide_media(parent, slide)


def remap_element_ids(elements):
    """Fresh ids for a copied set: connector bindings inside the set follow the copies, the rest are dropped."""
    new_ids = ["".join(random.choices(string.ascii_lowercase + string.digits, k=9)) for _ in elements]
    id_map = {element.get("id"): new_id for element, new_id in zip(elements, new_ids, strict=True)}
    for element, new_id in zip(elements, new_ids, strict=True):
        element["id"] = new_id
        connector = element.get("connector")
        if not connector:
            continue
        for end in ("start", "end"):
            bound = connector.get(end)
            if not bound:
                continue
            target_id = id_map.get(bound.get("elementId"))
            connector[end] = {**bound, "elementId": target_id} if target_id else None


def is_system_template(template_title: str) -> bool:
    return template_title in SYSTEM_TEMPLATE_TITLES


def get_template_thumbnail(template_title: str, index: int) -> str:
    template_title = (template_title or "light").lower()
    return f"/assets/suite/slides/frontend/images/layouts/{template_title}/thumbnail-{index}.webp"


@frappe.whitelist()
def create_presentation(
    template: str | None = None, duplicate_from: str | None = None, parent: str | None = None
):
    """Create a new deck and return it, so the editor can jump straight in.

    An atomic adapter over `drive.create_document`: the node and the deck are
    written together, in Drive's own savepoint, so `content.require_node`
    never sees a fresh deck with no node. Duplicate-from and
    new-from-template are both a `from_node` copy: Drive runs the deck's
    `duplicate` factory, copies every slide and its media node for node, and
    charges the destination root (§8.9). There is no template verb (§8.10) —
    the two differ only in the title `create_document` is given and which
    source it names. Drive also runs the UPLOAD check on `parent` itself.

    `parent` is the Drive folder the caller is looking at. Empty means "my
    Drive": the caller's own root, provisioned on first use.
    """
    if duplicate_from:
        if not frappe.has_permission("Presentation", "read", duplicate_from):
            frappe.throw("You cannot duplicate this presentation", frappe.PermissionError)
        source_node = slides_drive.node_of(duplicate_from)
        title = f"Copy of {slides_drive.node_title_of(source_node)}"
    else:
        # A template carries `is_template` on its node (§8.10).
        template_node = template and frappe.db.get_value("Presentation", template, NODE_FIELD)
        if not template_node or not slides_drive.node_is_template(template_node):
            frappe.throw(f"Template {template!r} does not exist", frappe.DoesNotExistError)
        if not frappe.has_permission("Presentation", "read", template):
            frappe.throw("You cannot create a presentation from this template", frappe.PermissionError)
        source_node = template_node
        title = "Untitled"

    # Resolved after the source, so a deck named by a caller who has no Drive
    # root yet is still refused by name ("that template does not exist")
    # rather than by the root the request would have provisioned for it.
    parent_node = parent or _home_folder()

    # `create_document` closes its own savepoint before returning, so the
    # `theme` write below is outside it. This one holds both: a new deck must
    # never exist without the theme its layouts are resolved through.
    savepoint = f"slides_create_presentation_{frappe.generate_hash(12)}"
    frappe.db.savepoint(savepoint)
    try:
        node = drive.create_document(
            parent_node, title, content_doctype=slides_drive.DOCTYPE, from_node=source_node
        )
        docname = slides_drive.docname_for_node(node)
        if not docname:
            frappe.throw(_("The new presentation could not be found"), frappe.ValidationError)
        if not duplicate_from:
            # `theme` names the template the editor resolves layouts through
            # (`LayoutDialog.vue`, `slide.js:addEmptySlide`). Drive's copy
            # carries the source's own `theme`, and a template's is empty, so
            # new-from-template has to name the template it started from. It
            # is Slides' own body column, not a Drive mirror.
            frappe.db.set_value(slides_drive.DOCTYPE, docname, "theme", template, update_modified=False)
    except Exception as failure:
        # `create_document` takes row locks, so this request can be an InnoDB
        # deadlock victim, and a victim's savepoints are gone before this arm
        # runs. Drive's shared helper reports the deadlock the caller has to
        # retry on instead of the savepoint that went with it.
        drive.rollback_savepoint(savepoint, failure)
        raise
    else:
        frappe.db.release_savepoint(savepoint)

    presentation = frappe.get_doc("Presentation", docname)
    # Drive owns the title (§10.2); it rides along for the response only.
    answer = presentation.as_dict()
    answer["title"] = presentation.node_title
    return answer


def _home_folder() -> str:
    """The caller's own Drive root, provisioned on first use.

    Mirrors `suite.sheets.api._home_folder`: a fresh user has no Personal root
    until something asks for one, and Guest and Administrator never get one.
    """
    user = frappe.session.user
    home = drive.personal_root_for(user) or drive.ensure_personal_root(user)
    if not home:
        frappe.throw(_("A Drive folder is required"), frappe.ValidationError)
    return home


@frappe.whitelist(methods=["POST"])
def update_theme(name: str, theme: str):
    presentation = frappe.get_doc("Presentation", name)
    presentation.check_permission("write")
    base_modified = presentation.modified
    presentation.theme = theme
    presentation.save()
    return {"modified": presentation.modified, "base_modified": base_modified}


@frappe.whitelist()
def get_updated_json(presentation: str, elements: list[dict]):
    """Adopt pasted elements' pictures under this deck (§8.9).

    UPLOAD at the deck node, taken before the element list is read: an
    element list naming no media would otherwise reach `adopt_media`'s
    empty-map early return and answer a caller with no grant at all.
    """
    drive.check(slides_drive.node_of(presentation), drive.UPLOAD)
    return slides_drive.adopt_element_media(presentation, elements)


@frappe.whitelist(allow_guest=True)
def is_composite_presentation(name: str):
    return frappe.db.get_value("Presentation", name, "is_composite") == 1


@frappe.whitelist(allow_guest=True)
def get_public_presentation(name: str):
    if not frappe.has_permission("Presentation", "read", name):
        frappe.throw("You cannot access this presentation", frappe.PermissionError)

    return frappe.get_doc("Presentation", name).as_dict()


@frappe.whitelist()
def get_templates():
    """The template picker: every template the caller may read, with its layouts.

    A template is a deck whose node carries `is_template` (§8.10), and who
    may use it is the grant on that node, so the list is scoped by READ.
    """
    templates = _readable_templates()

    slides = frappe.get_all(
        "Slide",
        filters={
            "parent": ["in", [t["name"] for t in templates]],
            "parenttype": "Presentation",
            "parentfield": "slides",
        },
        fields=["*"],
        order_by="parent asc, idx asc",
    )

    layouts_by_template: dict[str, list[dict]] = {}
    for slide in slides:
        slide["doctype"] = "Slide"
        layouts_by_template.setdefault(slide["parent"], []).append(slide)

    for template in templates:
        template["layouts"] = layouts_by_template.get(template["name"], [])
        for layout in template["layouts"]:
            layout["thumbnail"] = (
                get_template_thumbnail(template["title"], layout["idx"])
                if is_system_template(template["title"])
                else ""
            )

    return templates


def _readable_templates() -> list[dict]:
    """The readable template nodes, oldest first, under the keys the picker reads."""
    nodes = frappe.get_all(
        "Drive Node",
        filters={"content_doctype": slides_drive.DOCTYPE, "is_template": 1, "state": "Active"},
        fields=["name", "title", "content_docname", "creation"],
        order_by="creation asc",
        ignore_permissions=True,
    )
    if not nodes:
        return []
    readable = set(
        frappe.get_list(
            "Presentation",
            filters={NODE_FIELD: ["in", [node["name"] for node in nodes]]},
            pluck="name",
        )
    )
    return [
        {
            "name": node["content_docname"],
            "title": node["title"],
            "slug": slug(node["title"] or ""),
            "creation": node["creation"],
            "is_template": 1,
        }
        for node in nodes
        if node["content_docname"] in readable
    ]


@frappe.whitelist(allow_guest=True)
def get_composite_presentation(name: str):
    """Render one composite deck for this caller.

    One READ point check on the composite, then one per referenced deck
    against the same principals (§6.6). Being named grants nothing and nothing
    is copied, so the composite stays a live view. A reference the caller
    cannot read is marked in `references`, never dropped silently, and the
    client decides whether to draw a placeholder.
    """
    if not is_composite_presentation(name) or not slides_drive.deck_is_readable(name):
        # One answer for "not a composite", "no such deck", and "a composite
        # you cannot read". This route is guest-reachable, so two different
        # errors would tell a stranger which names are composites.
        frappe.throw("Presentation is not public", frappe.PermissionError)
    doc = frappe.get_doc("Presentation", name)
    references = slides_drive.composite_references(name)
    composite_slides = []
    for reference in references:
        if not reference["readable"]:
            continue
        composite_slides.extend(frappe.get_cached_doc("Presentation", reference["presentation"]).slides)
    doc.slides = composite_slides
    answer = doc.as_dict()
    answer["references"] = references
    return answer


@frappe.whitelist(allow_guest=True)
def get_editor_access(presentation_id: str) -> str:
    """Answer one deck's access level for this caller: "edit", "view", or "none".

    One node, one role ladder. `Drive Grant` is the only authority (§1), and
    a refusal below Read is a 404 rather than a disclosure (§5.4). A composite
    is a live view over other decks: its own body is not editable however
    high the caller's role is, so Edit reads as view.
    """
    is_composite = frappe.db.get_value("Presentation", presentation_id, "is_composite")
    node = slides_drive.node_of(presentation_id)
    for role, answer in ((drive.EDIT, "edit"), (drive.READ, "view")):
        try:
            drive.check(node, role)
        except frappe.ValidationError:
            continue
        return "view" if is_composite else answer
    return "none"
