"""Writer's collaborative documents, kept in the collab library's update log."""

import base64
import gzip

import pycrdt

from suite.suite_core import collab
from suite.suite_core.collab import checkpoints, compaction, scheduling

ADAPTER = "writer"
# The editor's fragment, and tab labels
ROOTS = {"default": pycrdt.XmlFragment, "meta": pycrdt.Map}


def ensure_tables() -> None:
    collab.ensure_tables(ADAPTER)


def start_log(node: str) -> None:
    """Make a new document collaborative from its first edit, while collaboration is on."""
    if collab.enabled():
        collab.create(ADAPTER, node)


def live_state(node: str) -> pycrdt.Doc | None:
    """The document as its log stands now, read in the caller's transaction; None when the node has no log."""
    doc = collab.find(ADAPTER, node)
    if not doc:
        return None
    read = collab.read(ADAPTER, doc.id, own_snapshot=False)
    parts = ([read["checkpoint"]] if read["checkpoint"] else []) + [payload for _rev, payload in read["rows"]]
    return compaction.load(parts)


def version_payload(node: str) -> dict | None:
    """The document now as a `writer-document/2` version, or None while its body is not in a log.

    The state is compacted with pycrdt in the request from the newest integrated
    checkpoint, never a fallback one, and only an integrated result is answered.
    The readable copy is not built yet, so `html` is null.
    """
    if not collab.enabled():
        return None
    doc = collab.find(ADAPTER, node)
    if not doc:
        return None
    read = collab.read(ADAPTER, doc.id, integrated=True, own_snapshot=False)
    rows = [payload for _rev, payload in read["rows"]]
    if rows:
        result = compaction.compact(read["checkpoint"], rows, ROOTS)
        if not result.integrated:
            raise compaction.CompactionFailed("fallback")
        state = result.state
    else:
        state = read["checkpoint"] or pycrdt.Doc().get_update()
    return {
        "schema": "writer-document/2",
        "codec": "yjs1",
        "lineage": read["lineage"],
        "through_rev": read["head_rev"],
        "chain": read["head_chain"].hex(),
        "state": base64.b64encode(gzip.compress(state)).decode("ascii"),
        "html": None,
    }


def compact(doc_id: str) -> None:
    checkpoints.run(ADAPTER, doc_id, ROOTS)


def consider_compaction(doc_id: str, *, final_from: str | None = None) -> None:
    scheduling.consider(ADAPTER, doc_id, "suite.writer.collab.compact", final_from=final_from)


def sweep() -> None:
    scheduling.sweep(ADAPTER, "suite.writer.collab.compact")
