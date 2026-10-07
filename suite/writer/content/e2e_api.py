"""Collab hooks for the Playwright suites: turn collaboration on, compact now, and read a log back."""

import json

import frappe
import pycrdt
from frappe.tests.utils import whitelist_for_tests

from suite.suite_core import content
from suite.suite_core.content import compaction, quarantine, scheduling, suspect
from suite.suite_core.content.tables import KINDS, table
from suite.writer import content as writer_content


def collab_doc(node: str) -> dict:
    doc = content.find(writer_content.ADAPTER, node)
    if doc is None:
        raise frappe.DoesNotExistError(f"{node} has no collab log")
    return doc


@whitelist_for_tests(methods=["POST"])
def enable_collab(node: str) -> dict:
    """Turn collaboration on for the site and make `node`'s Writer document collaborative."""
    frappe.db.set_single_value("Suite Collab Settings", "mode", "on")
    frappe.db.set_value("Writer Document", {"node": node}, "collab", 1)
    if content.find(writer_content.ADAPTER, node) is None:
        content.create(writer_content.ADAPTER, node)
    frappe.db.commit()
    return state(node)


@whitelist_for_tests(methods=["POST"])
def compact_now(node: str) -> dict:
    """Compact `node`'s collab log in this request, as the queued job would."""
    writer_content.compact(collab_doc(node)["id"])
    return state(node)


@whitelist_for_tests(methods=["POST"])
def hold(node: str, why: str) -> dict:
    """Hold `node` for an admin, as a judge that can't settle a compaction's suspect does."""
    doc_id = collab_doc(node)["id"]
    frappe.db.sql(
        f"UPDATE `{table(writer_content.ADAPTER, 'doc')}` SET `suspect` = 'unreadable' WHERE `id` = %s",
        doc_id,
    )
    suspect.hold(writer_content.ADAPTER, doc_id, why, "Held by the Playwright suite")
    return state(node)


@whitelist_for_tests(methods=["POST"])
def release(node: str) -> dict:
    """Clear `node`'s hold as an admin does from the suspect list."""
    suspect.release(writer_content.ADAPTER, collab_doc(node)["id"])
    return state(node)


@whitelist_for_tests(methods=["POST"])
def quarantine_last(node: str, why: str) -> dict:
    """Quarantine `node`'s last row, as a judge that finds it bad does."""
    doc = collab_doc(node)
    quarantine.quarantine(
        writer_content.ADAPTER, doc["id"], {int(doc["head_rev"])}, why, writer_content.document_owner
    )
    return state(node)


@whitelist_for_tests(methods=["POST"])
def leave_no_room(node: str) -> dict:
    """Count `node`'s state as big as the tail leaves room for, so its next adding push waits for a compaction."""
    frappe.db.sql(
        f"""UPDATE `{table(writer_content.ADAPTER, "doc")}` SET `state_bytes` = %s - `tail_bound` WHERE `id` = %s""",
        (scheduling.STATE_MAX, collab_doc(node)["id"]),
    )
    return state(node)


@whitelist_for_tests(methods=["POST"])
def fill_up(node: str) -> dict:
    """Count `node`'s state as big as a document may be, so nothing that adds is taken again."""
    frappe.db.sql(
        f"""UPDATE `{table(writer_content.ADAPTER, "doc")}` SET `state_bytes` = %s WHERE `id` = %s""",
        (scheduling.STATE_MAX, collab_doc(node)["id"]),
    )
    return state(node)


@whitelist_for_tests(methods=["POST"])
def write_newer_schema(node: str) -> dict:
    """Mark `node`'s rows as written from here on by an editor one schema newer, as its pushes would."""
    doc = collab_doc(node)
    steps = json.loads(doc["schema_steps"])
    steps.append([int(doc["head_rev"]) + 1, steps[-1][1] + 1])
    frappe.db.sql(
        f"UPDATE `{table(writer_content.ADAPTER, 'doc')}` SET `schema_steps` = %s WHERE `id` = %s",
        (json.dumps(steps), doc["id"]),
    )
    return state(node)


@whitelist_for_tests(methods=["POST"])
def paragraph_change(node: str, client_id: int, length: int) -> dict:
    """What a tab writing as `client_id` sends when it adds a paragraph of `length` letters to the end of `node`."""
    live = writer_content.live_state(node)
    assert live is not None
    tab: pycrdt.Doc = pycrdt.Doc(client_id=int(client_id))
    tab.apply_update(live.get_update())
    before = tab.get_state()
    paragraph = tab.get("default", type=pycrdt.XmlFragment).children.append(pycrdt.XmlElement("paragraph"))
    paragraph.children.append(pycrdt.XmlText()).insert(0, "x" * int(length))
    doc = collab_doc(node)
    return {
        "change": tab.get_update(before).hex(),
        "lineage": doc["lineage"],
        "head_rev": int(doc["head_rev"]),
    }


@whitelist_for_tests(methods=["GET", "POST"])
def state_bytes(node: str) -> int:
    """How big `node`'s compacted state is counted."""
    return int(collab_doc(node)["state_bytes"])


@whitelist_for_tests(methods=["GET", "POST"])
def state(node: str) -> dict:
    """Where `node`'s collab log stands: its checkpoint, its head and the rows between."""
    row = frappe.db.sql(
        f"""SELECT `checkpoint_rev`, `head_rev`, `tail_rows`
        FROM `{table(writer_content.ADAPTER, "doc")}` WHERE `id` = %s""",
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
            f"SELECT COUNT(*) FROM `{table(writer_content.ADAPTER, kind)}` WHERE `{'id' if kind == 'doc' else 'doc_id'}` = %s",
            log,
        )[0][0]
        for kind in KINDS
    }


@whitelist_for_tests(methods=["GET", "POST"])
def server_text(node: str) -> list[str]:
    """The text of each top-level block of `node`, read from the checkpoint and the rows after it."""
    stored = content.read(writer_content.ADAPTER, collab_doc(node)["id"])
    if stored is None:
        raise frappe.DoesNotExistError(f"{node} has no collab log")
    parts = ([stored["checkpoint"]] if stored["checkpoint"] else []) + [row for _rev, row in stored["rows"]]
    fragment = compaction.load(parts).get("default", type=pycrdt.XmlFragment)
    return [block_text(block) for block in fragment.children]


def block_text(node) -> str:
    if isinstance(node, pycrdt.XmlText):
        return "".join(chunk for chunk, _attributes in node.diff())
    return "".join(block_text(child) for child in node.children)
