"""Free, reusable preview artifacts beside Drive nodes."""

import io
import time
from collections.abc import Iterable

import frappe
from frappe import _
from frappe.storage.blob import put_blob, revive_blob
from frappe.storage.driver import get_driver
from frappe.storage.url import signed_url_for_blob
from PIL import Image, ImageOps

from suite.drive._core.access import require
from suite.drive._core.errors import DriveForbidden, DriveNotFound
from suite.drive._core.nodes import _node
from suite.drive._core.principals import Principals
from suite.drive._core.roles import EDIT

PREVIEW_LONGEST_SIDE = 512
PREVIEW_TTL_SECONDS = 15 * 60
SWEEP_BATCH = 500
SWEEP_CURSOR_KEY = "drive:preview-sweep-cursor"

IMAGE_MIMES = frozenset(
    {
        "image/avif",
        "image/bmp",
        "image/gif",
        "image/jp2",
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/tiff",
        "image/webp",
        "image/x-icon",
    }
)
VIDEO_MIMES = frozenset(
    {
        "video/mp4",
        "video/mpeg",
        "video/ogg",
        "video/quicktime",
        "video/webm",
        "video/x-matroska",
    }
)
PDF_MIME = "application/pdf"
RENDERABLE_MIMES = tuple(sorted((*IMAGE_MIMES, *VIDEO_MIMES, PDF_MIME)))

MISSING_PREVIEW_SQL = """
SELECT n.name, n.creation
FROM `tabDrive Node` n
LEFT JOIN `tabDrive Node Preview` pv ON pv.node = n.name
WHERE n.state = 'Active'
  AND n.kind = 'file'
  AND n.blob IS NOT NULL
  AND n.mime IN %(renderable_mimes)s
  AND pv.name IS NULL
  AND (
      %(after_creation)s IS NULL
      OR n.creation > %(after_creation)s
      OR (n.creation = %(after_creation)s AND n.name > %(after_name)s)
  )
ORDER BY n.creation, n.name
LIMIT %(batch)s
"""


def enqueue_render(node: str) -> None:
    """Queue one post-commit render attempt without taking a render lock."""
    frappe.enqueue(
        "suite.drive._core.previews.render",
        queue="short",
        enqueue_after_commit=True,
        node=node,
    )


def render(node: str) -> None:
    """Render or reuse a file preview, publishing only for the captured head."""
    snapshot = frappe.db.get_value(
        "Drive Node",
        node,
        ["name", "kind", "state", "blob", "mime"],
        as_dict=True,
    )
    if not _renderable_file(snapshot):
        return

    source_blob = snapshot.blob
    reused = frappe.db.get_value(
        "Drive Node Preview",
        {"source_blob": source_blob},
        "blob",
        order_by="creation, name",
    )
    if reused:
        _publish_rendered(node, source_blob, reused)
        return

    source = frappe.db.get_value(
        "File Blob",
        source_blob,
        ["name", "key", "driver", "is_private", "status"],
        as_dict=True,
    )
    if not source or source.status != "Ready" or not source.is_private:
        raise DriveNotFound(_("The Drive preview source blob was not found"))

    driver = get_driver(source.driver)
    with driver.read(source.key, is_private=True) as stream:
        preview_bytes = _render_webp(stream, snapshot.mime)
    preview = put_blob(io.BytesIO(preview_bytes), is_private=True, filename=f"{node}.webp")
    _publish_rendered(node, source_blob, preview.name)


def push_preview(principals: Principals, node: str, image_bytes: bytes, mime: str) -> None:
    """Replace one document preview under EDIT without touching its node."""
    current = _node(node)
    require(current, EDIT, principals)
    if current.kind != "document" or current.state != "Active":
        raise DriveForbidden(_("Only an active content document accepts a pushed preview"))
    if mime not in IMAGE_MIMES or not isinstance(image_bytes, bytes) or not image_bytes:
        frappe.throw(_("A supported preview image is required"), frappe.ValidationError)

    preview_bytes = _image_webp(io.BytesIO(image_bytes))
    preview = put_blob(io.BytesIO(preview_bytes), is_private=True, filename=f"{node}.webp")

    locked = _node(node, for_update=True)
    if locked.kind != "document" or locked.state != "Active":
        raise DriveForbidden(_("Only an active content document accepts a pushed preview"))
    _write_preview(node, source_blob=None, preview_blob=preview.name)


def copy_preview(source: str, target: str) -> bool:
    """Copy one preview reference without copying or charging its bytes."""
    row = frappe.db.get_value(
        "Drive Node Preview",
        {"node": source},
        ["source_blob", "blob"],
        as_dict=True,
    )
    if not row:
        return False
    if not revive_blob(row.blob):
        return False
    _write_preview(target, source_blob=row.source_blob, preview_blob=row.blob)
    return True


