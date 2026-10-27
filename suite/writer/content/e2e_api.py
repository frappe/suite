"""Collab hooks for the Playwright suites: turn collaboration on, compact now, and read a log back."""

import json
from typing import cast

import frappe
import pycrdt
from frappe.tests.utils import whitelist_for_tests

from suite import content
from suite.content import (
    capacity,
    compaction,
    conversions,
    jobs,
    logged,
    quarantine,
    scheduling,
    suspect,
    trimming,
)
from suite.content.checkpoints import replace_start
from suite.content.log import create, set_mode
from suite.content.tables import KINDS, table
from suite.writer import content as writer_content


def find_log(node: str) -> dict:
    """Answer `node`'s collab log row, refusing a node that has none."""
    log_row = content.find(writer_content.APP, node)
    if log_row is None:
        raise frappe.DoesNotExistError(f"{node} has no collab log")

    return log_row


@whitelist_for_tests(methods=["POST"])
def enable_collab(node: str) -> dict:
    """Turn Writer's collaboration on and make `node`'s Writer document collaborative."""
    set_mode(writer_content.APP, "on")
    frappe.db.set_value("Writer Document", {"node": node}, "collab", 1)
    if content.find(writer_content.APP, node) is None:
        create(writer_content.APP, node)

    frappe.db.commit()
    return state(node)


@whitelist_for_tests(methods=["POST"])
def compact_now(node: str) -> dict:
    """Compact `node`'s collab log in this request, as the queued job would."""
    doc_id = find_log(node)["id"]
    jobs.compact(writer_content.APP, doc_id)
    return state(node)


@whitelist_for_tests(methods=["POST"])
def trim_now(node: str) -> dict:
    """Age `node`'s edit rows past the evidence window and queue its trimming, as the hourly run would."""
    doc_id = find_log(node)["id"]
    update_table = table(writer_content.APP, "update")
    frappe.db.sql(
        f"""UPDATE `{update_table}`
        SET `created` = `created` - INTERVAL 25 HOUR WHERE `doc_id` = %s""",
        doc_id,
    )
    frappe.db.commit()
    frappe.enqueue(
        trimming.trim,
        queue="long",
        app=writer_content.APP,
        doc_id=doc_id,
        part_map=writer_content.PART_MAP,
        bundle=writer_content.CHECKER_BUILD,
    )
    return state(node)


@whitelist_for_tests(methods=["POST"])
def age_copy(node: str) -> int:
    """Make `node`'s readable copy a minute old, so the next push asks for a render; answer its rev."""
    doc_id = find_log(node)["id"]
    projection_table = table(writer_content.APP, "projection")
    frappe.db.sql(
        f"""UPDATE `{projection_table}`
        SET `updated` = `updated` - INTERVAL 1 MINUTE WHERE `doc_id` = %s""",
        doc_id,
    )
    frappe.db.commit()
    ((projected_rev,),) = frappe.db.sql(
        f"SELECT COALESCE(MAX(`projected_rev`), 0) FROM `{projection_table}` WHERE `doc_id` = %s", doc_id
    )
    return projected_rev


@whitelist_for_tests(methods=["GET", "POST"])
def trimmed_rev(node: str) -> int:
    """Answer the rev through which `node`'s edit rows may be gone."""
    return int(find_log(node)["trimmed_rev"])


@whitelist_for_tests(methods=["POST"])
def hold(node: str, why: str) -> dict:
    """Hold `node` for an admin, as a judge that can't settle a compaction's suspect does."""
    doc_id = find_log(node)["id"]
    doc_table = table(writer_content.APP, "doc")
    frappe.db.sql(
        f"UPDATE `{doc_table}` SET `suspect` = 'unreadable' WHERE `id` = %s",
        doc_id,
    )
    suspect.hold_document(writer_content.APP, doc_id, why, "Held by the Playwright suite")
    return state(node)


@whitelist_for_tests(methods=["POST"])
def release(node: str) -> dict:
    """Clear `node`'s hold as an admin does from the suspect list."""
    doc_id = find_log(node)["id"]
    suspect.release(writer_content.APP, doc_id)
    return state(node)


