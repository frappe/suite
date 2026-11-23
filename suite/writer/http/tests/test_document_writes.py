import os
import re
import tempfile
import uuid
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

import frappe
import pycrdt
from bs4 import BeautifulSoup
from frappe.utils import now_datetime
from frappe.utils.synchronization import filelock

from suite import drive
from suite.content import capacity, checker, convert, steps
from suite.content.http import routes
from suite.tests.utils import ensure_user
from suite.writer import content as writer_content
from suite.writer import drive as writer_drive
from suite.writer.content import converter
from suite.writer.content.markdown import MarkdownRefused, WriteBusy, WriteRefused
from suite.writer.content.tests.drive_callback_case import (
    DriveCallbackCase,
    embed,
    share_as_writer,
)
from suite.writer.content.tests.support import OUTSIDER, READER, WRITER, call_route, read_open
from suite.writer.http import routes as writer_routes


class TestDocumentWrites(DriveCallbackCase):
    def setUp(self):
        super().setUp()
        if not checker.usable_node(convert.NODE_MIN) or not writer_content.CONVERTER_BUILD.is_file():
            reason = f"needs Node and the built bundle at {writer_content.CONVERTER_BUILD}; run bench build"
            # A skip in CI would leave the job green with agents unable to write
            if os.environ.get("CI"):
                self.fail(reason)

            self.skipTest(reason)

        root = drive.ensure_personal_root(WRITER)
        self.folder = frappe.db.get_value("Drive Root", root, "node")

    def create(self, markdown: str) -> str:
        written = writer_routes.document_create(self.folder, f"Agent {uuid.uuid4().hex[:8]}", markdown)
        self.addCleanup(self.delete_document, written["node"])
        self.addCleanup(self.delete_log, written["node"])
        return written["node"]

    def body_of(self, node: str) -> str:
        # The body as a tab opening the document gets it
        frame = read_open(call_route(routes.document_get, node).get_data())
        doc: pycrdt.Doc = pycrdt.Doc()
        for payload in [frame.checkpoint, *(payload for _rev, payload in frame.rows)]:
            if payload:
                doc.apply_update(payload)

        return str(doc.get("default", type=pycrdt.XmlFragment))

    def answer_of(self, refusal: Exception) -> dict:
        # What the answer publishes of a refusal: the one message stamped with the error's id
        stamp = getattr(refusal, "__frappe_exc_id", None)
        self.assertTrue(stamp)
        (answer,) = (entry for entry in frappe.local.message_log if entry.get("__frappe_exc_id") == stamp)
        return answer

    def blocks_of(self, node: str) -> str:
        # The body without the ids the editor gives headings
        return re.sub(r' (id|data-toc-id)="[^"]*"', "", self.body_of(node))

    def markdown_of(self, node: str) -> str:
        # The document as Drive's content route asks Writer for it
        docname = frappe.db.get_value(writer_drive.DOCTYPE, {"node": node})
        stream, _mime = writer_drive.SPEC.export(docname, "markdown")
        return stream.read().decode()

    def failing_converter(self, script: str):
        # A bundle whose child fails as a real one does
        bundle = Path(self.enterContext(tempfile.TemporaryDirectory())) / "converter.cjs"
        bundle.write_text(script)
        return patch.object(converter, "CONVERTER_BUILD", bundle)

    def test_a_new_document_holds_the_markdown(self):
        node = self.create("# Plan\n\nShip **today**, café ✓.")

        self.assertEqual(
            self.blocks_of(node),
            '<heading level="1">Plan</heading><paragraph>Ship <bold>today</bold>, café ✓.</paragraph>',
        )

    def test_a_user_who_cannot_add_to_the_folder_creates_nothing(self):
        frappe.set_user(OUTSIDER)

        with self.assertRaises((drive.DriveNotFound, drive.DriveForbidden)):
            writer_routes.document_create(self.folder, "Agent refused", "Hello")

        self.assertFalse(
            frappe.db.exists("Drive Node", {"parent_node": self.folder, "title": "Agent refused"})
        )

    def test_markdown_a_document_cannot_keep_creates_nothing(self):
        for markdown in ('Kept\n\n<div class="callout">Lost</div>', "[Run](javascript:alert(1))"):
            with (
                self.subTest(markdown),
                self.assertRaisesRegex(MarkdownRefused, "a link or HTML the editor can't hold"),
            ):
                writer_routes.document_create(self.folder, "Agent refused", markdown)

        self.assertFalse(
            frappe.db.exists("Drive Node", {"parent_node": self.folder, "title": "Agent refused"})
        )

    def test_markdown_over_the_size_limit_creates_nothing(self):
        with self.assertRaisesRegex(MarkdownRefused, "over 128 KB"):
            writer_routes.document_create(self.folder, "Agent refused", "a" * (128 * 1024 + 1))

        self.assertFalse(
            frappe.db.exists("Drive Node", {"parent_node": self.folder, "title": "Agent refused"})
        )

    def test_a_title_taken_in_the_folder_creates_nothing_and_names_a_free_one(self):
        title = frappe.db.get_value("Drive Node", self.create("First."), "title")

        with self.assertRaises(drive.DriveConflict) as refused:
            writer_routes.document_create(self.folder, title, "Second.")

        self.assertEqual(self.answer_of(refused.exception)["free_title"], f"{title} (2)")
        self.assertEqual(frappe.db.count("Drive Node", {"parent_node": self.folder, "title": title}), 1)

    def test_a_node_that_is_not_a_document_answers_not_found(self):
        with self.assertRaises(drive.DriveNotFound):
            writer_routes.document_write(self.folder, "Second.", "append")

    def test_append_adds_the_markdown_after_the_body(self):
        node = self.create("First.")

        written = writer_routes.document_write(node, "Second, *later*.", "append")

        self.assertEqual(
            self.blocks_of(node),
            "<paragraph>First.</paragraph><paragraph>Second, <italic>later</italic>.</paragraph>",
        )
        self.assertEqual(written["rev"], self.doc_row(node).head_rev)

    def test_an_appended_heading_shares_no_id_with_the_one_it_repeats(self):
        node = self.create("## Update\n\nFirst.")

        writer_routes.document_write(node, "## Update\n\nSecond.", "append")

        ids: list[set[str]] = []
        for heading in re.findall(r"<heading [^>]*>", self.body_of(node)):
            ids.append(set(re.findall(r'(?:id|data-toc-id)="([^"]+)"', heading)))

        # Each heading has one id, in both places the editor keeps it, as a typed heading does
        self.assertEqual([len(own) for own in ids], [1, 1])
        self.assertFalse(ids[0] & ids[1])

    def test_a_mention_keeps_the_user_it_names(self):
        mention = (
            '<span data-type="mention" class="mention" data-id="someone@example.com" data-label="W">@W</span>'
        )

        node = self.create(f"Hi {mention}, there.")

        self.assertRegex(self.body_of(node), r'<mention [^>]*id="someone@example\.com"')

    def test_replace_leaves_only_the_markdown(self):
        node = self.create("First.\n\nSecond.")

        writer_routes.document_write(node, "Only this.", "replace")

        self.assertEqual(self.blocks_of(node), "<paragraph>Only this.</paragraph>")

    def test_the_readable_copy_follows_a_write(self):
        node = self.create("First.")

        writer_routes.document_write(node, "Second.", "append")

        html = writer_routes.document(self.docname_of(node))["html"]
        self.assertIn("<p>First.</p><p>Second.</p>", html)

    def test_a_mode_other_than_replace_or_append_writes_nothing(self):
        node = self.create("First.")

        # By name, as a request's arguments come
        with self.assertRaisesRegex(drive.DriveError, "mode must be replace or append"):
            writer_routes.document_write(node=node, markdown="Second.", mode="prepend")

        self.assertEqual(self.blocks_of(node), "<paragraph>First.</paragraph>")

    def test_a_field_left_out_is_a_bad_request_that_names_it(self):
        with self.assertRaisesRegex(drive.DriveError, "markdown must be a string") as refused:
            writer_routes.document_create(parent=self.folder, title="Agent refused")

        self.assertEqual(refused.exception.http_status_code, 400)

    def test_a_reader_cannot_write(self):
        node = self.create("First.")
        share_as_writer(node, READER, drive.READ)
        frappe.db.commit()
        frappe.set_user(READER)

        with self.assertRaises(drive.DriveForbidden):
            writer_routes.document_write(node, "Second.", "append")

        frappe.set_user(WRITER)
        self.assertEqual(self.blocks_of(node), "<paragraph>First.</paragraph>")

    def test_a_full_document_refuses_the_write_and_names_no_retry(self):
        node = self.create("First.")
        self.set_doc(node, state_bytes=capacity.STATE_MAX)

        with self.assertRaisesRegex(WriteRefused, "doc_full") as refused:
            writer_routes.document_write(node, "Second.", "append")

        self.assertNotIn("retry_ms", self.answer_of(refused.exception))

    def test_a_document_waiting_for_room_answers_busy_and_when_to_retry(self):
        node = self.create("First.")
        # No room until a compaction folds the tail in, with none planned and none timed yet
        room = {"state_bytes": capacity.STATE_MAX - 1, "tail_rows": 1}
        self.set_doc(node, **room, next_compaction_at=None, last_compaction_ms=None)

        with self.assertRaisesRegex(WriteBusy, "compacting") as refused:
            writer_routes.document_write(node, "Second.", "append")

        self.assertEqual(self.answer_of(refused.exception)["retry_ms"], 2000)

    def test_the_automatic_version_credits_who_wrote(self):
        ensure_user(OUTSIDER)
        node = self.create("First.")
        share_as_writer(node, OUTSIDER, drive.EDIT)
        frappe.db.commit()
        later = now_datetime().replace(microsecond=0) + timedelta(hours=1)

        frappe.set_user(OUTSIDER)
        with self.frozen_clock(later):
            writer_routes.document_write(node, "Second.", "append")

        actors = frappe.get_all(
            "Drive Node Version", filters={"node": node, "kind": "auto"}, pluck="actor", order_by="seq"
        )
        self.assertEqual(actors, [WRITER, OUTSIDER])

    def test_a_tabs_edit_made_before_an_append_lands_with_it(self):
        node = self.create("First.")

        def type_then_meet_the_append(fragment: pycrdt.XmlFragment) -> None:
            fragment.children[0].children[0].insert(6, " Typed.")
            # The write lands after the tab read the document and before it pushes
            writer_routes.document_write(node, "Second.", "append")

        self.push_edit(node, type_then_meet_the_append)

        self.assertEqual(
            self.blocks_of(node), "<paragraph>First. Typed.</paragraph><paragraph>Second.</paragraph>"
        )

    def test_a_block_a_tab_adds_before_a_replace_stays(self):
        node = self.create("First.")

        def add_then_meet_the_replace(fragment: pycrdt.XmlFragment) -> None:
            added = fragment.children.append(pycrdt.XmlElement("paragraph"))
            added.children.append(pycrdt.XmlText("Added."))
            writer_routes.document_write(node, "Only this.", "replace")

        self.push_edit(node, add_then_meet_the_replace)

        blocks = self.blocks_of(node)
        self.assertEqual(
            sorted(re.findall("<paragraph>.*?</paragraph>", blocks)),
            ["<paragraph>Added.</paragraph>", "<paragraph>Only this.</paragraph>"],
        )

    def test_a_busy_converter_answers_busy_and_creates_nothing(self):
        with (
            filelock(checker.LOCK),
            patch.object(checker, "REQUEST_WAIT_S", 0.2),
            self.assertRaises(WriteBusy),
        ):
            writer_routes.document_create(self.folder, "Agent refused", "Hello")

        self.assertFalse(
            frappe.db.exists("Drive Node", {"parent_node": self.folder, "title": "Agent refused"})
        )

    def test_a_markdown_table_becomes_a_table(self):
        node = self.create("| a | b |\n|---|---|\n| 1 | 2 |")

        blocks = re.sub(r' (colspan|rowspan)="1"', "", self.blocks_of(node))
        self.assertEqual(
            blocks,
            "<table>"
            "<tableRow><tableHeader><paragraph>a</paragraph></tableHeader>"
            "<tableHeader><paragraph>b</paragraph></tableHeader></tableRow>"
            "<tableRow><tableCell><paragraph>1</paragraph></tableCell>"
            "<tableCell><paragraph>2</paragraph></tableCell></tableRow>"
            "</table>",
        )

    def test_a_markdown_picture_becomes_a_picture(self):
        node = self.create("![A chart](https://example.com/chart.png)")

        self.assertRegex(self.blocks_of(node), r'<image [^>]*src="https://example\.com/chart\.png"')

    def test_fenced_code_keeps_its_language(self):
        node = self.create("```python\nx = 1\n```")

        self.assertEqual(self.blocks_of(node), '<codeBlock language="python">x = 1</codeBlock>')

    def test_markdown_the_converter_would_drop_part_of_answers_what_it_drops(self):
        with self.assertRaises(MarkdownRefused) as refused:
            writer_routes.document_create(self.folder, "Agent refused", "See [the page]().")

        self.assertEqual(
            self.answer_of(refused.exception)["message"], "A document can't keep this Markdown: empty-link"
        )

    def test_a_document_reads_back_as_markdown(self):
        node = self.create("# Plan\n\nShip **today**.")

        writer_routes.document_write(node, "## Later\n\nOne more thing.", "append")

        self.assertEqual(self.markdown_of(node), "# Plan\n\nShip **today**.\n\n## Later\n\nOne more thing.")

    def test_a_busy_converter_answers_busy_to_a_markdown_read(self):
        node = self.create("Hello")

        with (
            filelock(checker.LOCK),
            patch.object(checker, "REQUEST_WAIT_S", 0.2),
            self.assertRaises(frappe.RateLimitExceededError),
        ):
            self.markdown_of(node)

    def test_markdown_read_and_written_back_makes_the_same_document(self):
        node = self.create(
            "# Plan\n\n"
            "Ship **today**, *not* later, with `code` and [a link](https://example.com/a_b).\n\n"
            "- one\n    - inside\n- two\n\n"
            "1. first\n2. second\n\n"
            "> A quote\n\n"
            "| a | b |\n|---|---|\n| 1 | x \\| y |\n\n"
            "```python\nif x < 1:\n    y = '*'\n```\n\n"
            "---\n\n"
            "![A chart](https://example.com/chart.png)\n\n"
            "Stars \\*stay\\* and 1\\. too."
        )
        before = self.blocks_of(node)

        writer_routes.document_write(node, self.markdown_of(node), "replace")

        # A block's attributes come back in any order, which parsed blocks don't mind
        self.assertEqual(
            BeautifulSoup(self.blocks_of(node), "html.parser"), BeautifulSoup(before, "html.parser")
        )
        self.assertIn("<table>", before)
        self.assertIn('<codeBlock language="python">', before)

    def test_a_read_after_typing_in_a_tab_gives_the_new_text(self):
        node = self.create("First.")
        self.push_edit(node, lambda body: body.children[0].children[0].insert(6, " Typed."))

        self.assertEqual(self.markdown_of(node), "First. Typed.")

        # A read's request ends in a rollback, which the copy the read made outlives
        frappe.db.rollback()
        self.assertIn("<p>First. Typed.</p>", writer_routes.document(self.docname_of(node))["html"])

    def test_a_guests_read_after_typing_in_a_tab_starts_no_render(self):
        node = self.create("First.")
        self.push_edit(node, lambda body: body.children[0].children[0].insert(6, " Typed."))
        frappe.set_user("Guest")

        with self.assertRaises(drive.DriveConflict):
            writer_drive.SPEC.export(self.docname_of(node), "html")

    def test_a_guest_cannot_read_markdown(self):
        node = self.create("Hello")
        frappe.set_user("Guest")

        with self.assertRaises(drive.DriveForbidden):
            self.markdown_of(node)

    def test_a_converter_that_fails_answers_busy_and_creates_nothing(self):
        failures = {
            "a crash": "process.exit(1)",
            "another version": """process.stdout.write('{"version": "0"}')""",
        }
        for failure, script in failures.items():
            with self.subTest(failure), self.failing_converter(script), self.assertRaises(WriteBusy):
                writer_routes.document_create(self.folder, "Agent refused", "Hello")

        self.assertFalse(
            frappe.db.exists("Drive Node", {"parent_node": self.folder, "title": "Agent refused"})
        )

    def test_a_converter_that_fails_answers_busy_to_a_markdown_read(self):
        node = self.create("Hello")

        with self.failing_converter("process.exit(1)"), self.assertRaises(frappe.RateLimitExceededError):
            self.markdown_of(node)

    def test_a_document_purged_under_a_write_answers_not_found(self):
        node = self.create("First.")
        self.addCleanup(self.set_doc, node, mode="active")
        read = steps.read

        def read_then_purge(app: str, doc_id: str):
            snapshot = read(app, doc_id)
            # The purge lands after the write read the document and before it pushes
            self.set_doc(node, mode="purged")
            return snapshot

        with patch.object(steps, "read", read_then_purge), self.assertRaises(drive.DriveNotFound):
            writer_routes.document_write(node, "Second.", "append")

    def test_a_drive_picture_survives_a_read_and_a_replace(self):
        node = self.create("First.")
        picture = self.old_media(node, "chart.png")
        src = embed(picture)
        self.push_edit(node, lambda body: body.children.append(pycrdt.XmlElement("image", {"src": src})))

        writer_routes.document_write(node, self.markdown_of(node), "replace")

        self.assertIn(f'src="{src}"', self.body_of(node))
        self.assertEqual(writer_drive.SPEC.used_nodes(self.docname_of(node)), {picture})
