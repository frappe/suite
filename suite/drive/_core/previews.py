"""Free, reusable preview artifacts beside Drive nodes."""

import io
import time
from collections.abc import Iterable
from contextlib import closing
from typing import IO, Literal

import frappe
from frappe import _
from frappe.storage.blob import put_blob, revive_blob
from frappe.storage.driver import StorageDriver, get_driver
from frappe.storage.url import signed_url_for_blob
from frappe.utils import cint
from PIL import Image, ImageOps

from suite.drive._core.access import require
from suite.drive._core.errors import DriveForbidden, DriveNotFound
from suite.drive._core.principals import Principals
from suite.drive._core.roles import EDIT
from suite.drive._core.roots import reject_illegal_root_operation

PREVIEW_LONGEST_SIDE = 512
# The range a `preview_size` may take, in pixels. A preview is a grid tile:
# below 128 px it is blurry on a high-density screen, and above 2048 px it is
# a full-size render, not a thumbnail. A PDF page at 2048 px is about 4 Mpx;
# a stored value of 250000 asked pymupdf for a pixmap it refuses to make.
MIN_PREVIEW_SIZE = 128
MAX_PREVIEW_SIZE = 2048
PREVIEW_TTL_SECONDS = 15 * 60
# One ranged read of a video's source blob. PyAV reads 32 KB at a time; a
# larger buffer turns those reads into a few requests, not hundreds.
RANGE_READ_BYTES = 1024 * 1024


def is_plausible_preview_size(value: int) -> bool:
    """Whether `value` is a longest side, in pixels, that a preview may use."""
    return MIN_PREVIEW_SIZE <= value <= MAX_PREVIEW_SIZE


def _preview_longest_side() -> int:
    """Read the site's configured preview dimension, falling back safely.

    `Drive Disk Settings.preview_size` is `reqd: 1` with `default: 512`, and
    the doctype refuses a value outside `MIN_PREVIEW_SIZE..MAX_PREVIEW_SIZE`
    (§3.13, §9.2). A Single field can still come back `None` before the
    site's first save, or carry a value written without validation. A render
    runs from a background job, so there is no request to refuse; fall back
    to the spec default rather than pass a bad size into PIL's `thumbnail()`
    or the PDF zoom maths.
    """
    try:
        value = int(frappe.db.get_single_value("Drive Disk Settings", "preview_size"))
    except TypeError, ValueError:
        return PREVIEW_LONGEST_SIDE
    return value if is_plausible_preview_size(value) else PREVIEW_LONGEST_SIDE


# A pushed preview is an app-rendered thumbnail, not a photograph, so the bound
# is generous. It exists because `_encode_image` decodes before it thumbnails:
# a 294 KB solid WebP of 13000x13000 is 169 megapixels, sits under Pillow's own
# 178.9 Mpx bomb threshold, peaks at 2.6 GB of resident memory, and stores 542
# bytes. A byte cap cannot see that; a pixel count can, from the header alone.
MAX_PUSHED_PREVIEW_PIXELS = 25_000_000
# One page of `MISSING_PREVIEW_SQL`. The daily sweep queues one page per run;
# the backfill renders page after page until none is left.
SWEEP_BATCH = 500
SWEEP_CURSOR_KEY = "drive:preview-sweep-cursor"
BACKFILL_CURSOR_KEY = "drive:preview-backfill-cursor"
BACKFILL_JOB_ID = "drive-preview-backfill"
# Long enough for a whole migrated site in one job. A job that runs out of
# time keeps its cursor, and the next run continues from there.
BACKFILL_TIMEOUT_SECONDS = 6 * 60 * 60

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

BackfillOutcome = Literal["made", "skipped", "failed"]

# §9.2's sweep matches `pv.name IS NULL`. A row that survives a head change
# is invisible to that filter, so every writer that repoints `Drive Node.blob`
# has to remember the delete. The `source_blob` comparison closes that class:
# any file whose preview no longer names its head is swept and re-rendered.
MISSING_PREVIEW_SQL = """
SELECT n.name, n.creation
FROM `tabDrive Node` n
LEFT JOIN `tabDrive Node Preview` pv ON pv.node = n.name
WHERE n.state = 'Active'
  AND n.kind = 'file'
  AND n.blob IS NOT NULL
  AND n.mime IN %(renderable_mimes)s
  AND (pv.name IS NULL OR pv.source_blob IS NULL OR pv.source_blob != n.blob)
  AND (
      %(after_creation)s IS NULL
      OR n.creation > %(after_creation)s
      OR (n.creation = %(after_creation)s AND n.name > %(after_name)s)
  )
ORDER BY n.creation, n.name
LIMIT %(batch)s
"""


