"""The collaboration self-test: run as an RQ job on the compaction queue, so it speaks for the workers that compact.

It compacts a fixture with pycrdt and checks the result against a document
whose content, state vector and delete set are known, then records the
platform facts collaboration depends on. Each fact is read on its own, and one
that can't be read is recorded as absent.
"""

import json
import os
import shutil
import subprocess

import frappe
import pycrdt
from frappe.utils import now_datetime, sbool

from suite.suite_core.content import compaction
from suite.suite_core.content.scheduling import enqueue

ROOTS = {"default": pycrdt.XmlFragment, "meta": pycrdt.Map}
# Two people edit one paragraph at once; one renames the first tab
EXPECTED_TEXT = "<paragraph>Oh, Hello there 😀</paragraph>"
EXPECTED_CLOCKS = {1: 22, 2: 4}
EXPECTED_DELETED = {1: [(8, 5)]}
DATABASE_VARIABLES = (
    "innodb_flush_log_at_trx_commit",
    "sync_binlog",
    "version",
    "tx_isolation",
    "transaction_isolation",
    "max_allowed_packet",
)


@frappe.whitelist(methods=["POST"])
def run_self_test() -> None:
    frappe.only_for("System Manager")
    enqueue("suite.suite_core.content.selftest.self_test", "suite-collab-self-test")


def self_test() -> dict:
    report = {
        "pycrdt": pycrdt.__version__,
        "compaction": compaction_check(),
        "node": node_version(),
        "database": {name: database_variable(name) for name in DATABASE_VARIABLES},
        "cgroup_readable": all(
            os.access(f"/sys/fs/cgroup/{name}", os.R_OK) for name in ("memory.max", "memory.stat")
        ),
        "nofork": bool(sbool(os.environ.get("FRAPPE_BACKGROUND_WORKERS_NOFORK", False))),
    }
    passed = report["pycrdt"] == compaction.PYCRDT_VERSION and report["compaction"] == "pass"
    settings = {
        "self_test_at": now_datetime(),
        "self_test_passed": int(passed),
        "self_test_report": json.dumps(report, indent=1, ensure_ascii=False),
    }
    frappe.db.set_single_value("Suite Collab Settings", settings)
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    return report


def fixture_rows() -> list[bytes]:
    rows = []
    first_writer: pycrdt.Doc = pycrdt.Doc(client_id=1)
    first_writer.observe(lambda event: rows.append(event.update))
    first_fragment = first_writer.get("default", type=pycrdt.XmlFragment)
    paragraph = first_fragment.children.append(pycrdt.XmlElement("paragraph"))
    text = paragraph.children.append(pycrdt.XmlText())
    text.insert(0, "Hello world 😀")

    second_writer: pycrdt.Doc = pycrdt.Doc(client_id=2)
    second_writer.apply_update(first_writer.get_update())
    second_writer.observe(lambda event: rows.append(event.update))
    second_fragment = second_writer.get("default", type=pycrdt.XmlFragment)
    second_text = second_fragment.children[0].children[0]
    second_text.insert(0, "Oh, ")

    del text[6:11]
    text.insert(6, "there")
    first_writer.get("meta", type=pycrdt.Map)["firstTabLabel"] = "Notes"
    return rows


def compaction_check() -> str:
    try:
        compacted = compaction.compact(None, fixture_rows(), ROOTS)
    except compaction.CompactionFailed as error:
        return error.reason

    if not compacted.integrated:
        return "fallback"

    doc = compaction.load_doc([compacted.state])
    actual = (
        str(doc.get("default", type=pycrdt.XmlFragment)),
        doc.get("meta", type=pycrdt.Map).to_py(),
        compaction.vector_and_deletes(doc),
    )
    expected = (EXPECTED_TEXT, {"firstTabLabel": "Notes"}, (EXPECTED_CLOCKS, EXPECTED_DELETED))
    if actual != expected:
        return "content_mismatch"

    return "pass"


def node_version() -> str | None:
    """Node is optional; it only judges suspect documents and cross-checks retention."""
    node_path = shutil.which("node")
    if not node_path:
        return None

    try:
        completed = subprocess.run(
            [node_path, "--version"], capture_output=True, text=True, timeout=10, check=True
        )
        return completed.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None


def database_variable(name: str):
    try:
        return frappe.db.sql(f"SELECT @@{name}")[0][0]
    except Exception:
        return "absent"
