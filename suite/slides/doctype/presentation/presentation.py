# Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import base64
import json
import random
import re
import string
import uuid

import frappe
from frappe import _
from frappe.core.doctype.file.file import get_local_image
from frappe.model.document import Document
from frappe.query_builder.functions import Count

from suite import drive
from suite.drive.api.permissions import user_has_permission
from suite.drive.overrides.file import File as DriveFile
from suite.drive.overrides.file import content_has_permission, content_query_conditions
from suite.slides import drive as slides_drive

SYSTEM_TEMPLATE_TITLES = {"Light", "Dark"}
MAX_THUMBNAIL_BYTES = 6 * 1024 * 1024

NODE_FIELD = slides_drive.NODE_FIELD


class Presentation(drive.DriveContent, Document):
    """One deck, on either side of Drive adoption.

    A row that carries a `node` is Drive-native. Drive owns its title, place,
    grants, lifecycle, versions, comments, preview, and byte charge; the
    `DriveContent` mixin supplies `node`, `node_title`, `drive_check`,
    `drive_touch`, and `drive_take_version` (§10.2).

    A row with no node is a legacy row Build has not linked yet (§14.7). It
    keeps the behaviour it has always had: the backing `File`, the mirrored
    title, the legacy thumbnail File, and the forced-public composite row.
    Ticket 23 moves the legacy read path and ticket 29 activates the registry;
    until both, the two shapes live side by side.

    The split is explicit at every method, and it only ever runs one way: a
    linked row never falls back to the `File`, because that would be a way
    around `Drive Grant` (§1).
    """

    @property
    def drive_native(self) -> bool:
        """True when Drive owns this row, false for a legacy row with no node."""
        return bool(self.get(self.drive_node_field))

    def before_save(self):
        if self.drive_native:
            # The slug is derived from the legacy title column, and Drive owns a
            # linked deck's title with no mirror in either direction (§10.2).
            return
        self.slug = slug(self.title)

    def validate(self):
        if not self.is_composite:
            return
        if not self.reference_presentations:
            frappe.throw("Please add at least one reference presentation to create a composite presentation.")

        if self.drive_native:
            # §6.6: the save-time "every reference must be public" rule becomes
            # the ordinary read check. You may reference what you can read.
            slides_drive.refuse_unreadable_references(self)
            return

        for ref in self.reference_presentations:
            ref_doc = frappe.get_cached_doc("Presentation", ref.presentation)
            if not _is_public(ref_doc.name):
                frappe.throw(
                    f"Reference presentation '{ref_doc.title}' must be public to create a composite presentation."
                )

    def after_insert(self):
        if self.drive_native or self.is_template:
            return
        self.create_drive_file()

    def on_update(self):
        if self.drive_native:
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
            return

        # composite decks are always public — a system invariant, enforced directly
        # since File.share() would require the saver to hold a share grant.
        # Legacy only: §6.6 removes it, and `validate` above is what replaces it
        # for a linked row.
        if self.is_composite and not is_public_presentation(self.name):
            file = DriveFile.get_for_doc("Presentation", self.name)
            if not file:
                return
            existing = frappe.db.get_value("Drive Permission", {"entity": file, "user": "", "deny": 0})
            perm = (
                frappe.get_doc("Drive Permission", existing)
                if existing
                else frappe.new_doc("Drive Permission").update({"entity": file, "user": ""})
            )
            perm.read = 1
            perm.save(ignore_permissions=True)

    def create_drive_file(self, parent: str | None = None):
        """Legacy only. A linked deck's identity is its node, written by Drive."""
        refuse_drive_native(self.name, "Drive node")
        return DriveFile.create_for_doc(
            self,
            parent=parent or self.flags.get("drive_parent"),
            mime_type="frappe/slides",
            file_type="Presentation",
        )


def is_drive_native(name: str) -> bool:
    """True when this deck carries a Drive node, whatever else it still carries."""
    return bool(frappe.db.get_value("Presentation", name, NODE_FIELD))