def enqueue_render(node: str) -> None:
    """Queue one post-commit render attempt without taking a render lock.

    Callers reach this through the module (`previews.enqueue_render(node)`),
    never through a `from ... import` alias. §9.2 names this function as the
    one render entry point, so one patch point has to cover every writer.

    Queuing is best-effort. `frappe.enqueue` measures the queue depth inline,
    before it registers the post-commit callback, and raises `QueueOverloaded`
    from the call below. Both node writers call this as the last statement
    inside their savepoint (`nodes.create_file`, `nodes.update`), so a raised
    refusal would discard bytes the caller already stored and already paid
    quota for, to save a thumbnail. A preview is a free derived artifact and
    §9.2's daily gap sweep exists to cover failed renders, so the byte write
    wins and the miss is logged for triage.
    """
    try:
        frappe.enqueue(
            "suite.drive._core.previews.render",
            queue="short",
            enqueue_after_commit=True,
            node=node,
        )
    except Exception:
        frappe.log_error("Drive: could not queue a preview render", frappe.get_traceback())


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
    if reused and _publish_rendered(node, source_blob, reused):
        return
    if reused and frappe.db.get_value("Drive Node", node, "blob") != source_blob:
        # The head moved while this job ran. A newer job owns the node.
        return

    source = frappe.db.get_value(
        "File Blob",
        source_blob,
        ["name", "key", "driver", "is_private", "status", "file_size"],
        as_dict=True,
    )
    if not source or source.status != "Ready" or not source.is_private:
        raise DriveNotFound(_("The Drive preview source blob was not found"))

    with _open_source(source, snapshot.mime) as stream:
        preview_bytes = _render_webp(stream, snapshot.mime)
    preview = put_blob(io.BytesIO(preview_bytes), is_private=True, filename=f"{node}.webp")
    _publish_rendered(node, source_blob, preview.name)


def push_preview(principals: Principals, node: str, image_bytes: bytes, mime: str) -> None:
    """Replace one document preview under EDIT without touching its node."""
    from suite.drive._core.nodes import _node

    current = _node(node)
    require(current, EDIT, principals)
    reject_illegal_root_operation(current, "preview")
    if current.kind != "document" or current.state != "Active":
        raise DriveForbidden(_("Only an active content document accepts a pushed preview"))
    if mime not in IMAGE_MIMES or not isinstance(image_bytes, bytes) or not image_bytes:
        frappe.throw(_("A supported preview image is required"), frappe.ValidationError)
    _refuse_oversized_image(image_bytes)

    try:
        preview_bytes = _image_webp(io.BytesIO(image_bytes), _preview_longest_side())
    except OSError, ValueError:
        # A header that parsed and a body that did not: Pillow raises
        # `OSError` on truncated data, which is a malformed argument, not a
        # server fault.
        frappe.throw(_("A supported preview image is required"), frappe.ValidationError)
    preview = put_blob(io.BytesIO(preview_bytes), is_private=True, filename=f"{node}.webp")

    locked = _node(node, for_update=True)
    if locked.kind != "document" or locked.state != "Active":
        raise DriveForbidden(_("Only an active content document accepts a pushed preview"))
    _write_preview(node, source_blob=None, preview_blob=preview.name)


def _refuse_oversized_image(image_bytes: bytes) -> None:
    """Refuse a pushed image on its declared pixel count, before any decode.

    `Image.open` reads the header and stops, so `size` costs nothing and the
    decompression bomb never reaches `_encode_image`.
    """
    try:
        with Image.open(io.BytesIO(image_bytes)) as probe:
            width, height = probe.size
    except Exception:
        frappe.throw(_("A supported preview image is required"), frappe.ValidationError)
    if width * height > MAX_PUSHED_PREVIEW_PIXELS:
        frappe.throw(
            _("A pushed Drive preview may not exceed {0} pixels").format(MAX_PUSHED_PREVIEW_PIXELS),
            frappe.ValidationError,
        )


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
    after_creation, after_name = _read_cursor(_sweep_cursor_key())
    rows = _missing_rows(after_creation, after_name)
    wrapped = False
    if not rows and after_creation is not None:
        rows = _missing_rows(None, None)
        wrapped = True

    for row in rows:
        enqueue_render(row.name)

    if rows:
        _write_cursor(_sweep_cursor_key(), str(rows[-1].creation), rows[-1].name)
    else:
        frappe.cache().delete_value(_sweep_cursor_key())
    return {
        "enqueued": len(rows),
        "cursor": rows[-1].name if rows else None,
        "wrapped": wrapped,
    }


