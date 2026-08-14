# Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import base64
import json
import random
import re
import string
import uuid

import frappe
from frappe.core.doctype.file.file import get_local_image
from frappe.model.document import Document
from frappe.query_builder.functions import Count

from suite.drive.api.permissions import user_has_permission
from suite.drive.overrides.file import File as DriveFile
from suite.drive.overrides.file import content_has_permission, content_query_conditions

SYSTEM_TEMPLATE_TITLES = {"Light", "Dark"}
MAX_THUMBNAIL_BYTES = 6 * 1024 * 1024


class Presentation(Document):
    def before_save(self):
        self.slug = slug(self.title)

    def validate(self):
        if self.is_composite:
            if not self.reference_presentations:
                frappe.throw(
                    "Please add at least one reference presentation to create a composite presentation."
                )

            for ref in self.reference_presentations:
                ref_doc = frappe.get_cached_doc("Presentation", ref.presentation)
                if not is_public_presentation(ref_doc.name):
                    frappe.throw(
                        f"Reference presentation '{ref_doc.title}' must be public to create a composite presentation."
                    )

    def after_insert(self):
        if self.is_template:
            return
        self.create_drive_file()

    def on_update(self):
        # composite decks are always public — a system invariant, enforced directly
        # since File.share() would require the saver to hold a share grant
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
        return DriveFile.create_for_doc(
            self,
            parent=parent or self.flags.get("drive_parent"),
            mime_type="frappe/slides",
            file_type="Presentation",
        )


ALLOWED_IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}


@frappe.whitelist()
def save_base64_image(base64_data: str, presentation_name: str, prefix: str) -> str:
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
    """Returns the thumbnail of a presentation."""
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
    frappe.get_doc("Presentation", parent).check_permission("write")

    slide = json.loads(slide) if isinstance(slide, str) else slide

    elements_data = slide.get("elements") or "[]"
    elements = elements_data if isinstance(elements_data, list) else json.loads(elements_data)
    for element in elements:
        element["id"] = "".join(random.choices(string.ascii_lowercase + string.digits, k=9))
        if element.get("src") and element["src"].startswith("/private"):
            element["attachmentName"] = get_attachment(parent, element["src"])

    slide["elements"] = json.dumps(elements)

    return slide


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
        if not frappe.has_permission("Presentation", "read", duplicate_from):
            frappe.throw("You cannot duplicate this presentation", frappe.PermissionError)
        source_thumbnail = set_duplicate_metadata(presentation, duplicate_from)
    else:
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
    return frappe.delete_doc("Presentation", name)


@frappe.whitelist()
def update_title(name: str, title: str):
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


@frappe.whitelist()
def get_updated_json(presentation: str, elements: list[dict]):
    frappe.get_doc("Presentation", presentation).check_permission("write")

    for element in elements:
        if element.get("type") in ["image", "video"] and element.get("src"):
            file_url = element["src"].replace(frappe.local.site_name, "")
            name = get_attachment(presentation, file_url)
            element["attachmentName"] = name

    return elements


def get_permission_query_conditions(user):
    return content_query_conditions("Presentation", user, extra="`tabPresentation`.is_template = 1")


def has_permission(doc, ptype="read", user=None):
    user = user or frappe.session.user
    if doc.is_template and user != "Administrator":
        return ptype == "read" or doc.owner == user
    return content_has_permission(doc, ptype, user)


@frappe.whitelist(allow_guest=True)
def is_public_presentation(name: str):
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
    if not (is_public_presentation(name) and is_composite_presentation(name)):
        frappe.throw("Presentation is not public", frappe.PermissionError)

    doc = frappe.get_doc("Presentation", name)

    composite_slides = []

    for reference in doc.reference_presentations:
        # references are public when the composite is saved, but can be made private later
        if not is_public_presentation(reference.presentation):
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
    is_composite = frappe.db.get_value("Presentation", presentation_id, "is_composite")
    if is_composite:
        return "view"

    if frappe.has_permission("Presentation", "write", presentation_id):
        return "edit"
    if frappe.has_permission("Presentation", "read", presentation_id):
        return "view"

    return "none"
