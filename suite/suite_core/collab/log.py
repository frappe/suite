"""The update log: every committed change to a collaborative document, in one order.

Pushes take the control row with `SKIP LOCKED` as the first statement of a fresh
transaction, so a web thread never waits on a document: a held lock answers
`busy` at once. Each row gets the next gap-free `rev` and extends a hash chain,
and is committed before the push answers.
"""

import hashlib
import json
import secrets
import struct

import frappe
from frappe.utils import now_datetime

from suite.suite_core.collab.tables import table

PROTO = 1
PACE_MS = 1000
HEADER_MAX = 4096
CLIENT_ID_MAX = 2**30


class Refusal(Exception):
    """A collab answer other than success, sent as `{"collab": reason, ...}`."""

    def __init__(self, status: int, reason: str, **extra):
        super().__init__(reason)
        self.status = status
        self.body = {"collab": reason, **extra}


def enabled() -> bool:
    return frappe.db.get_single_value("Suite Collab Settings", "mode") == "on"


def require_enabled() -> None:
    if not enabled():
        raise Refusal(409, "disabled")


def chain_seed(lineage: str) -> bytes:
    return hashlib.sha256(lineage.encode()).digest()


def chain_next(previous: bytes, rev: int, payload_sha: bytes) -> bytes:
    return hashlib.sha256(previous + struct.pack(">Q", rev) + payload_sha).digest()


def find(adapter: str, node: str) -> dict | None:
    rows = frappe.db.sql(
        f"SELECT `id`, `lineage`, `head_rev`, `head_chain` FROM `{table(adapter, 'doc')}` WHERE `node` = %s",
        node,
        as_dict=True,
    )
    return rows[0] if rows else None


def create(adapter: str, node: str) -> str:
    """Start an empty log for `node` in the caller's transaction."""
    doc_id = frappe.generate_hash(length=20)
    lineage = secrets.token_hex(16)
    frappe.db.sql(
        f"""INSERT INTO `{table(adapter, "doc")}` (`id`, `node`, `lineage`, `head_rev`, `head_chain`, `created`)
        VALUES (%s, %s, %s, 0, %s, %s)""",
        (doc_id, node, lineage, chain_seed(lineage), now_datetime()),
    )
    return doc_id


def rows_after(adapter: str, doc_id: str, since: int) -> list[tuple[int, bytes]]:
    """Committed rows after `since`, in rev order. One statement, so one snapshot."""
    return [
        (int(rev), bytes(payload))
        for rev, payload in frappe.db.sql(
            f"SELECT `rev`, `payload` FROM `{table(adapter, 'update')}` WHERE `doc_id` = %s AND `rev` > %s ORDER BY `rev`",
            (doc_id, since),
        )
    ]


def frame(header: dict, rows: list[tuple[int, bytes]] = ()) -> bytes:
    """`u32 hlen | header JSON | u32 checkpoint len (0) | u32 n | (u64 rev | u32 len | bytes)*`"""
    encoded = json.dumps(header, separators=(",", ":")).encode()
    parts = [struct.pack(">I", len(encoded)), encoded, struct.pack(">II", 0, len(rows))]
    for rev, payload in rows:
        parts += [struct.pack(">QI", rev, len(payload)), payload]
    return b"".join(parts)


def open_header(doc: dict, *, can_write: bool) -> dict:
    return {
        "state": "live",
        "proto": PROTO,
        "lineage": doc["lineage"],
        "can_write": can_write,
        "pace_ms": PACE_MS,
    }


def issue_session(adapter: str, doc_id: str, sid: str, principal: str) -> int:
    """Bind a fresh clientID to `sid` before the tab reveals or uses it. Idempotent per sid."""
    sessions = table(adapter, "session")
    existing = frappe.db.sql(
        f"SELECT `client_id`, `principal` FROM `{sessions}` WHERE `doc_id` = %s AND `sid` = %s",
        (doc_id, sid),
        as_dict=True,
    )
    if existing:
        if existing[0].principal != principal:
            raise Refusal(409, "session_owner")
        return int(existing[0].client_id)
    for _attempt in range(8):
        client_id = secrets.randbelow(CLIENT_ID_MAX - 1) + 1
        try:
            frappe.db.sql(
                f"""INSERT INTO `{sessions}` (`doc_id`, `sid`, `client_id`, `principal`, `acked_seq`, `created`)
                VALUES (%s, %s, %s, %s, 0, %s)""",
                (doc_id, sid, client_id, principal, now_datetime()),
            )
        except Exception as error:
            if frappe.db.is_duplicate_entry(error):
                continue
            raise
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        return client_id
    raise Refusal(423, "busy", retry_ms=PACE_MS)


