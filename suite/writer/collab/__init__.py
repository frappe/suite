"""Writer's collaborative documents, kept in the collab library's update log."""

from suite.suite_core import collab

ADAPTER = "writer"


def ensure_tables() -> None:
    collab.ensure_tables(ADAPTER)


def start_log(node: str) -> None:
    """Make a new document collaborative from its first edit, while collaboration is on."""
    if collab.enabled():
        collab.create(ADAPTER, node)
