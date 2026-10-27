"""Telling the app a document changed and taking its automatic versions: after a push, and from the sweep
for the edits after."""

from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass
from datetime import datetime, timedelta

import frappe
from frappe.query_builder import Criterion, Table
from frappe.utils import now_datetime

from suite import drive
from suite.content.db import changed_rows
from suite.content.log import Refusal
from suite.content.tables import table

# A push tells the app and takes a version at most this often; the sweep follows the edits after
TOUCH_EVERY = timedelta(minutes=10)
TOUCH_BATCH = 100


@dataclass(frozen=True)
class Follower:
    """What the app is told after edits: `column` names its `_at` and `_rev` columns, `hook` tells Drive."""

    column: str
    hook: Callable[[str], None]
    failure: str


def touch_body(node: str) -> None:
    """Tell Drive the document behind `node` changed."""
    doctype = frappe.db.get_value("Drive Node", node, "content_doctype")
    document_name = frappe.db.get_value(doctype, {drive.node_field(doctype): node})
    drive.touch(doctype, document_name)


def version_body(node: str, kind: str, label: str | None) -> None:
    """Store the document's body as a Drive version of `kind`; a milestone Drive refuses is refused."""
    try:
        drive.take_version(node, kind=kind, label=label)
    except drive.DriveError as error:
        if kind != "milestone":
            raise

        raise Refusal(409, "milestone_failed", message=str(error)) from None


TOUCH = Follower(column="touched", hook=touch_body, failure="Collab: Drive touch failed")
VERSION = Follower(
    column="versioned",
    hook=lambda node: version_body(node, "auto", None),
    failure="Collab: automatic version failed",
)


def due(doc: frappe._dict, follower: Follower) -> bool:
    """Whether `follower` is due on the doc row: edits it hasn't followed, and none for TOUCH_EVERY."""
    followed_at = doc[f"{follower.column}_at"]
    unfollowed = int(doc.head_rev) > int(doc[f"{follower.column}_rev"])
    quiet = followed_at is None or followed_at <= now_datetime() - TOUCH_EVERY
    return doc.mode != "purged" and unfollowed and quiet


def follow(app: str, doc_id: str, follower: Follower) -> None:
    """Do what `follower` does after edits, once per TOUCH_EVERY at most, after a push or from the sweep."""
    claim = claimed(app, doc_id, follower)
    if claim is None:
        return

    try:
        follower.hook(claim.node)
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
    except Exception:
        frappe.db.rollback()
        # The edits are committed; the sweep retries once TOUCH_EVERY passes
        with suppress(Exception):
            give_back(app, doc_id, follower, claim)

        with suppress(Exception):
            traceback = frappe.get_traceback()
            frappe.log_error(
                title=follower.failure,
                message=f"{app} document {doc_id}\n{traceback}",
                reference_doctype="Suite Collab Settings",
            )


@dataclass(frozen=True)
class Claim:
    node: str
    at: datetime
    rev: int
    previous_rev: int


def claimed(app: str, doc_id: str, follower: Follower) -> Claim | None:
    """Mark the head followed when it is due, committed, so only one request follows it."""
    now = now_datetime()
    followed_before = now - TOUCH_EVERY
    doc = Table(table(app, "doc"))
    followed_at = getattr(doc, f"{follower.column}_at")
    followed_rev = getattr(doc, f"{follower.column}_rev")
    due_condition = Criterion.all(
        [
            doc.id == doc_id,
            doc.mode != "purged",
            doc.head_rev > followed_rev,
            followed_at.isnull() | (followed_at <= followed_before),
        ]
    )
    previous = frappe.qb.from_(doc).select(followed_rev).where(due_condition).run()
    if not previous:
        return None

    claimed_count = changed_rows(
        frappe.qb.update(doc).set(followed_at, now).set(followed_rev, doc.head_rev).where(due_condition)
    )
    ((node, claimed_rev),) = frappe.qb.from_(doc).select(doc.node, followed_rev).where(doc.id == doc_id).run()
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    if not claimed_count:
        return None

    ((previous_rev,),) = previous
    return Claim(node=node, at=now, rev=claimed_rev, previous_rev=previous_rev)


def give_back(app: str, doc_id: str, follower: Follower, claim: Claim) -> None:
    """Put the followed head back to before `claim`, unless another request has claimed it since."""
    doc = Table(table(app, "doc"))
    followed_at = getattr(doc, f"{follower.column}_at")
    followed_rev = getattr(doc, f"{follower.column}_rev")
    (
        frappe.qb.update(doc)
        .set(followed_rev, claim.previous_rev)
        .where(doc.id == doc_id)
        .where(followed_at == claim.at)
        .where(followed_rev == claim.rev)
        .run()
    )
    frappe.db.commit()  # nosemgrep: frappe-manual-commit


def sweep(app: str) -> None:
    """Touch and version the documents edited since, longest waiting first, TOUCH_BATCH at most of each."""
    sweep_for(app, TOUCH)
    sweep_for(app, VERSION)


def sweep_for(app: str, follower: Follower) -> None:
    """Follow the documents edited since `follower` last did, longest waiting first, TOUCH_BATCH at most."""
    followed_before = now_datetime() - TOUCH_EVERY
    doc = Table(table(app, "doc"))
    followed_at = getattr(doc, f"{follower.column}_at")
    followed_rev = getattr(doc, f"{follower.column}_rev")
    due_doc_ids = (
        frappe.qb.from_(doc)
        .select(doc.id)
        .where(followed_at <= followed_before)
        .where(doc.head_rev > followed_rev)
        .where(doc.mode != "purged")
        .orderby(followed_at)
        .limit(TOUCH_BATCH)
        .run()
    )
    for (doc_id,) in due_doc_ids:
        follow(app, doc_id, follower)
