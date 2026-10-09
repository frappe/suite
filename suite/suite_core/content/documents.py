"""Each adapter's documents in their logs, by node: what Drive's callbacks and the routes call, and the jobs."""

from contextlib import suppress
from datetime import timedelta

import frappe
import pycrdt
from frappe.utils import now_datetime

from suite.suite_core import content
from suite.suite_core.content import checkpoints, compaction, scheduling, suspect, updates
from suite.suite_core.content.adapters import adapters, spec_of
from suite.suite_core.content.tables import table

COMPACT = "suite.suite_core.content.documents.compact"
JUDGE = "suite.suite_core.content.documents.judge"
DELETE_PURGED = "suite.suite_core.content.documents.delete_purged"
# A push tells the app at most this often; the sweep tells it about the edits after
TOUCH_EVERY = timedelta(minutes=10)
TOUCH_BATCH = 100


def ensure_tables() -> None:
    for spec in adapters().values():
        content.ensure_tables(spec.name)
        content.backfill_clocks(spec.name, spec.owner)


def start_log(adapter: str, node: str) -> None:
    """Make a new document collaborative from its first edit, while collaboration is on."""
    if content.enabled():
        content.create(adapter, node)


def live_state(adapter: str, node: str) -> pycrdt.Doc | None:
    """The document as its log stands now, read in the caller's transaction; None when the node has no log.

    Read whether collaboration is on or not, so the media sweep keeps what a log names.
    """
    doc = content.find(adapter, node)
    read = content.read(adapter, doc.id, own_snapshot=False) if doc else None
    if read is None:
        return None

    checkpoint_part = [read["checkpoint"]] if read["checkpoint"] else []
    row_parts = [payload for _rev, payload in read["rows"]]
    parts = checkpoint_part + row_parts
    return compaction.load(parts)


def live_checkpoint(adapter: str, node: str) -> tuple[dict, bytes] | None:
    """The document's read and its state now, or None when the node has no log.

    Read whether collaboration is on or not. The state is compacted with pycrdt in
    the request from the body, never a fallback, and only an integrated result is
    answered. A state or tail larger than a compaction job would take is refused.
    """
    doc = content.find(adapter, node)
    read = content.read(adapter, doc.id, integrated=True, own_snapshot=False) if doc else None
    if read is None:
        return None

    rows = [payload for _rev, payload in read["rows"]]
    if not rows:
        return read, read["checkpoint"] or pycrdt.Doc().get_update()

    # pycrdt cannot be interrupted, so a web worker only takes on what a compaction job would
    size = len(read["checkpoint"] or b"") + sum(len(row) for row in rows)
    too_big = size > scheduling.STATE_MAX
    too_many_rows = len(rows) > scheduling.TAIL_ROWS
    if too_big or too_many_rows:
        raise compaction.CompactionFailed("too_large")

    roots = spec_of(adapter).roots
    result = compaction.compact(read["checkpoint"], rows, roots)
    if not result.integrated:
        raise compaction.CompactionFailed("fallback")

    return read, result.state


def copy_log(adapter: str, source_node: str, node: str) -> bool:
    """Start `node`'s log from `source_node`'s state now, under a new lineage; False while the source is not in a log."""
    live = live_checkpoint(adapter, source_node)
    if live is None:
        return False

    read, state = live
    doc_id = content.create(adapter, node)
    content.replace_start(adapter, doc_id, state, read["schema"])
    return True


def remap_log(adapter: str, node: str, rewrite) -> None:
    """Rewrite the values a copied log starts from, in place: no struct, row or session is added.

    The result must hold the same structs, read as the copy with `rewrite` applied to every
    attribute, mark and embed value, and give nothing more to rewrite.
    """
    doc = content.find(adapter, node)
    if not doc:
        return

    read = content.read(adapter, doc.id, own_snapshot=False)
    if read is None:
        return

    roots = spec_of(adapter).roots
    state = read["checkpoint"]
    remapped = updates.rewrite_values(state, rewrite)
    if remapped == state:
        return

    before = compaction.load([state])
    after = compaction.load([remapped])
    if (
        compaction.snapshot(after) != compaction.snapshot(before)
        or compaction.content(after, roots) != compaction.content(before, roots, rewrite)
        or updates.rewrite_values(remapped, rewrite) != remapped
    ):
        raise compaction.CompactionFailed("remap_mismatch")

    content.replace_start(adapter, doc.id, remapped, read["schema"])


