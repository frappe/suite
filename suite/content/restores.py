"""Restoring a version: a fence on the document while the restoring tab sends the restore as one push.

`begin` sets the fence and answers the head the restore is made against; the
caller then takes a version of that head. While fenced, every push but the
restoring tab's answers `paused`. That tab's push carries the fence's token and
commits only against the same head, and it records `restore_rev`: work made
before it is refused for good. A fence nobody finishes lapses at its deadline.
"""

import secrets
from datetime import datetime, timedelta

import frappe
from frappe.query_builder import Table
from frappe.utils import now_datetime

from suite.content import live
from suite.content.db import Unhex
from suite.content.log import Refusal
from suite.content.tables import table
from suite.content.wire import busy_refusal

FENCE_SECONDS = 120
# One restore per document per minute (Q127)
RESTORE_EVERY_SECONDS = 60
RESTORING_RETRY_MS = 1_000


def fenced(doc: frappe._dict, now: datetime) -> bool:
    """Whether a restore holds the document now."""
    return doc.mode == "restoring" and doc.restore_deadline is not None and doc.restore_deadline > now


def locked(app: str, doc_id: str) -> frappe._dict:
    """Lock the document row; refuse `busy` when another request holds it."""
    # The lock must be the first statement of a fresh transaction
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    doc = Table(table(app, "doc"))
    rows = (
        frappe.qb.from_(doc)
        .select(
            doc.lineage,
            doc.head_rev,
            doc.head_chain,
            doc.mode,
            doc.suspect_held,
            doc.restore_token,
            doc.restore_deadline,
            doc.restored_at,
            doc.milestone_chain,
        )
        .where(doc.id == doc_id)
        .for_update(skip_locked=True)
        .run(as_dict=True)
    )
    if not rows:
        raise busy_refusal()

    return rows[0]


def fence(app: str, doc_id: str, token: str, deadline: datetime) -> None:
    """Put the document in restoring mode under `token` until `deadline`."""
    doc = Table(table(app, "doc"))
    (
        frappe.qb.update(doc)
        .set(doc.mode, "restoring")
        .set(doc.restore_token, token)
        .set(doc.restore_deadline, deadline)
        .where(doc.id == doc_id)
        .run()
    )


def begin(app: str, doc_id: str, seen_rev: int) -> dict:
    """Fence the document for a restore made against `seen_rev`, which must be its head."""
    doc = locked(app, doc_id)
    now = now_datetime()
    try:
        check_can_begin(doc, seen_rev, now)
        token = secrets.token_hex(16)
        fence(app, doc_id, token, now + timedelta(seconds=FENCE_SECONDS))
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
    except BaseException:
        frappe.db.rollback()
        raise

    live.publish_control(app, doc_id, doc.lineage, kind="restoring", fence_ms=FENCE_SECONDS * 1000)
    head_chain = bytes(doc.head_chain)
    return {
        "token": token,
        "base_rev": int(doc.head_rev),
        "fence_ms": FENCE_SECONDS * 1000,
        "head_chain": head_chain,
        "has_milestone": doc.milestone_chain is not None and bytes(doc.milestone_chain) == head_chain,
    }


def check_can_begin(doc: frappe._dict, seen_rev: int, now: datetime) -> None:
    """Refuse a restore the document can't take now, saying why."""
    if doc.mode == "purged":
        raise Refusal(404, "not_found")

    if fenced(doc, now):
        raise Refusal(409, "restoring")

    if doc.restored_at is not None:
        wait = doc.restored_at + timedelta(seconds=RESTORE_EVERY_SECONDS) - now
        if wait > timedelta(0):
            raise Refusal(409, "restore_recent", retry_s=max(1, round(wait.total_seconds())))

    if doc.suspect_held:
        raise Refusal(423, "paused", reason="suspect")

    # The restore is computed from the tab's copy, which must hold every row
    if seen_rev != int(doc.head_rev):
        raise Refusal(409, "behind", head=int(doc.head_rev))


def check_landing(doc: frappe._dict, token: str, seen_rev: int, now: datetime) -> None:
    """Refuse a restore whose fence was lifted, lapsed or taken over, or whose head moved under it."""
    same_fence = doc.restore_token is not None and secrets.compare_digest(doc.restore_token, token)
    if not (same_fence and fenced(doc, now)) or seen_rev != int(doc.head_rev):
        raise Refusal(409, "restore_lost")


def landed(app: str, doc_id: str, rev: int, now: datetime) -> None:
    """Record `rev` as the restore and lift its fence, in the push's transaction."""
    doc = Table(table(app, "doc"))
    (
        frappe.qb.update(doc)
        .set(doc.mode, "active")
        .set(doc.restore_token, None)
        .set(doc.restore_deadline, None)
        .set(doc.restore_rev, rev)
        .set(doc.restored_at, now)
        .where(doc.id == doc_id)
        .run()
    )


def header_fields(app: str, doc_id: str) -> dict:
    """Answer the last restore's rev and how long a standing fence lasts."""
    doc_table = Table(table(app, "doc"))
    # Read after the rows a tab gets, so the rev covers every restore among them
    (doc,) = (
        frappe.qb.from_(doc_table)
        .select(doc_table.mode, doc_table.restore_deadline, doc_table.restore_rev)
        .where(doc_table.id == doc_id)
        .run(as_dict=True)
    )
    now = now_datetime()
    fields = {"restore_rev": int(doc.restore_rev)}
    if fenced(doc, now):
        fields["restoring_ms"] = int((doc.restore_deadline - now).total_seconds() * 1000)

    return fields


def milestone_taken(app: str, doc_id: str, head_chain: bytes) -> None:
    """Record that a version holds this head, so a restore begun again with no edits takes none."""
    doc = Table(table(app, "doc"))
    frappe.qb.update(doc).set(doc.milestone_chain, Unhex(head_chain.hex())).where(doc.id == doc_id).run()


def cancel(app: str, doc_id: str, token: str) -> None:
    """Lift the fence `token` set, if it still stands; tabs go back to editing."""
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    doc = Table(table(app, "doc"))
    lineage = (
        frappe.qb.from_(doc)
        .select(doc.lineage)
        .where(doc.id == doc_id)
        .where(doc.mode == "restoring")
        .where(doc.restore_token == token)
        .for_update()
        .run()
    )
    if not lineage:
        frappe.db.rollback()
        return

    lift(app, doc_id)
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    live.publish_control(app, doc_id, lineage[0][0], kind="restore_ended")


def lift(app: str, doc_id: str) -> None:
    """Clear the fence so the document takes edits again."""
    doc = Table(table(app, "doc"))
    (
        frappe.qb.update(doc)
        .set(doc.mode, "active")
        .set(doc.restore_token, None)
        .set(doc.restore_deadline, None)
        .where(doc.id == doc_id)
        .run()
    )
