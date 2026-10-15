"""Sessions: the clientID bound to each tab's sid, and the checks a push makes against it."""

import secrets

import frappe
from frappe.utils import now_datetime

from suite.suite_core.content.log import Refusal
from suite.suite_core.content.snapshot import start_clocks
from suite.suite_core.content.tables import table
from suite.suite_core.content.wire import PushHeader, busy_refusal

CLIENT_ID_MAX = 2**30


def load_session(adapter: str, doc_id: str, sid: str, principal: str):
    """The session row for `sid`, or None. Refused if it belongs to another principal."""
    rows = frappe.db.sql(
        f"SELECT `client_id`, `principal`, `acked_seq`, `next_clock`, `closed` FROM `{table(adapter, 'session')}` WHERE `doc_id` = %s AND `sid` = %s",
        (doc_id, sid),
        as_dict=True,
    )
    if rows and rows[0].principal != principal:
        raise Refusal(409, "session_owner")

    return rows[0] if rows else None


def session_for(adapter: str, doc_id: str, header: PushHeader, principal: str):
    """The pushing session, refused unless it is this principal's, bound to this clientID and open."""
    session = load_session(adapter, doc_id, header.sid, principal)
    if session is None:
        raise Refusal(409, "session_unknown")

    if int(session.client_id) != header.client_id:
        raise Refusal(409, "client_conflict")

    if session.closed:
        # Before any replay: an acked seq of a closed session may be quarantined
        raise Refusal(409, "client_closed")

    return session


def insert_session(adapter: str, doc_id: str, sid: str, client_id: int, principal: str) -> bool:
    """Commit a new session row. False if the sid or the clientID is already taken, by a session or
    by a writer of the start state. The doc lock keeps the start from changing under the check."""
    doc = frappe.db.sql(
        f"SELECT `start_clocks` FROM `{table(adapter, 'doc')}` WHERE `id` = %s FOR UPDATE",
        doc_id,
        as_dict=True,
    )[0]
    if client_id in start_clocks(doc):
        return False

    try:
        frappe.db.sql(
            f"""INSERT INTO `{table(adapter, "session")}` (`doc_id`, `sid`, `client_id`, `principal`, `acked_seq`, `next_clock`, `created`)
            VALUES (%s, %s, %s, %s, 0, 0, %s)""",
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

    raise busy_refusal()


def claim_session(adapter: str, doc: dict, sid: str, claim, principal: str) -> str:
    """Bind the clientID a tab opened offline chose itself: `ok`, `clash` or `lineage`. Mints nothing."""
    client_id = claim.get("cid") if isinstance(claim, dict) else None
    lineage = claim.get("lineage") if isinstance(claim, dict) else None
    if not isinstance(client_id, int) or isinstance(client_id, bool):
        raise Refusal(400, "malformed")

    if not isinstance(lineage, str):
        raise Refusal(400, "malformed")

    if not CLIENT_ID_MAX <= client_id < 2 * CLIENT_ID_MAX:
        raise Refusal(400, "malformed")

    if lineage != doc["lineage"]:
        return "lineage"

    def existing_binding() -> str | None:
        row = load_session(adapter, doc["id"], sid, principal)
        if not row:
            return None

        if int(row.client_id) == client_id:
            return "ok"

        return "clash"

    binding = existing_binding()
    if binding:
        return binding

    if insert_session(adapter, doc["id"], sid, client_id, principal):
        return "ok"

    return existing_binding() or "clash"  # lost a race for the sid or the clientID
