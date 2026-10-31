"""When a document is due a compaction, and asking for one.

A request is only a hint: it enqueues a job and never fails the open or push
that made it.

A tail is big once it passes a quarter of the state or half the room left
under the cap, whichever is less. The room term is hysteresis: a document
near the cap waits for a real tail instead of compacting after every push.
"""

import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

import frappe
from frappe.query_builder import Table
from frappe.query_builder.functions import Coalesce, Max
from frappe.query_builder.terms import SubQuery
from frappe.utils import now_datetime
from frappe.utils.background_jobs import is_job_enqueued
from pypika.queries import QueryBuilder, Selectable
from pypika.terms import Criterion, Term

from suite.content import capacity, stage
from suite.content.admission import TIMEOUT
from suite.content.db import Greatest
from suite.content.tables import table

TAIL_MIN = 256 * 2**10
TAIL_ROWS = 2000
TAIL_AGE = timedelta(minutes=10)
QUIET_SPAN = timedelta(seconds=30)
SWEEP_AGE = timedelta(minutes=30)
QUEUE_PAUSE = timedelta(minutes=1)

paused_until = 0.0


@dataclass(frozen=True)
class DocsWithBase:
    """A query of control rows as `docs`, each with its `base`, joined to `next_row`, the first row after it."""

    query: QueryBuilder
    docs: Selectable
    next_row: Table

    def due_columns(self) -> list[Term]:
        """Answer the columns `compaction_due` reads."""
        docs = self.docs
        return [
            docs.head_rev,
            docs.base,
            docs.state_bytes,
            docs.tail_rows,
            docs.tail_bytes,
            docs.tail_bound,
            docs.next_compaction_at,
            docs.suspect,
            self.next_row.created.as_("oldest"),
        ]


def docs_with_base(app: str, where: Callable[[Table], Criterion]) -> DocsWithBase:
    """Query the control rows `where` matches; `base` is the newer of the body's rev and any fallback's."""
    doc = Table(table(app, "doc")).as_("doc")
    checkpoint = Table(table(app, "checkpoint")).as_("c")
    fallback = (
        frappe.qb.from_(checkpoint).select(Max(checkpoint.through_rev)).where(checkpoint.doc_id == doc.id)
    )
    base = Greatest(doc.body_rev, Coalesce(SubQuery(fallback), 0)).as_("base")
    docs = frappe.qb.from_(doc).select(doc.star, base).where(where(doc)).as_("d")
    update = Table(table(app, "update")).as_("u")
    query = (
        frappe.qb.from_(docs).left_join(update).on((update.doc_id == docs.id) & (update.rev == docs.base + 1))
    )
    return DocsWithBase(query, docs, update)


def sweep_candidate(doc: Table) -> Criterion:
    """Match a document with rows after its body that is neither purged nor suspect."""
    return (doc.head_rev > doc.body_rev) & (doc.mode != "purged") & doc.suspect.isnull()


def request_if_due(
    app: str, doc_id: str, compact_method: str, *, final_from: str | None = None, refused: bool = False
) -> None:
    """Request a compaction if due; `final_from` is a hiding tab's session, `refused` a push short of room."""
    based = docs_with_base(app, lambda doc: doc.id == doc_id)
    due_columns = based.due_columns()
    due_rows = based.query.select(*due_columns).run(as_dict=True)
    if due_rows:
        request_on(app, doc_id, due_rows[0], compact_method, final_from=final_from, refused=refused)


def request_on(
    app: str,
    doc_id: str,
    doc: frappe._dict,
    compact_method: str,
    *,
    final_from: str | None = None,
    refused: bool = False,
) -> None:
    """Request a compaction if the doc row, read with its base and oldest tail row, says one is due."""
    closing = refused
    if final_from and not closing:
        session = Table(table(app, "session"))
        closing = not (
            frappe.qb.from_(session)
            .select(1)
            .where(session.doc_id == doc_id)
            .where(session.sid != final_from)
            .where(session.last_push_at > now_datetime() - QUIET_SPAN)
            .limit(1)
            .run()
        )

    if compaction_due(doc, now_datetime(), closing=closing):
        request_compaction(app, doc_id, compact_method)


