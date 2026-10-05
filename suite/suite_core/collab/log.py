"""The update log: every committed change to a collaborative document, in one order.

Pushes take the control row with `SKIP LOCKED` as the first statement of a fresh
transaction, so a web thread never waits on a document: a held lock answers
`busy` at once. Each row gets the next gap-free `rev` and extends a hash chain,
and is committed before the push answers. A push that repeats seqs already
committed gets their original answer back, checked against each seq's sha, so a
lost answer costs one request and never a second row.
"""

import contextlib
import gzip
import hashlib
import json
import secrets
import struct

import frappe
from frappe.utils import now_datetime

from suite.suite_core.collab.compaction import KERNEL
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


class ChainBroken(Exception):
    reason = "chain_break"


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


def create(adapter: str, node: str, state: bytes | None = None) -> str:
    """Start a log for `node` in the caller's transaction: empty, or starting from `state` at rev 1."""
    doc_id = frappe.generate_hash(length=20)
    lineage = secrets.token_hex(16)
    frappe.db.sql(
        f"""INSERT INTO `{table(adapter, "doc")}` (`id`, `node`, `lineage`, `head_rev`, `head_chain`, `created`)
        VALUES (%s, %s, %s, 0, UNHEX(%s), %s)""",
        (doc_id, node, lineage, chain_seed(lineage).hex(), now_datetime()),
    )
    if state is not None:
        replace_start(adapter, doc_id, state)
    return doc_id


def replace_start(adapter: str, doc_id: str, state: bytes) -> None:
    """Make `state` the integrated checkpoint a fresh log starts from, at rev 1, in the caller's transaction.

    The caller has checked `state`. Once a tab has a session or a row exists, a tab may
    hold the old start, so the start can no longer change.
    """
    doc = frappe.db.sql(
        f"SELECT `lineage`, `head_rev` FROM `{table(adapter, 'doc')}` WHERE `id` = %s FOR UPDATE",
        doc_id,
        as_dict=True,
    )[0]
    sessions = frappe.db.sql(
        f"SELECT 1 FROM `{table(adapter, 'session')}` WHERE `doc_id` = %s LIMIT 1", doc_id
    )
    if int(doc.head_rev) > 1 or sessions or rows_after(adapter, doc_id, 0):
        raise ValueError("this log's start is already in use")
    sha = hashlib.sha256(state).digest()
    chain = chain_next(chain_seed(doc.lineage), 1, sha)
    checkpoint = table(adapter, "checkpoint")
    frappe.db.sql(f"DELETE FROM `{checkpoint}` WHERE `doc_id` = %s", doc_id)
    frappe.db.sql(
        f"""INSERT INTO `{checkpoint}`
        (`doc_id`, `through_rev`, `chain`, `sha256`, `nbytes`, `gz`, `integrated`, `kernel_schema`, `report`, `created`)
        VALUES (%s, 1, UNHEX(%s), UNHEX(%s), %s, UNHEX(%s), 1, %s, %s, %s)""",
        (
            doc_id,
            chain.hex(),
            sha.hex(),
            len(state),
            gzip.compress(state).hex(),
            KERNEL,
            json.dumps({"start": True}),
            now_datetime(),
        ),
    )
    frappe.db.sql(
        f"""UPDATE `{table(adapter, "doc")}` SET `head_rev` = 1, `head_chain` = UNHEX(%(chain)s),
        `checkpoint_rev` = 1, `checkpoint_chain` = UNHEX(%(chain)s), `integrated_rev` = 1,
        `kernel_schema` = %(kernel)s, `state_bytes` = %(size)s WHERE `id` = %(doc)s""",
        {"chain": chain.hex(), "kernel": KERNEL, "size": len(state), "doc": doc_id},
    )


