"""Pure row mappings for Build content conversion."""

import base64
import binascii
import gzip
import hashlib
import io
import json
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from suite.drive._core.roles import EDIT, MANAGE, READ

MAX_SHEETS_DATA_BYTES = 75 * 1024 * 1024
MAX_VERSION_SEQ = 2_147_483_647

# `Drive Node.path` is `varchar(500)` and a tree stops at 40 levels (§3.1).
# `tree.py` names both for the ticket 27 walk. A media node and a template
# node are children too, and bulk SQL fires no validator.
PATH_CAPACITY = 500
DEPTH_CAP = 40


class InvalidLegacyContent(ValueError):
    """Legacy content cannot fit the accepted target shape."""


class RemovedLegacyFile(InvalidLegacyContent):
    """Every legacy `File` row of a content document is `Removed`.

    §14.4: "Rows with status Removed, and everything below them, are not
    migrated and are counted." The tree phase therefore minted no node for
    those `File` rows, and no later step can mint one, because §7 of ticket
    011 rejected treating a Removed row as Trashed: its bytes are gone.

    §5.13 leaves no room for the document that is left: "There is no
    'document without a node' fallback ... that state cannot exist, so it is
    an error", and `framework.refuse_unlinked_documents` stops the migration
    on one. So step 10 counts it, lists it under `removed_file_documents`,
    and purges it through the app's own `on_purge`. It is not deferred:
    deferral means a later step still owes it a node, and nothing does.

    Step 7 raises this too, and skips: it copies no history for a document
    with no node, and step 10 owns the census and the purge.

    Subclassing `InvalidLegacyContent` keeps a caller that does not handle
    the skip failing with bounded evidence, as it does today, rather than
    running on with no node.

    `file` is the lowest of the Removed `File` ids, so a rerun and a report
    name the same one.
    """

    def __init__(self, doctype: str, docname: str, file: str):
        super().__init__(f"legacy File {file} is Removed")
        self.doctype = doctype
        self.docname = docname
        self.file = file


def path_depth(path: str) -> int:
    """The depth a node carrying this path sits at, root counted as zero."""
    return path.count("/") or 1


def within_capacity(path: str) -> bool:
    """Whether a child at this path fits the column and the depth cap."""
    return len(path) <= PATH_CAPACITY and path_depth(path) <= DEPTH_CAP


def docshare_role(row) -> int | None:
    """Map Frappe sharing rights to Drive's strict role ladder.

    §14.5, one line each: `share` and `write` is MANAGE, `write` is EDIT,
    `read` only is READ, and `share` without `write` leaves the highest
    content flag to win. `submit` is not on the ladder and no content
    doctype here is submittable, so a submit-only row falls to its own
    `read` flag, which Frappe always sets alongside.
    """
    if row.share and row.write:
        return MANAGE
    if row.write:
        return EDIT
    if row.read:
        return READ
    return None


def decode_sheets_data(stored: str | None) -> str:
    """Decode the legacy bounded gzip envelope without importing Sheets."""
    if not stored:
        return "{}"
    try:
        envelope = json.loads(stored)
    except (TypeError, ValueError):
        return stored
    if not (
        isinstance(envelope, dict) and envelope.get("_z") == "gzip" and isinstance(envelope.get("data"), str)
    ):
        return stored
    encoded = envelope["data"]
    if len(encoded) > MAX_SHEETS_DATA_BYTES * 2:
        raise InvalidLegacyContent("compressed Sheet data exceeds the accepted bound")
    try:
        compressed = base64.b64decode(encoded, validate=True)
        with gzip.GzipFile(fileobj=io.BytesIO(compressed), mode="rb") as stream:
            raw = stream.read(MAX_SHEETS_DATA_BYTES)
            if stream.read(1):
                raise InvalidLegacyContent("Sheet data expands past the accepted bound")
    except (binascii.Error, OSError, EOFError) as error:
        raise InvalidLegacyContent("Sheet data has an invalid gzip envelope") from error
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise InvalidLegacyContent("Sheet data is not UTF-8") from error


def sheet_version_bytes(stored: str, seq: int) -> bytes:
    """Create the exact `sheet/1` payload the Sheets adapter restores."""
    plain = decode_sheets_data(stored)
    try:
        json.loads(plain)
    except ValueError as error:
        raise InvalidLegacyContent("Sheet snapshot is not JSON") from error
    payload = {"schema": "sheet/1", "sheets_data": plain, "head_seq": int(seq)}
    return json.dumps(payload).encode("utf-8")


def sheet_anchor(sheet_name: str, cell_id: str) -> str:
    """Return the reversible opaque Sheets anchor."""
    anchor = json.dumps([sheet_name, cell_id], ensure_ascii=False, separators=(",", ":"))
    if not anchor or len(anchor) > 255:
        raise InvalidLegacyContent("Sheet comment anchor exceeds 255 characters")
    return anchor


