"""Writer's collaborative documents, kept in the collab library's update log."""

import pycrdt

from suite.suite_core import collab
from suite.suite_core.collab import checkpoints

ADAPTER = "writer"
# The editor's fragment, and tab labels
ROOTS = {"default": pycrdt.XmlFragment, "meta": pycrdt.Map}


def ensure_tables() -> None:
    collab.ensure_tables(ADAPTER)


def start_log(node: str) -> None:
    """Make a new document collaborative from its first edit, while collaboration is on."""
    if collab.enabled():
        collab.create(ADAPTER, node)


def compact(doc_id: str) -> None:
    checkpoints.run(ADAPTER, doc_id, ROOTS)


def consider_compaction(doc_id: str, *, final_from: str | None = None) -> None:
    checkpoints.consider(ADAPTER, doc_id, "suite.writer.collab.compact", final_from=final_from)


def sweep() -> None:
    checkpoints.sweep(ADAPTER, "suite.writer.collab.compact")