def refuse_drive_native(name: str, instead: str) -> None:
    """Refuse a legacy path for a deck Drive owns. It never falls back."""
    if is_drive_native(name):
        frappe.throw(
            _("Drive owns this presentation. Use {0} instead.").format(instead),
            frappe.ValidationError,
        )


ALLOWED_IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}


@frappe.whitelist()
def save_base64_image(base64_data: str, presentation_name: str, prefix: str) -> str:
    """Legacy only. Drive owns a linked deck's media and does not convert uploads.

    A picture reaches a Drive-native deck through the Drive upload route, which
    ticket 21 exposes and ticket 34 adopts, with the node under the deck (§8.4,
    §10.7). Refused here rather than answered from a `File`.
    """
    refuse_drive_native(presentation_name, "the Drive upload route")
    presentation = frappe.get_doc("Presentation", presentation_name)
    presentation.check_permission("write")

    match = re.match(r"^data:image/([a-zA-Z0-9.+-]+);base64,(.+)$", base64_data or "", re.DOTALL)
    if not match:
        frappe.throw("Invalid image data")

    ext = match.group(1).lower()
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        frappe.throw("Unsupported image type")

    try:
        content = base64.b64decode(match.group(2), validate=True)
    except Exception:
        frappe.throw("Malformed base64 image content")

    filename = f"{prefix}-{uuid.uuid4().hex[:6]}.{ext}"

    file_doc = frappe.get_doc(
        {
            "doctype": "File",
            "file_name": filename,
            "content": content,
            "is_private": 1,
            "attached_to_doctype": "Presentation",
            "attached_to_name": presentation_name,
        }
    ).insert()

    return file_doc.file_url


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


def replace_thumbnail_file(presentation: Document, base64_data: str) -> str:
    content, ext = get_thumbnail_content(base64_data)
    presentation_name = presentation.name
    file_name = f"presentation-thumbnail-{presentation_name}.{ext}"

    delete_existing_thumbnail_files(presentation, file_name)

    return create_thumbnail_file(presentation_name, file_name, content)


def delete_existing_thumbnail_files(presentation: Document, file_name: str) -> None:
    file_doc_names = set()

    file_doc_names.update(
        frappe.get_all(
            "File",
            filters={
                "attached_to_doctype": "Presentation",
                "attached_to_name": presentation.name,
                "file_name": file_name,
                "is_private": 1,
            },
            pluck="name",
        )
    )

    for file_doc_name in file_doc_names:
        frappe.delete_doc("File", file_doc_name)


def create_thumbnail_file(presentation_name: str, file_name: str, content: bytes) -> str:
    file = frappe.get_doc(
        {
            "doctype": "File",
            "attached_to_doctype": "Presentation",
            "attached_to_name": presentation_name,
            # thumbnail is an Attach Image field, so the framework's attach hook looks
            # for a File carrying the fieldname; without it every save of the deck is
            # treated as an unattached URL and re-creates the File from disk
            "attached_to_field": "thumbnail",
            "file_name": file_name,
            "is_private": 1,
            "content": content,
        }
    ).insert()

    return file.file_url


@frappe.whitelist()
def save_presentation_thumbnail(presentation_name: str, base64_data: str) -> str:
    """Store the browser's deck capture.

    A linked deck pushes it through Drive, which checks EDIT at the node and
    replaces the `Drive Node Preview` row without stamping the deck ([012 §8]).
    Conversion to webp already happened in the browser [012 §9]. A legacy deck
    keeps its thumbnail `File` and the `thumbnail` column until Build copies
    them (§14.7).
    """
    if is_drive_native(presentation_name):
        content, _ext = get_thumbnail_content(base64_data)
        slides_drive.push_deck_preview(presentation_name, content)
        return ""

    presentation = frappe.get_doc("Presentation", presentation_name)
    presentation.check_permission("write")

    file_url = replace_thumbnail_file(presentation, base64_data)

    if presentation.thumbnail != file_url:
        # the thumbnail is derived, not an edit: bumping modified would make the
        # editor discard local changes it had not synced yet
        presentation.db_set("thumbnail", file_url, update_modified=False)
    return file_url


