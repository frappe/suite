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


def child_path(parent: dict) -> str:
    """The `path` every direct child of `parent` must carry.

    One rule, spelled the same way as `_core/nodes.child_path`, which the
    runtime enforces on every save, move, restore, and copy: a child of a
    root carries the empty path, and every deeper child carries its parent's
    path plus the parent id. `parent['path'] or ''` drops the leading slash
    for a parent that sits directly under a root, and `_check_tree_position`
    then refuses that node for good.
    """
    if parent.get("kind") == "root":
        return ""
    return f"{parent.get('path') or '/'}{parent.get('name')}/"


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


def exact_fields(actual: dict, expected: dict, fields: tuple[str, ...], label: str) -> None:
    """Refuse the first immutable or semantic mismatch."""
    for field in fields:
        left = actual.get(field)
        right = expected.get(field)
        if field in {"creation", "modified", "content_modified", "trashed_at", "resolved_at"}:
            left = str(left) if left is not None else None
            right = str(right) if right is not None else None
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
            raise InvalidLegacyContent(
                f"{label} field {field} is {actual.get(field)!r}, expected {expected.get(field)!r}"
            )
