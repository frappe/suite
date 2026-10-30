"""Sessions: the clientID bound to each tab's sid, and the checks a push makes against it."""

import secrets

import frappe
from frappe.query_builder import Table
from frappe.utils import now_datetime

from suite.content.db import insert_into
from suite.content.log import Refusal
from suite.content.snapshot import start_clocks
from suite.content.tables import table
from suite.content.wire import PushHeader, busy_refusal

CLIENT_ID_MAX = 2**30


def load_session(app: str, doc_id: str, sid: str, user: str) -> frappe._dict | None:
    """Load the session row for `sid`, or None; refused when it belongs to another user."""
    session_table = Table(table(app, "session"))
    rows = (
        frappe.qb.from_(session_table)
        .select(
            session_table.client_id,
            session_table.user,
            session_table.acked_seq,
            session_table.next_clock,
            session_table.closed,
        )
        .where(session_table.doc_id == doc_id)
        .where(session_table.sid == sid)
        .run(as_dict=True)
    )
    if not rows:
        return None

    session = rows[0]
    if session.user != user:
        raise Refusal(409, "session_owner")

    return session


def session_for(app: str, doc_id: str, header: PushHeader, user: str) -> frappe._dict:
    """Load the pushing session, refused unless it is this user's, bound to this clientID and open."""
    session = load_session(app, doc_id, header.sid, user)
    if session is None:
        raise Refusal(409, "session_unknown")

    if int(session.client_id) != header.client_id:
        raise Refusal(409, "client_conflict")

    if session.closed:
        # Before any replay: an acked seq of a closed session may be quarantined
        raise Refusal(409, "client_closed")

    return session


def locked_start_clocks(app: str, doc_id: str) -> dict[int, int]:
    """Lock the control row and load the clocks the document's state starts from."""
    doc = Table(table(app, "doc"))
    doc_rows = (
        frappe.qb.from_(doc).select(doc.start_clocks).where(doc.id == doc_id).for_update().run(as_dict=True)
    )
    return start_clocks(doc_rows[0])


def insert_session(app: str, doc_id: str, sid: str, client_id: int, user: str) -> bool:
    """Commit a new session row under the doc lock; False when a session or the start already has the ids."""
    if client_id in locked_start_clocks(app, doc_id):
        return False

    try:
        insert_into(
            table(app, "session"),
            {
                "doc_id": doc_id,
                "sid": sid,
                "client_id": client_id,
                "user": user,
                "acked_seq": 0,
                "next_clock": 0,
                "created": now_datetime(),
            },
        ).run()
    except Exception as error:
        if frappe.db.is_duplicate_entry(error):
            return False

        raise

    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    return True


def issue_session(app: str, doc_id: str, sid: str, user: str) -> int:
    """Bind a fresh clientID to `sid` before the tab reveals or uses it. Idempotent per sid."""
    existing = load_session(app, doc_id, sid, user)
    if existing:
        return int(existing.client_id)

    for _attempt in range(8):
        client_id = secrets.randbelow(CLIENT_ID_MAX - 1) + 1
        if insert_session(app, doc_id, sid, client_id, user):
            return client_id

    raise busy_refusal()


def parsed_claim(claim: object) -> tuple[int, str]:
    """Read the clientID and lineage a tab claims; raise `Refusal` when either is malformed."""
    client_id = None
    lineage = None
    if isinstance(claim, dict):
        client_id = claim.get("cid")
        lineage = claim.get("lineage")

    if not isinstance(client_id, int) or isinstance(client_id, bool):
        raise Refusal(400, "malformed")

    if not isinstance(lineage, str):
        raise Refusal(400, "malformed")

    if not CLIENT_ID_MAX <= client_id < 2 * CLIENT_ID_MAX:
        raise Refusal(400, "malformed")

    return client_id, lineage


def claim_session(app: str, doc: dict, sid: str, claim: object, user: str) -> str:
    """Bind the clientID a tab opened offline chose itself: `ok`, `clash` or `lineage`. Mints nothing."""
    client_id, lineage = parsed_claim(claim)
    if lineage != doc["lineage"]:
        return "lineage"

    def existing_binding() -> str | None:
        row = load_session(app, doc["id"], sid, user)
        if not row:
            return None

        if int(row.client_id) == client_id:
            return "ok"

        return "clash"

    binding = existing_binding()
    if binding:
        return binding

    if insert_session(app, doc["id"], sid, client_id, user):
        return "ok"

    # Lost a race for the sid or the clientID
    return existing_binding() or "clash"