def slug(text: str) -> str:
    return text.lower().replace(" ", "-")


# whitelist needed for drive integration
@frappe.whitelist()
def get_presentation_thumbnail(presentation_name: str, index: int | None = 1) -> str:
    """Returns the thumbnail of a presentation. Legacy only.

    A linked deck's preview is a `Drive Node Preview` row, read through Drive
    after a READ check. The legacy column survives until §14.10 drops it, so
    answering from it here would hand out a `/private/files/` URL for a deck the
    caller holds no grant on. Ticket 34 moves the client to the Drive preview.
    """
    refuse_drive_native(presentation_name, "the Drive preview")
    return frappe.get_value("Presentation", presentation_name, "thumbnail") or ""


@frappe.whitelist()
def get_presentations() -> list[dict]:
    """
    Returns a list of presentation details
    - info and presentation thumbnail
    """
    presentations = frappe.get_list(
        "Presentation",
        fields=["name", "title", "owner", "creation", "modified_by", "modified", "thumbnail"],
        order_by="modified desc",
        filters=[["owner", "=", frappe.session.user], ["is_template", "=", 0]],
    )

    counts = get_slide_counts([p["name"] for p in presentations])
    for presentation in presentations:
        presentation["slide_count"] = counts.get(presentation["name"], 0)

    return presentations


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
    slide = json.loads(slide) if isinstance(slide, str) else slide

    if is_drive_native(parent):
        # Cross-deck paste. Drive adopts the pasted pictures under this deck,
        # sharing the blob and reusing a node the deck already holds for the
        # same picture (§8.9). The gate is UPLOAD at the deck node, never a
        # `File`, and it is taken here rather than left to `adopt_media`:
        # `adopt_media` answers an empty map before any check when the slide
        # names no media, which would let a stranger learn the deck exists.
        drive.check(slides_drive.node_of(parent), drive.UPLOAD)
        elements = slides_drive.elements_of(slide)
        remap_element_ids(elements)
        slide["elements"] = elements
        return slides_drive.adopt_slide_media(parent, slide)

    frappe.get_doc("Presentation", parent).check_permission("write")

    elements_data = slide.get("elements") or "[]"
    elements = elements_data if isinstance(elements_data, list) else json.loads(elements_data)
    remap_element_ids(elements)
    for element in elements:
        if element.get("src") and element["src"].startswith("/private"):
            element["attachmentName"] = get_attachment(parent, element["src"])
        attach_poster(parent, element)

    slide["elements"] = json.dumps(elements)

    return slide


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


def apply_slide_layout(slide, ref_id, parent):
    layout_slide = frappe.get_doc("Slide", ref_id)

    slide_dict = layout_slide.as_dict()
    slide_dict = update_slide_attachments(parent, slide_dict)

    for key, value in slide_dict.items():
        setattr(slide, key, value)


def create_new_slide(parent, ref_id):
    """
    Creates a new slide with the given reference slide id.
    """
    slide = frappe.new_doc("Slide")

    apply_slide_layout(slide, ref_id, parent)

    slide.parent = parent
    slide.parentfield = "slides"
    slide.parenttype = "Presentation"
    slide.save()

    return slide


def get_slides_from_ref(parent, theme, duplicate_from):
    ref_name = duplicate_from or theme or "Light"
    ref_presentation = frappe.get_doc("Presentation", ref_name)

    slides = []

    if duplicate_from:
        for slide in ref_presentation.slides:
            new_slide = create_new_slide(parent, slide.name)
            new_slide.idx = slide.idx
            slides.append(new_slide)
    else:
        first_index = 2 if ref_presentation.title in ("Light", "Dark") else 0
        first_slide = create_new_slide(parent, ref_presentation.slides[first_index].name)
        first_slide.idx = 1
        slides.append(first_slide)

    return slides