def enqueue_backfill() -> None:
    """Queue one preview backfill on the long queue, after the caller commits.

    Cleanup calls this once at the end of the migration, so `bench migrate`
    does not wait for thousands of renders. The fixed job id means a second
    call while a backfill is queued or running adds nothing.
    """
    frappe.enqueue(
        "suite.drive._core.previews.backfill_missing",
        queue="long",
        timeout=BACKFILL_TIMEOUT_SECONDS,
        job_id=BACKFILL_JOB_ID,
        deduplicate=True,
        enqueue_after_commit=True,
    )


def backfill_missing() -> dict:
    """Render every active file whose supported head lacks a preview, in one pass.

    This is the daily sweep's query without its one-page limit. The job
    renders each file itself and commits after each one, instead of queuing
    one short job per file: thousands of queued renders would fill the short
    queue that new uploads also use.

    The pass only moves forward. A cursor in the site cache records the last
    file it tried, so a run that stops partway continues after that file
    when it runs again. A file that fails to render is logged and passed
    over, so this run does not try it again; the daily sweep still does, as
    it does for any failed render. A file that already has a preview for
    its current head is not in the query, so a second run renders only what
    is still missing. A finished run clears its cursor.

    An operator can run it again, in the foreground:

        bench --site <site> execute suite.drive._core.previews.backfill_missing
    """
    started = time.monotonic()
    key = _backfill_cursor_key()
    after_creation, after_name = _read_cursor(key)
    counts: dict[BackfillOutcome, int] = {"made": 0, "skipped": 0, "failed": 0}
    while rows := _missing_rows(after_creation, after_name):
        for row in rows:
            counts[_backfill_one(row.name)] += 1
            after_creation, after_name = str(row.creation), row.name
            _write_cursor(key, after_creation, after_name)
    frappe.cache().delete_value(key)
    return {**counts, "seconds": round(time.monotonic() - started, 1)}


def _backfill_one(node: str) -> BackfillOutcome:
    """Render one file in its own transaction and say what came of it."""
    try:
        render(node)
    except Exception:
        frappe.db.rollback()
        frappe.log_error("Drive: could not render a preview", frappe.get_traceback())
        return "failed"
    frappe.db.commit()
    head = frappe.db.get_value("Drive Node", node, "blob")
    # `render` writes nothing when the file changed or left Active while the
    # backfill ran; whoever changed it queued its own render.
    if head and frappe.db.exists("Drive Node Preview", {"node": node, "source_blob": head}):
        return "made"
    return "skipped"


def _renderable_file(node: frappe._dict | None) -> bool:
    return bool(
        node
        and node.kind == "file"
        and node.state == "Active"
        and node.blob
        and node.mime in RENDERABLE_MIMES
    )


def _open_source(source: frappe._dict, mime: str) -> IO[bytes]:
    """Open a source blob for its render.

    An image or a PDF is read from start to end, so a plain stream does.
    A video is not: PyAV reads the index, which an MP4 can keep at the end
    of the file, then seeks to the middle frame. On a driver with native
    ranged reads, such as S3, a video gets a seekable view that fetches only
    the parts PyAV reads. Its plain stream cannot seek, and reading it would
    download the whole file. A local or in-memory driver's stream is a
    seekable file already.
    """
    driver = get_driver(source.driver)
    if mime in VIDEO_MIMES and _reads_ranges(driver):
        return io.BufferedReader(
            _BlobRanges(driver, source.key, cint(source.file_size)),
            buffer_size=RANGE_READ_BYTES,
        )
    return driver.read(source.key, is_private=True)


