"""Embedded comment conversion through in-memory ports."""

import base64
import json
import tempfile
import unittest
from pathlib import Path

import pycrdt

from suite.drive.patches.build.comments import convert_document_comments
from suite.drive.patches.build.content_mapping import InvalidLegacyContent, derived_name, sheet_anchor
from suite.drive.patches.build.ports import ContentRow
from suite.drive.patches.build.tests.fakes import (
    FakeContent,
    FakeContentTarget,
    InterruptedRun,
    build_environment,
)

STAMP = "2024-01-02 03:04:05.000000"
OWNER = "owner@example.com"


def writer_update(values):
    document = pycrdt.Doc()
    comments = document.get("comments", type=pycrdt.Map)
    for name, value in values.items():
        comments[name] = value
    return base64.b64encode(document.get_update()).decode()


class CommentTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def environment(self, source):
        target = FakeContentTarget(content=source)
        env = build_environment(self.path, content=source, content_target=target)
        return env, target

    def test_writer_thread_preserves_ids_order_mentions_and_resolution(self):
        ycomments = writer_update(
            {
                "top": {
                    "id": "top",
                    "text": "First",
                    "owner": "deleted@example.com",
                    "creation": 1_000,
                    "mentions": [{"id": "a@example.com"}],
                    "resolved": True,
                    "replies": [
                        {
                            "id": "reply",
                            "text": "Later",
                            "owner": "reply@example.com",
                            "creation": 2_000,
                            "mentions": ["b@example.com"],
                        }
                    ],
                }
            }
        )
        document = ContentRow(
            "Writer Document",
            "writer-1",
            ycomments=ycomments,
            modified=STAMP,
            modified_by=OWNER,
        )
        source = FakeContent(documents=[document], timezone="UTC")
        env, target = self.environment(source)

        count = convert_document_comments(env, document, "node-1", batch_size=1)

        self.assertEqual(count, 2)
        thread = target.thread_rows["top"]
        self.assertEqual(thread["anchor"], "top")
        self.assertEqual(thread["resolved_by"], "reply@example.com")
        self.assertEqual(thread["resolved_at"], "1970-01-01 00:00:02.000000")
        self.assertEqual(target.comment_rows["top"]["idx"], 1)
        self.assertEqual(target.comment_rows["reply"]["idx"], 2)
        self.assertEqual(json.loads(target.comment_rows["top"]["mentions"]), ["a@example.com"])

    def test_threads_are_written_in_sorted_id_order(self):
        keys = ["zz", "mm", "aa", "qq", "bb", "kk", "cc", "yy"]
        ycomments = writer_update(
            {key: {"id": key, "text": key, "owner": OWNER, "creation": 1_000} for key in keys}
        )
        document = ContentRow(
            "Writer Document", "writer-1", ycomments=ycomments, modified=STAMP, modified_by=OWNER
        )
        source = FakeContent(documents=[document], timezone="UTC")
        env, target = self.environment(source)
        written = []
        original = target.write_thread

        def record(thread, comments):
            written.append(thread["name"])
            original(thread, comments)

        target.write_thread = record

        convert_document_comments(env, document, "node-1", batch_size=100)

        # `to_py()` hands back the yrs map order, and that is a fresh hash
        # order on every read. Each thread is its own commit, so an
        # interrupted run must resume over the order it stopped inside.
        self.assertEqual(written, sorted(keys))

    def test_a_reply_that_is_not_an_object_is_refused(self):
        ycomments = writer_update(
            {
                "top": {
                    "id": "top",
                    "text": "First",
                    "owner": OWNER,
                    "creation": 1_000,
                    "replies": ["not an object"],
                }
            }
        )
        document = ContentRow(
            "Writer Document", "writer-1", ycomments=ycomments, modified=STAMP, modified_by=OWNER
        )
        source = FakeContent(documents=[document], timezone="UTC")
        env, _ = self.environment(source)

        # No caller catches `AttributeError`, so the run would end with no
        # issue recorded and no state written.
        with self.assertRaisesRegex(InvalidLegacyContent, "reply is not an object"):
            convert_document_comments(env, document, "node-1", batch_size=100)

    def test_an_over_long_author_is_refused_before_the_insert(self):
        ycomments = writer_update(
            {"top": {"id": "top", "text": "First", "owner": "a" * 141, "creation": 1_000}}
        )
        document = ContentRow(
            "Writer Document", "writer-1", ycomments=ycomments, modified=STAMP, modified_by=OWNER
        )
        source = FakeContent(documents=[document], timezone="UTC")
        env, _ = self.environment(source)

        # `Drive Comment.author` is `varchar(140)`. MariaDB error 1406 is
        # neither `InvalidLegacyContent` nor `ValueError`, so it would escape
        # the guard and repeat on every rerun.
        with self.assertRaisesRegex(InvalidLegacyContent, "author exceeds"):
            convert_document_comments(env, document, "node-1", batch_size=100)

    def test_blank_writer_author_uses_guest_and_container_fallback(self):
        ycomments = writer_update(
            {"top": {"id": "top", "text": "Text", "owner": "", "creation": "bad", "replies": []}}
        )
        document = ContentRow(
            "Writer Document",
            "writer-1",
            ycomments=ycomments,
            modified=STAMP,
            modified_by=OWNER,
        )
        source = FakeContent(documents=[document])
        env, target = self.environment(source)

        convert_document_comments(env, document, "node-1", batch_size=1000)

        comment = target.comment_rows["top"]
        self.assertEqual(comment["author"], "Guest")
        self.assertEqual(comment["creation"], STAMP)

    def test_sheet_anchor_and_ids_follow_the_frozen_codecs(self):
        workbook = {
            "comments": {
                "Résumé": {
                    "A/1": {
                        "resolved": True,
                        "thread": [
                            {
                                "text": "Cell note",
                                "author": "cell@example.com",
                                "name": "Cell User",
                                "ts": 0,
                                "mentions": [{"id": "mention@example.com"}],
                            }
                        ],
                    }
                }
            }
        }
        document = ContentRow(
            "Sheet",
            "sheet-1",
            sheets_data=json.dumps(workbook, ensure_ascii=False),
            modified=STAMP,
            modified_by=OWNER,
        )
        source = FakeContent(documents=[document])
        env, target = self.environment(source)

        convert_document_comments(env, document, "node-1", batch_size=1000)

        thread_id = derived_name("drive-sheet-thread/1", "sheet-1", "Résumé", "A/1")
        comment_id = derived_name("drive-sheet-comment/1", thread_id, 0)
        self.assertEqual(target.thread_rows[thread_id]["anchor"], sheet_anchor("Résumé", "A/1"))
        self.assertEqual(target.comment_rows[comment_id]["author_name"], "Cell User")
        self.assertEqual(target.thread_rows[thread_id]["resolved_at"], "1970-01-01 00:00:00.000000")

    def test_legacy_sheet_string_is_one_unresolved_guest_comment(self):
        document = ContentRow(
            "Sheet",
            "sheet-1",
            sheets_data=json.dumps({"comments": {"Sheet 1": {"A1": "old note"}}}),
            modified=STAMP,
            modified_by=OWNER,
        )
        source = FakeContent(documents=[document])
        env, target = self.environment(source)

        count = convert_document_comments(env, document, "node-1", batch_size=1000)

        self.assertEqual(count, 1)
        comment = next(iter(target.comment_rows.values()))
        thread = next(iter(target.thread_rows.values()))
        self.assertEqual(comment["content"], "old note")
        self.assertEqual(comment["author"], "Guest")
        self.assertEqual(thread["resolved"], 0)

    def test_sheet_resolution_uses_the_head_operation_fallback(self):
        workbook = {
            "comments": {
                "Sheet 1": {
                    "A1": {
                        "resolved": True,
                        "thread": [{"text": "note", "author": "", "ts": None}],
                    }
                }
            }
        }
        document = ContentRow(
            "Sheet",
            "sheet-1",
            sheets_data=json.dumps(workbook),
            head_seq=8,
            modified=STAMP,
            modified_by=OWNER,
        )
        source = FakeContent(documents=[document])
        source.op_stamps[("sheet-1", 8)] = ("operator@example.com", "2024-03-01 00:00:00")
        env, target = self.environment(source)

        convert_document_comments(env, document, "node-1", batch_size=1000)

        thread = next(iter(target.thread_rows.values()))
        self.assertEqual(thread["resolved_by"], "operator@example.com")
        self.assertEqual(thread["resolved_at"], "2024-03-01 00:00:00")

    def test_thread_and_first_comments_are_one_atomic_unit(self):
        document = ContentRow(
            "Sheet",
            "sheet-1",
            sheets_data=json.dumps({"comments": {"Sheet 1": {"A1": "note"}}}),
            modified=STAMP,
            modified_by=OWNER,
        )
        source = FakeContent(documents=[document])
        env, target = self.environment(source)
        thread_id = derived_name("drive-sheet-thread/1", "sheet-1", "Sheet 1", "A1")
        target.fail_unit = thread_id

        with self.assertRaises(InterruptedRun):
            convert_document_comments(env, document, "node-1", batch_size=1000)
        self.assertFalse(target.thread_rows)
        self.assertFalse(target.comment_rows)

    def test_malformed_sheet_comment_is_refused_without_partial_rows(self):
        document = ContentRow(
            "Sheet",
            "sheet-1",
            sheets_data=json.dumps({"comments": {"Sheet 1": {"A1": 7}}}),
            modified=STAMP,
            modified_by=OWNER,
        )
        source = FakeContent(documents=[document])
        env, target = self.environment(source)

        with self.assertRaisesRegex(InvalidLegacyContent, "malformed"):
            convert_document_comments(env, document, "node-1", batch_size=1000)
        self.assertFalse(target.thread_rows)

    def test_colliding_reply_ids_refuse_before_an_earlier_thread_is_committed(self):
        ycomments = writer_update(
            {
                "first": {
                    "id": "first",
                    "text": "First",
                    "owner": OWNER,
                    "creation": 1,
                    "replies": [{"id": "same", "text": "One", "owner": OWNER, "creation": 2}],
                },
                "second": {
                    "id": "second",
                    "text": "Second",
                    "owner": OWNER,
                    "creation": 3,
                    "replies": [{"id": "same", "text": "Two", "owner": OWNER, "creation": 4}],
                },
            }
        )
        document = ContentRow(
            "Writer Document",
            "writer-1",
            ycomments=ycomments,
            modified=STAMP,
            modified_by=OWNER,
        )
        source = FakeContent(documents=[document])
        env, target = self.environment(source)

        with self.assertRaisesRegex(InvalidLegacyContent, "comment ids collide"):
            convert_document_comments(env, document, "node-1", batch_size=1000)
        self.assertFalse(target.thread_rows)
        self.assertFalse(target.comment_rows)

    def test_unusable_reply_id_is_a_content_refusal_not_a_type_error(self):
        for reply_id in ("x" * 141, 7):
            with self.subTest(reply_id=reply_id):
                ycomments = writer_update(
                    {
                        "top": {
                            "id": "top",
                            "text": "First",
                            "owner": OWNER,
                            "creation": 1,
                            "replies": [{"id": reply_id, "text": "Reply", "owner": OWNER, "creation": 2}],
                        }
                    }
                )
                document = ContentRow(
                    "Writer Document",
                    "writer-1",
                    ycomments=ycomments,
                    modified=STAMP,
                    modified_by=OWNER,
                )
                source = FakeContent(documents=[document])
                env, target = self.environment(source)

                with self.assertRaisesRegex(InvalidLegacyContent, "ids are missing or too long"):
                    convert_document_comments(env, document, "node-1", batch_size=1000)
                self.assertFalse(target.thread_rows)


if __name__ == "__main__":
    unittest.main()
