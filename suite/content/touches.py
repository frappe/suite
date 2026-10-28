"""Telling the app a document changed and taking its automatic versions: after a push, and from the sweep
for the edits after."""

from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass
from datetime import datetime, timedelta

import frappe
from frappe.utils import now_datetime

from suite import drive
from suite.content.log import Refusal
from suite.content.tables import table

# A push tells the app and takes a version at most this often; the sweep follows the edits after
TOUCH_EVERY = timedelta(minutes=10)
TOUCH_BATCH = 100


@dataclass(frozen=True)
class Claim:
    node: str
    at: datetime
    rev: int
    previous_rev: int


@dataclass(frozen=True)
class Follower:
    """What the app is told after edits: `column` names its `_at` and `_rev` columns, `hook` tells Drive."""

    column: str
    hook: Callable[[str, str, Claim], None]
    failure: str


def touch_body(node: str) -> None:
    """Tell Drive the document behind `node` changed."""
    doctype = frappe.db.get_value("Drive Node", node, "content_doctype")
    document_name = frappe.db.get_value(doctype, {drive.node_field(doctype): node})
    drive.touch(doctype, document_name)


def version_body(node: str, kind: str, label: str | None, actor: str | None = None) -> None:
    """Store the document's body as a Drive version of `kind`, credited to `actor` or the caller;
    a milestone Drive refuses is refused."""
    try:
        drive.take_version(node, kind=kind, label=label, actor=actor)
    except drive.DriveError as error:
        if kind != "milestone":
            raise

        raise Refusal(409, "milestone_failed", message=str(error)) from None


def version_edits(app: str, doc_id: str, claim: Claim) -> None:
    """Store the edits `claim` follows as an automatic version, credited to who made most of them."""
    version_body(claim.node, "auto", None, main_author(app, doc_id, claim))


TOUCH = Follower(
    column="touched",
    hook=lambda _app, _doc_id, claim: touch_body(claim.node),
    failure="Collab: Drive touch failed",
)
VERSION = Follower(column="versioned", hook=version_edits, failure="Collab: automatic version failed")


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
        follower.hook(app, doc_id, claim)
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


def claimed(app: str, doc_id: str, follower: Follower) -> Claim | None:
    """Mark the head followed when it is due, committed, so only one request follows it."""
    at_column = f"{follower.column}_at"
    rev_column = f"{follower.column}_rev"
    due_condition = f"""`id` = %s AND `mode` != 'purged' AND `head_rev` > `{rev_column}`
        AND (`{at_column}` IS NULL OR `{at_column}` <= %s)"""
    now = now_datetime()
    followed_before = now - TOUCH_EVERY
    doc_table = table(app, "doc")
    previous = frappe.db.sql(
        f"SELECT `{rev_column}` FROM `{doc_table}` WHERE {due_condition}", (doc_id, followed_before)
    )
    if not previous:
        return None

    frappe.db.sql(
        f"UPDATE `{doc_table}` SET `{at_column}` = %s, `{rev_column}` = `head_rev` WHERE {due_condition}",
        (now, doc_id, followed_before),
    )
    ((claimed_count,),) = frappe.db.sql("SELECT ROW_COUNT()")
    ((node, claimed_rev),) = frappe.db.sql(
        f"SELECT `node`, `{rev_column}` FROM `{doc_table}` WHERE `id` = %s", doc_id
    )
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    if not claimed_count:
        return None

    ((previous_rev,),) = previous
    return Claim(node=node, at=now, rev=claimed_rev, previous_rev=previous_rev)


def main_author(app: str, doc_id: str, claim: Claim) -> str | None:
    """The person whose tabs sent the most of the rows `claim` follows, the latest on a tie.

    A sweep runs as the system user and a push as whoever sent it, so neither is who made the
    changes. None when no row names a person, as for a copy's start.
    """
    authors = frappe.db.sql(
        f"""SELECT `session`.`user` FROM `{table(app, "update")}` AS `row`
        JOIN `{table(app, "session")}` AS `session`
            ON `session`.`doc_id` = `row`.`doc_id` AND `session`.`client_id` = `row`.`client_id`
        WHERE `row`.`doc_id` = %s AND `row`.`rev` > %s AND `row`.`rev` <= %s
        GROUP BY `session`.`user` ORDER BY COUNT(*) DESC, MAX(`row`.`rev`) DESC LIMIT 1""",
        (doc_id, claim.previous_rev, claim.rev),
    )
    return authors[0][0] if authors else None


def give_back(app: str, doc_id: str, follower: Follower, claim: Claim) -> None:
    """Put the followed head back to before `claim`, unless another request has claimed it since."""
    at_column = f"{follower.column}_at"
    rev_column = f"{follower.column}_rev"
    doc_table = table(app, "doc")
    frappe.db.sql(
        f"""UPDATE `{doc_table}` SET `{rev_column}` = %s
        WHERE `id` = %s AND `{at_column}` = %s AND `{rev_column}` = %s""",
        (claim.previous_rev, doc_id, claim.at, claim.rev),
    )
    frappe.db.commit()  # nosemgrep: frappe-manual-commit


def sweep(app: str) -> None:
    """Touch and version the documents edited since, longest waiting first, TOUCH_BATCH at most of each."""
    sweep_for(app, TOUCH)
    sweep_for(app, VERSION)


def sweep_for(app: str, follower: Follower) -> None:
    """Follow the documents edited since `follower` last did, longest waiting first, TOUCH_BATCH at most."""
    at_column = f"{follower.column}_at"
    rev_column = f"{follower.column}_rev"
    followed_before = now_datetime() - TOUCH_EVERY
    doc_table = table(app, "doc")
    due_doc_ids = frappe.db.sql(
        f"""SELECT `id` FROM `{doc_table}` WHERE `{at_column}` <= %s AND `head_rev` > `{rev_column}`
        AND `mode` != 'purged' ORDER BY `{at_column}` LIMIT %s""",
        (followed_before, TOUCH_BATCH),
    )
    for (doc_id,) in due_doc_ids:
        follow(app, doc_id, follower)
