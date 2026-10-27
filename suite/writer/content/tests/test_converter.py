import base64
import json
import os
import re
import socket
import subprocess
import tempfile
from pathlib import Path
from unittest.mock import patch

import frappe
import pycrdt
from frappe.tests import UnitTestCase

from suite.content import checker, convert
from suite.writer import content as writer_content

# Node's own modules the bundle loads; a new one, above all a network one, should be seen in review
BUILTINS = {
    *("crypto", "events", "fs", "os", "path", "stream", "url", "util", "vm", "zlib"),
    *("node:assert", "node:async_hooks", "node:buffer", "node:console", "node:crypto"),
    *("node:diagnostics_channel", "node:dns", "node:events", "node:fs", "node:fs/promises"),
    *("node:http", "node:http2", "node:net", "node:path", "node:perf_hooks", "node:querystring"),
    *("node:sqlite", "node:stream", "node:timers", "node:tls", "node:url", "node:util"),
    *("node:util/types", "node:vm", "node:worker_threads", "node:zlib"),
}


def converted(html: str | None = None, content: str | None = None):
    legacy = {"content": content, "html": html, "collab": int(bool(content)), "ycomments": None}
    return convert.convert(writer_content.CONVERTER_BUILD, writer_content.CONVERTER_VERSION, legacy)


def body_of(result: convert.Converted) -> str:
    doc = pycrdt.Doc()
    doc.apply_update(result.state)
    return str(doc.get("default", type=pycrdt.XmlFragment))


def connected(listener: socket.socket) -> bool:
    try:
        connection, _ = listener.accept()
    except TimeoutError:
        return False

    connection.close()
    return True


class TestConverter(UnitTestCase):
    def setUp(self):
        if not checker.usable_node(convert.NODE_MIN) or not writer_content.CONVERTER_BUILD.is_file():
            minimum = ".".join(map(str, convert.NODE_MIN))
            reason = f"needs Node {minimum}+ and the built bundle at {writer_content.CONVERTER_BUILD}; run bench build"
            # A skip in CI would leave the job green with a converter that can't run
            if os.environ.get("CI"):
                self.fail(reason)

            self.skipTest(reason)

        job_patch = patch.object(frappe.local, "job", frappe._dict(job_name="test_converter"), create=True)
        job_patch.start()
        self.addCleanup(job_patch.stop)

    def test_the_built_bundle_holds_the_version_the_server_expects(self):
        self.assertTrue(
            convert.bundle_ready(writer_content.CONVERTER_BUILD, writer_content.CONVERTER_VERSION)
        )

    def test_refuses_a_bundle_with_another_version_or_none(self):
        folder = self.enterContext(tempfile.TemporaryDirectory())
        for name, source in (
            ("stale", "process.stdout.write(JSON.stringify({ version: '0' }))"),
            ("unversioned", "process.stdout.write(JSON.stringify({}))"),
        ):
            bundle = Path(folder) / f"{name}.cjs"
            bundle.write_text(source)
            with self.subTest(name):
                self.assertFalse(convert.bundle_ready(bundle, "1"))

    def test_runs_on_node_22_13_and_newer_where_the_checker_needs_24(self):
        for version, converter_runs, checker_runs in (
            ("v22.12.0", False, False),
            ("v22.9.0", False, False),
            ("v22.13.0", True, False),
            ("v23.0.0", True, False),
            ("v24.0.0", True, True),
        ):
            with self.subTest(version), patch.object(checker, "node_version", return_value=version):
                runs = (bool(checker.usable_node(convert.NODE_MIN)), bool(checker.usable_node()))
                self.assertEqual(runs, (converter_runs, checker_runs))

    def test_refuses_a_missing_bundle(self):
        missing = writer_content.CONVERTER_BUILD.with_name("missing.cjs")
        self.assertFalse(convert.bundle_ready(missing, writer_content.CONVERTER_VERSION))

    def test_converts_an_html_body_into_the_editor_state(self):
        result = converted(html="<p>Hello</p>")
        self.assertEqual((result.source, result.dropped), ("html", []))
        self.assertEqual(body_of(result), "<paragraph>Hello</paragraph>")

    def test_converts_an_old_yjs_body(self):
        old = pycrdt.Doc()
        old.get("default", type=pycrdt.XmlFragment).children.append(
            pycrdt.XmlElement("paragraph", contents=[pycrdt.XmlText("Hi")])
        )
        content = base64.b64encode(old.get_update()).decode()

        result = converted(content=content)

        self.assertEqual(result.source, "yjs")
        self.assertEqual(body_of(result), "<paragraph>Hi</paragraph>")

    def test_reads_an_unlabelled_tag_from_its_words(self):
        result = converted(html='<p><span class="tag-item">#plan</span></p>')
        self.assertEqual(result.dropped, [])
        self.assertEqual(body_of(result), '<paragraph><tagItem tagLabel="plan"></tagItem></paragraph>')

    def test_the_bundle_loads_only_the_node_modules_pinned_here(self):
        bundle_source = writer_content.CONVERTER_BUILD.read_text()
        required = set(re.findall(r'\brequire\("([^"$]+)"\)', bundle_source))
        self.assertEqual(required, BUILTINS)

    def test_the_bundle_drops_the_network_globals(self):
        bundle = writer_content.CONVERTER_BUILD.resolve()
        quoted_bundle = json.dumps(str(bundle))
        probe = f"""
        require({quoted_bundle})
        const names = ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest']
        const exposed = names.filter((name) => name in globalThis || name in globalThis.window)
        process.stdout.write(JSON.stringify(exposed) + '\\n')
        """
        completed = subprocess.run(
            [checker.usable_node(convert.NODE_MIN), "--permission", f"--allow-fs-read={bundle}", "-e", probe],
            input=checker.framed([b"{}"]),
            capture_output=True,
            check=True,
        )
        exposed_globals, version_line = completed.stdout.decode().splitlines()
        self.assertEqual(
            (exposed_globals, json.loads(version_line)), ("[]", {"version": writer_content.CONVERTER_VERSION})
        )

    def test_loads_nothing_an_old_body_points_at(self):
        listener = self.enterContext(socket.create_server(("127.0.0.1", 0)))
        listener.settimeout(0.5)
        _, port = listener.getsockname()
        url = f"http://127.0.0.1:{port}/x"

        for name, html, refusal in (
            ("image", f'<p>a</p><img src="{url}">', None),
            # Before any text the parser puts these in the head, where the editor never looks
            ("stylesheet in the head", f'<link rel="stylesheet" href="{url}"><p>a</p>', None),
            ("script in the head", f'<script src="{url}"></script><p>a</p>', None),
            ("stylesheet in the body", f'<p>a</p><link rel="stylesheet" href="{url}">', "check"),
            ("script in the body", f'<p>a</p><script src="{url}"></script>', "check"),
        ):
            with self.subTest(name):
                result = converted(html=html)
                self.assertEqual((getattr(result, "reason", None), connected(listener)), (refusal, False))

        # The same listener sees a child that does connect, so the checks above can fail
        folder = self.enterContext(tempfile.TemporaryDirectory())
        bundle = Path(folder) / "connects.cjs"
        bundle.write_text(
            f"require('net').connect({port}, '127.0.0.1', () => process.stdout.write('{{}}')).unref()"
        )
        self.assertEqual(checker.ask(bundle, {}, minimum=convert.NODE_MIN), {})
        self.assertTrue(connected(listener))
