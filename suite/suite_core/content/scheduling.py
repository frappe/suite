"""When a document is due a compaction, and asking for one.

A request is only a hint: it enqueues a job and never fails the open or push
that made it.
"""

import time
from datetime import timedelta

import frappe
from frappe.utils import now_datetime

from suite.suite_core.content import stage
from suite.suite_core.content.admission import TIMEOUT
from suite.suite_core.content.tables import table

STATE_MAX = 4 * 2**20
TAIL_MIN = 256 * 2**10
TAIL_ROWS = 2000
AGE = timedelta(minutes=10)
QUIET = timedelta(seconds=30)
SWEEP_AGE = timedelta(minutes=30)
QUEUE_PAUSE = timedelta(minutes=1)

paused_until = 0.0


def based(adapter: str) -> str:
    """The control rows with `base`, the rev their open base runs through: the newer of the body and any fallback."""
    return f"""(SELECT `doc`.*, GREATEST(`doc`.`body_rev`, COALESCE((SELECT MAX(`c`.`through_rev`)
        FROM `{table(adapter, "checkpoint")}` `c` WHERE `c`.`doc_id` = `doc`.`id`), 0)) AS `base`
        FROM `{table(adapter, "doc")}` `doc`)"""


def consider(
    adapter: str, doc_id: str, method: str, *, final_from: str | None = None, refused: bool = False
) -> None:
    """Request a compaction if the document is due. `final_from` names a tab's session that is hiding or closing;
    `refused`: a push was just refused for want of room, which only a compaction makes."""
    doc = frappe.db.sql(
        f"""SELECT `d`.`head_rev`, `d`.`base`, `d`.`state_bytes`, `d`.`tail_rows`, `d`.`tail_bytes`, `d`.`tail_bound`,
        `d`.`next_compaction_at`, `d`.`suspect`, `u`.`created` AS `oldest`
        FROM {based(adapter)} `d` LEFT JOIN `{table(adapter, "update")}` `u`
        ON `u`.`doc_id` = `d`.`id` AND `u`.`rev` = `d`.`base` + 1
        WHERE `d`.`id` = %s""",
        doc_id,
        as_dict=True,
    )
    if not doc:
        return
    closing = refused
    if final_from and not closing:
        closing = not frappe.db.sql(
            f"""SELECT 1 FROM `{table(adapter, "session")}` WHERE `doc_id` = %s AND `sid` != %s
            AND `last_push_at` > %s LIMIT 1""",
            (doc_id, final_from, now_datetime() - QUIET),
        )
    if due(doc[0], now_datetime(), closing=closing):
        request(adapter, doc_id, method)


def due(doc, now, *, closing: bool = False) -> bool:
    """Whether a document's tail calls for a compaction now. `closing`: the tab that closed was the last one typing,
    or a push waits for room.

    A tail is big once it passes a quarter of the state or half the room left
    under the cap, whichever is less. The room term is hysteresis: a document
    near the cap waits for a real tail instead of compacting after every push.
    """
    if int(doc.head_rev) == int(doc.base) or doc.get("suspect"):
        return False
    if doc.next_compaction_at and doc.next_compaction_at > now:
        return False
    state = int(doc.state_bytes)
    return (
        closing
        or int(doc.tail_bytes) >= max(TAIL_MIN, min(state // 4, (STATE_MAX - state) // 2))
        or int(doc.tail_bound) >= max(TAIL_MIN, (STATE_MAX - state) // 2)
        or int(doc.tail_rows) >= TAIL_ROWS
        or (doc.oldest is not None and doc.oldest <= now - AGE)
    )


def sweep(
    adapter: str,
    method: str,
    limit: int = 100,
    *,
    purge_method: str | None = None,
    judge_method: str | None = None,
) -> None:
    """Request compactions for documents whose tail has waited too long, whatever their traffic,
    the deletion of purged logs and expired staged pieces and the judging of suspect documents a job has not finished."""
    stage.expire(adapter, now_datetime())
    if purge_method:
        for (doc_id,) in frappe.db.sql(
            f"SELECT `id` FROM `{table(adapter, 'doc')}` WHERE `mode` = 'purged' LIMIT %s", limit
        ):
            enqueue(purge_method, f"suite-collab-purge-{adapter}-{doc_id}", adapter=adapter, doc_id=doc_id)
    if judge_method:
        for (doc_id,) in frappe.db.sql(
            f"""SELECT `id` FROM `{table(adapter, "doc")}` WHERE `suspect` IS NOT NULL AND `suspect_held` IS NULL
            AND `mode` != 'purged' LIMIT %s""",
            limit,
        ):
            enqueue(judge_method, f"suite-collab-judge-{adapter}-{doc_id}", adapter=adapter, doc_id=doc_id)
    now = now_datetime()
    for (doc_id,) in frappe.db.sql(
        f"""SELECT `d`.`id` FROM {based(adapter)} `d` JOIN `{table(adapter, "update")}` `u`
        ON `u`.`doc_id` = `d`.`id` AND `u`.`rev` = `d`.`base` + 1
        WHERE `d`.`head_rev` > `d`.`base` AND `d`.`mode` != 'purged' AND `d`.`suspect` IS NULL
        AND `u`.`created` <= %s
        AND (`d`.`next_compaction_at` IS NULL OR `d`.`next_compaction_at` <= %s)
        ORDER BY `u`.`created` LIMIT %s""",
        (now - SWEEP_AGE, now, limit),
    ):
        request(adapter, doc_id, method)


def enqueue(method: str, job_id: str, **kwargs) -> None:
    """Queue a collaboration job, once per `job_id`, on the compaction queue where the bench has one."""
    queue = "collab" if "collab" in frappe.conf.get("workers", {}) else "default"
    frappe.enqueue(method, queue=queue, timeout=TIMEOUT, job_id=job_id, deduplicate=True, **kwargs)


def request(adapter: str, doc_id: str, method: str) -> None:
    """Enqueue `method(adapter, doc_id)` once per document."""
    global paused_until
    if time.monotonic() < paused_until:
        return
    try:
        enqueue(method, f"suite-collab-compact-{adapter}-{doc_id}", adapter=adapter, doc_id=doc_id)
    except Exception:
        # A request is only a hint, so the open or push that made it carries on and this process rests a while
        paused_until = time.monotonic() + QUEUE_PAUSE.total_seconds()
        frappe.log_error(
            title="Collab compaction: request failed",
            message=f"{adapter} document {doc_id}\n{frappe.get_traceback()}",
            reference_doctype="Suite Collab Settings",
        )