def compaction_due(doc: frappe._dict, now: datetime, *, closing: bool = False) -> bool:
    """Answer whether the tail needs compacting; `closing` means the last typing tab left or a push waits."""
    if int(doc.head_rev) == int(doc.base) or doc.get("suspect"):
        return False

    if doc.next_compaction_at and doc.next_compaction_at > now:
        return False

    state_bytes = int(doc.state_bytes)
    room_left = capacity.STATE_MAX - state_bytes
    tail_bytes_big = int(doc.tail_bytes) >= max(TAIL_MIN, min(state_bytes // 4, room_left // 2))
    tail_bound_big = int(doc.tail_bound) >= max(TAIL_MIN, room_left // 2)
    tail_rows_many = int(doc.tail_rows) >= TAIL_ROWS
    tail_old = doc.oldest is not None and doc.oldest <= now - TAIL_AGE
    return closing or tail_bytes_big or tail_bound_big or tail_rows_many or tail_old


def request_overdue(app: str, method: str, limit: int) -> None:
    """Request compactions for documents whose tail has waited past `SWEEP_AGE`, whatever their traffic."""
    now = now_datetime()
    based = docs_with_base(app, sweep_candidate)
    docs = based.docs
    next_row = based.next_row
    overdue = (
        based.query.select(docs.id)
        .where(docs.head_rev > docs.base)
        .where(next_row.created <= now - SWEEP_AGE)
        .where(docs.next_compaction_at.isnull() | (docs.next_compaction_at <= now))
        .orderby(next_row.created)
        .limit(limit)
    )
    for (doc_id,) in overdue.run():
        request_compaction(app, doc_id, method)


def sweep(
    app: str,
    method: str,
    limit: int = 100,
    *,
    purge_method: str | None = None,
    judge_method: str | None = None,
) -> None:
    """Drop expired pieces and request purges, unfinished judgings and compactions of tails left too long."""
    stage.expire_pieces(app, now_datetime())

    doc = Table(table(app, "doc"))
    if purge_method:
        for (doc_id,) in frappe.qb.from_(doc).select(doc.id).where(doc.mode == "purged").limit(limit).run():
            enqueue(purge_method, f"suite-collab-purge-{app}-{doc_id}", app=app, doc_id=doc_id)

    if judge_method:
        for (doc_id,) in (
            frappe.qb.from_(doc)
            .select(doc.id)
            .where(doc.suspect.isnotnull())
            .where(doc.suspect_held.isnull())
            .where(doc.mode != "purged")
            .limit(limit)
            .run()
        ):
            enqueue(judge_method, f"suite-collab-judge-{app}-{doc_id}", app=app, doc_id=doc_id)

    request_overdue(app, method, limit)


def enqueue(method: str, job_id: str, *, timeout: int = TIMEOUT, **kwargs: object) -> None:
    """Queue a collaboration job, once per `job_id`, on the compaction queue where the bench has one."""
    # Frappe's own dedupe logs an error each time it skips, so a job already waiting or running returns here
    if is_job_enqueued(job_id):
        return

    queue = "collab" if "collab" in frappe.conf.get("workers", {}) else "default"
    frappe.enqueue(method, queue=queue, timeout=timeout, job_id=job_id, deduplicate=True, **kwargs)


def request_compaction(app: str, doc_id: str, method: str) -> None:
    """Enqueue `method(app, doc_id)` once per document."""
    global paused_until
    if time.monotonic() < paused_until:
        return

    try:
        enqueue(method, f"suite-collab-compact-{app}-{doc_id}", app=app, doc_id=doc_id)
    except Exception:
        # A request is only a hint, so the open or push that made it carries on and this process rests a while
        paused_until = time.monotonic() + QUEUE_PAUSE.total_seconds()
        traceback = frappe.get_traceback()
        frappe.log_error(
            title="Collab compaction: request failed",
            message=f"{app} document {doc_id}\n{traceback}",
            reference_doctype="Suite Collab Settings",
        )
