"""Move deck pictures and videos still stored as Frappe Files into Drive media nodes.

Until T3-21 the editor uploaded media as private `File` rows and wrote their
`/private/files/` URL into the body. Only signed-in readers could open those,
so a public-link guest saw no pictures. Build converted every deck it found;
this converts the media uploaded after Build. Each URL a linked deck names
gets one media node below that deck, holding the same bytes, and the body is
repointed with `remap_media`. The `File` rows stay, so the patch can run again
and a body it could not convert still renders through the legacy proxy.
"""

import io

import frappe

from suite import drive
from suite.slides import drive as slides_drive

LEGACY_PREFIXES = ("/private/files/", "/files/")


def execute():
    for deck in frappe.get_all("Presentation", filters={"node": ("is", "set")}, fields=["name", "node"]):
        try:
            convert_deck(deck.name, deck.node)
            frappe.db.commit()
        except Exception:
            frappe.db.rollback()
            frappe.log_error(
                f"Slides: could not move the media of {deck.name} to Drive", frappe.get_traceback()
            )


def convert_deck(docname: str, node: str) -> dict[str, str]:
    """Give every legacy URL the deck names its own media node, and repoint the body."""
    mapping = {}
    for url in sorted(legacy_urls(docname)):
        content, title = file_content(url)
        if content is not None:
            mapping[url] = drive.store_file(node, title, io.BytesIO(content))
    slides_drive.remap_media(docname, mapping)
    return mapping


def legacy_urls(docname: str) -> set[str]:
    urls = set()
    for row in frappe.get_all(
        "Slide",
        filters={"parent": docname, "parenttype": "Presentation"},
        fields=["background", "elements"],
    ):
        if is_legacy_url(row.background):
            urls.add(row.background)
        for element in slides_drive.elements_of(row):
            urls.update(
                element[key] for key in slides_drive.ELEMENT_MEDIA_KEYS if is_legacy_url(element.get(key))
            )
    return urls


def is_legacy_url(value) -> bool:
    return isinstance(value, str) and value.startswith(LEGACY_PREFIXES)


def file_content(url: str) -> tuple[bytes | None, str]:
    """Read the bytes behind one legacy URL. The editor may store `/files/` for a private file."""
    candidates = [url, url.replace("/files/", "/private/files/", 1)] if url.startswith("/files/") else [url]
    for candidate in candidates:
        name = frappe.db.get_value("File", {"file_url": candidate, "is_folder": 0}, "name")
        if not name:
            continue
        file = frappe.get_doc("File", name)
        try:
            content = file.get_content()
        except OSError:
            # the row outlived its bytes; the body keeps the URL it had
            return None, ""
        return (content.encode() if isinstance(content, str) else content), file.file_name
    return None, ""