def rows_after(adapter: str, doc_id: str, since: int) -> list[tuple[int, bytes]]:
    """Committed rows after `since`, in rev order. One statement, so one snapshot."""
    return [
        (int(rev), bytes(payload))
        for rev, payload in frappe.db.sql(
            f"SELECT `rev`, `payload` FROM `{table(adapter, 'update')}` WHERE `doc_id` = %s AND `rev` > %s ORDER BY `rev`",
            (doc_id, since),
        )
    ]


def frame(header: dict, rows: list[tuple[int, bytes]] = (), checkpoint: bytes | None = None) -> bytes:
    """`u32 hlen | header JSON | u32 checkpoint len | checkpoint | u32 n | (u64 rev | u32 len | bytes)*`"""
    encoded = json.dumps(header, separators=(",", ":")).encode()
    checkpoint = checkpoint or b""
    parts = [
        struct.pack(">I", len(encoded)),
        encoded,
        struct.pack(">I", len(checkpoint)),
        checkpoint,
        struct.pack(">I", len(rows)),
    ]
    for rev, payload in rows:
        parts += [struct.pack(">QI", rev, len(payload)), payload]
    return b"".join(parts)


def open_header(doc: dict, *, can_write: bool) -> dict:
    return {
        "state": "live",
        "proto": PROTO,
        "lineage": doc["lineage"],
        "base": doc["base"],
        "can_write": can_write,
        "pace_ms": PACE_MS,
    }


def load_session(adapter: str, doc_id: str, sid: str, principal: str):
    """The session row for `sid`, or None. Refused if it belongs to another principal."""
    rows = frappe.db.sql(
        f"SELECT `client_id`, `principal`, `acked_seq` FROM `{table(adapter, 'session')}` WHERE `doc_id` = %s AND `sid` = %s",
        (doc_id, sid),
        as_dict=True,
    )
    if rows and rows[0].principal != principal:
        raise Refusal(409, "session_owner")
    return rows[0] if rows else None


def insert_session(adapter: str, doc_id: str, sid: str, client_id: int, principal: str) -> bool:
    """Commit a new session row. False if the sid or the clientID is already taken."""
    try:
        frappe.db.sql(
            f"""INSERT INTO `{table(adapter, "session")}` (`doc_id`, `sid`, `client_id`, `principal`, `acked_seq`, `created`)
            VALUES (%s, %s, %s, %s, 0, %s)""",
            (doc_id, sid, client_id, principal, now_datetime()),
        )
    except Exception as error:
        if frappe.db.is_duplicate_entry(error):
            return False
        raise
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    return True


def issue_session(adapter: str, doc_id: str, sid: str, principal: str) -> int:
    """Bind a fresh clientID to `sid` before the tab reveals or uses it. Idempotent per sid."""
    existing = load_session(adapter, doc_id, sid, principal)
    if existing:
        return int(existing.client_id)
    for _attempt in range(8):
        client_id = secrets.randbelow(CLIENT_ID_MAX - 1) + 1
        if insert_session(adapter, doc_id, sid, client_id, principal):
            return client_id
    raise busy()


def claim_session(adapter: str, doc: dict, sid: str, claim, principal: str) -> str:
    """Bind the clientID a tab opened offline chose itself: `ok`, `clash` or `lineage`. Mints nothing."""
    cid = claim.get("cid") if isinstance(claim, dict) else None
    lineage = claim.get("lineage") if isinstance(claim, dict) else None
    if not isinstance(cid, int) or isinstance(cid, bool) or not isinstance(lineage, str):
        raise Refusal(400, "malformed")
    if not CLIENT_ID_MAX <= cid < 2 * CLIENT_ID_MAX:
        raise Refusal(400, "malformed")
    if lineage != doc["lineage"]:
        return "lineage"

    def bound() -> str | None:
        row = load_session(adapter, doc["id"], sid, principal)
        return row and ("ok" if int(row.client_id) == cid else "clash")

    answer = bound()
    if answer:
        return answer
    if insert_session(adapter, doc["id"], sid, cid, principal):
        return "ok"
    return bound() or "clash"  # lost a race for the sid or the clientID


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
    required = {"lineage": str, "sid": str, "from": int, "to": int, "cid": int, "seen_rev": int, "shas": list}
    if not isinstance(header, dict) or any(
        not isinstance(header.get(key), kind) or isinstance(header.get(key), bool)
        for key, kind in required.items()
    ):
        raise Refusal(400, "malformed")
    if header["from"] < 1 or header["to"] < header["from"] or not payload:
        raise Refusal(400, "malformed")
    if len(header["shas"]) != header["to"] - header["from"] + 1:
        raise Refusal(400, "malformed")
    try:
        header["shas"] = [bytes.fromhex(sha) for sha in header["shas"]]
    except (TypeError, ValueError):
        raise Refusal(400, "malformed") from None
    if any(len(sha) != 32 for sha in header["shas"]):
        raise Refusal(400, "malformed")
    return header, payload


