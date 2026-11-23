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
from frappe.utils import now_datetime

from suite.content import admission, compaction, db
from suite.content.scheduling import enqueue

PART_MAP = {"default": pycrdt.XmlFragment, "meta": pycrdt.Map}
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
CGROUP_PATHS = ("/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory.stat")


@frappe.whitelist(methods=["POST"])
def run_self_test() -> None:
    """Queue the self-test on the compaction queue, for a System Manager."""
    frappe.only_for("System Manager")
    enqueue("suite.content.selftest.self_test", "suite-collab-self-test")


def self_test() -> dict:
    """Run the self-test, record its report on the collab settings and answer it."""
    from suite.content import checker

    report = {
        "pycrdt": pycrdt.__version__,
        "compaction": compaction_check(),
        "node": node_version(),
        "node_checks": checker.usable_node() is not None,
        "database": {name: database_variable(name) for name in DATABASE_VARIABLES},
        "cgroup_readable": all(os.access(path, os.R_OK) for path in CGROUP_PATHS),
        "nofork": not admission.forked_for_job(),
    }
    passed = self_test_fault() is None
    settings = {
        "self_test_at": now_datetime(),
        "self_test_passed": int(passed),
        "self_test_report": json.dumps(report, indent=1, ensure_ascii=False),
    }
    frappe.db.set_single_value("Suite Collab Settings", settings)
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    return report


def self_test_fault() -> str | None:
    """Name why compaction fails here, a pycrdt other than the pinned one or a wrong fixture result, or None."""
    if pycrdt.__version__ != compaction.PYCRDT_VERSION:
        return f"pycrdt {pycrdt.__version__}, expected {compaction.PYCRDT_VERSION}"

    result = compaction_check()
    return None if result == "pass" else result


def fixture_rows() -> list[bytes]:
    """Build the fixture's rows in the order its two writers made them."""
    rows: list[bytes] = []
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
    """Compact the fixture and answer `pass`, or why its result differs from the known document."""
    try:
        compacted = compaction.compact(None, fixture_rows(), PART_MAP)
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


def database_variable(name: str) -> str | int:
    """Load a database variable for the report, `absent` when the server has none by that name."""
    value = db.load_system_variable(name)
    if value is None:
        return "absent"

    return value
