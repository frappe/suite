"""When a document is due a compaction, and asking for one.

A request is only a hint: it enqueues a job and never fails the open or push
that made it.

A tail is big once it passes a quarter of the state or half the room left
under the cap, whichever is less. The room term is hysteresis: a document
near the cap waits for a real tail instead of compacting after every push.
"""

import time
from datetime import datetime, timedelta

import frappe
from frappe.utils import now_datetime
from frappe.utils.background_jobs import is_job_enqueued

from suite.content import capacity, stage
from suite.content.admission import TIMEOUT
from suite.content.tables import table

TAIL_MIN = 256 * 2**10
TAIL_ROWS = 2000
TAIL_AGE = timedelta(minutes=10)
QUIET_SPAN = timedelta(seconds=30)
SWEEP_AGE = timedelta(minutes=30)
QUEUE_PAUSE = timedelta(minutes=1)
SWEEP_CANDIDATES = (
    "`doc`.`head_rev` > `doc`.`body_rev` AND `doc`.`mode` != 'purged' AND `doc`.`suspect` IS NULL"
)

paused_until = 0.0


def docs_with_base(app: str, *, where: str) -> str:
    """Select the control rows `where` matches with `base`, the newer of the body's rev and any fallback's."""
    checkpoint_table = table(app, "checkpoint")
    doc_table = table(app, "doc")
    return f"""(SELECT `doc`.*, GREATEST(`doc`.`body_rev`, COALESCE((SELECT MAX(`c`.`through_rev`)
        FROM `{checkpoint_table}` `c` WHERE `c`.`doc_id` = `doc`.`id`), 0)) AS `base`
        FROM `{doc_table}` `doc` WHERE {where})"""


def request_if_due(
    app: str, doc_id: str, compact_method: str, *, final_from: str | None = None, refused: bool = False
) -> None:
    """Request a compaction if due; `final_from` is a hiding tab's session, `refused` a push short of room."""
    doc_with_base = docs_with_base(app, where="`doc`.`id` = %s")
    update_table = table(app, "update")
    due_rows = frappe.db.sql(
        f"""SELECT `d`.`head_rev`, `d`.`base`, `d`.`state_bytes`, `d`.`tail_rows`, `d`.`tail_bytes`, `d`.`tail_bound`,
        `d`.`next_compaction_at`, `d`.`suspect`, `u`.`created` AS `oldest`
        FROM {doc_with_base} `d` LEFT JOIN `{update_table}` `u`
        ON `u`.`doc_id` = `d`.`id` AND `u`.`rev` = `d`.`base` + 1""",
        doc_id,
        as_dict=True,
    )
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
        session_table = table(app, "session")
        closing = not frappe.db.sql(
            f"""SELECT 1 FROM `{session_table}` WHERE `doc_id` = %s AND `sid` != %s
            AND `last_push_at` > %s LIMIT 1""",
            (doc_id, final_from, now_datetime() - QUIET_SPAN),
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
    candidates = docs_with_base(app, where=SWEEP_CANDIDATES)
    update_table = table(app, "update")
    for (doc_id,) in frappe.db.sql(
        f"""SELECT `d`.`id` FROM {candidates} `d` JOIN `{update_table}` `u`
        ON `u`.`doc_id` = `d`.`id` AND `u`.`rev` = `d`.`base` + 1
        WHERE `d`.`head_rev` > `d`.`base` AND `u`.`created` <= %s
        AND (`d`.`next_compaction_at` IS NULL OR `d`.`next_compaction_at` <= %s)
        ORDER BY `u`.`created` LIMIT %s""",
        (now - SWEEP_AGE, now, limit),
    ):
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

    doc_table = table(app, "doc")
    if purge_method:
        for (doc_id,) in frappe.db.sql(
            f"SELECT `id` FROM `{doc_table}` WHERE `mode` = 'purged' LIMIT %s", limit
        ):
            enqueue(purge_method, f"suite-collab-purge-{app}-{doc_id}", app=app, doc_id=doc_id)

    if judge_method:
        for (doc_id,) in frappe.db.sql(
            f"""SELECT `id` FROM `{doc_table}` WHERE `suspect` IS NOT NULL AND `suspect_held` IS NULL
            AND `mode` != 'purged' LIMIT %s""",
            limit,
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