def _reads_ranges(driver: StorageDriver) -> bool:
    """Whether the driver fetches a byte range without reading the whole blob.

    `StorageDriver.read_range` reads the whole blob and slices it, so only a
    driver that overrides it reads ranges natively.
    """
    return isinstance(driver, StorageDriver) and type(driver).read_range is not StorageDriver.read_range


class _BlobRanges(io.RawIOBase):
    """A seekable, read-only view of one private blob, fetched range by range.

    `io.BufferedReader` wraps it, so PyAV's small reads share one request
    per `RANGE_READ_BYTES`, and a seek within the buffer fetches nothing.
    """

    def __init__(self, driver: StorageDriver, key: str, size: int) -> None:
        self._driver = driver
        self._key = key
        self._size = size
        self._position = 0

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self._position

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        bases = {io.SEEK_SET: 0, io.SEEK_CUR: self._position, io.SEEK_END: self._size}
        if whence not in bases:
            raise ValueError(f"Unsupported whence: {whence}")
        position = bases[whence] + offset
        if position < 0:
            raise ValueError("Cannot seek before the start of the blob")
        self._position = position
        return position

    def readinto(self, buffer) -> int:
        if self._position >= self._size or not len(buffer):
            return 0
        end = min(self._position + len(buffer), self._size) - 1
        with closing(self._driver.read_range(self._key, self._position, end, is_private=True)) as body:
            data = body.read()
        buffer[: len(data)] = data
        self._position += len(data)
        return len(data)


def _render_webp(stream, mime: str) -> bytes:
    longest_side = _preview_longest_side()
    if mime in IMAGE_MIMES:
        return _image_webp(stream, longest_side)
    if mime in VIDEO_MIMES:
        import av

        with av.open(stream) as container:
            video = next(candidate for candidate in container.streams if candidate.type == "video")
            if video.duration:
                container.seek(video.duration // 2, stream=video)
            frame = next(container.decode(video))
            return _image_webp(frame.to_image(), longest_side)
    if mime == PDF_MIME:
        import pymupdf

        with pymupdf.open(stream=stream.read(), filetype="pdf") as pdf:
            page = pdf.load_page(0)
            zoom = longest_side / max(page.rect.width, page.rect.height)
            pixmap = page.get_pixmap(
                matrix=pymupdf.Matrix(zoom, zoom),
                colorspace=pymupdf.csRGB,
                alpha=False,
            )
            image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
            return _image_webp(image, longest_side)
    raise ValueError(f"Unsupported preview MIME: {mime}")


def _image_webp(source, longest_side: int) -> bytes:
    if isinstance(source, Image.Image):
        return _encode_image(source, longest_side)
    with Image.open(source) as image:
        return _encode_image(image, longest_side)


def _encode_image(image: Image.Image, longest_side: int) -> bytes:
    image = ImageOps.exif_transpose(image)
    image.thumbnail((longest_side, longest_side))
    output = io.BytesIO()
    image.convert("RGB").save(output, format="WEBP")
    return output.getvalue()


def _publish_rendered(node: str, source_blob: str, preview_blob: str) -> bool:
    from suite.drive._core.nodes import _node

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
    else:
        frappe.get_doc(
            {
                "doctype": "Drive Node Preview",
                "node": node,
                "source_blob": source_blob,
                "blob": preview_blob,
            }
        ).insert(ignore_permissions=True)
    from suite.drive._core.changes import emit_for_node

    emit_for_node(node)


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


def _read_cursor(key: str) -> tuple[str | None, str | None]:
    raw = frappe.cache().get_value(key)
    if not raw:
        return None, None
    try:
        value = frappe.parse_json(raw)
    except TypeError, ValueError:
        return None, None
    if (
        not isinstance(value, dict)
        or not isinstance(value.get("creation"), str)
        or not isinstance(value.get("name"), str)
    ):
        return None, None
    return value["creation"], value["name"]


def _write_cursor(key: str, creation: str, name: str) -> None:
    frappe.cache().set_value(key, frappe.as_json({"creation": creation, "name": name}))


def _sweep_cursor_key() -> str:
    return _site_key(SWEEP_CURSOR_KEY)


def _backfill_cursor_key() -> str:
    return _site_key(BACKFILL_CURSOR_KEY)


def _site_key(prefix: str) -> str:
    site = getattr(frappe.local, "site", None) or "no-site"
    return f"{prefix}:{site}"
