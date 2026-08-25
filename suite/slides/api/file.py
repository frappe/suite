import mimetypes

import frappe
from frappe import _
from werkzeug.exceptions import Forbidden, NotFound
from werkzeug.utils import send_file
from werkzeug.wrappers import Response


def get_file_metadata(src: str) -> tuple[str, str]:
    """
    Returns the file path and MIME type.
    """
    if src.startswith("/files"):
        src = "/public" + src
    file_path = frappe.get_site_path() + src
    mimetype = mimetypes.guess_type(file_path)[0] or "video/mp4"

    return file_path, mimetype


def get_media_response(src: str) -> Response:
    """Streams the file, honouring the Range header (206 / 416) as a browser expects."""
    file_path, mimetype = get_file_metadata(src)

    response = send_file(
        file_path,
        environ=frappe.local.request.environ,
        conditional=True,
        mimetype=mimetype,
    )
    # werkzeug advertises ranges only on a 206; a player decides from the 200
    response.headers["Accept-Ranges"] = "bytes"
    return response


def get_reference_presentations(name: str) -> set[str]:
    """Presentations a composite shows; its media is attached to those, not to it."""
    return set(
        frappe.get_all(
            "Reference Presentation",
            filters={"parent": name, "parenttype": "Presentation"},
            pluck="presentation",
            order_by=None,
        )
    )


def get_attached_presentations(src: str, names: set[str]) -> set[str]:
    """Which of `names` hold `src`, deduped: one url collects a File row per upload."""
    if not names:
        return set()

    return set(
        frappe.get_all(
            "File",
            filters={
                "file_url": src,
                "attached_to_doctype": "Presentation",
                "attached_to_name": ("in", list(names)),
            },
            pluck="attached_to_name",
            distinct=True,
            order_by=None,
        )
    )


def is_template_media(src: str) -> bool:
    """Layouts are copied into a presentation wholesale, so it shows the file urls of
    every template it ever drew a slide from without holding a File row for any."""
    holders = frappe.get_all(
        "File",
        filters={"file_url": src, "attached_to_doctype": "Presentation"},
        pluck="attached_to_name",
        distinct=True,
        order_by=None,
    )
    if not holders:
        return False

    return bool(
        frappe.get_all(
            "Presentation",
            filters={"name": ("in", holders), "is_template": 1},
            limit=1,
            order_by=None,
        )
    )


def validate_media_file(src: str, presentation: str | None = None) -> None:
    if presentation:
        shown = {presentation} | get_reference_presentations(presentation)
        for name in get_attached_presentations(src, shown):
            if frappe.has_permission("Presentation", "read", name):
                return

        # templates are readable by everyone, so the only question left is whether the
        # caller may see the presentation they claim to be viewing
        if frappe.has_permission("Presentation", "read", presentation) and is_template_media(src):
            return

    if not frappe.db.exists("File", {"file_url": src}):
        raise NotFound

    raise Forbidden(_("You don't have permission to access this file"))


@frappe.whitelist(allow_guest=True)
def get_media_file(src: str, public: str | None = None, presentation: str | None = None) -> Response:
    """
    Fetches permitted video file and returns a response.

    `presentation` is the presentation the media is being viewed in, and is required:
    a file url on its own does not identify who may see it.

    `public` is deprecated and ignored; access is determined server-side.
    """
    validate_media_file(src, presentation)

    return get_media_response(src)
