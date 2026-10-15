"""Telling the app a document changed and taking its automatic versions: after a push, and from the sweep
for the edits after."""

from contextlib import suppress
from dataclasses import dataclass
from datetime import datetime, timedelta

import frappe
from frappe.utils import now_datetime

from suite.suite_core.content.adapters import node_hooks, spec_of
from suite.suite_core.content.tables import table

# A push tells the app and takes a version at most this often; the sweep follows the edits after
TOUCH_EVERY = timedelta(minutes=10)
TOUCH_BATCH = 100


@dataclass(frozen=True)
class Follower:
    """What the app is told after edits: `column` names its `_at` and `_rev` columns, `hook` the node hook."""

    column: str
    hook: str
    failure: str


TOUCH = Follower(column="touched", hook="touch", failure="Collab: Drive touch failed")
VERSION = Follower(column="versioned", hook="take_version", failure="Collab: automatic version failed")


def touch(adapter: str, doc_id: str) -> None:
    """Tell the app the document changed, once per TOUCH_EVERY at most; after a push commits, and from the sweep.

    The sweep only follows a push's touch, so a document nobody has edited since keeps its date.
    """
    follow(adapter, doc_id, TOUCH)


def take_version(adapter: str, doc_id: str) -> None:
    """Take an automatic version of the document, once per TOUCH_EVERY at most, the same way as a touch."""
    follow(adapter, doc_id, VERSION)


def follow(adapter: str, doc_id: str, follower: Follower) -> None:
    """Do what `follower` does after edits, once per TOUCH_EVERY at most; the sweep retries a failure."""
    claim = claimed(adapter, doc_id, follower)
    if claim is None:
        return

    try:
        getattr(node_hooks(), follower.hook)(spec_of(adapter), claim.node)
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
    except Exception:
        frappe.db.rollback()
        # The edits are committed; the sweep retries once TOUCH_EVERY passes
        with suppress(Exception):
            give_back(adapter, doc_id, follower, claim)

        with suppress(Exception):
            frappe.log_error(
                title=follower.failure,
                message=f"{adapter} document {doc_id}\n{frappe.get_traceback()}",
                reference_doctype="Suite Collab Settings",
            )


@dataclass(frozen=True)
class Claim:
    node: str
    at: datetime
    rev: int
    previous_rev: int


def claimed(adapter: str, doc_id: str, follower: Follower) -> Claim | None:
    """Mark the head followed when it is due, committed, so only one request follows it."""
    at_column = f"{follower.column}_at"
    rev_column = f"{follower.column}_rev"
    due_condition = f"""`id` = %s AND `mode` != 'purged' AND `head_rev` > `{rev_column}`
        AND (`{at_column}` IS NULL OR `{at_column}` <= %s)"""
    now = now_datetime()
    followed_before = now - TOUCH_EVERY
    doc_table = table(adapter, "doc")
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


def give_back(adapter: str, doc_id: str, follower: Follower, claim: Claim) -> None:
    """Put the followed head back to before `claim`, unless another request has claimed it since."""
    at_column = f"{follower.column}_at"
    rev_column = f"{follower.column}_rev"
    doc_table = table(adapter, "doc")
    frappe.db.sql(
        f"""UPDATE `{doc_table}` SET `{rev_column}` = %s
        WHERE `id` = %s AND `{at_column}` = %s AND `{rev_column}` = %s""",
        (claim.previous_rev, doc_id, claim.at, claim.rev),
    )
    frappe.db.commit()  # nosemgrep: frappe-manual-commit


def sweep(adapter: str) -> None:
    """Touch and version the documents edited since, longest waiting first, TOUCH_BATCH at most of each."""
    sweep_for(adapter, TOUCH)
    sweep_for(adapter, VERSION)


def sweep_for(adapter: str, follower: Follower) -> None:
    """Follow the documents edited since `follower` last did, longest waiting first, TOUCH_BATCH at most."""
    at_column = f"{follower.column}_at"
    rev_column = f"{follower.column}_rev"
    followed_before = now_datetime() - TOUCH_EVERY
    doc_table = table(adapter, "doc")
    due_doc_ids = frappe.db.sql(
        f"""SELECT `id` FROM `{doc_table}` WHERE `{at_column}` <= %s AND `head_rev` > `{rev_column}`
        AND `mode` != 'purged' ORDER BY `{at_column}` LIMIT %s""",
        (followed_before, TOUCH_BATCH),
    )
    for (doc_id,) in due_doc_ids:
        follow(adapter, doc_id, follower)
