import os

import frappe
from frappe.utils import get_files_path

from suite.slides.doctype.presentation.patches.cleanup_unused_thumbnail_files import (
    get_url_variants,
)

PRIVATE_PREFIX = "/private/files/"
PUBLIC_PREFIX = "/files/"


def get_disk_path(file_url: str) -> str | None:
    """Resolve a framework file URL to its path on disk, mirroring File.get_full_path()."""
    if file_url.startswith(PRIVATE_PREFIX):
        return get_files_path(*file_url[len(PRIVATE_PREFIX) :].split("/"), is_private=1)
    if file_url.startswith(PUBLIC_PREFIX):
        return get_files_path(*file_url[len(PUBLIC_PREFIX) :].split("/"))
    return None


def is_dangling(file_url: str) -> bool:
    """Nothing can serve this URL any more.

    Both privacy prefixes have to be ruled out: sanitize_attachment_urls stripped
    /private from the stored string without touching the File row, so a field can read
    /files/x while the row and the blob still live under /private/files/x.

    A File row of any kind means some storage backend still owns the blob, and the
    attach hook only rebuilds a thumbnail it cannot find a File for — so a surviving
    row is reason enough to leave the field alone. Only once no row is left does the
    on-disk check decide, and by then the URL can only be a local framework blob:
    Drive rewrites S3-backed files to the `suite.drive.api.s3.fetch` prefix, which
    get_disk_path() does not resolve.
    """
    variants = get_url_variants(file_url)

    if frappe.db.exists("File", {"file_url": ["in", list(variants)]}):
        return False

    disk_paths = [path for path in map(get_disk_path, variants) if path]
    return bool(disk_paths) and not any(os.path.exists(path) for path in disk_paths)


def execute():
    """Clear deck thumbnails whose blob is gone.

    cleanup_unused_thumbnail_files decided what was unused by scanning Slide rows only,
    so thumbnails that move_slide_thumbnail_to_presentation had already lifted onto
    Presentation.thumbnail were deleted with the field still pointing at them. The
    framework's attach hook then retries the missing blob on every save of those decks
    and logs "Error Attaching File" each time.
    """
    # the field left the DocType (Q19'), so its column, where one is left, is reached by SQL
    if not frappe.db.has_column("Presentation", "thumbnail"):
        return

    presentations = frappe.db.sql(
        "SELECT `name`, `thumbnail` FROM `tabPresentation` WHERE `thumbnail` LIKE %s",
        "/%files/%",
        as_dict=True,
    )

    for presentation in presentations:
        if not is_dangling(presentation.thumbnail):
            continue

        frappe.db.sql(
            "UPDATE `tabPresentation` SET `thumbnail` = '' WHERE `name` = %s",
            presentation.name,
        )
