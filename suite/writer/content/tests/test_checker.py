import json
import os
import re
import subprocess
import tempfile
from pathlib import Path
from unittest.mock import patch

import frappe
import pycrdt
from frappe.tests import UnitTestCase

from suite.content import checker

BUNDLE = Path(__file__).parents[1] / "dist" / "checker.cjs"


def paragraph(text: str) -> pycrdt.XmlElement:
    return pycrdt.XmlElement("paragraph", contents=[pycrdt.XmlText(text)])


def typed_rows(*edits) -> list[bytes]:
    doc = pycrdt.Doc()
    body = doc.get("default", type=pycrdt.XmlFragment)
    rows: list[bytes] = []
    doc.observe(lambda event: rows.append(event.update))
    for edit in edits:
        edit(body)

    return rows


def append_node(node):
    return lambda body: body.children.append(node)


def table_cell():
    return append_node(pycrdt.XmlElement("tableCell", contents=[paragraph("z")]))


class TestChecker(UnitTestCase):
    def setUp(self):
        if not checker.usable_node() or not BUNDLE.is_file():
            reason = f"needs Node {checker.NODE_MAJOR}+ and the built bundle at {BUNDLE}; run bench build"
            # A skip in CI would leave the job green with suspect documents never judged
            if os.environ.get("CI"):
                self.fail(reason)

            self.skipTest(reason)

        job_patch = patch.object(frappe.local, "job", frappe._dict(job_name="test_checker"), create=True)
        job_patch.start()
        self.addCleanup(job_patch.stop)

    def test_passes_rows_the_editor_can_hold(self):
        rows = typed_rows(append_node(paragraph("abc")), append_node(paragraph("def")))
        self.assertEqual(checker.judge(BUNDLE, None, rows), checker.Verdict(None))

    def test_names_a_table_cell_straight_in_the_body(self):
        rows = typed_rows(
            append_node(paragraph("abc")),
            append_node(paragraph("def")),
            table_cell(),
            append_node(paragraph("after")),
        )
        self.assertEqual(
            checker.judge(BUNDLE, None, rows),
            checker.Verdict(2, "schema: cannot place tableCell"),
        )

    def test_blames_a_checkpoint_that_holds_the_bad_content(self):
        checkpoint, *rows = typed_rows(table_cell(), append_node(paragraph("after")))
        self.assertEqual(checker.judge(BUNDLE, checkpoint, rows).index, -1)

    def test_names_a_row_yjs_cannot_read(self):
        readable_rows = typed_rows(append_node(paragraph("abc")))
        rows = [*readable_rows, b"\xff\xff\xff"]
        verdict = checker.judge(BUNDLE, None, rows)
        self.assertEqual(verdict.index, 1)
        self.assertTrue(verdict.reason.startswith("throws: "), verdict.reason)

    def test_names_a_bad_row_among_heavy_rows_on_a_large_checkpoint(self):
        doc = pycrdt.Doc()
        body = doc.get("default", type=pycrdt.XmlFragment)
        for _ in range(3000):
            body.children.append(paragraph("Lorem ipsum dolor sit amet " * 4))

        for edit in range(20000):
            text = body.children[edit * 7919 % 3000].children[0]
            if edit % 3:
                text.insert(edit * 31 % len(text), "x")
            else:
                del text[2:3]

        checkpoint = doc.get_update()
        bad_row = 41
        rows: list[bytes] = []
        for row in range(64):
            added = paragraph("row")
            if row == bad_row:
                added = pycrdt.XmlElement("tableCell", contents=[paragraph("z")])

            before = doc.get_state()
            with doc.transaction():
                body.children.append(added)
                del body.children[row * 13].children[0][3:5]

            # Each row carries the document's whole delete set, as one made against a state vector does
            rows.append(doc.get_update(before))

        self.assertGreater(min(map(len, rows)), 1000)
        self.assertEqual(
            checker.judge(BUNDLE, checkpoint, rows),
            checker.Verdict(bad_row, "schema: cannot place tableCell"),
        )

    def test_a_body_holds_the_rows_merged_into_it(self):
        rows = typed_rows(append_node(paragraph("abc")), append_node(paragraph("def")))
        body = pycrdt.merge_updates(*rows)
        self.assertTrue(checker.covers(BUNDLE, body, rows))

    def test_a_body_does_not_hold_a_row_after_it(self):
        rows = typed_rows(append_node(paragraph("abc")), append_node(paragraph("def")))
        self.assertFalse(checker.covers(BUNDLE, rows[0], rows))

    def test_a_body_does_not_hold_a_row_yjs_cannot_read(self):
        rows = typed_rows(append_node(paragraph("abc")))
        self.assertFalse(checker.covers(BUNDLE, rows[0], [b"\xff\xff\xff"]))

    def test_gives_no_cover_answer_without_node_24(self):
        rows = typed_rows(append_node(paragraph("abc")))
        with patch.object(checker, "node_version", return_value="v22.12.0"):
            self.assertIsNone(checker.covers(BUNDLE, rows[0], rows))

    def test_runs_only_in_background_jobs(self):
        with patch.object(frappe.local, "job", None):
            with self.assertRaises(RuntimeError):
                checker.judge(BUNDLE, None, [])

    def test_gives_no_verdict_without_node_24(self):
        for version in (None, "v22.12.0"):
            with patch.object(checker, "node_version", return_value=version):
                self.assertIsNone(checker.judge(BUNDLE, None, typed_rows(table_cell())))

    def test_gives_no_verdict_without_the_bundle(self):
        self.assertIsNone(checker.judge(BUNDLE.with_name("missing.cjs"), None, typed_rows(table_cell())))

    def test_runs_the_child_with_no_environment_files_or_processes(self):
        # macOS adds __CF_USER_TEXT_ENCODING to every process
        probe = """
        const tried = (run) => { try { run(); return 'allowed' } catch (error) { return error.code === 'ERR_ACCESS_DENIED' ? 'denied' : error.code } }
        const env = Object.keys(process.env).filter((key) => key !== '__CF_USER_TEXT_ENCODING')
        process.stdout.write(JSON.stringify({ verdict: 'bad', index: 0, reason: [
          `env ${env.length}`,
          `read ${tried(() => require('fs').readFileSync('/etc/hosts'))}`,
          `write ${tried(() => require('fs').writeFileSync(require('os').tmpdir() + '/checker-probe', 'x'))}`,
          `spawn ${tried(() => require('child_process').execFileSync('ls'))}`,
        ].join(', ') }))
        """
        with tempfile.TemporaryDirectory() as folder:
            bundle = Path(folder) / "probe.cjs"
            bundle.write_text(probe)
            with patch.dict(os.environ, {"SUITE_CHECKER_SECRET": "x"}):
                reason = checker.judge(bundle, None, [b"x"]).reason

        self.assertEqual(reason, "env 0, read denied, write denied, spawn denied")

    def test_a_reason_keeps_no_document_text(self):
        folder = self.enterContext(tempfile.TemporaryDirectory())
        for name, reason, expected in (
            ("quoted", 'throws: Error: unexpected "secret words" here', "throws: Error: unexpected"),
            (
                "node",
                "schema: RangeError: Invalid content for node doc: <paragraph(secret)>",
                "schema: RangeError: Invalid content for node doc:",
            ),
            ("long", "x" * 200, "x" * 80),
        ):
            bundle = Path(folder) / f"{name}.cjs"
            quoted_reason = json.dumps(reason)
            source = f"process.stdout.write(JSON.stringify({{ verdict: 'bad', index: 0, reason: {quoted_reason} }}))"
            bundle.write_text(source)
            with self.subTest(name):
                self.assertEqual(checker.judge(bundle, None, [b"x"]).reason, expected)

        bundle = Path(folder) / "loud.cjs"
        bundle.write_text("process.stderr.write('Error: <p>secret words</p>\\n'); process.exit(3)")
        with self.assertRaises(checker.CheckerFailed) as failed:
            checker.judge(bundle, None, [])

        self.assertEqual(str(failed.exception), "exit 3: Error:")

    def test_the_bundle_needs_only_crypto_and_drops_the_network_globals(self):
        bundle_source = BUNDLE.read_text()
        required = set(re.findall(r'\brequire\("([^"$]+)"\)', bundle_source))
        node_imports = set(re.findall(r"[\"'`](node:[\w/]+)", bundle_source))
        self.assertEqual(required, {"node:crypto"})
        self.assertEqual(node_imports, {"node:crypto"})

        bundle = BUNDLE.resolve()
        quoted_bundle = json.dumps(str(bundle))
        probe = f"""
        require({quoted_bundle})
        const names = ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest']
        process.stdout.write(JSON.stringify(names.filter((name) => name in globalThis)) + '\\n')
        """
        completed = subprocess.run(
            [checker.usable_node(), "--permission", f"--allow-fs-read={bundle}", "--expose-gc", "-e", probe],
            input=checker.framed([b'{"mode": "judge"}', b""]),
            capture_output=True,
            check=True,
        )
        exposed_globals, verdict_line = completed.stdout.decode().splitlines()
        verdict_name = json.loads(verdict_line)["verdict"]
        self.assertEqual((exposed_globals, verdict_name), ("[]", "clean"))

    def test_the_bundle_runs_the_yjs_the_browsers_get(self):
        lockfile = (Path(__file__).parents[4] / "yarn.lock").read_text()
        locked = set(re.findall(r'^"?yjs@[^\n]*\n\s+version "([^"]+)"', lockfile, re.M))
        completed = subprocess.run(
            checker.node_command(checker.usable_node(), BUNDLE),
            input=checker.framed([b'{"mode": "judge"}', b""]),
            capture_output=True,
            check=True,
        )
        bundled_yjs = json.loads(completed.stdout)["yjs"]
        self.assertEqual({bundled_yjs}, locked)

    def test_the_bundle_refuses_a_request_cut_inside_its_last_row(self):
        rows = typed_rows(append_node(paragraph("abc")), append_node(paragraph("def")))
        request = checker.framed([b'{"mode": "judge"}', b"", *rows])
        completed = subprocess.run(
            checker.node_command(checker.usable_node(), BUNDLE), input=request[:-1], capture_output=True
        )
        self.assertEqual((completed.returncode, completed.stdout), (1, b""))

    def test_a_child_that_hangs_or_crashes_fails_loudly(self):
        folder = self.enterContext(tempfile.TemporaryDirectory())
        for name, source in (("hang", "setInterval(() => {}, 1000)"), ("crash", "process.exit(3)")):
            bundle = Path(folder) / f"{name}.cjs"
            bundle.write_text(source)
            with (
                self.subTest(name),
                patch.object(checker, "TIMEOUT_S", 2),
                self.assertRaises(checker.CheckerFailed),
            ):
                checker.judge(bundle, None, [])