def preview_expansions(nodes: Iterable[str]) -> dict[str, dict]:
    """Mint batched preview URLs after an adapter explicitly requests expansion."""
    node_ids = tuple(dict.fromkeys(node for node in nodes if isinstance(node, str) and node))
    if not node_ids:
        return {}
    rows = frappe.get_all(
        "Drive Node Preview",
        filters={"node": ["in", node_ids]},
        fields=["node", "blob"],
    )
    expires = int(time.time()) + PREVIEW_TTL_SECONDS
    return {
        row.node: {
            "url": signed_url_for_blob(row.blob, f"{row.node}.webp", PREVIEW_TTL_SECONDS),
            "expires": expires,
        }
        for row in rows
    }


def sweep_missing() -> dict:
    """Queue one bounded page of active files whose supported head lacks a preview."""
    after_creation, after_name = _sweep_cursor()
    rows = _missing_rows(after_creation, after_name)
    wrapped = False
    if not rows and after_creation is not None:
        rows = _missing_rows(None, None)
        wrapped = True

    for row in rows:
        enqueue_render(row.name)

    if rows:
        last = rows[-1]
        frappe.cache().set_value(
            _sweep_cursor_key(),
            frappe.as_json({"creation": str(last.creation), "name": last.name}),
        )
    else:
        frappe.cache().delete_value(_sweep_cursor_key())
    return {
        "enqueued": len(rows),
        "cursor": rows[-1].name if rows else None,
        "wrapped": wrapped,
    }


def _renderable_file(node: frappe._dict | None) -> bool:
    return bool(
        node
        and node.kind == "file"
        and node.state == "Active"
        and node.blob
        and node.mime in RENDERABLE_MIMES
    )


def _render_webp(stream, mime: str) -> bytes:
    if mime in IMAGE_MIMES:
        return _image_webp(stream)
    if mime in VIDEO_MIMES:
        import av

        with av.open(stream) as container:
            video = next(candidate for candidate in container.streams if candidate.type == "video")
            if video.duration:
                container.seek(video.duration // 2, stream=video)
            frame = next(container.decode(video))
            return _image_webp(frame.to_image())
    if mime == PDF_MIME:
        import pymupdf

        with pymupdf.open(stream=stream.read(), filetype="pdf") as pdf:
            page = pdf.load_page(0)
            zoom = PREVIEW_LONGEST_SIDE / max(page.rect.width, page.rect.height)
            pixmap = page.get_pixmap(
                matrix=pymupdf.Matrix(zoom, zoom),
                colorspace=pymupdf.csRGB,
                alpha=False,
            )
            image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
            return _image_webp(image)
    raise ValueError(f"Unsupported preview MIME: {mime}")


def _image_webp(source) -> bytes:
    if isinstance(source, Image.Image):
        return _encode_image(source)
    with Image.open(source) as image:
        return _encode_image(image)


def _encode_image(image: Image.Image) -> bytes:
    image = ImageOps.exif_transpose(image)
    image.thumbnail((PREVIEW_LONGEST_SIDE, PREVIEW_LONGEST_SIDE))
    output = io.BytesIO()
    image.convert("RGB").save(output, format="WEBP")
    return output.getvalue()


def _publish_rendered(node: str, source_blob: str, preview_blob: str) -> bool:
    try:
        current = _node(node, for_update=True)
    except DriveNotFound:
        return False
    if not _renderable_file(current) or current.blob != source_blob:
        return False
    if not revive_blob(preview_blob):
        return False
    _write_preview(node, source_blob=source_blob, preview_blob=preview_blob)
    return True


def _write_preview(node: str, *, source_blob: str | None, preview_blob: str) -> None:
    existing = frappe.db.get_value("Drive Node Preview", {"node": node}, "name")
    if existing:
        preview = frappe.get_doc("Drive Node Preview", existing)
        preview.source_blob = source_blob
        preview.blob = preview_blob
        preview.save(ignore_permissions=True)
        return
    frappe.get_doc(
        {
            "doctype": "Drive Node Preview",
            "node": node,
            "source_blob": source_blob,
            "blob": preview_blob,
        }
    ).insert(ignore_permissions=True)


def _missing_rows(after_creation, after_name):
    return frappe.db.sql(
        MISSING_PREVIEW_SQL,
        {
            "renderable_mimes": RENDERABLE_MIMES,
            "after_creation": after_creation,
            "after_name": after_name,
            "batch": SWEEP_BATCH,
        },
        as_dict=True,
    )


def _sweep_cursor() -> tuple[str | None, str | None]:
    raw = frappe.cache().get_value(_sweep_cursor_key())
    if not raw:
        return None, None
    try:
        value = frappe.parse_json(raw)
    except (TypeError, ValueError):
        return None, None
    if (
        not isinstance(value, dict)
        or not isinstance(value.get("creation"), str)
        or not isinstance(value.get("name"), str)
    ):
        return None, None
    return value["creation"], value["name"]


def _sweep_cursor_key() -> str:
    site = getattr(frappe.local, "site", None) or "no-site"
    return f"{SWEEP_CURSOR_KEY}:{site}"
