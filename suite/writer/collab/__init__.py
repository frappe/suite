"""Writer's collaborative documents, kept in the collab library's update log."""

import base64
import gzip
import json
from pathlib import Path

import frappe
import pycrdt

from suite.suite_core import collab
from suite.suite_core.collab import checkpoints, compaction, scheduling, suspect, updates

ADAPTER = "writer"
# The editor's fragment, and tab labels
ROOTS = {"default": pycrdt.XmlFragment, "meta": pycrdt.Map}
# The Node kernel `bench build` makes, which judges suspect documents with the browsers' Yjs and this schema
KERNEL = Path(__file__).with_name("dist") / "kernel.cjs"
DECLARED = json.loads(Path(__file__).with_name("features.json").read_text())
# y-prosemirror writes only GC, deleted, string, format, type and any content, and only XmlElement and
# XmlText shared types. `meta` holds only plain values; if it ever nests a Map, Array or Text,
# `shared_types` must change in the same commit
SCHEMA = collab.EditorSchema(
    DECLARED["schema"],
    DECLARED["features"],
    content_refs=frozenset({0, 1, 4, 6, 7, 8}),
    shared_types=frozenset({3, 6}),
    nodes=frozenset(DECLARED["nodes"]),
    marks=frozenset(DECLARED["marks"]),
)


def ensure_tables() -> None:
    collab.ensure_tables(ADAPTER)
    collab.backfill_clocks(ADAPTER)


def start_log(node: str) -> None:
    """Make a new document collaborative from its first edit, while collaboration is on."""
    if collab.enabled():
        collab.create(ADAPTER, node)


def log_of(node: str) -> dict | None:
    """`node`'s log while collaboration is on: then its body lives there, not in the document row."""
    return collab.find(ADAPTER, node) if collab.enabled() else None


def live_state(node: str) -> pycrdt.Doc | None:
    """The document as its log stands now, read in the caller's transaction; None when the node has no log.

    Read whether collaboration is on or not, so the media sweep keeps what a log names.
    """
    doc = collab.find(ADAPTER, node)
    if not doc:
        return None
    read = collab.read(ADAPTER, doc.id, own_snapshot=False)
    parts = ([read["checkpoint"]] if read["checkpoint"] else []) + [payload for _rev, payload in read["rows"]]
    return compaction.load(parts)


def live_checkpoint(node: str) -> tuple[dict, bytes] | None:
    """The document's read and its state now, or None while its body is not in a log.

    The state is compacted with pycrdt in the request from the newest integrated
    checkpoint, never a fallback one, and only an integrated result is answered.
    A state or tail larger than a compaction job would take is refused.
    """
    doc = log_of(node)
    if not doc:
        return None
    read = collab.read(ADAPTER, doc.id, integrated=True, own_snapshot=False)
    rows = [payload for _rev, payload in read["rows"]]
    if not rows:
        return read, read["checkpoint"] or pycrdt.Doc().get_update()
    # pycrdt cannot be interrupted, so a web worker only takes on what a compaction job would
    size = len(read["checkpoint"] or b"") + sum(len(row) for row in rows)
    if size > scheduling.STATE_MAX or len(rows) > scheduling.TAIL_ROWS:
        raise compaction.CompactionFailed("too_large")
    result = compaction.compact(read["checkpoint"], rows, ROOTS)
    if not result.integrated:
        raise compaction.CompactionFailed("fallback")
    return read, result.state


def version_payload(read: dict, state: bytes) -> dict:
    """`state` as a `writer-document/2` version. The readable copy is not built yet, so `html` is null."""
    return {
        "schema": "writer-document/2",
        "codec": "yjs1",
        "lineage": read["lineage"],
        "through_rev": read["head_rev"],
        "chain": read["head_chain"].hex(),
        "state": base64.b64encode(gzip.compress(state)).decode("ascii"),
        "html": None,
    }


def copy_log(source_node: str, node: str) -> bool:
    """Start `node`'s log from `source_node`'s state now, under a new lineage; False while the source is not in a log."""
    live = live_checkpoint(source_node)
    if live is None:
        return False
    collab.replace_start(ADAPTER, collab.create(ADAPTER, node), live[1], live[0]["schema"])
    return True


def remap_log(node: str, rewrite) -> None:
    """Rewrite the values a copied log starts from, in place: no struct, row or session is added.

    The result must hold the same structs, read as the copy with `rewrite` applied to every
    attribute, mark and embed value, and give nothing more to rewrite.
    """
    doc = collab.find(ADAPTER, node)
    read = collab.read(ADAPTER, doc.id, own_snapshot=False)
    state = read["checkpoint"]
    remapped = updates.rewrite_values(state, rewrite)
    if remapped == state:
        return
    before, after = compaction.load([state]), compaction.load([remapped])
    if (
        compaction.snapshot(after) != compaction.snapshot(before)
        or compaction.content(after, ROOTS) != compaction.content(before, ROOTS, rewrite)
        or updates.rewrite_values(remapped, rewrite) != remapped
    ):
        raise compaction.CompactionFailed("remap_mismatch")
    collab.replace_start(ADAPTER, doc.id, remapped, read["schema"])


def purge_log(node: str) -> None:
    """Mark `node`'s log purged in Drive's transaction; a job deletes its rows once that commits."""
    doc_id = collab.mark_purged(ADAPTER, node)
    if doc_id:
        scheduling.enqueue(
            "suite.writer.collab.delete_purged",
            f"suite-collab-purge-{ADAPTER}-{doc_id}",
            doc_id=doc_id,
            enqueue_after_commit=True,
        )


def delete_purged(doc_id: str) -> None:
    collab.delete_purged(ADAPTER, doc_id)


def compact(doc_id: str) -> None:
    checkpoints.run(ADAPTER, doc_id, ROOTS, "suite.writer.collab.judge")


def judge(doc_id: str) -> None:
    if suspect.judge(ADAPTER, doc_id, ROOTS, KERNEL) in ("clean", "quarantined"):
        consider_compaction(doc_id)


# Who may ask for a new verdict on a suspect document or clear it; a System Manager may only list them
SUSPECT_ADMINS = ("Suite Admin", "Administrator")


@frappe.whitelist(methods=["GET"])
def suspect_documents() -> list[dict]:
    frappe.only_for(("System Manager", *SUSPECT_ADMINS))
    return suspect.listed(ADAPTER)


@frappe.whitelist(methods=["POST"])
def rejudge_suspect(doc_id: str) -> bool:
    frappe.only_for(SUSPECT_ADMINS)
    return suspect.rejudge(ADAPTER, doc_id, "suite.writer.collab.judge")


@frappe.whitelist(methods=["POST"])
def clear_suspect(doc_id: str) -> bool:
    frappe.only_for(SUSPECT_ADMINS)
    return suspect.release(ADAPTER, doc_id)


def report_suspect(doc_id: str, rev: int) -> tuple[int, dict]:
    return suspect.report(ADAPTER, doc_id, rev, "suite.writer.collab.judge")


def consider_compaction(doc_id: str, *, final_from: str | None = None) -> None:
    scheduling.consider(ADAPTER, doc_id, "suite.writer.collab.compact", final_from=final_from)


def sweep() -> None:
    scheduling.sweep(
        ADAPTER,
        "suite.writer.collab.compact",
        purge_method="suite.writer.collab.delete_purged",
        judge_method="suite.writer.collab.judge",
    )