def derived_name(domain: str, *parts) -> str:
    """Hash structured source identity without delimiter ambiguity."""
    material = json.dumps([domain, *parts], ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def epoch_millis(value, timezone: str) -> str:
    """Convert one UTC epoch value into a naive site datetime string."""
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise InvalidLegacyContent("comment creation is not epoch milliseconds")
    try:
        converted = datetime.fromtimestamp(value / 1000, UTC).astimezone(ZoneInfo(timezone))
    except (OSError, OverflowError, ValueError) as error:
        raise InvalidLegacyContent("comment creation is outside the datetime range") from error
    return converted.replace(tzinfo=None).strftime("%Y-%m-%d %H:%M:%S.%f")


STAMP_FORMAT = "%Y-%m-%d %H:%M:%S.%f"
# What MariaDB hands back for a `datetime(6)`, in the two renderings the
# driver produces: with microseconds, and without them when they are zero.
STAMP_TEXT_FORMATS = (STAMP_FORMAT, "%Y-%m-%d %H:%M:%S")


def normalized_stamp(value):
    """Render one stamp the same way whatever produced it.

    A planned stamp is text with microseconds. The same row read back is a
    `datetime`, and `str()` on one whose microsecond is zero drops the
    `.000000`, so an exact comparison would refuse a row it just wrote.
    Both sides go through one format, so the comparison is of the instant.
    A value that is not a stamp is returned unchanged and still mismatches.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.strftime(STAMP_FORMAT)
    text = str(value)
    for pattern in STAMP_TEXT_FORMATS:
        try:
            return datetime.strptime(text, pattern).strftime(STAMP_FORMAT)
        except ValueError:
            continue
    return text


def compact_settings(keymap: str | None) -> str:
    """Preserve a Writer Template shortcut without inventing settings."""
    value = (keymap or "").strip()
    return json.dumps({"keymap": value} if value else {}, separators=(",", ":"), ensure_ascii=False)


def standard_fields(row, *, owner: str | None = None) -> dict:
    """Copy source stamps into one bulk target row."""
    actor = owner or row.owner
    if not actor or not row.creation or not row.modified:
        raise InvalidLegacyContent(f"{row.name} has incomplete standard stamps")
    return {
        "owner": actor,
        "creation": str(row.creation),
        "modified": str(row.modified),
        "modified_by": row.modified_by or actor,
        "docstatus": 0,
        "idx": 0,
    }


def expected_node(
    row,
    *,
    name: str,
    title: str,
    parent: str,
    root: str,
    path: str,
    mime: str,
    is_template: int = 0,
    state: str = "Active",
    trashed_at: str | None = None,
    trash_root: str | None = None,
) -> dict:
    """Build one canonical content document node."""
    return {
        "name": name,
        "title": title,
        "parent": parent,
        "root": root,
        "path": path,
        "kind": "document",
        "blob": None,
        "size": 0,
        "mime": mime,
        "url": None,
        "content_doctype": row.doctype,
        "content_docname": row.name,
        "state": state,
        "trashed_at": trashed_at,
        "trash_root": trash_root,
        "content_modified": row.modified,
        "is_template": is_template,
        **standard_fields(row),
    }


# Every refusal message reaches `drive-build-state.json` through `record_issue`,
# and plan §13 forbids that file from holding comment text, body bytes, authors,
# secrets, or blob contents. A mismatch on `html` or `content` would otherwise
# copy two whole documents into it.
OPAQUE_FIELDS = frozenset(
    {
        "html",
        "content",
        "settings",
        "sheets_data",
        "text",
        "anchor",
        "title",
        "owner",
        "modified_by",
        "actor",
        "author",
        "author_name",
        "resolved_by",
        "mentions",
        "user",
    }
)
BOUNDED_VALUE_CHARS = 60


def bounded(value, *, opaque: bool = False) -> str:
    """Describe one field value without reproducing it."""
    if value is None or isinstance(value, bool | int | float):
        return repr(value)
    text = value if isinstance(value, str) else repr(value)
    digest = hashlib.sha256(text.encode("utf-8", "surrogatepass")).hexdigest()[:12]
    if opaque or len(text) > BOUNDED_VALUE_CHARS:
        return f"<{len(text)} chars sha256:{digest}>"
    return repr(text)


def exact_fields(actual: dict, expected: dict, fields: tuple[str, ...], label: str) -> None:
    """Refuse the first immutable or semantic mismatch."""
    for field in fields:
        left = actual.get(field)
        right = expected.get(field)
        if field in {"creation", "modified", "content_modified", "trashed_at", "resolved_at"}:
            left = normalized_stamp(left)
            right = normalized_stamp(right)
        if field in {"pinned", "resolved", "is_template", "collab", "docstatus", "idx"}:
            left = int(left or 0)
            right = int(right or 0)
        if field == "mentions":
            try:
                left = json.loads(left) if isinstance(left, str) else left
                right = json.loads(right) if isinstance(right, str) else right
            except ValueError:
                pass
        if left != right:
            opaque = field in OPAQUE_FIELDS
            raise InvalidLegacyContent(
                f"{label} field {field} is {bounded(actual.get(field), opaque=opaque)}, "
                f"expected {bounded(expected.get(field), opaque=opaque)}"
            )
