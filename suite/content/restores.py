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
from frappe.utils import now_datetime

from suite.content import live
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
    doc_table = table(app, "doc")
    rows = frappe.db.sql(
        f"""SELECT `lineage`, `head_rev`, `head_chain`, `mode`, `suspect_held`, `restore_token`,
        `restore_deadline`, `restored_at`, `milestone_chain` FROM `{doc_table}`
        WHERE `id` = %s FOR UPDATE SKIP LOCKED""",
        doc_id,
        as_dict=True,
    )
    if not rows:
        raise busy_refusal()

    return rows[0]


def begin(app: str, doc_id: str, seen_rev: int) -> dict:
    """Fence the document for a restore made against `seen_rev`, which must be its head."""
    doc = locked(app, doc_id)
    now = now_datetime()
    try:
        check_can_begin(doc, seen_rev, now)
        token = secrets.token_hex(16)
        deadline = now + timedelta(seconds=FENCE_SECONDS)
        doc_table = table(app, "doc")
        frappe.db.sql(
            f"""UPDATE `{doc_table}` SET `mode` = 'restoring', `restore_token` = %s,
            `restore_deadline` = %s WHERE `id` = %s""",
            (token, deadline, doc_id),
        )
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
    doc_table = table(app, "doc")
    frappe.db.sql(
        f"""UPDATE `{doc_table}` SET `mode` = 'active', `restore_token` = NULL,
        `restore_deadline` = NULL, `restore_rev` = %s, `restored_at` = %s WHERE `id` = %s""",
        (rev, now, doc_id),
    )


def header_fields(app: str, doc_id: str) -> dict:
    """Answer the last restore's rev and how long a standing fence lasts."""
    doc_table = table(app, "doc")
    # Read after the rows a tab gets, so the rev covers every restore among them
    (doc,) = frappe.db.sql(
        f"""SELECT `mode`, `restore_deadline`, `restore_rev` FROM `{doc_table}`
        WHERE `id` = %s""",
        doc_id,
        as_dict=True,
    )
    now = now_datetime()
    fields = {"restore_rev": int(doc.restore_rev)}
    if fenced(doc, now):
        fields["restoring_ms"] = int((doc.restore_deadline - now).total_seconds() * 1000)

    return fields


def milestone_taken(app: str, doc_id: str, head_chain: bytes) -> None:
    """Record that a version holds this head, so a restore begun again with no edits takes none."""
    doc_table = table(app, "doc")
    frappe.db.sql(
        f"UPDATE `{doc_table}` SET `milestone_chain` = UNHEX(%s) WHERE `id` = %s",
        (head_chain.hex(), doc_id),
    )


def cancel(app: str, doc_id: str, token: str) -> None:
    """Lift the fence `token` set, if it still stands; tabs go back to editing."""
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    doc_table = table(app, "doc")
    lineage = frappe.db.sql(
        f"""SELECT `lineage` FROM `{doc_table}` WHERE `id` = %s AND `mode` = 'restoring'
        AND `restore_token` = %s FOR UPDATE""",
        (doc_id, token),
    )
    if not lineage:
        frappe.db.rollback()
        return

    lift(app, doc_id)
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    live.publish_control(app, doc_id, lineage[0][0], kind="restore_ended")


def lift(app: str, doc_id: str) -> None:
    """Clear the fence so the document takes edits again."""
    doc_table = table(app, "doc")
    frappe.db.sql(
        f"""UPDATE `{doc_table}` SET `mode` = 'active', `restore_token` = NULL,
        `restore_deadline` = NULL WHERE `id` = %s""",
        doc_id,
    )
