"""The collab wire format: frames, the open header, a push's and a piece's parsing, and busy answers."""

import json
import secrets
import struct
from collections.abc import Sequence
from dataclasses import dataclass

import frappe

from suite.suite_core.content import capacity, stage
from suite.suite_core.content.adapters import spec_of
from suite.suite_core.content.log import Refusal
from suite.suite_core.content.snapshot import Snapshot

PROTOCOL_VERSION = 1
PACE_MS = 500
RESTORE_TOKEN_LENGTH = 32


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
    principal: object


def busy_refusal() -> Refusal:
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


def limits(adapter: str, doc: frappe._dict) -> dict:
    """The sizes a tab checks a change against before it enters the document."""
    spec = spec_of(adapter)
    return {
        "fragment": stage.PIECE_MAX,
        "edit_max": capacity.edit_max(spec.max_change),
        "state_max": spec.max_state,
        "state_bytes": int(doc.state_bytes),
        "tail_bound": int(doc.tail_bound),
    }


def parse_push(body: bytes) -> tuple[PushHeader, bytes]:
    """Split `u32 hlen | header JSON | Yjs update`."""
    if len(body) < 4:
        raise Refusal(400, "malformed")

    (header_length,) = struct.unpack(">I", body[:4])
    header_too_long = header_length > stage.HEADER_MAX
    body_truncated = len(body) < 4 + header_length
    if header_too_long or body_truncated:
        raise Refusal(400, "malformed")

    try:
        header = json.loads(body[4 : 4 + header_length])
    except ValueError:
        raise Refusal(400, "malformed") from None

    payload = body[4 + header_length :]
    # A bigger change is staged in pieces first
    if len(payload) > stage.PIECE_MAX:
        raise Refusal(413, "too_large")

    required_types = {
        "lineage": str,
        "sid": str,
        "from": int,
        "to": int,
        "cid": int,
        "seen_rev": int,
        "schema": int,
        "shas": list,
    }
    if not isinstance(header, dict):
        raise Refusal(400, "malformed")

    mistyped = any(
        not isinstance(header.get(key), expected_type) or isinstance(header.get(key), bool)
        for key, expected_type in required_types.items()
    )
    if mistyped:
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

    try:
        shas = [bytes.fromhex(sha) for sha in header["shas"]]
    except (TypeError, ValueError):
        raise Refusal(400, "malformed") from None

    if any(len(sha) != 32 for sha in shas):
        raise Refusal(400, "malformed")

    restore = header.get("restore")
    if restore is not None and not (isinstance(restore, str) and len(restore) == RESTORE_TOKEN_LENGTH):
        raise Refusal(400, "malformed")

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
        restore=restore,
        principal=header.get("principal"),
    )
    return push_header, payload


def parse_piece(adapter: str, body: bytes, stage_id: str, index_text: str) -> tuple[dict, int, bytes]:
    """Split `u32 hlen | header JSON | piece`; the header names the change the piece belongs to."""
    if not stage.valid_id(stage_id):
        raise Refusal(400, "malformed")

    try:
        return stage.parse_piece(body, index_text, capacity.edit_max(spec_of(adapter).max_change))
    except stage.Malformed:
        raise Refusal(400, "malformed") from None
    except stage.TooLarge:
        raise Refusal(413, "too_large") from None
