import base64
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

from frappe.tests import UnitTestCase

from suite.content import ingest, updates

FUZZ_SCRIPT = Path(__file__).parent / "differential" / "fuzz.cjs"
YJS = Path(__file__).parents[3] / "node_modules" / "yjs"
# About 26,000 generated and mutated pushes, about a second
SEED = 1
SESSIONS = 1000
MAX_FAILURES = 5

# Kept in step with the reasons the QA harness accepts for a row Yjs can read
LISTED_REASONS = re.compile(
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


def id_list(ref: tuple[int, int] | None) -> list[int] | None:
    if not ref:
        return None

    return list(ref)


def gate_reading(update: updates.Update) -> dict:
    structs: list[list] = []
    for struct in update.structs:
        structs.append(
            [
                *(struct.client, struct.clock, struct.length, struct.kind),
                *(id_list(struct.origin), id_list(struct.right_origin), id_list(struct.parent)),
                *(struct.type, struct.node, struct.format_key, struct.names),
            ]
        )

    deletes: list[list] = []
    for client, ranges in update.deletes.items():
        if ranges:
            deletes.append([client, [list(span) for span in ranges]])

    return {
        "structs": structs,
        "deletes": sorted(deletes),
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
        completed = subprocess.run(
            [self.node, str(FUZZ_SCRIPT), str(SEED), str(SESSIONS)],
            capture_output=True,
            text=True,
            timeout=60,
            check=True,
        )
        lines = completed.stdout.splitlines()
        self.assertGreater(len(lines), 20000)

        # The run stops at the first few failures, so a broken gate fails fast in bounded memory
        failures: list[str] = []
        for line in lines:
            generated_push = json.loads(line)
            problem = gate_problem(generated_push)
            if not problem:
                continue

            failures.append(
                f"{generated_push['case']} cid={generated_push['cid']} {generated_push['update']}: {problem}"
            )
            if len(failures) == MAX_FAILURES:
                break

        self.assertFalse(failures, "\n".join(failures))


def refusal_problem(
    refusal: ValueError, *, case: str, expected: str | None, yjs_reading: dict | None
) -> str | None:
    if case in {"own", "merged"}:
        return f"a tab's own update was refused: {refusal}"

    if expected and str(refusal) != expected:
        return f"refused for {refusal}, not {expected}"

    if not expected and yjs_reading and not LISTED_REASONS.search(str(refusal)):
        return f"refused for an unlisted reason: {refusal}"

    return None


def gate_problem(generated_push: dict) -> str | None:
    yjs_reading = generated_push["yjs"]
    if yjs_reading:
        yjs_reading["deletes"] = sorted(yjs_reading["deletes"])

    case = generated_push["case"]
    expected = EXPECTED.get(case)
    try:
        pushed = base64.b64decode(generated_push["update"])
        row = ingest.check_row(pushed, generated_push["cid"])
    except ValueError as refusal:
        return refusal_problem(refusal, case=case, expected=expected, yjs_reading=yjs_reading)

    if expected:
        return "a row the gate must refuse passed"

    if not yjs_reading:
        return "the gate passed a row Yjs can't read"

    if gate_reading(row.update) != yjs_reading:
        return "the gate read it differently from Yjs"

    for client, clock, length, kind, *_refs in yjs_reading["structs"]:
        another_client = client != generated_push["cid"]
        refused_kind = kind in {2, 3, 9, 10}
        past_safe_clock = clock + length > updates.MAX_SAFE_INTEGER
        if another_client or refused_kind or past_safe_clock:
            return f"passed a struct ({client}, {clock}, {length}, kind {kind})"

    return None