def purge_log(adapter: str, node: str) -> None:
    """Mark `node`'s log purged in Drive's transaction; a job deletes its rows once that commits."""
    doc_id = content.mark_purged(adapter, node)
    if doc_id:
        scheduling.enqueue(
            DELETE_PURGED,
            f"suite-collab-purge-{adapter}-{doc_id}",
            adapter=adapter,
            doc_id=doc_id,
            enqueue_after_commit=True,
        )


def delete_purged(adapter: str, doc_id: str) -> None:
    content.delete_purged(adapter, doc_id)


def compact(adapter: str, doc_id: str) -> None:
    spec = spec_of(adapter)
    checkpoints.run(adapter, doc_id, spec.roots, JUDGE, spec.owner)


def judge(adapter: str, doc_id: str) -> None:
    spec = spec_of(adapter)
    verdict = suspect.judge(adapter, doc_id, spec.roots, spec.kernel, spec.owner)
    if verdict in {"clean", "quarantined"}:
        consider_compaction(adapter, doc_id)


# Who may ask for a new verdict on a suspect document or clear it; a System Manager may only list them
SUSPECT_ADMINS = ("Suite Admin", "Administrator")


@frappe.whitelist(methods=["GET"])
def suspect_documents(adapter: str) -> list[dict]:
    frappe.only_for(("System Manager", *SUSPECT_ADMINS))
    return suspect.listed(spec_of(adapter).name)


@frappe.whitelist(methods=["POST"])
def rejudge_suspect(adapter: str, doc_id: str) -> bool:
    frappe.only_for(SUSPECT_ADMINS)
    return suspect.rejudge(spec_of(adapter).name, doc_id, JUDGE)


@frappe.whitelist(methods=["POST"])
def clear_suspect(adapter: str, doc_id: str) -> bool:
    frappe.only_for(SUSPECT_ADMINS)
    return suspect.release(spec_of(adapter).name, doc_id)


def report_suspect(adapter: str, doc_id: str, rev: int) -> tuple[int, dict]:
    return suspect.report(adapter, doc_id, rev, JUDGE)


def consider_compaction(
    adapter: str, doc_id: str, *, final_from: str | None = None, refused: bool = False
) -> None:
    scheduling.consider(adapter, doc_id, COMPACT, final_from=final_from, refused=refused)


def sweep() -> None:
    for name in adapters():
        scheduling.sweep(name, COMPACT, purge_method=DELETE_PURGED, judge_method=JUDGE)
        touched_before = now_datetime() - TOUCH_EVERY
        due = frappe.db.sql(
            f"""SELECT `id` FROM `{table(name, "doc")}` WHERE `touched_at` <= %s AND `head_rev` > `touched_rev`
            AND `mode` != 'purged' ORDER BY `touched_at` LIMIT %s""",
            (touched_before, TOUCH_BATCH),
        )
        for (doc_id,) in due:
            touch(name, doc_id)


def touch(adapter: str, doc_id: str) -> None:
    """Tell the app the document changed, once per TOUCH_EVERY at most; after a push commits, and from the sweep.

    The sweep only follows a push's touch, so a document nobody has edited since keeps its date.
    """
    due = """`id` = %s AND `mode` != 'purged' AND `head_rev` > `touched_rev`
        AND (`touched_at` IS NULL OR `touched_at` <= %s)"""
    now = now_datetime()
    touched_before = now - TOUCH_EVERY
    doc = table(adapter, "doc")
    before = frappe.db.sql(f"SELECT `touched_rev` FROM `{doc}` WHERE {due}", (doc_id, touched_before))
    if not before:
        return

    frappe.db.sql(
        f"UPDATE `{doc}` SET `touched_at` = %s, `touched_rev` = `head_rev` WHERE {due}",
        (now, doc_id, touched_before),
    )
    claimed = frappe.db.sql("SELECT ROW_COUNT()")[0][0]
    node, rev = frappe.db.sql(f"SELECT `node`, `touched_rev` FROM `{doc}` WHERE `id` = %s", doc_id)[0]
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    if not claimed:
        return

    try:
        spec_of(adapter).touch(node)
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
    except Exception:
        frappe.db.rollback()
        # The edits are committed; the sweep retries the touch once TOUCH_EVERY passes
        with suppress(Exception):
            frappe.db.sql(
                f"UPDATE `{doc}` SET `touched_rev` = %s WHERE `id` = %s AND `touched_at` = %s AND `touched_rev` = %s",
                (before[0][0], doc_id, now, rev),
            )
            frappe.db.commit()  # nosemgrep: frappe-manual-commit
        with suppress(Exception):
            frappe.log_error(
                title="Collab: Drive touch failed",
                message=f"{adapter} document {doc_id}\n{frappe.get_traceback()}",
                reference_doctype="Suite Collab Settings",
            )