def session_for(adapter: str, doc_id: str, header: dict, principal: str):
    """The pushing session, refused unless it is this principal's and bound to this clientID."""
    session = load_session(adapter, doc_id, header["sid"], principal)
    if session is None:
        raise Refusal(409, "session_unknown")
    if int(session.client_id) != header["cid"]:
        raise Refusal(409, "client_conflict")
    return session


def replay(adapter: str, doc_id: str, header: dict, acked: int, head: int) -> dict | None:
    """The original answer for a push that starts inside the committed seqs, if every sha matches."""
    if header["from"] > acked:
        return None
    through = min(header["to"], acked)
    rows = frappe.db.sql(
        f"""SELECT `rev`, `seq_from`, `seq_to`, `seq_shas`, `chain` FROM `{table(adapter, "update")}`
        WHERE `doc_id` = %s AND `sid` = %s AND `seq_to` >= %s AND `seq_from` <= %s ORDER BY `rev`""",
        (doc_id, header["sid"], header["from"], through),
        as_dict=True,
    )
    stored = {}
    for row in rows:
        shas = bytes(row.seq_shas)
        for index, seq in enumerate(range(int(row.seq_from), int(row.seq_to) + 1)):
            stored[seq] = (shas[32 * index : 32 * index + 32], row)
    last = None
    for seq in range(header["from"], through + 1):
        sha, last = stored.get(seq, (None, None))
        if sha != header["shas"][seq - header["from"]]:
            raise Refusal(409, "seq_conflict")
    return {
        "dup": True,
        "rev": int(last.rev),
        "chain": bytes(last.chain).hex(),
        "acked": acked,
        "head": head,
        "pace_ms": PACE_MS,
    }