def is_system_template(template_title: str) -> bool:
    return template_title in SYSTEM_TEMPLATE_TITLES


def get_template_thumbnail(template_title: str, index: int) -> str:
    template_title = (template_title or "light").lower()
    return f"/assets/suite/slides/frontend/images/layouts/{template_title}/thumbnail-{index}.webp"


def get_template_cover_thumbnail(template):
    template_title, template_thumbnail = frappe.get_value(
        "Presentation",
        template,
        ["title", "thumbnail"],
    )
    return (
        get_template_thumbnail(template_title, 3)
        if is_system_template(template_title)
        else template_thumbnail
    )


def set_duplicate_metadata(presentation, duplicate_from) -> str:
    src_title, src_theme, src_thumbnail = frappe.get_value(
        "Presentation",
        duplicate_from,
        ["title", "theme", "thumbnail"],
    )
    presentation.title = f"Copy of {src_title}"
    presentation.theme = src_theme
    return src_thumbnail


def set_template_metadata(presentation, template) -> str:
    presentation.title = "Untitled"
    presentation.theme = template
    return get_template_cover_thumbnail(template)


def copy_thumbnail_file(presentation_name: str, source_url: str) -> str:
    source = frappe.db.get_value("File", {"file_url": source_url}, ["name", "file_name"], as_dict=True)
    if not source:
        return ""

    try:
        content = frappe.get_doc("File", source.name).get_content()
    except FileNotFoundError:
        # blob is already gone; the editor captures a fresh thumbnail on the next edit
        return ""

    _, _, ext = source.file_name.rpartition(".")
    file_name = f"presentation-thumbnail-{presentation_name}.{ext or 'webp'}"

    return create_thumbnail_file(presentation_name, file_name, content)


def adopt_thumbnail(presentation: Document, source_url: str) -> None:
    """Give a new deck its own copy of the thumbnail it started from.

    Sharing the source's URL leaves the field pointing at a File this deck does not
    own: once the source regenerates or deletes its thumbnail the blob can go with it,
    and every later save of this deck retries the missing file through frappe's attach
    hook. System template covers ship with the app, so they have no File to copy.
    """
    if not source_url:
        return

    thumbnail = (
        copy_thumbnail_file(presentation.name, source_url)
        if source_url.startswith(("/files/", "/private/files/"))
        else source_url
    )
    presentation.db_set("thumbnail", thumbnail)


@frappe.whitelist()
def create_presentation(
    template: str | None = None, duplicate_from: str | None = None, parent: str | None = None
):
    if parent and not user_has_permission(parent, "upload"):
        frappe.throw(
            "Cannot access folder due to insufficient permissions",
            frappe.PermissionError,
        )

    presentation = frappe.new_doc("Presentation")
    if duplicate_from:
        # A linked source is copied by `drive.create_document(from_node=...)`,
        # which runs the `duplicate` factory, copies the media per blob, and
        # charges the destination root (§8.9). Ticket 21 exposes it.
        refuse_drive_native(duplicate_from, "the Drive copy")
        if not frappe.has_permission("Presentation", "read", duplicate_from):
            frappe.throw("You cannot duplicate this presentation", frappe.PermissionError)
        source_thumbnail = set_duplicate_metadata(presentation, duplicate_from)
    else:
        # New-from-template is the same Drive call for a linked template, with
        # `is_template` left false; there is no template verb (§8.10). Refused
        # before the flag check, because a linked deck carries `is_template` on
        # its node and the legacy column would answer "does not exist".
        if template:
            refuse_drive_native(template, "the Drive copy")
        if not template or not frappe.db.get_value("Presentation", template, "is_template"):
            frappe.throw(f"Template {template!r} does not exist", frappe.DoesNotExistError)
        if not frappe.has_permission("Presentation", "read", template):
            frappe.throw("You cannot create a presentation from this template", frappe.PermissionError)
        source_thumbnail = set_template_metadata(presentation, template)
    presentation.flags.drive_parent = parent
    presentation.insert()

    # only now does the deck have a name to attach its own thumbnail File to
    adopt_thumbnail(presentation, source_thumbnail)

    presentation.slides = get_slides_from_ref(presentation.name, template, duplicate_from)

    presentation.save()
    return presentation


