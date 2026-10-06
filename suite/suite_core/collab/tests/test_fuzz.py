import base64
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

from frappe.tests import UnitTestCase

from suite.suite_core.collab import ingest, updates

FUZZ = Path(__file__).parent / "differential" / "fuzz.cjs"
YJS = Path(__file__).parents[4] / "node_modules" / "yjs"
# About 26,000 generated and mutated pushes, about a second
SEED, SESSIONS = 1, 1000
MAX_FAILURES = 5

# Kept in step with the reasons the QA harness accepts for a row Yjs can read
LISTED = re.compile(
    "an empty row|another client|a gap in the writer|refused content|too large"
    "|unexpected end|integer out of range|clock out of range|trailing bytes|empty struct|empty delete range"
    "|nested too deep|not JSON|unknown (type|content|value tag)|a client appears twice"
)
EXPECTED = {
    "own": None,
    "merged": None,
    "gap": "a gap in the writer's clocks",
    "two writers": "written by another client",
    "binary": "refused content 3",
    "subdocument": "refused content 9",
}


def pair(ref: tuple[int, int] | None) -> list[int] | None:
    return list(ref) if ref else None


def summary(update: updates.Update) -> dict:
    """What the gate read from an update, in the shape fuzz.cjs reports Yjs's reading."""
    return {
        "structs": [
            [
                *(s.client, s.clock, s.length, s.kind),
                *(pair(s.origin), pair(s.right_origin), pair(s.parent)),
                *(s.type, s.node, s.format_key, s.names),
            ]
            for s in update.structs
        ],
        "deletes": sorted(
            [client, [list(r) for r in ranges]] for client, ranges in update.deletes.items() if ranges
        ),
    }


class TestGateAgainstYjs(UnitTestCase):
    def setUp(self):
        node = shutil.which("node")
        if not node:
            self.missing("node is not installed, so Yjs can't judge the gate")
        if not YJS.is_dir():
            self.missing(f"Yjs is not installed at {YJS}; run yarn at the repo root")
        self.node = node

    def missing(self, reason: str):
        # A skip in CI would leave the job green with the gate unchecked
        if os.environ.get("CI"):
            self.fail(reason)
        self.skipTest(reason)

    def test_the_gate_takes_only_rows_yjs_reads_the_same_way(self):
        lines = subprocess.run(
            [self.node, str(FUZZ), str(SEED), str(SESSIONS)],
            capture_output=True,
            text=True,
            timeout=60,
            check=True,
        ).stdout.splitlines()
        self.assertGreater(len(lines), 20000)
        # The run stops at the first few failures, so a broken gate fails fast in bounded memory
        failures = []
        for line in lines:
            item = json.loads(line)
            problem = judge(item)
            if problem:
                failures.append(f"{item['case']} cid={item['cid']} {item['update']}: {problem}")
                if len(failures) == MAX_FAILURES:
                    break
        self.assertFalse(failures, "\n".join(failures))


def judge(item: dict) -> str | None:
    """What is wrong with the gate's answer to one generated push, or None."""
    read = item["yjs"]
    if read:
        read["deletes"] = sorted(read["deletes"])
    expected = EXPECTED.get(item["case"])
    try:
        row = ingest.check(base64.b64decode(item["update"]), item["cid"])
    except ValueError as refusal:
        if item["case"] in ("own", "merged"):
            return f"a tab's own update was refused: {refusal}"
        if expected and str(refusal) != expected:
            return f"refused for {refusal}, not {expected}"
        if not expected and read and not LISTED.search(str(refusal)):
            return f"refused for an unlisted reason: {refusal}"
        return None
    if expected:
        return "a row the gate must refuse passed"
    if not read:
        return "the gate passed a row Yjs can't read"
    if summary(row.update) != read:
        return "the gate read it differently from Yjs"
    for client, clock, length, kind, *_refs in read["structs"]:
        if client != item["cid"] or kind in {2, 3, 9, 10} or clock + length > updates.MAX_SAFE:
            return f"passed a struct ({client}, {clock}, {length}, kind {kind})"
    return None