def busy() -> Refusal:
    return Refusal(423, "busy", retry_ms=PACE_MS // 2 + secrets.randbelow(PACE_MS // 2 + 1))


def push(adapter: str, doc_id: str, header: dict, payload: bytes, principal: str) -> dict:
    """Commit one session's contiguous seq range as the next rev, or refuse it."""
    session = session_for(adapter, doc_id, header, principal)
    head = frappe.db.sql(f"SELECT `head_rev` FROM `{table(adapter, 'doc')}` WHERE `id` = %s", doc_id)[0][0]
    answer = replay(adapter, doc_id, header, int(session.acked_seq), int(head))
    if answer:
        return answer
    # The lock must be the first statement of a fresh transaction
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    locked = frappe.db.sql(
        f"SELECT `lineage`, `head_rev`, `head_chain` FROM `{table(adapter, 'doc')}` WHERE `id` = %s FOR UPDATE SKIP LOCKED",
        doc_id,
        as_dict=True,
    )
    if not locked:
        raise busy()
    doc = locked[0]
    try:
        if header["lineage"] != doc.lineage:
            raise Refusal(409, "lineage")
        session = session_for(adapter, doc_id, header, principal)
        acked = int(session.acked_seq)
        head = int(doc.head_rev)
        answer = replay(adapter, doc_id, header, acked, head)
        if answer:
            frappe.db.rollback()
            return answer
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
            (`doc_id`, `rev`, `sid`, `seq_from`, `seq_to`, `client_id`, `payload`, `sha256`, `seq_shas`, `chain`, `created`)
            VALUES (%s, %s, %s, %s, %s, %s, UNHEX(%s), UNHEX(%s), UNHEX(%s), UNHEX(%s), %s)""",
            (
                doc_id,
                rev,
                header["sid"],
                header["from"],
                header["to"],
                header["cid"],
                payload.hex(),
                payload_sha.hex(),
                b"".join(header["shas"]).hex(),
                chain.hex(),
                now,
            ),
        )
        frappe.db.sql(
            f"""UPDATE `{table(adapter, "doc")}` SET `head_rev` = %s, `head_chain` = UNHEX(%s),
            `tail_rows` = `tail_rows` + 1, `tail_bytes` = `tail_bytes` + %s
            WHERE `id` = %s""",
            (rev, chain.hex(), len(payload), doc_id),
        )
        frappe.db.sql(
            f"UPDATE `{table(adapter, 'session')}` SET `acked_seq` = %s, `last_push_at` = %s WHERE `doc_id` = %s AND `sid` = %s",
            (header["to"], now, doc_id, header["sid"]),
        )
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
    except BaseException:
        frappe.db.rollback()
        raise
    return {"rev": rev, "head": rev, "chain": chain.hex(), "acked": header["to"], "pace_ms": PACE_MS}


def read(adapter: str, doc_id: str, *, integrated: bool = False, own_snapshot: bool = True) -> dict | None:
    """The checkpoint and every row after it through the head, from one snapshot, chain checked.

    Rows are gap-free and commit-ordered, so a break means the store changed under
    the read or was rewound; the read is tried once more before it gives up.
    `integrated` starts from the newest integrated checkpoint, never a fallback one.
    A Drive callback may not commit, so it passes `own_snapshot=False` and reads in Drive's transaction.
    """
    for _try in range(2):
        with repeatable_read() if own_snapshot else contextlib.nullcontext():
            doc = frappe.db.sql(
                f"""SELECT `lineage`, `head_rev`, `head_chain`, `checkpoint_rev`, `integrated_rev`
                FROM `{table(adapter, "doc")}` WHERE `id` = %s""",
                doc_id,
                as_dict=True,
            )
            if not doc:
                return None
            doc = doc[0]
            base = int(doc.integrated_rev if integrated else doc.checkpoint_rev)
            checkpoint = None
            chain = chain_seed(doc.lineage)
            if base:
                gz, chain = frappe.db.sql(
                    f"SELECT `gz`, `chain` FROM `{table(adapter, 'checkpoint')}` WHERE `doc_id` = %s AND `through_rev` = %s",
                    (doc_id, base),
                )[0]
                checkpoint, chain = gzip.decompress(bytes(gz)), bytes(chain)
            rows = rows_after(adapter, doc_id, base)
        revs = [rev for rev, _payload in rows]
        for rev, payload in rows:
            chain = chain_next(chain, rev, hashlib.sha256(payload).digest())
        if revs == list(range(base + 1, int(doc.head_rev) + 1)) and chain == bytes(doc.head_chain):
            return {
                "lineage": doc.lineage,
                "head_rev": int(doc.head_rev),
                "head_chain": chain,
                "base": base,
                "checkpoint": checkpoint,
                "rows": rows,
            }
    raise ChainBroken


@contextlib.contextmanager
def repeatable_read():
    """Run the reads in one REPEATABLE READ snapshot. The level applies from the next transaction."""
    previous = isolation()
    frappe.db.sql("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ")
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    try:
        yield
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
    finally:
        if previous and previous != "REPEATABLE-READ":
            frappe.db.sql(f"SET SESSION TRANSACTION ISOLATION LEVEL {previous.replace('-', ' ')}")


def isolation() -> str | None:
    for variable in ("@@transaction_isolation", "@@tx_isolation"):
        try:
            return frappe.db.sql(f"SELECT {variable}")[0][0]
        except Exception:
            continue
    return None