@frappe.whitelist()
def delete_presentation(name: str):
    """Legacy only. Drive owns a linked deck's lifecycle: trash, restore, purge."""
    refuse_drive_native(name, "the Drive trash")
    return frappe.delete_doc("Presentation", name)


@frappe.whitelist()
def update_title(name: str, title: str):
    """Legacy only. A linked deck's title is its node's, renamed through Drive."""
    refuse_drive_native(name, "the Drive rename")
    presentation = frappe.get_doc("Presentation", name)
    presentation.check_permission("write")
    presentation.title = title
    presentation.save()
    return {"slug": slug(title), "modified": presentation.modified}


def get_attachment(presentation, file_url):
    """
    Returns the attachment name for a file URL in a presentation.
    """
    # if file is already attached to the presentation, return its name
    attachment = frappe.get_value("File", {"file_url": file_url, "attached_to_name": presentation}, "name")

    # if not, create a File doc from the source presentation's attachment from where this element was copied
    if not attachment:
        source_doc = frappe.get_all("File", filters={"file_url": file_url}, limit=1)
        if source_doc:
            source_file = frappe.get_doc("File", source_doc[0].name)
            source_file.check_permission("read")
            new_attachment_doc = frappe.copy_doc(source_file)
            new_attachment_doc.attached_to_name = presentation
            new_attachment_doc.insert()
            attachment = new_attachment_doc.name

    return attachment


def attach_poster(presentation, element):
    """Best-effort: a broken poster must not fail the paste."""
    poster = element.get("poster")
    if not isinstance(poster, str) or not poster.startswith("/private"):
        return
    try:
        get_attachment(presentation, poster)
    except Exception:
        frappe.log_error(f"could not attach poster {poster} to {presentation}")


@frappe.whitelist()
def get_updated_json(presentation: str, elements: list[dict]):
    if is_drive_native(presentation):
        # UPLOAD at the deck node, taken before the element list is read: an
        # element list naming no media would otherwise reach `adopt_media`'s
        # empty-map early return and answer a caller with no grant at all.
        drive.check(slides_drive.node_of(presentation), drive.UPLOAD)
        return slides_drive.adopt_element_media(presentation, elements)

    frappe.get_doc("Presentation", presentation).check_permission("write")

    for element in elements:
        if element.get("type") in ["image", "video"] and element.get("src"):
            file_url = element["src"].replace(frappe.local.site_name, "")
            name = get_attachment(presentation, file_url)
            element["attachmentName"] = name
        attach_poster(presentation, element)

    return elements


# Adoption is staged (§10.3, README execution rules). `Presentation` carries a
# `node` Link from ticket 18, but `drive_content_types` stays empty and these two
# hooks stay here until ticket 29 has Build's links. So both guards read the node
# column and answer on one of two sides:
#
#   node set    Drive-native. `Drive Grant` is the only authority (§1), and this
#               module cannot read it: the entries that can live in
#               `suite.drive.framework` and arrive with the registry. Refused
#               here, never answered from the legacy `File`, because that would
#               be a way around Drive.
#   no node     A legacy row Build has not linked. Unchanged File-backed
#               behaviour until §14.7 copies it and Cleanup removes it.
#
# A hook may only deny (`frappe/permissions.py:244-246`), so refusing a linked
# row costs a legacy row nothing and an Administrator nothing:
# `frappe.has_permission` answers before any controller hook for them.


