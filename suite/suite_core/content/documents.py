"""Each adapter's documents in their logs, by node: what Drive's callbacks and the routes call, and the jobs."""

import frappe
import pycrdt

from suite.suite_core import content
from suite.suite_core.content import (
    checkpoints,
    compaction,
    copies,
    scheduling,
    stage,
    suspect,
    touches,
    trimming,
    updates,
)
from suite.suite_core.content.adapters import adapters, node_hooks, spec_of
from suite.suite_core.content.snapshot import Snapshot
from suite.suite_core.content.tables import table

COMPACT = "suite.suite_core.content.documents.compact"
JUDGE = "suite.suite_core.content.documents.judge"
DELETE_PURGED = "suite.suite_core.content.documents.delete_purged"
TRIM = "suite.suite_core.content.documents.trim"
CHECK_RENDER = "suite.suite_core.content.documents.check_render"


def ensure_tables() -> None:
    for spec in adapters().values():
        content.ensure_tables(spec.name)
        content.backfill_clocks(spec.name, node_hooks().owner)


def start_log(adapter: str, node: str) -> None:
    """Make a new document collaborative from its first edit, while collaboration is on."""
    if content.enabled(adapter):
        content.create(adapter, node)


def live_state(adapter: str, node: str) -> pycrdt.Doc | None:
    """The document as its log stands now, read in the caller's transaction; None when the node has no log.

    Read whether collaboration is on or not, so the media sweep keeps what a log names.
    """
    doc = content.find(adapter, node)
    log_read = content.read(adapter, doc.id, own_snapshot=False) if doc else None
    if log_read is None:
        return None

    checkpoint_part = [log_read.checkpoint] if log_read.checkpoint else []
    row_parts = log_read.payloads()
    parts = checkpoint_part + row_parts
    return compaction.load_doc(parts)


def live_checkpoint(adapter: str, node: str) -> tuple[Snapshot, bytes] | None:
    """The document's read and its state now, or None when the node has no log.

    Read whether collaboration is on or not. The state is compacted with pycrdt in
    the request from the body, never a fallback, and only an integrated result is
    answered. A state or tail larger than a compaction job would take is refused.
    """
    doc = content.find(adapter, node)
    log_read = content.read(adapter, doc.id, integrated=True, own_snapshot=False) if doc else None
    if log_read is None:
        return None

    rows = log_read.payloads()
    if not rows:
        return log_read, log_read.checkpoint or pycrdt.Doc().get_update()

    # pycrdt cannot be interrupted, so a web worker only takes on what a compaction job would
    total_bytes = len(log_read.checkpoint or b"") + sum(len(row) for row in rows)
    too_big = total_bytes > spec_of(adapter).max_state
    too_many_rows = len(rows) > scheduling.TAIL_ROWS
    if too_big or too_many_rows:
        raise compaction.CompactionFailed("too_large")

    roots = spec_of(adapter).roots
    compacted = compaction.compact(log_read.checkpoint, rows, roots)
    if not compacted.integrated:
        raise compaction.CompactionFailed("fallback")

    return log_read, compacted.state


def copy_log(adapter: str, source_node: str, node: str) -> bool:
    """Start `node`'s log from `source_node`'s state now, under a new lineage; False while the source is not in a log."""
    source_checkpoint = live_checkpoint(adapter, source_node)
    if source_checkpoint is None:
        return False

    log_read, state = source_checkpoint
    doc_id = content.create(adapter, node)
    content.replace_start(adapter, doc_id, state, log_read.schema)
    return True


def remap_log(adapter: str, node: str, rewrite) -> None:
    """Rewrite the values a copied log starts from, in place: no struct, row or session is added.

    The result must hold the same structs, read as the copy with `rewrite` applied to every
    attribute, mark and embed value, and give nothing more to rewrite.
    """
    doc = content.find(adapter, node)
    if not doc:
        return

    log_read = content.read(adapter, doc.id, own_snapshot=False)
    if log_read is None:
        return

    roots = spec_of(adapter).roots
    state = log_read.checkpoint
    # copy_log starts every copied log from a body
    assert state is not None

    remapped = updates.rewrite_values(state, rewrite)
    if remapped == state:
        return

    original_doc = compaction.load_doc([state])
    remapped_doc = compaction.load_doc([remapped])
    if (
        compaction.vector_and_deletes(remapped_doc) != compaction.vector_and_deletes(original_doc)
        or compaction.content_json(remapped_doc, roots)
        != compaction.content_json(original_doc, roots, rewrite)
        or updates.rewrite_values(remapped, rewrite) != remapped
    ):
        raise compaction.CompactionFailed("remap_mismatch")

    content.replace_start(adapter, doc.id, remapped, log_read.schema)


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
    checkpoints.run(adapter, doc_id, spec.roots, JUDGE, node_hooks().owner)


def trim(adapter: str) -> None:
    """Run one app's trimming, as its queued job."""
    spec = spec_of(adapter)
    trimming.run(adapter, spec.roots, spec.kernel)


def trim_logs() -> None:
    """Hourly: one trimming job per app, which resumes where the last one stopped."""
    for adapter in adapters():
        frappe.enqueue(
            TRIM,
            queue="long",
            timeout=trimming.TIMEOUT,
            job_id=f"suite-collab-trim-{adapter}",
            deduplicate=True,
            adapter=adapter,
        )


def judge(adapter: str, doc_id: str) -> None:
    spec = spec_of(adapter)
    verdict = suspect.judge(adapter, doc_id, spec.roots, spec.kernel, node_hooks().owner)
    if verdict in {"clean", "quarantined"}:
        consider_compaction(adapter, doc_id)


# Who may ask for a new verdict on a suspect document or clear it; a System Manager may only list them
SUSPECT_ADMINS = ("Suite Admin", "Administrator")


@frappe.whitelist(methods=["GET"])
def suspect_documents(adapter: str) -> list[dict]:
    frappe.only_for(("System Manager", *SUSPECT_ADMINS))
    return suspect.listed_suspects(spec_of(adapter).name)


@frappe.whitelist(methods=["POST"])
def rejudge_suspect(adapter: str, doc_id: str) -> bool:
    frappe.only_for(SUSPECT_ADMINS)
    return suspect.rejudge(spec_of(adapter).name, doc_id, JUDGE)


@frappe.whitelist(methods=["POST"])
def clear_suspect(adapter: str, doc_id: str) -> bool:
    frappe.only_for(SUSPECT_ADMINS)
    return suspect.release(spec_of(adapter).name, doc_id)


def report_suspect(adapter: str, doc_id: str, rev: int) -> tuple[int, dict]:
    return suspect.report_row(adapter, doc_id, rev, JUDGE)


def check_render(adapter: str, doc_id: str) -> None:
    """Check the document's newest whole staged render as its readable copy."""
    copies.check_staged(adapter, doc_id)


def request_render_check(adapter: str, doc_id: str) -> None:
    """Enqueue the document's copy check once."""
    scheduling.enqueue(
        CHECK_RENDER, f"suite-collab-render-{adapter}-{doc_id}", adapter=adapter, doc_id=doc_id
    )


def consider_compaction(
    adapter: str, doc_id: str, *, final_from: str | None = None, refused: bool = False
) -> None:
    scheduling.request_if_due(adapter, doc_id, COMPACT, final_from=final_from, refused=refused)


def sweep() -> None:
    for adapter in adapters():
        scheduling.sweep(adapter, COMPACT, purge_method=DELETE_PURGED, judge_method=JUDGE)
        touches.sweep(adapter)
        for doc_id in stage.rendered_docs(adapter):
            request_render_check(adapter, doc_id)
