"""Staged pieces of a change too big for one request body (4f).

A change is cut into pieces of exactly `PIECE_MAX` bytes, the last one
shorter, each sent on its own and kept here. The push that names the stage
assembles them and checks the exact length and sha256 before anything parses
the bytes, so a piece never reaches the parser or pycrdt.
"""

import hashlib
import json
import struct
from dataclasses import astuple, dataclass, fields
from datetime import datetime, timedelta
from typing import TypeGuard, cast

import frappe

from suite.content.tables import table

PIECE_MAX = 256 * 2**10
HEADER_MAX = 4096
DOC_MAX = 16 * 2**20
LENGTH_PREFIX_BYTES = 4
SHA_BYTES = 32
ID_LENGTH = 32
EXPIRY = timedelta(minutes=15)
FULL_RETRY_MS = 60_000
# The header fields that place a piece, by purpose: a save's seq range, a render's rev and quarantine epoch
PLACES = {"save": ("from", "to"), "render": ("rev", "q_epoch")}


class Malformed(Exception):
    pass


class TooLarge(Exception):
    pass


class Conflict(Exception):
    """The piece disagrees with what is staged at its index or with the stage's other pieces."""


class Full(Exception):
    """The user has `DOC_MAX` bytes staged on the document already."""


class Incomplete(Exception):
    """The stage lacks a piece, or its bytes don't match its length and sha256."""


@dataclass(frozen=True)
class Shape:
    """What every piece of one stage agrees on: a save's seq range or a render's rev and epoch."""

    purpose: str
    sid: str
    seq_from: int | None
    seq_to: int | None
    rev: int | None
    lineage: str
    q_epoch: int | None
    total_len: int
    sha_total: bytes


SHAPE_COLUMNS = ", ".join(f"`{field.name}`" for field in fields(Shape))


@dataclass(frozen=True)
class Piece:
    """One piece of a staged change: the stage's shape, the piece's index and its bytes."""

    shape: Shape
    index: int
    payload: bytes


def valid_id(value: object) -> TypeGuard[str]:
    """Answer whether `value` is an id of `ID_LENGTH` ASCII letters and digits."""
    return isinstance(value, str) and len(value) == ID_LENGTH and value.isalnum() and value.isascii()