def get_permission_query_conditions(user):
    """`permission_query_conditions` for `Presentation`, staged.

    The legacy predicate is owner-or-directly-shared through the backing `File`,
    OR every template. A Drive-native row has no `File` and its template flag
    lives on its node, so the node column is what excludes it until ticket 29
    replaces this whole predicate with the node-based one.
    """
    user = user or frappe.session.user
    # A shared linked deck cannot be excluded by any predicate this hook
    # returns: `frappe.db.query` ORs the shared names around it
    # (`frappe/database/query.py:1737-1741`). Drive refuses instead. Scoped to a
    # deck that carries a node, so a legacy site lists what it always listed.
    drive.refuse_shared_linked_rows("Presentation", NODE_FIELD, user)
    legacy = content_query_conditions("Presentation", user, extra="`tabPresentation`.is_template = 1")
    if not legacy:
        return legacy
    return f"`tabPresentation`.`{NODE_FIELD}` IS NULL AND ({legacy})"


def has_permission(doc, ptype="read", user=None, debug=False):
    """`has_permission` for `Presentation`, staged the same way."""
    user = user or frappe.session.user
    if doc.get(NODE_FIELD):
        # Answering False is not a denial: Frappe reads it as "no role
        # permission" and then asks `false_if_not_shared`
        # (`frappe/permissions.py:214-216`), which a `DocShare` answers Yes.
        # That would be a way around `Drive Grant` (§1) for the whole window
        # between Build and ticket 29.
        drive.refuse_shared_row(doc.doctype, doc.get("name"), ptype, user)
        return False
    if doc.is_template and user != "Administrator":
        return ptype == "read" or doc.owner == user
    return content_has_permission(doc, ptype, user)


@frappe.whitelist(allow_guest=True)
def is_public_presentation(name: str):
    """Legacy only. A linked deck has no "public" flag: it has grants (§6.5)."""
    refuse_drive_native(name, "the Drive sharing state")
    return _is_public(name)


def _is_public(name: str) -> bool:
    """Answer the legacy public flag, False for a deck Drive owns.

    A legacy composite names references Build may have linked already, and it
    asks this about each one. Raising there would take the whole composite down
    for a mixed deck; a linked reference is simply not public in the legacy
    sense, and §6.6 is what answers for it once the composite itself is linked.
    """
    if is_drive_native(name):
        return False
    file = DriveFile.get_for_doc("Presentation", name)
    if not file:
        return False
    return frappe.get_doc("File", file).is_public()


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
    templates = frappe.get_all(
        "Presentation",
        filters={"is_template": 1},
        fields=["name", "title", "slug", "creation", "is_template"],
        order_by="creation",
    )

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


@frappe.whitelist(allow_guest=True)
def get_composite_presentation(name: str):
    """Render one composite deck for this caller.

    A linked deck answers through Drive (§6.6): one READ point check on the
    composite, then one per referenced deck against the same principals. Being
    named grants nothing and nothing is copied, so the composite stays a live
    view. A reference the caller cannot read is marked in `references`, never
    dropped silently, and the client decides whether to draw a placeholder.

    A legacy deck keeps the published-references rule until Build links it.
    Ticket 20 owns the grouped load that batches the checks and the codes.
    """
    if not is_composite_presentation(name):
        frappe.throw("Presentation is not public", frappe.PermissionError)

    if is_drive_native(name):
        if not slides_drive.deck_is_readable(name):
            # One answer for "not a composite", "no such deck", and "a composite
            # you cannot read". This route is guest-reachable, so two different
            # errors would tell a stranger which names are linked composites.
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

    if not is_public_presentation(name):
        frappe.throw("Presentation is not public", frappe.PermissionError)

    doc = frappe.get_doc("Presentation", name)

    composite_slides = []

    for reference in doc.reference_presentations:
        # references are public when the composite is saved, but can be made
        # private later, and Build may have linked one already
        if not _is_public(reference.presentation):
            continue
        ref_doc = frappe.get_cached_doc("Presentation", reference.presentation)
        for slide in ref_doc.slides:
            composite_slides.append(slide)

    doc.slides = composite_slides

    return doc.as_dict()


