import os
import tempfile
from pathlib import Path
from unittest.mock import patch

import frappe
import pycrdt
from frappe.tests import UnitTestCase

from suite.suite_core.collab import kernel

BUNDLE = Path(__file__).parents[1] / "dist" / "kernel.cjs"


def paragraph(text: str) -> pycrdt.XmlElement:
    return pycrdt.XmlElement("paragraph", contents=[pycrdt.XmlText(text)])


def typed(*edits) -> list[bytes]:
    """One row per edit to the body, as a tab pushes them."""
    doc = pycrdt.Doc()
    body = doc.get("default", type=pycrdt.XmlFragment)
    rows = []
    doc.observe(lambda event: rows.append(event.update))
    for edit in edits:
        edit(body)
    return rows


def append(node):
    return lambda body: body.children.append(node)


def table_cell():
    return append(pycrdt.XmlElement("tableCell", contents=[paragraph("z")]))


class TestKernel(UnitTestCase):
    def setUp(self):
        if not kernel.usable_node() or not BUNDLE.is_file():
            reason = f"needs Node {kernel.NODE_MAJOR}+ and the built bundle at {BUNDLE}; run bench build"
            # A skip in CI would leave the job green with suspect documents never judged
            if os.environ.get("CI"):
                self.fail(reason)
            self.skipTest(reason)
        job = patch.object(frappe.local, "job", frappe._dict(job_name="test_kernel"), create=True)
        job.start()
        self.addCleanup(job.stop)

    def test_passes_rows_the_editor_can_hold(self):
        rows = typed(append(paragraph("abc")), append(paragraph("def")))
        self.assertEqual(kernel.judge(BUNDLE, None, rows), kernel.Verdict(None))

    def test_names_a_table_cell_straight_in_the_body(self):
        rows = typed(
            append(paragraph("abc")), append(paragraph("def")), table_cell(), append(paragraph("after"))
        )
        verdict = kernel.judge(BUNDLE, None, rows)
        self.assertEqual(verdict.index, 2)
        self.assertTrue(
            verdict.reason.startswith("schema: RangeError: Invalid content for node doc"), verdict.reason
        )

    def test_blames_a_checkpoint_that_holds_the_bad_content(self):
        checkpoint, *rows = typed(table_cell(), append(paragraph("after")))
        self.assertEqual(kernel.judge(BUNDLE, checkpoint, rows).index, -1)

    def test_names_a_row_yjs_cannot_read(self):
        rows = [*typed(append(paragraph("abc"))), b"\xff\xff\xff"]
        verdict = kernel.judge(BUNDLE, None, rows)
        self.assertEqual(verdict.index, 1)
        self.assertTrue(verdict.reason.startswith("throws: "), verdict.reason)

    def test_runs_only_in_background_jobs(self):
        with patch.object(frappe.local, "job", None):
            with self.assertRaises(RuntimeError):
                kernel.judge(BUNDLE, None, [])

    def test_gives_no_verdict_without_node_24(self):
        for version in (None, "v22.12.0"):
            with patch.object(kernel, "node_version", return_value=version):
                self.assertIsNone(kernel.judge(BUNDLE, None, typed(table_cell())))

    def test_gives_no_verdict_without_the_bundle(self):
        self.assertIsNone(kernel.judge(BUNDLE.with_name("missing.cjs"), None, typed(table_cell())))

    def test_runs_the_child_with_no_environment_files_or_processes(self):
        probe = """
        const tried = (run) => { try { run(); return 'allowed' } catch (error) { return error.code } }
        process.stdout.write(JSON.stringify({ verdict: 'bad', index: 0, reason: JSON.stringify({
          env: Object.keys(process.env),
          read: tried(() => require('fs').readFileSync('/etc/hosts')),
          write: tried(() => require('fs').writeFileSync(require('os').tmpdir() + '/kernel-probe', 'x')),
          spawn: tried(() => require('child_process').execFileSync('ls')),
        }) }))
        """
        with tempfile.TemporaryDirectory() as folder:
            bundle = Path(folder) / "probe.cjs"
            bundle.write_text(probe)
            with patch.dict(os.environ, {"SUITE_KERNEL_SECRET": "x"}):
                found = frappe.parse_json(kernel.judge(bundle, None, []).reason)
        # macOS adds __CF_USER_TEXT_ENCODING to every process
        self.assertEqual(set(found.env) - {"__CF_USER_TEXT_ENCODING"}, set())
        self.assertEqual(
            (found.read, found.write, found.spawn),
            ("ERR_ACCESS_DENIED", "ERR_ACCESS_DENIED", "ERR_ACCESS_DENIED"),
        )

    def test_a_child_that_hangs_or_crashes_fails_loudly(self):
        with tempfile.TemporaryDirectory() as folder:
            for name, source in (("hang", "setInterval(() => {}, 1000)"), ("crash", "process.exit(3)")):
                bundle = Path(folder) / f"{name}.cjs"
                bundle.write_text(source)
                with self.subTest(name), patch.object(kernel, "TIMEOUT_S", 2):
                    with self.assertRaises(kernel.KernelFailed):
                        kernel.judge(bundle, None, [])
