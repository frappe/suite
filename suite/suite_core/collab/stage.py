"""Staged pieces of a change too big for one request body (4f).

A change is cut into pieces of exactly `PIECE_MAX` bytes, the last one
shorter, each sent on its own and kept here. The push that names the stage
assembles them and checks the exact length and sha256 before anything parses
the bytes, so a piece never reaches the parser or pycrdt.
"""

import hashlib
import json
import struct
from datetime import datetime, timedelta

import frappe

from suite.suite_core.collab import capacity
from suite.suite_core.collab.tables import table

PIECE_MAX = 256 * 2**10
HEADER_MAX = 4096
DOC_MAX = 16 * 2**20
EXPIRY = timedelta(minutes=15)
FULL_RETRY_MS = 60_000


class Malformed(Exception):
    pass


class TooLarge(Exception):
    pass


class Conflict(Exception):
    """The piece disagrees with what is staged at its index or with the stage's other pieces."""


class Full(Exception):
    """The principal has `DOC_MAX` bytes staged on the document already."""


class Incomplete(Exception):
    """The stage lacks a piece, or its bytes don't match its length and sha256."""


def valid_id(value) -> bool:
    return isinstance(value, str) and len(value) == 32 and value.isalnum() and value.isascii()


def count(total_len: int) -> int:
    return -(-total_len // PIECE_MAX)


def parse_piece(body: bytes, idx: str) -> tuple[dict, int, bytes]:
    """Split `u32 hlen | header JSON | piece` and check the piece's place in its change."""
    if len(body) < 4:
        raise Malformed
    (length,) = struct.unpack(">I", body[:4])
    if length > HEADER_MAX or len(body) < 4 + length:
        raise Malformed
    try:
        header = json.loads(body[4 : 4 + length])
        sha_total = bytes.fromhex(header["sha_total"])
    except (ValueError, TypeError, KeyError):
        raise Malformed from None
    if not isinstance(header, dict) or not all(
        type(header.get(key)) is int for key in ("from", "to", "total_len")
    ):
        raise Malformed
    if not isinstance(header.get("lineage"), str) or not valid_id(header.get("sid")) or len(sha_total) != 32:
        raise Malformed
    if header["from"] < 1 or header["to"] < header["from"] or header["total_len"] < 1:
        raise Malformed
    if header["total_len"] > capacity.edit_max():
        raise TooLarge
    if not idx.isdigit() or int(idx) >= count(header["total_len"]):
        raise Malformed
    index, piece = int(idx), body[4 + length :]
    if len(piece) != min(PIECE_MAX, header["total_len"] - index * PIECE_MAX):
        raise Malformed
    header["sha_total"] = sha_total
    return header, index, piece


def store(
    adapter: str, doc_id: str, stage_id: str, index: int, header: dict, piece: bytes, principal: str
) -> None:
    """Keep one piece. The same bytes again at an index change nothing but the stage's age. Each
    principal has its own `DOC_MAX`, so one editor's pieces never block another's."""
    stage = table(adapter, "stage")
    shape = (header["sid"], header["from"], header["to"], header["total_len"], header["sha_total"])
    held = frappe.db.sql(
        f"""SELECT `idx`, `sid`, `seq_from`, `seq_to`, `total_len`, `sha_total`, `bytes` = UNHEX(%s) AS `same`
        FROM `{stage}` WHERE `doc_id` = %s AND `stage_id` = %s""",
        (piece.hex(), doc_id, stage_id),
        as_dict=True,
    )
    for row in held:
        if (row.sid, row.seq_from, row.seq_to, row.total_len, bytes(row.sha_total)) != shape:
            raise Conflict
        if row.idx == index:
            if not row.same:
                raise Conflict
            return touch(adapter, doc_id, stage_id)
    # Locked, so a principal's puts take turns and each sees what the one before it kept
    staged = frappe.db.sql(
        f"""SELECT COALESCE(SUM(LENGTH(`stage`.`bytes`)), 0) FROM `{stage}` `stage`
        JOIN `{table(adapter, "session")}` `session`
            ON `session`.`doc_id` = `stage`.`doc_id` AND `session`.`sid` = `stage`.`sid`
        WHERE `stage`.`doc_id` = %s AND `session`.`principal` = %s FOR UPDATE""",
        (doc_id, principal),
    )
    if int(staged[0][0]) + len(piece) > DOC_MAX:
        raise Full
    frappe.db.sql(
        f"""INSERT IGNORE INTO `{stage}`
        (`doc_id`, `stage_id`, `idx`, `purpose`, `sid`, `seq_from`, `seq_to`, `total_len`, `sha_total`, `bytes`, `created`)
        VALUES (%s, %s, %s, 'save', %s, %s, %s, %s, UNHEX(%s), UNHEX(%s), %s)""",
        (doc_id, stage_id, index, *shape[:4], shape[4].hex(), piece.hex(), frappe.utils.now_datetime()),
    )
    touch(adapter, doc_id, stage_id)


def touch(adapter: str, doc_id: str, stage_id: str) -> None:
    """Restart the expiry of every piece of the stage, so a slow upload loses none of its early pieces."""
    frappe.db.sql(
        f"UPDATE `{table(adapter, 'stage')}` SET `created` = %s WHERE `doc_id` = %s AND `stage_id` = %s",
        (frappe.utils.now_datetime(), doc_id, stage_id),
    )
    frappe.db.commit()  # nosemgrep: frappe-manual-commit


def assemble(adapter: str, doc_id: str, stage_id: str, header: dict) -> bytes:
    """The staged change the push names, whole and checked. A stage whose bytes are wrong is dropped
    so the tab can stage it again; one that only lacks pieces keeps them."""
    rows = frappe.db.sql(
        f"""SELECT `idx`, `sid`, `seq_from`, `seq_to`, `total_len`, `sha_total`, `bytes`
        FROM `{table(adapter, "stage")}` WHERE `doc_id` = %s AND `stage_id` = %s ORDER BY `idx`""",
        (doc_id, stage_id),
        as_dict=True,
    )
    if not rows:
        raise Incomplete
    first = rows[0]
    if (first.sid, first.seq_from, first.seq_to) != (header["sid"], header["from"], header["to"]):
        raise Conflict
    if [row.idx for row in rows] != list(range(count(first.total_len))):
        raise Incomplete
    payload = b"".join(bytes(row.bytes) for row in rows)
    if len(payload) != first.total_len or hashlib.sha256(payload).digest() != bytes(first.sha_total):
        drop(adapter, doc_id, stage_id)
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        raise Incomplete
    return payload


def drop(adapter: str, doc_id: str, stage_id: str) -> None:
    frappe.db.sql(
        f"DELETE FROM `{table(adapter, 'stage')}` WHERE `doc_id` = %s AND `stage_id` = %s", (doc_id, stage_id)
    )


def expire(adapter: str, now: datetime) -> None:
    """Delete save pieces older than `EXPIRY`; their tab still holds the change and can stage it again."""
    frappe.db.sql(
        f"DELETE FROM `{table(adapter, 'stage')}` WHERE `purpose` = 'save' AND `created` < %s", now - EXPIRY
    )
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