def can_convert_image(extn):
    return extn.lower() in ["png", "jpeg", "jpg"]


def convert_and_save_image(image, path):
    image.save(path, "WEBP")
    return path


def create_new_webp_file_doc(presentation_name, file_url, image, extn):
    files = frappe.get_all(
        "File",
        filters={
            "attached_to_name": presentation_name,
            "file_url": file_url,
        },
        fields=["name"],
        limit=1,
    )
    if files:
        _file = frappe.get_doc("File", files[0].name)
        webp_path = _file.get_full_path().replace(extn, "webp")
        convert_and_save_image(image, webp_path)
        new_file = frappe.copy_doc(_file)
        new_file.file_name = f"{_file.file_name.replace(extn, 'webp')}"
        new_file.file_url = f"{_file.file_url.replace(extn, 'webp')}"
        new_file.mime_type = "image/webp"
        new_file.save()
        _file.delete()
        return new_file
    return file_url


@frappe.whitelist()
def get_webp_doc(presentation_name: str, file_doc: dict):
    """Legacy only. Drive does not convert uploads (§10.7).

    The conversion reads and rewrites a local disk path and then deletes the
    source `File`. A linked deck holds media nodes and blobs instead, and the
    browser converts before the node exists [012 §9].
    """
    refuse_drive_native(presentation_name, "a webp upload")
    file_url = file_doc.get("file_url", "")
    if file_url.endswith((".webp", ".svg")):
        return file_doc

    image, filename, extn = get_local_image(file_url)

    if can_convert_image(extn):
        return create_new_webp_file_doc(presentation_name, file_url, image, extn)

    return file_doc


def update_element_urls(presentation, element):
    attribute = "poster" if element.get("type") == "video" else "src"
    image_url = element.get(attribute, "")

    webp_doc = get_webp_doc(presentation, image_url)

    if webp_doc.file_url:
        element["attachmentName"] = webp_doc.name
        element[attribute] = webp_doc.file_url


@frappe.whitelist()
def optimize_images(name: str):
    """Legacy only, and a Desk button. See `get_webp_doc`."""
    refuse_drive_native(name, "a webp upload")
    doc = frappe.get_doc("Presentation", name)

    for slide in doc.slides:
        elements = json.loads(slide.elements or "[]")

        for element in elements:
            if element.get("type") in ["image", "video"]:
                update_element_urls(doc.name, element)

        slide.elements = json.dumps(elements, indent=2)

    return doc.save()


@frappe.whitelist(allow_guest=True)
def get_editor_access(presentation_id: str) -> str:
    """Answer one deck's access level for this caller.

    A linked deck answers from its node, composite or not. The composite arm
    used to run first and answer `"view"` off the legacy `is_composite` column
    with no check at all, on a guest route: a stranger learned that a name is a
    composite deck Drive owns, which is what §5.4 refuses to say. A legacy row
    keeps that arm, because Build has not linked it and ticket 23 owns the
    legacy read path.
    """
    is_composite = frappe.db.get_value("Presentation", presentation_id, "is_composite")

    if is_drive_native(presentation_id):
        # One node, one role ladder. `Drive Grant` is the only authority (§1),
        # and a refusal below Read is a 404 rather than a disclosure (§5.4).
        node = slides_drive.node_of(presentation_id)
        for role, answer in ((drive.EDIT, "edit"), (drive.READ, "view")):
            try:
                drive.check(node, role)
            except frappe.ValidationError:
                continue
            # A composite is a live view over other decks. Its own body is not
            # editable however high the caller's role is, so Edit reads as view.
            return "view" if is_composite else answer
        return "none"

    if is_composite:
        return "view"

    if frappe.has_permission("Presentation", "write", presentation_id):
        return "edit"
    if frappe.has_permission("Presentation", "read", presentation_id):
        return "view"

    return "none"
