"""Collab hooks for the Playwright suites: turn collaboration on, compact now, and read a log back."""

import frappe
import pycrdt
from frappe.tests.utils import whitelist_for_tests

from suite.suite_core import collab
from suite.suite_core.collab import compaction
from suite.suite_core.collab.tables import KINDS, table
from suite.writer import collab as writer_collab


def collab_doc(node: str) -> dict:
    doc = collab.find(writer_collab.ADAPTER, node)
    if doc is None:
        raise frappe.DoesNotExistError(f"{node} has no collab log")
    return doc


@whitelist_for_tests(methods=["POST"])
def enable_collab(node: str) -> dict:
    """Turn collaboration on for the site and make `node`'s Writer document collaborative."""
    frappe.db.set_single_value("Suite Collab Settings", "mode", "on")
    frappe.db.set_value("Writer Document", {"node": node}, "collab", 1)
    if collab.find(writer_collab.ADAPTER, node) is None:
        collab.create(writer_collab.ADAPTER, node)
    frappe.db.commit()
    return state(node)


@whitelist_for_tests(methods=["POST"])
def compact_now(node: str) -> dict:
    """Compact `node`'s collab log in this request, as the queued job would."""
    writer_collab.compact(collab_doc(node)["id"])
    return state(node)


@whitelist_for_tests(methods=["GET", "POST"])
def state(node: str) -> dict:
    """Where `node`'s collab log stands: its checkpoint, its head and the rows between."""
    row = frappe.db.sql(
        f"""SELECT `checkpoint_rev`, `head_rev`, `tail_rows`
        FROM `{table(writer_collab.ADAPTER, "doc")}` WHERE `id` = %s""",
        collab_doc(node)["id"],
        as_dict=True,
    )[0]
    return {key: int(value) for key, value in row.items()}


@whitelist_for_tests(methods=["GET", "POST"])
def log_id(node: str) -> str:
    return collab_doc(node)["id"]


@whitelist_for_tests(methods=["GET", "POST"])
def log_rows(log: str) -> dict:
    """How many rows each collab table holds for the log `log`, its control row included."""
    return {
        kind: frappe.db.sql(
            f"SELECT COUNT(*) FROM `{table(writer_collab.ADAPTER, kind)}` WHERE `{'id' if kind == 'doc' else 'doc_id'}` = %s",
            log,
        )[0][0]
        for kind in KINDS
    }


@whitelist_for_tests(methods=["GET", "POST"])
def server_text(node: str) -> list[str]:
    """The text of each top-level block of `node`, read from the checkpoint and the rows after it."""
    stored = collab.read(writer_collab.ADAPTER, collab_doc(node)["id"])
    if stored is None:
        raise frappe.DoesNotExistError(f"{node} has no collab log")
    parts = ([stored["checkpoint"]] if stored["checkpoint"] else []) + [row for _rev, row in stored["rows"]]
    fragment = compaction.load(parts).get("default", type=pycrdt.XmlFragment)
    return [block_text(block) for block in fragment.children]


def block_text(node) -> str:
    if isinstance(node, pycrdt.XmlText):
        return "".join(chunk for chunk, _attributes in node.diff())
    return "".join(block_text(child) for child in node.children)
