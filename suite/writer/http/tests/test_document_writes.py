import base64
import gzip
import json
import os
import re
import tempfile
import threading
import uuid
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

import frappe
import pycrdt
from bs4 import BeautifulSoup
from frappe.utils import now_datetime
from frappe.utils.logging import connection_for
from frappe.utils.synchronization import filelock

from suite import content, drive
from suite.content import capacity, checker, convert, jobs, scheduling, steps
from suite.content.http import routes
from suite.tests.utils import ensure_user
from suite.writer import content as writer_content
from suite.writer import drive as writer_drive
from suite.writer.content import converter
from suite.writer.content.markdown import MarkdownRefused, WriteBusy, WriteRefused, body_state, write_body
from suite.writer.content.tests.drive_callback_case import (
    DriveCallbackCase,
    embed,
    exported,
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

    def create(self, markdown: str, title: str | None = None) -> str:
        title = title or f"Agent {uuid.uuid4().hex[:8]}"
        node = writer_routes.document_create(self.folder, title, markdown)["name"]
        self.addCleanup(self.delete_document, node)
        self.addCleanup(self.delete_log, node)
        return node

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
        return exported(node, "markdown")

    def saved_of(self, node: str) -> dict:
        # Every row a read could write: the log's control row, its projection row and the app's row
        control = self.doc_row(node)
        return {
            "control": control,
            "projection": frappe.db.sql(
                "SELECT * FROM `__writer_content_projection` WHERE `doc_id` = %s", control.id
            ),
            "app row": frappe.db.get_value(
                "Writer Document", {"node": node}, ["html", "content", "modified"]
            ),
        }

    def elsewhere(self, work) -> list[Exception]:
        # Run `work` as another request would, on a connection of its own
        site = frappe.local.site
        errors: list[Exception] = []

        def run():
            frappe.init(site=site)
            frappe.connect()
            frappe.set_user(WRITER)
            try:
                work()
            except Exception as error:
                errors.append(error)
            finally:
                frappe.destroy()

        thread = threading.Thread(target=run)
        thread.start()
        thread.join()
        return errors

    def kept_versions(self, node: str) -> list[dict]:
        return [row for row in drive.list_versions(node)["rows"] if row["kind"] == "milestone"]

    def version_blocks(self, node: str, seq: int) -> str:
        # The body a version holds, as its stored bytes give it
        with drive.read_version(node, seq) as stream:
            state = gzip.decompress(base64.b64decode(json.loads(stream.read())["state"]))

        return self.text_of(state)

    def as_request(self, work) -> None:
        # Run `work` inside a request, where a limit counts
        call_route(lambda _node: work(), "")

    def forget_limits(self) -> None:
        # A minute's count outlives the test, and one an earlier run left would cut this one short
        frappe.cache.delete_keys("rl:suite.writer")
        self.addCleanup(frappe.cache.delete_keys, "rl:suite.writer")

    def copy_of(self, node: str) -> str:
        return frappe.db.get_value("Writer Document", {"node": node}, "html") or ""

    def age_copy(self, node: str) -> None:
        # As a minute after the copy was written
        frappe.db.sql(
            "UPDATE `__writer_content_projection` SET `updated` = %s WHERE `doc_id` = %s",
            (now_datetime() - timedelta(seconds=61), self.doc_row(node).id),
        )
        frappe.db.commit()

    def swept_renders(self, node: str) -> int:
        # The copy jobs one sweep queues for the document
        with patch.object(scheduling, "enqueue") as enqueue:
            jobs.sweep()

        job = (jobs.RENDER_OWED, f"suite-collab-copy-writer-{self.doc_row(node).id}")
        return [call.args for call in enqueue.call_args_list].count(job)

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
        ensure_user(OUTSIDER)
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

    def test_append_adds_markdown_and_returns_the_updated_document(self):
        title = f"Agent {uuid.uuid4().hex[:8]}"
        node = self.create("First.", title)
        before = self.doc_row(node).head_rev

        written = writer_routes.document_write(node, "Second, *later*.", "append")

        self.assertEqual(
            self.blocks_of(node),
            "<paragraph>First.</paragraph><paragraph>Second, <italic>later</italic>.</paragraph>",
        )
        self.assertEqual(
            (written["name"], written["title"], written["parent_node"], written["kind"]),
            (node, title, self.folder, "document"),
        )
        self.assertEqual(written["rev"], before + 1)
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

    def test_a_replace_keeps_a_version_of_what_a_person_typed(self):
        node = self.create("First.")
        self.push_edit(node, lambda body: body.children[0].children[0].insert(6, " Typed by hand."))

        writer_routes.document_write(node, "Only this.", "replace")

        self.assertEqual(self.blocks_of(node), "<paragraph>Only this.</paragraph>")
        (kept,) = self.kept_versions(node)
        self.assertEqual(kept["label"], "Before a replace from Markdown")
        self.assertEqual(
            self.version_blocks(node, kept["seq"]), "<paragraph>First. Typed by hand.</paragraph>"
        )

    def test_a_replace_asked_again_after_a_refusal_keeps_one_version_of_the_head(self):
        node = self.create("First.")
        room = self.doc_row(node).state_bytes
        self.set_doc(node, state_bytes=capacity.STATE_MAX)

        for _attempt in range(2):
            with self.assertRaisesRegex(WriteRefused, "doc_full"):
                writer_routes.document_write(node, "Only this.", "replace")

        self.assertEqual(len(self.kept_versions(node)), 1)

        # A head that moved is kept again
        self.set_doc(node, state_bytes=room)
        self.push_edit(node, lambda body: body.children[0].children[0].insert(6, " Typed by hand."))
        writer_routes.document_write(node, "Only this.", "replace")

        newest, _first = self.kept_versions(node)
        self.assertEqual(
            self.version_blocks(node, newest["seq"]), "<paragraph>First. Typed by hand.</paragraph>"
        )

    def test_a_replace_that_can_keep_no_version_writes_nothing(self):
        node = self.create("First.")
        full = drive.DriveOverQuota("The drive is full")

        with (
            patch.object(drive, "take_version", side_effect=full),
            self.assertRaisesRegex(WriteRefused, "No version could be kept"),
        ):
            writer_routes.document_write(node, "Only this.", "replace")

        self.assertEqual(self.blocks_of(node), "<paragraph>First.</paragraph>")

    def test_a_replace_whose_versions_are_away_answers_busy_and_writes_nothing(self):
        node = self.create("First.")
        away = drive.DriveConflict("Version history is not available for this document right now")

        with patch.object(drive, "take_version", side_effect=away), self.assertRaises(WriteBusy):
            writer_routes.document_write(node, "Only this.", "replace")

        self.assertEqual(self.blocks_of(node), "<paragraph>First.</paragraph>")

    def test_an_append_keeps_no_version_of_its_own(self):
        node = self.create("First.")

        writer_routes.document_write(node, "Second.", "append")

        self.assertEqual(self.kept_versions(node), [])

    def test_an_append_that_shows_nothing_is_refused(self):
        node = self.create("First.")

        for blank in ("", " \n\n ", "<!-- a note -->"):
            with self.subTest(blank), self.assertRaises(MarkdownRefused):
                writer_routes.document_write(node, blank, "append")

        self.assertEqual(self.blocks_of(node), "<paragraph>First.</paragraph>")

    def test_a_replace_with_no_markdown_empties_the_document(self):
        node = self.create("First.")

        writer_routes.document_write(node, "", "replace")

        self.assertEqual(self.blocks_of(node), "<paragraph></paragraph>")

    def test_a_change_that_changes_nothing_is_malformed(self):
        node = self.create("First.")

        with self.assertRaises(content.Refusal) as refused:
            content.write(writer_content.APP, node, lambda doc: None)

        self.assertEqual((refused.exception.status, refused.exception.body), (400, {"collab": "malformed"}))

    def test_the_readable_copy_follows_a_write(self):
        node = self.create("First.")
        self.age_copy(node)

        writer_routes.document_write(node, "Second.", "append")

        html = writer_routes.document(self.docname_of(node))["html"]
        self.assertIn("<p>First.</p><p>Second.</p>", html)
        self.assertEqual(self.swept_renders(node), 0)

    def test_writes_inside_a_minute_of_the_copy_leave_it_to_the_sweep(self):
        node = self.create("First.")

        writer_routes.document_write(node, "Second.", "append")
        writer_routes.document_write(node, "Third.", "append")

        self.assertIn("<p>First.</p>", self.copy_of(node))
        self.assertNotIn("Second.", self.copy_of(node))
        # Not before the copy is a minute old
        self.assertEqual(self.swept_renders(node), 0)

        self.age_copy(node)
        self.assertEqual(self.swept_renders(node), 1)
        jobs.render_owed(writer_content.APP, self.doc_row(node).id)

        self.assertIn("<p>First.</p><p>Second.</p><p>Third.</p>", self.copy_of(node))
        self.assertEqual(exported(node, "html"), self.copy_of(node))
        self.age_copy(node)
        self.assertEqual(self.swept_renders(node), 0)

    def test_a_render_that_fails_at_the_write_is_left_to_the_sweep(self):
        node = self.create("First.")
        self.age_copy(node)
        # Converted before the converter fails, so only the copy's render meets it
        body = body_state("Second.")

        with patch.object(converter, "run", side_effect=RuntimeError("no turn")):
            write_body(node, body, "append")

        self.assertEqual(self.blocks_of(node), "<paragraph>First.</paragraph><paragraph>Second.</paragraph>")
        self.assertNotIn("Second.", self.copy_of(node))
        self.assertEqual(self.swept_renders(node), 1)
        jobs.render_owed(writer_content.APP, self.doc_row(node).id)
        self.assertIn("<p>First.</p><p>Second.</p>", self.copy_of(node))

    def test_a_write_keeps_what_it_owes_when_its_request_fails_later(self):
        node = self.create("First.")

        write_body(node, body_state("Second."), "append")
        frappe.db.rollback()

        self.assertEqual(self.doc_row(node).copy_owed, 1)

    def test_a_write_answers_its_rev_when_the_copy_cannot_be_marked_as_owed(self):
        node = self.create("First.")
        doc = self.doc_row(node)
        body = body_state("Second.")
        site = frappe.local.site
        locked = threading.Event()
        written = threading.Event()

        def hold_row():
            frappe.init(site=site)
            frappe.connect()
            try:
                frappe.db.sql("SELECT `id` FROM `__writer_content_doc` WHERE `id` = %s FOR UPDATE", doc.id)
                locked.set()
                written.wait(30)
            finally:
                frappe.destroy()

        holder = threading.Thread(target=hold_row)
        push = steps.push_and_follow

        def push_then_lose_the_row(*args, **kwargs):
            answer = push(*args, **kwargs)
            holder.start()
            locked.wait(30)
            return answer

        frappe.db.sql("SET SESSION innodb_lock_wait_timeout = 1")
        self.addCleanup(frappe.db.sql, "SET SESSION innodb_lock_wait_timeout = DEFAULT")
        unmarked = {"method": "Collab readable copy: not marked as owed"}
        logged = connection_for("Error Log").count("Error Log", unmarked)

        try:
            with patch.object(steps, "push_and_follow", side_effect=push_then_lose_the_row):
                rev = write_body(node, body, "append")
        finally:
            written.set()
            holder.join()

        self.assertEqual(rev, doc.head_rev + 1)
        self.assertEqual(self.blocks_of(node), "<paragraph>First.</paragraph><paragraph>Second.</paragraph>")
        self.assertEqual(connection_for("Error Log").count("Error Log", unmarked), logged + 1)

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
        ensure_user(READER)
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

    def test_a_write_during_a_restore_answers_busy_and_when_to_retry(self):
        node = self.create("First.")
        restore = json.dumps({"seen_rev": int(self.doc_row(node).head_rev), "version": 1}).encode()
        self.assertEqual(call_route(routes.restore_post, node, body=restore).status_code, 200)

        with self.assertRaisesRegex(WriteBusy, "restoring") as refused:
            writer_routes.document_write(node, "Second.", "append")

        self.assertEqual(self.answer_of(refused.exception)["retry_ms"], 1000)

    def test_a_write_a_restore_landed_under_answers_busy(self):
        node = self.create("First.")
        read = steps.read

        def read_then_restore(app: str, doc_id: str):
            snapshot = read(app, doc_id)
            # The restore lands after the write read the document and before it pushes
            self.set_doc(node, restore_rev=snapshot.head_rev + 1)
            return snapshot

        with patch.object(steps, "read", read_then_restore), self.assertRaisesRegex(WriteBusy, "restored"):
            writer_routes.document_write(node, "Second.", "append")

    def test_a_document_held_for_review_refuses_the_write(self):
        node = self.create("First.")
        self.set_doc(node, suspect_held="no_node")

        with self.assertRaisesRegex(WriteRefused, "paused"):
            writer_routes.document_write(node, "Second.", "append")

    def test_a_write_to_a_document_not_converted_yet_asks_for_its_conversion(self):
        node = self.create("First.")
        self.delete_log(node)

        with (
            patch.object(scheduling, "enqueue") as enqueue,
            self.assertRaisesRegex(WriteRefused, "unconverted"),
        ):
            writer_routes.document_write(node, "Only this.", "replace")

        self.assertEqual([queued.kwargs["node"] for queued in enqueue.call_args_list], [node])
        self.assertEqual(self.kept_versions(node), [])

    def test_a_user_past_the_write_limit_waits_and_another_user_does_not(self):
        ensure_user(OUTSIDER)
        self.forget_limits()

        def write():
            # Refused for its mode, so the count is all it costs
            writer_routes.document_write("no node", "Second.", "prepend")

        for _write in range(30):
            with self.assertRaises(drive.DriveError):
                self.as_request(write)

        with self.assertRaises(frappe.RateLimitExceededError):
            self.as_request(write)

        frappe.set_user(OUTSIDER)
        with self.assertRaises(drive.DriveError):
            self.as_request(write)

    def test_a_user_past_the_create_limit_waits(self):
        self.forget_limits()

        def create():
            writer_routes.document_create(parent=self.folder, title="Agent refused")

        for _create in range(30):
            with self.assertRaises(drive.DriveError):
                self.as_request(create)

        with self.assertRaises(frappe.RateLimitExceededError):
            self.as_request(create)

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

    def test_a_read_saves_nothing(self):
        node = self.create("First.")
        self.push_edit(node, lambda body: body.children[0].children[0].insert(6, " Typed."))
        before = self.saved_of(node)

        self.markdown_of(node)

        self.assertEqual(self.saved_of(node), before)

    def test_a_tab_pushes_while_a_read_is_open(self):
        node = self.create("First.")
        self.push_edit(node, lambda body: body.children[0].children[0].insert(6, " Typed."))

        # The read's request stays open after it, so a lock it took would still be held
        self.markdown_of(node)
        refused = self.elsewhere(
            lambda: self.push_edit(node, lambda body: body.children[0].children[0].insert(0, "Now. "))
        )

        self.assertEqual(refused, [])

    def test_a_new_empty_document_reads_as_no_markdown(self):
        node = self.new_document()

        self.assertEqual(self.markdown_of(node), "")

    def test_a_document_not_converted_yet_refuses_a_read(self):
        node = self.create("Hello")
        self.delete_log(node)

        with patch.object(scheduling, "enqueue") as enqueue, self.assertRaises(drive.DriveConflict):
            self.markdown_of(node)

        # The read asks for the conversion it waits on
        self.assertEqual([queued.kwargs["node"] for queued in enqueue.call_args_list], [node])

    def test_a_read_the_document_changes_under_says_to_try_again(self):
        node = self.create("Hello")

        with (
            patch.object(writer_drive, "read", side_effect=content.ChainBroken),
            self.assertRaisesRegex(drive.DriveConflict, "Try again"),
        ):
            self.markdown_of(node)

    def test_a_user_past_the_read_limit_waits(self):
        self.forget_limits()
        node = self.create("Hello")
        # A read of a document with no log is refused before the converter, so the count is all it costs
        self.delete_log(node)

        self.enterContext(patch.object(scheduling, "enqueue"))

        for _read in range(60):
            with self.assertRaises(drive.DriveConflict):
                self.as_request(lambda: self.markdown_of(node))

        with self.assertRaises(frappe.RateLimitExceededError):
            self.as_request(lambda: self.markdown_of(node))

    def test_a_guest_on_a_public_link_reads_the_copy_and_no_markdown(self):
        node = self.create("Hello")
        share_as_writer(node, "$PUBLIC", drive.READ)
        frappe.set_user("Guest")

        with self.assertRaises(drive.DriveForbidden):
            self.markdown_of(node)

        # The link still reads the document, as its copy
        self.assertEqual(exported(node, "html"), "<p>Hello</p>")

    def test_a_converter_of_another_version_answers_busy_and_creates_nothing(self):
        another_version = """process.stdout.write('{"version": "0"}')"""

        with self.failing_converter(another_version), self.assertRaises(WriteBusy):
            writer_routes.document_create(self.folder, "Agent refused", "Hello")

        self.assertFalse(
            frappe.db.exists("Drive Node", {"parent_node": self.folder, "title": "Agent refused"})
        )

    def test_a_converter_that_fails_on_the_markdown_refuses_it_and_creates_nothing(self):
        failures = {
            "a crash": ("process.exit(1)", "the converter failed on it"),
            "no answer in time": ("setInterval(() => {}, 1000)", "the converter ran out of time on it"),
        }
        for failure, (script, said) in failures.items():
            with (
                self.subTest(failure),
                self.failing_converter(script),
                patch.object(checker, "TIMEOUT_S", 1),
                self.assertRaisesRegex(MarkdownRefused, said),
            ):
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
