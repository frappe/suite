"""Each adapter's documents in their logs, by node: what Drive's callbacks and the routes call, and the jobs."""

import frappe
import pycrdt

from suite.suite_core import content
from suite.suite_core.content import checkpoints, compaction, scheduling, suspect, updates
from suite.suite_core.content.adapters import adapters, spec_of

COMPACT = "suite.suite_core.content.documents.compact"
JUDGE = "suite.suite_core.content.documents.judge"
DELETE_PURGED = "suite.suite_core.content.documents.delete_purged"


def ensure_tables() -> None:
    for spec in adapters().values():
        content.ensure_tables(spec.name)
        content.backfill_clocks(spec.name, spec.owner)


def start_log(adapter: str, node: str) -> None:
    """Make a new document collaborative from its first edit, while collaboration is on."""
    if content.enabled():
        content.create(adapter, node)


def log_of(adapter: str, node: str) -> frappe._dict | None:
    """`node`'s log while collaboration is on: then its body lives there, not in the document row."""
    return content.find(adapter, node) if content.enabled() else None


def live_state(adapter: str, node: str) -> pycrdt.Doc | None:
    """The document as its log stands now, read in the caller's transaction; None when the node has no log.

    Read whether collaboration is on or not, so the media sweep keeps what a log names.
    """
    doc = content.find(adapter, node)
    read = content.read(adapter, doc.id, own_snapshot=False) if doc else None
    if read is None:
        return None
    parts = ([read["checkpoint"]] if read["checkpoint"] else []) + [payload for _rev, payload in read["rows"]]
    return compaction.load(parts)


def live_checkpoint(adapter: str, node: str) -> tuple[dict, bytes] | None:
    """The document's read and its state now, or None while its body is not in a log.

    The state is compacted with pycrdt in the request from the newest integrated
    checkpoint, never a fallback one, and only an integrated result is answered.
    A state or tail larger than a compaction job would take is refused.
    """
    doc = log_of(adapter, node)
    read = content.read(adapter, doc.id, integrated=True, own_snapshot=False) if doc else None
    if read is None:
        return None
    rows = [payload for _rev, payload in read["rows"]]
    if not rows:
        return read, read["checkpoint"] or pycrdt.Doc().get_update()
    # pycrdt cannot be interrupted, so a web worker only takes on what a compaction job would
    size = len(read["checkpoint"] or b"") + sum(len(row) for row in rows)
    if size > scheduling.STATE_MAX or len(rows) > scheduling.TAIL_ROWS:
        raise compaction.CompactionFailed("too_large")
    result = compaction.compact(read["checkpoint"], rows, spec_of(adapter).roots)
    if not result.integrated:
        raise compaction.CompactionFailed("fallback")
    return read, result.state


def copy_log(adapter: str, source_node: str, node: str) -> bool:
    """Start `node`'s log from `source_node`'s state now, under a new lineage; False while the source is not in a log."""
    live = live_checkpoint(adapter, source_node)
    if live is None:
        return False
    content.replace_start(adapter, content.create(adapter, node), live[1], live[0]["schema"])
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
    before, after = compaction.load([state]), compaction.load([remapped])
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
    if suspect.judge(adapter, doc_id, spec.roots, spec.kernel, spec.owner) in {"clean", "quarantined"}:
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