def piece_count(total_len: int) -> int:
    """Count the pieces a change of `total_len` bytes is cut into."""
    return -(-total_len // PIECE_MAX)


def split_header(body: bytes) -> tuple[object, bytes]:
    """Split `u32 hlen | header JSON | rest` into the decoded header and the rest."""
    if len(body) < LENGTH_PREFIX_BYTES:
        raise Malformed

    (length,) = struct.unpack(">I", body[:LENGTH_PREFIX_BYTES])
    header_end = LENGTH_PREFIX_BYTES + length
    if length > HEADER_MAX or len(body) < header_end:
        raise Malformed

    try:
        header = json.loads(body[LENGTH_PREFIX_BYTES:header_end])
    except ValueError:
        raise Malformed from None

    return header, body[header_end:]


def checked_shape(header: object) -> Shape:
    """Check a piece's header and return the shape it gives its stage."""
    try:
        sha_total = bytes.fromhex(cast(dict, header)["sha_total"])
    except (ValueError, TypeError, KeyError):
        raise Malformed from None

    if not isinstance(header, dict):
        raise Malformed

    purpose = header.get("purpose", "save")
    if purpose not in PLACES or type(header.get("total_len")) is not int:
        raise Malformed

    lineage_valid = isinstance(header.get("lineage"), str)
    sid_valid = valid_id(header.get("sid"))
    sha_valid = len(sha_total) == SHA_BYTES
    if not (lineage_valid and sid_valid and sha_valid):
        raise Malformed

    if not placed(header, purpose) or header["total_len"] < 1:
        raise Malformed

    return shape_of(header, purpose, sha_total)


def parse_piece(body: bytes, index_text: str, edit_max: int) -> Piece:
    """Split `u32 hlen | header JSON | piece` and check its place in a change of at most `edit_max`."""
    header, piece = split_header(body)
    shape = checked_shape(header)
    if shape.total_len > edit_max:
        raise TooLarge

    if not index_text.isdigit() or int(index_text) >= piece_count(shape.total_len):
        raise Malformed

    index = int(index_text)
    expected_len = min(PIECE_MAX, shape.total_len - index * PIECE_MAX)
    if len(piece) != expected_len:
        raise Malformed

    return Piece(shape, index, piece)


def placed(header: dict, purpose: str) -> bool:
    """Answer whether a save names a seq range, or a render the rev and quarantine epoch it was made at."""
    if not all(type(header.get(key)) is int for key in PLACES[purpose]):
        return False

    if purpose == "render":
        return header["rev"] >= 1 and header["q_epoch"] >= 0

    return header["from"] >= 1 and header["to"] >= header["from"]


def already_staged(app: str, doc_id: str, stage_id: str, index: int, shape: Shape, piece: bytes) -> bool:
    """Answer whether the stage keeps these bytes at `index`; refuse a piece that disagrees with the stage."""
    stage_table = table(app, "stage")
    staged_pieces = frappe.db.sql(
        f"""SELECT `idx`, {SHAPE_COLUMNS}, `bytes` = UNHEX(%s) AS `same`
        FROM `{stage_table}` WHERE `doc_id` = %s AND `stage_id` = %s""",
        (piece.hex(), doc_id, stage_id),
        as_dict=True,
    )
    for row in staged_pieces:
        if stored_shape(row) != shape:
            raise Conflict

        if row.idx != index:
            continue

        if not row.same:
            raise Conflict

        return True

    return False


def check_room(app: str, doc_id: str, user: str, piece_len: int) -> None:
    """Refuse a piece past the user's own `DOC_MAX`, so one editor's pieces never block another's."""
    stage_table = table(app, "stage")
    session_table = table(app, "session")
    # Locked, so a user's puts take turns and each sees what the one before it kept
    [[staged_bytes]] = frappe.db.sql(
        f"""SELECT COALESCE(SUM(LENGTH(`stage`.`bytes`)), 0) FROM `{stage_table}` `stage`
        JOIN `{session_table}` `session`
            ON `session`.`doc_id` = `stage`.`doc_id` AND `session`.`sid` = `stage`.`sid`
        WHERE `stage`.`doc_id` = %s AND `session`.`user` = %s FOR UPDATE""",
        (doc_id, user),
    )
    if int(staged_bytes) + piece_len > DOC_MAX:
        raise Full


def insert_piece(app: str, doc_id: str, stage_id: str, index: int, shape: Shape, piece: bytes) -> None:
    """Insert the piece at `index` with its stage's shape."""
    stage_table = table(app, "stage")
    frappe.db.sql(
        f"""INSERT IGNORE INTO `{stage_table}`
        (`doc_id`, `stage_id`, `idx`, {SHAPE_COLUMNS}, `bytes`, `created`)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, UNHEX(%s), UNHEX(%s), %s)""",
        (
            doc_id,
            stage_id,
            index,
            *astuple(shape)[:-1],
            shape.sha_total.hex(),
            piece.hex(),
            frappe.utils.now_datetime(),
        ),
    )


def store_piece(app: str, doc_id: str, stage_id: str, piece: Piece, user: str) -> None:
    """Keep one piece; the same bytes again at its index only restart the stage's expiry."""
    if not already_staged(app, doc_id, stage_id, piece.index, piece.shape, piece.payload):
        check_room(app, doc_id, user, len(piece.payload))
        insert_piece(app, doc_id, stage_id, piece.index, piece.shape, piece.payload)

    refresh_expiry(app, doc_id, stage_id)


def shape_of(header: dict, purpose: str, sha_total: bytes) -> Shape:
    """Return the shape a piece's header gives its stage."""
    place = {key: header[key] for key in PLACES[purpose]}
    return Shape(
        purpose,
        header["sid"],
        place.get("from"),
        place.get("to"),
        place.get("rev"),
        header["lineage"],
        place.get("q_epoch"),
        header["total_len"],
        sha_total,
    )


def stored_shape(row: frappe._dict) -> Shape:
    """Return the shape a staged piece was kept with."""
    stored = {field.name: row[field.name] for field in fields(Shape)}
    return Shape(**{**stored, "sha_total": bytes(row.sha_total)})


def refresh_expiry(app: str, doc_id: str, stage_id: str) -> None:
    """Restart the expiry of every piece of the stage, so a slow upload loses none of its early pieces."""
    stage_table = table(app, "stage")
    frappe.db.sql(
        f"UPDATE `{stage_table}` SET `created` = %s WHERE `doc_id` = %s AND `stage_id` = %s",
        (frappe.utils.now_datetime(), doc_id, stage_id),
    )
    frappe.db.commit()  # nosemgrep: frappe-manual-commit


def assemble(app: str, doc_id: str, stage_id: str, sid: str, seq_from: int, seq_to: int) -> bytes:
    """Return the staged change the push names, whole and checked."""
    rows = staged_rows(app, doc_id, stage_id)
    first_piece = rows[0]
    if (first_piece.sid, first_piece.seq_from, first_piece.seq_to) != (sid, seq_from, seq_to):
        raise Conflict

    return joined(app, doc_id, stage_id, rows)


def assemble_render(app: str, doc_id: str, stage_id: str) -> tuple[frappe._dict, bytes]:
    """Return the staged render, whole and checked, with its first piece, which names its sid, rev, lineage and epoch."""
    rows = staged_rows(app, doc_id, stage_id)
    if rows[0].purpose != "render":
        raise Conflict

    return rows[0], joined(app, doc_id, stage_id, rows)


def staged_rows(app: str, doc_id: str, stage_id: str) -> list[frappe._dict]:
    """Return the stage's pieces in order, refused as incomplete when it has none."""
    stage_table = table(app, "stage")
    rows = frappe.db.sql(
        f"""SELECT `idx`, {SHAPE_COLUMNS}, `bytes`
        FROM `{stage_table}` WHERE `doc_id` = %s AND `stage_id` = %s ORDER BY `idx`""",
        (doc_id, stage_id),
        as_dict=True,
    )
    if not rows:
        raise Incomplete

    return rows


def joined(app: str, doc_id: str, stage_id: str, rows: list[frappe._dict]) -> bytes:
    """Join the pieces; a stage whose bytes are wrong is dropped, one that only lacks pieces keeps them."""
    first_piece = rows[0]
    expected_indexes = list(range(piece_count(first_piece.total_len)))
    if [row.idx for row in rows] != expected_indexes:
        raise Incomplete

    payload = b"".join(bytes(row.bytes) for row in rows)
    length_wrong = len(payload) != first_piece.total_len
    sha_wrong = hashlib.sha256(payload).digest() != bytes(first_piece.sha_total)
    if length_wrong or sha_wrong:
        drop_stage(app, doc_id, stage_id)
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        raise Incomplete

    return payload


def drop_stage(app: str, doc_id: str, stage_id: str) -> None:
    """Delete every piece of the stage."""
    stage_table = table(app, "stage")
    frappe.db.sql(f"DELETE FROM `{stage_table}` WHERE `doc_id` = %s AND `stage_id` = %s", (doc_id, stage_id))


def expire_pieces(app: str, now: datetime) -> None:
    """Delete save pieces older than `EXPIRY`; their tab still holds the change and can stage it again."""
    stage_table = table(app, "stage")
    frappe.db.sql(f"DELETE FROM `{stage_table}` WHERE `purpose` = 'save' AND `created` < %s", now - EXPIRY)
    frappe.db.commit()  # nosemgrep: frappe-manual-commit


def renders(app: str, doc_id: str) -> list[frappe._dict]:
    """Return the document's staged renders, newest rev first."""
    stage_table = table(app, "stage")
    return frappe.db.sql(
        f"""SELECT DISTINCT `stage_id`, `rev` FROM `{stage_table}`
        WHERE `doc_id` = %s AND `purpose` = 'render' ORDER BY `rev` DESC, `stage_id`""",
        doc_id,
        as_dict=True,
    )


def rendered_docs(app: str, limit: int = 100) -> list[str]:
    """Return the documents with a staged render, which is due its copy check."""
    stage_table = table(app, "stage")
    found = frappe.db.sql(
        f"SELECT DISTINCT `doc_id` FROM `{stage_table}` WHERE `purpose` = 'render' LIMIT %s", limit
    )
    return [doc_id for (doc_id,) in found]


def drop_renders_through(app: str, doc_id: str, rev: int, keep: str | None = None) -> None:
    """Drop the staged renders at or before `rev`, other than the stage `keep`."""
    stage_table = table(app, "stage")
    frappe.db.sql(
        f"""DELETE FROM `{stage_table}` WHERE `doc_id` = %s AND `purpose` = 'render'
        AND `rev` <= %s AND `stage_id` != %s""",
        (doc_id, rev, keep or ""),
    )