@whitelist_for_tests(methods=["POST"])
def quarantine_last(node: str, why: str) -> dict:
    """Quarantine `node`'s last row, as a judge that finds it bad does."""
    log_row = find_log(node)
    revs = {int(log_row["head_rev"])}
    quarantine.quarantine(writer_content.APP, log_row["id"], revs, why)
    return state(node)


@whitelist_for_tests(methods=["POST"])
def leave_no_room(node: str) -> dict:
    """Count `node`'s state as big as the tail leaves room for, so its next adding push waits for a compaction."""
    doc_id = find_log(node)["id"]
    doc_table = table(writer_content.APP, "doc")
    frappe.db.sql(
        f"""UPDATE `{doc_table}` SET `state_bytes` = %s - `tail_bound` WHERE `id` = %s""",
        (capacity.STATE_MAX, doc_id),
    )
    return state(node)


@whitelist_for_tests(methods=["POST"])
def fill_up(node: str) -> dict:
    """Count `node`'s state as big as a document may be, so nothing that adds is taken again."""
    doc_id = find_log(node)["id"]
    doc_table = table(writer_content.APP, "doc")
    frappe.db.sql(
        f"""UPDATE `{doc_table}` SET `state_bytes` = %s WHERE `id` = %s""",
        (capacity.STATE_MAX, doc_id),
    )
    return state(node)


@whitelist_for_tests(methods=["POST"])
def write_newer_schema(node: str) -> dict:
    """Mark `node`'s rows as written from here on by an editor one schema newer, as its pushes would."""
    log_row = find_log(node)
    steps = json.loads(log_row["schema_steps"])
    next_rev = int(log_row["head_rev"]) + 1
    next_schema = steps[-1][1] + 1
    steps.append([next_rev, next_schema])
    steps_json = json.dumps(steps)
    doc_table = table(writer_content.APP, "doc")
    frappe.db.sql(
        f"UPDATE `{doc_table}` SET `schema_steps` = %s WHERE `id` = %s",
        (steps_json, log_row["id"]),
    )
    return state(node)


@whitelist_for_tests(methods=["POST"])
def make_old(node: str, html: str) -> None:
    """Make `node` an old Writer document holding `html`, with no log and no conversion record."""
    log_row = content.find(writer_content.APP, node)
    doc_id = (log_row or {}).get("id")
    keys = {"doc": ("id", doc_id), "conversion": ("node", node)}
    for kind in KINDS:
        column, value = keys.get(kind, ("doc_id", doc_id))
        if value is None:
            continue

        kind_table = table(writer_content.APP, kind)
        frappe.db.sql(f"DELETE FROM `{kind_table}` WHERE `{column}` = %s", value)

    old = {"content": None, "html": html, "collab": 0, "ycomments": None}
    frappe.db.set_value("Writer Document", {"node": node}, old, update_modified=False)
    if content.find(writer_content.APP, node) is not None:
        raise frappe.ValidationError(f"{node} still has a collab log")

    frappe.db.commit()


@whitelist_for_tests(methods=["POST"])
def convert_now(node: str) -> str | None:
    """Convert `node`'s old body in this request, as the queued conversion would; answer the outcome."""
    job = getattr(frappe.local, "job", None)
    try:
        # The converter runs only in background jobs
        frappe.local.job = frappe._dict(job_name="e2e convert_now")
        return conversions.convert_document(writer_content.APP, node)
    finally:
        frappe.local.job = job


@whitelist_for_tests(methods=["POST"])
def paragraph_change(node: str, client_id: int, length: int) -> dict:
    """Build the change a tab as `client_id` sends to add a paragraph of `length` letters to `node`."""
    live_state = logged.live_state(writer_content.APP, node)
    assert live_state is not None
    tab: pycrdt.Doc = pycrdt.Doc(client_id=int(client_id))
    live_update = live_state.get_update()
    tab.apply_update(live_update)
    state_before = tab.get_state()
    fragment = tab.get("default", type=pycrdt.XmlFragment)
    paragraph = fragment.children.append(pycrdt.XmlElement("paragraph"))
    text = paragraph.children.append(pycrdt.XmlText())
    text.insert(0, "x" * int(length))
    log_row = find_log(node)
    change = tab.get_update(state_before).hex()
    return {
        "change": change,
        "lineage": log_row["lineage"],
        "head_rev": int(log_row["head_rev"]),
    }


