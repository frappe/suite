"""The collab wire format: frames, the open header, a push's and a piece's parsing, and busy answers."""

import json
import secrets
import struct
from collections.abc import Sequence
from dataclasses import dataclass

import frappe

from suite.content import capacity, stage
from suite.content.log import Refusal
from suite.content.snapshot import Snapshot

PROTOCOL_VERSION = 1
PACE_MS = 500
RESTORE_TOKEN_LENGTH = 32
PUSH_FIELD_TYPES = {
    "lineage": str,
    "sid": str,
    "from": int,
    "to": int,
    "cid": int,
    "seen_rev": int,
    "schema": int,
    "shas": list,
}


@dataclass(frozen=True)
class PushHeader:
    lineage: str
    sid: str
    seq_from: int
    seq_to: int
    client_id: int
    seen_rev: int
    schema: int
    shas: list[bytes]
    # Set when the change was staged in pieces, which the push itself carries none of
    stage_id: str | None
    is_final: bool
    # The fence's token on the push that lands a restore
    restore: str | None
    # Who the tab says it is, checked against the signed-in user; unchecked JSON
    expected_user: object


def busy_refusal() -> Refusal:
    """Refuse a push as busy, with a jittered retry so waiting tabs spread out."""
    retry_ms = PACE_MS // 2 + secrets.randbelow(PACE_MS // 2 + 1)
    return Refusal(423, "busy", retry_ms=retry_ms)


def encode_frame(
    header: dict, rows: Sequence[tuple[int, bytes]] = (), checkpoint: bytes | None = None
) -> bytes:
    """`u32 hlen | header JSON | u32 checkpoint len | checkpoint | u32 n | (u64 rev | u32 len | bytes)*`"""
    header_json = json.dumps(header, separators=(",", ":")).encode()
    checkpoint = checkpoint or b""
    parts = [
        struct.pack(">I", len(header_json)),
        header_json,
        struct.pack(">I", len(checkpoint)),
        checkpoint,
        struct.pack(">I", len(rows)),
    ]
    for rev, payload in rows:
        parts += [struct.pack(">QI", rev, len(payload)), payload]

    return b"".join(parts)


def open_header(log_read: Snapshot, *, can_write: bool) -> dict:
    """Build the header of the frame that opens a live document."""
    return {
        "state": "live",
        "proto": PROTOCOL_VERSION,
        "lineage": log_read.lineage,
        "base": log_read.base,
        "can_write": can_write,
        "pace_ms": PACE_MS,
        "q_epoch": log_read.q_epoch,
        "schema": log_read.schema,
    }


def limits(app: str, doc: frappe._dict) -> dict:
    """Answer the sizes a tab checks a change against before it enters the document."""
    return {
        "fragment": stage.PIECE_MAX,
        "edit_max": capacity.edit_max(),
        "state_max": capacity.STATE_MAX,
        "state_bytes": int(doc.state_bytes),
        "tail_bound": int(doc.tail_bound),
    }


def split_push(body: bytes) -> tuple[object, bytes]:
    """Split `u32 hlen | header JSON | Yjs update`; refuse a bad frame or an update past `PIECE_MAX`."""
    try:
        header, payload = stage.split_header(body)
    except stage.Malformed:
        raise Refusal(400, "malformed") from None

    # A bigger change is staged in pieces first
    if len(payload) > stage.PIECE_MAX:
        raise Refusal(413, "too_large")

    return header, payload


def is_mistyped(header: dict) -> bool:
    """Answer whether a push header lacks a required field or holds one of the wrong type."""
    for key, expected_type in PUSH_FIELD_TYPES.items():
        value = header.get(key)
        if not isinstance(value, expected_type) or isinstance(value, bool):
            return True

    return False


def checked_push_fields(header: object, payload: bytes) -> dict:
    """Refuse a push header with a field missing or wrong, a bad seq range or schema, or no change."""
    if not isinstance(header, dict) or is_mistyped(header):
        raise Refusal(400, "malformed")

    seq_range_invalid = header["from"] < 1 or header["to"] < header["from"]
    schema_invalid = header["schema"] < 1
    if seq_range_invalid or schema_invalid:
        raise Refusal(400, "malformed")

    # A staged change comes with no bytes of its own
    is_staged = "stage_id" in header
    stage_invalid = is_staged and (payload or not stage.valid_id(header["stage_id"]))
    no_change = not (payload or is_staged)
    if stage_invalid or no_change:
        raise Refusal(400, "malformed")

    seq_count = header["to"] - header["from"] + 1
    if len(header["shas"]) != seq_count:
        raise Refusal(400, "malformed")

    restore = header.get("restore")
    if restore is not None and not (isinstance(restore, str) and len(restore) == RESTORE_TOKEN_LENGTH):
        raise Refusal(400, "malformed")

    return header


def checked_shas(header_shas: list) -> list[bytes]:
    """Decode a push's per-seq shas, refusing any that is not `SHA_BYTES` of hex."""
    try:
        shas = [bytes.fromhex(sha) for sha in header_shas]
    except (TypeError, ValueError):
        raise Refusal(400, "malformed") from None

    if any(len(sha) != stage.SHA_BYTES for sha in shas):
        raise Refusal(400, "malformed")

    return shas


def parse_push(body: bytes) -> tuple[PushHeader, bytes]:
    """Split `u32 hlen | header JSON | Yjs update` and check the header."""
    raw_header, payload = split_push(body)
    header = checked_push_fields(raw_header, payload)
    shas = checked_shas(header["shas"])
    push_header = PushHeader(
        lineage=header["lineage"],
        sid=header["sid"],
        seq_from=header["from"],
        seq_to=header["to"],
        client_id=header["cid"],
        seen_rev=header["seen_rev"],
        schema=header["schema"],
        shas=shas,
        stage_id=header.get("stage_id"),
        is_final=header.get("final") is True,
        restore=header.get("restore"),
        expected_user=header.get("expected_user"),
    )
    return push_header, payload


def parse_piece(app: str, body: bytes, stage_id: str, index_text: str) -> stage.Piece:
    """Split `u32 hlen | header JSON | piece`; the header names the change the piece belongs to."""
    if not stage.valid_id(stage_id):
        raise Refusal(400, "malformed")

    try:
        return stage.parse_piece(body, index_text, capacity.edit_max())
    except stage.Malformed:
        raise Refusal(400, "malformed") from None
    except stage.TooLarge:
        raise Refusal(413, "too_large") from None