def parse_push(body: bytes) -> tuple[dict, bytes]:
    """Split `u32 hlen | header JSON | Yjs update`."""
    if len(body) < 4:
        raise Refusal(400, "malformed")
    (length,) = struct.unpack(">I", body[:4])
    if length > HEADER_MAX or len(body) < 4 + length:
        raise Refusal(400, "malformed")
    try:
        header = json.loads(body[4 : 4 + length])
    except ValueError:
        raise Refusal(400, "malformed") from None
    payload = body[4 + length :]
    required = {"lineage": str, "sid": str, "from": int, "to": int, "cid": int, "seen_rev": int}
    if not isinstance(header, dict) or any(
        not isinstance(header.get(key), kind) or isinstance(header.get(key), bool)
        for key, kind in required.items()
    ):
        raise Refusal(400, "malformed")
    if header["from"] < 1 or header["to"] < header["from"] or not payload:
        raise Refusal(400, "malformed")
    return header, payload


def push(adapter: str, doc_id: str, header: dict, payload: bytes, principal: str) -> dict:
    """Commit one session's contiguous seq range as the next rev, or refuse it."""
    # The lock must be the first statement of a fresh transaction
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    locked = frappe.db.sql(
        f"SELECT `lineage`, `head_rev`, `head_chain` FROM `{table(adapter, 'doc')}` WHERE `id` = %s FOR UPDATE SKIP LOCKED",
        doc_id,
        as_dict=True,
    )
    if not locked:
        raise Refusal(423, "busy", retry_ms=PACE_MS)
    doc = locked[0]
    try:
        if header["lineage"] != doc.lineage:
            raise Refusal(409, "lineage")
        sessions = table(adapter, "session")
        session = frappe.db.sql(
            f"SELECT `client_id`, `principal`, `acked_seq` FROM `{sessions}` WHERE `doc_id` = %s AND `sid` = %s",
            (doc_id, header["sid"]),
            as_dict=True,
        )
        if not session:
            raise Refusal(409, "session_unknown")
        session = session[0]
        if session.principal != principal:
            raise Refusal(409, "session_owner")
        if int(session.client_id) != header["cid"]:
            raise Refusal(409, "client_conflict")
        acked = int(session.acked_seq)
        head = int(doc.head_rev)
        if header["to"] <= acked:
            frappe.db.rollback()
            return {"dup": True, "acked": acked, "head": head, "pace_ms": PACE_MS}
        if header["from"] != acked + 1:
            raise Refusal(409, "seq", acked=acked)
        if header["seen_rev"] > head:
            raise Refusal(409, "diverged")

        rev = head + 1
        payload_sha = hashlib.sha256(payload).digest()
        chain = chain_next(bytes(doc.head_chain), rev, payload_sha)
        now = now_datetime()
        frappe.db.sql(
            f"""INSERT INTO `{table(adapter, "update")}`
            (`doc_id`, `rev`, `sid`, `seq_from`, `seq_to`, `client_id`, `payload`, `sha256`, `chain`, `created`)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                doc_id,
                rev,
                header["sid"],
                header["from"],
                header["to"],
                header["cid"],
                payload,
                payload_sha,
                chain,
                now,
            ),
        )
        frappe.db.sql(
            f"UPDATE `{table(adapter, 'doc')}` SET `head_rev` = %s, `head_chain` = %s WHERE `id` = %s",
            (rev, chain, doc_id),
        )
        frappe.db.sql(
            f"UPDATE `{sessions}` SET `acked_seq` = %s, `last_push_at` = %s WHERE `doc_id` = %s AND `sid` = %s",
            (header["to"], now, doc_id, header["sid"]),
        )
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
    except BaseException:
        frappe.db.rollback()
        raise
    return {"rev": rev, "head": rev, "chain": chain.hex(), "acked": header["to"], "pace_ms": PACE_MS}