@whitelist_for_tests(methods=["POST"])
def start_code_and_bold(node: str) -> dict:
    """Start `node`'s log from a paragraph ending in text both code and bold, which the editor can't show at once."""
    start: pycrdt.Doc = pycrdt.Doc()
    fragment = start.get("default", type=pycrdt.XmlFragment)
    paragraph = fragment.children.append(pycrdt.XmlElement("paragraph"))
    text = paragraph.children.append(pycrdt.XmlText())
    text.insert(0, "plain ")
    text.insert(len("plain "), "both", {"code": {}, "bold": {}})
    log_row = find_log(node)
    replace_start(writer_content.APP, log_row["id"], start.get_update(), writer_content.DECLARED["schema"])
    frappe.db.commit()
    return state(node)


@whitelist_for_tests(methods=["GET", "POST"])
def block_runs(node: str) -> list[list]:
    """Read each of `node`'s top-level blocks as runs of text and formatting, as the server holds them."""
    fragment = stored_fragment(node)
    return [text_runs(cast(pycrdt.XmlElement, block)) for block in fragment.children]


def text_runs(block: pycrdt.XmlElement) -> list:
    """Join the runs of every text in `block`."""
    runs: list = []
    for text in block.children:
        runs.extend([chunk, attributes or {}] for chunk, attributes in cast(pycrdt.XmlText, text).diff())

    return runs


@whitelist_for_tests(methods=["GET", "POST"])
def state_bytes(node: str) -> int:
    """How big `node`'s compacted state is counted."""
    log_row = find_log(node)
    return int(log_row["state_bytes"])


@whitelist_for_tests(methods=["GET", "POST"])
def state(node: str) -> dict:
    """Where `node`'s collab log stands: its body, its head and the rows between."""
    doc_id = find_log(node)["id"]
    doc_table = table(writer_content.APP, "doc")
    rows = frappe.db.sql(
        f"""SELECT `body_rev`, `head_rev`, `tail_rows`
        FROM `{doc_table}` WHERE `id` = %s""",
        doc_id,
        as_dict=True,
    )
    row = rows[0]
    return {key: int(value) for key, value in row.items()}


@whitelist_for_tests(methods=["GET", "POST"])
def log_id(node: str) -> str:
    """Answer the id of `node`'s collab log."""
    return find_log(node)["id"]


@whitelist_for_tests(methods=["GET", "POST"])
def log_rows(log: str) -> dict:
    """How many rows each collab table holds for the log `log`, its control row included."""
    counts: dict[str, int] = {}
    # The conversion record is the node's, not the log's
    for kind in (kind for kind in KINDS if kind != "conversion"):
        key_column = "id" if kind == "doc" else "doc_id"
        kind_table = table(writer_content.APP, kind)
        ((row_count,),) = frappe.db.sql(
            f"SELECT COUNT(*) FROM `{kind_table}` WHERE `{key_column}` = %s",
            log,
        )
        counts[kind] = row_count

    return counts


@whitelist_for_tests(methods=["GET", "POST"])
def server_text(node: str) -> list[str]:
    """Read the text of each top-level block of `node` from the body and the rows after it."""
    fragment = stored_fragment(node)
    return [block_text(block) for block in fragment.children]


def stored_fragment(node: str) -> pycrdt.XmlFragment:
    """Load `node`'s body and the rows after it, and answer its editor fragment."""
    doc_id = find_log(node)["id"]
    stored = content.read(writer_content.APP, doc_id)
    if stored is None:
        raise frappe.DoesNotExistError(f"{node} has no collab log")

    parts: list[bytes] = []
    if stored.checkpoint:
        parts.append(stored.checkpoint)

    parts.extend(stored.payloads())
    loaded_doc = compaction.load_doc(parts)
    return loaded_doc.get("default", type=pycrdt.XmlFragment)


def block_text(node: pycrdt.XmlText | pycrdt.XmlElement | pycrdt.XmlFragment) -> str:
    """Join the text below `node`."""
    if isinstance(node, pycrdt.XmlText):
        return "".join(chunk for chunk, _attributes in node.diff())

    return "".join(block_text(child) for child in node.children)
