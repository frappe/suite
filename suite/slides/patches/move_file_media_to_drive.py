"""Move deck pictures and videos still stored as Frappe Files into Drive media nodes.

Until T3-21 the editor uploaded media as private `File` rows and wrote their
`/private/files/` URL into the body. Those open through the legacy proxy, and a
media request carries no `X-Drive-Links`, so a guest on a share link saw no
pictures. A guest on a public deck did. Build converted every deck it found;
this converts the media uploaded after Build. Each URL a linked deck names
gets one media node below that deck, holding the same bytes, and the body is
repointed with `remap_media`. The `File` rows stay, so a body it could not
convert still renders through the legacy proxy.

A deck that fails rolls back alone and keeps its legacy URLs, and the migrate
carries on. Frappe records the patch, so no later migrate retries it: each
failure lands in the Error Log, and the retry is
`bench --site <site> execute suite.slides.patches.move_file_media_to_drive.execute`.
A converted body names no legacy URL, so a second run has nothing to do for it.
"""

import io

import frappe

from suite import drive
from suite.slides import drive as slides_drive
from suite.slides.api.file import get_reference_presentations

LEGACY_PREFIXES = ("/private/files/", "/files/")


def execute():
    retry = f"bench --site {frappe.local.site} execute suite.slides.patches.move_file_media_to_drive.execute"
    failed = []
    for deck in frappe.get_all("Presentation", filters={"node": ("is", "set")}, fields=["name", "node"]):
        try:
            convert_deck(deck.name, deck.node)
            frappe.db.commit()
        except Exception as error:
            frappe.db.rollback()
            traceback = frappe.get_traceback()
            frappe.log_error(
                f"Slides: could not move the media of {deck.name} to Drive",
                f"{error!r}\n\nRetry with: {retry}\n\n{traceback}",
            )
            frappe.db.commit()
            failed.append(deck.name)
    if failed:
        names = ", ".join(failed)
        print(f"Slides: could not move the media of {names} to Drive. See the Error Log. Retry with: {retry}")


def convert_deck(docname: str, node: str) -> dict[str, str]:
    """Give every legacy URL the deck names its own media node, and repoint the body."""
    mapping = {}
    for url in sorted(legacy_urls(docname)):
        content, title = file_content(url, docname)
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


def file_content(url: str, docname: str) -> tuple[bytes | None, str]:
    """Read the bytes behind one legacy URL. The editor may store `/files/` for a private file."""
    candidates = [url, url.replace("/files/", "/private/files/", 1)] if url.startswith("/files/") else [url]
    for candidate in candidates:
        name = readable_file(candidate, docname)
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


def readable_file(url: str, docname: str) -> str | None:
    """The File this deck may show under `url`, by the legacy proxy's rule: attached to it,
    to a deck it references, or to a template. Another deck's file is not copied."""
    rows = frappe.get_all(
        "File",
        filters={"file_url": url, "is_folder": 0, "attached_to_doctype": "Presentation"},
        fields=["name", "attached_to_name"],
        order_by="creation",
    )
    if not rows:
        return None
    holders = [row.attached_to_name for row in rows]
    templates = frappe.get_all(
        "Presentation", filters={"name": ("in", holders), "is_template": 1}, pluck="name", order_by=None
    )
    allowed = {docname, *get_reference_presentations(docname), *templates}
    return next((row.name for row in rows if row.attached_to_name in allowed), None)
