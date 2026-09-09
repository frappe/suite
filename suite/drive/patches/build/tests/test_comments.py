"""Embedded comment conversion through in-memory ports."""

import base64
import json
import tempfile
import unittest
from pathlib import Path

import pycrdt

from suite.drive.patches.build.comments import convert_document_comments, port_legacy_comments
from suite.drive.patches.build.content_mapping import InvalidLegacyContent, derived_name, sheet_anchor
from suite.drive.patches.build.ports import ContentRow
from suite.drive.patches.build.state import ContentConversion
from suite.drive.patches.build.tests.fakes import (
    FakeContent,
    FakeContentTarget,
    InterruptedRun,
    build_environment,
)

STAMP = "2024-01-02 03:04:05.000000"
LEGACY_STAMP = "2023-05-06 07:08:09.000000"
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
        self.record = ContentConversion()

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

        count = convert_document_comments(env, self.record, document, "node-1", batch_size=1)

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

        convert_document_comments(env, self.record, document, "node-1", batch_size=100)

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
            convert_document_comments(env, self.record, document, "node-1", batch_size=100)

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
            convert_document_comments(env, self.record, document, "node-1", batch_size=100)

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

        convert_document_comments(env, self.record, document, "node-1", batch_size=1000)

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

        convert_document_comments(env, self.record, document, "node-1", batch_size=1000)

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

        count = convert_document_comments(env, self.record, document, "node-1", batch_size=1000)

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

        convert_document_comments(env, self.record, document, "node-1", batch_size=1000)

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
            convert_document_comments(env, self.record, document, "node-1", batch_size=1000)
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
            convert_document_comments(env, self.record, document, "node-1", batch_size=1000)
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
            convert_document_comments(env, self.record, document, "node-1", batch_size=1000)
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
                    convert_document_comments(env, self.record, document, "node-1", batch_size=1000)
                self.assertFalse(target.thread_rows)

    def test_legacy_sheet_string_takes_the_sheet_stamp_not_the_head_operation(self):
        # §9 fixes the creation of a legacy string at `Sheet.modified`. The
        # op-log stamp is the *resolution* fallback, and reading it here would
        # date the comment at whenever the head op happened to be written.
        document = ContentRow(
            "Sheet",
            "sheet-1",
            sheets_data=json.dumps({"comments": {"Sheet 1": {"A1": "old note"}}}),
            head_seq=8,
            modified=STAMP,
            modified_by=OWNER,
        )
        source = FakeContent(documents=[document])
        source.op_stamps[("sheet-1", 8)] = ("operator@example.com", "2020-05-05 11:11:11")
        env, target = self.environment(source)

        convert_document_comments(env, self.record, document, "node-1", batch_size=1000)

        comment = next(iter(target.comment_rows.values()))
        thread = next(iter(target.thread_rows.values()))
        self.assertEqual(comment["creation"], STAMP)
        self.assertEqual(thread["creation"], STAMP)

    def test_a_non_object_reply_is_a_content_refusal_not_a_type_error(self):
        # `history.py` catches `InvalidLegacyContent` and `ValueError` only, so
        # an `AttributeError` here would end the whole run with a traceback.
        ycomments = writer_update(
            {"top": {"id": "top", "text": "First", "owner": OWNER, "creation": 1, "replies": ["oops"]}}
        )
        document = ContentRow(
            "Writer Document", "writer-1", ycomments=ycomments, modified=STAMP, modified_by=OWNER
        )
        source = FakeContent(documents=[document])
        env, target = self.environment(source)

        with self.assertRaisesRegex(InvalidLegacyContent, "is not an object"):
            convert_document_comments(env, self.record, document, "node-1", batch_size=1000)
        self.assertFalse(target.thread_rows)

    def test_stamps_authors_and_mention_order_land_on_every_written_column(self):
        ycomments = writer_update(
            {
                "top": {
                    "id": "top",
                    "text": "First",
                    "owner": "first@example.com",
                    "creation": 1_000,
                    "mentions": ["zed@example.com", "amy@example.com"],
                    "replies": [
                        {
                            "id": "reply",
                            "text": "Later",
                            "owner": "last@example.com",
                            "creation": 5_000,
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

        convert_document_comments(env, self.record, document, "node-1", batch_size=1000)

        first = target.comment_rows["top"]
        last = target.comment_rows["reply"]
        thread = target.thread_rows["top"]
        # The author is the row's owner and its last editor: migration invents
        # no Administrator authorship.
        self.assertEqual((first["owner"], first["modified_by"]), ("first@example.com",) * 2)
        # No source edit stamp, so `modified` is the creation.
        self.assertEqual(first["modified"], first["creation"])
        self.assertEqual(first["creation"], "1970-01-01 00:00:01.000000")
        # Mentions keep source order, not a sorted one.
        self.assertEqual(json.loads(first["mentions"]), ["zed@example.com", "amy@example.com"])
        # The thread opens with its first comment and ends with its last.
        self.assertEqual((thread["owner"], thread["creation"]), ("first@example.com", first["creation"]))
        self.assertEqual((thread["modified_by"], thread["modified"]), ("last@example.com", last["creation"]))

    def test_blank_and_oversized_comment_text_refuse_the_thread(self):
        cases = {
            "blank": ("   ", "text is blank"),
            "oversized": ("x" * 65_536, "exceeds the target Text column"),
        }
        for label, (text, message) in cases.items():
            with self.subTest(case=label):
                ycomments = writer_update(
                    {"top": {"id": "top", "text": text, "owner": OWNER, "creation": 1, "replies": []}}
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

                with self.assertRaisesRegex(InvalidLegacyContent, message):
                    convert_document_comments(env, self.record, document, "node-1", batch_size=1000)
                self.assertFalse(target.comment_rows)

    def test_a_second_identical_run_validates_rows_instead_of_repeating_them(self):
        workbook = {
            "comments": {
                "Sheet 1": {
                    "A1": {
                        "resolved": False,
                        "thread": [
                            {"text": "one", "author": "a@example.com", "name": "A", "ts": 1_000},
                            {"text": "two", "author": "b@example.com", "name": "B", "ts": 1_000},
                        ],
                    }
                }
            }
        }
        document = ContentRow(
            "Sheet",
            "sheet-1",
            sheets_data=json.dumps(workbook),
            modified=STAMP,
            modified_by=OWNER,
        )
        source = FakeContent(documents=[document], timezone="UTC")
        env, target = self.environment(source)

        first = convert_document_comments(env, self.record, document, "node-1", batch_size=1000)
        before = (dict(target.thread_rows), dict(target.comment_rows))
        second = convert_document_comments(env, self.record, document, "node-1", batch_size=1000)

        self.assertEqual((first, second), (2, 2))
        self.assertEqual((dict(target.thread_rows), dict(target.comment_rows)), before)
        # Equal source times, so `idx` is the only key that still carries the
        # source order the runtime reader sorts on.
        rows = sorted(target.comment_rows.values(), key=lambda row: row["idx"])
        self.assertEqual([row["content"] for row in rows], ["one", "two"])

    def test_a_changed_target_row_refuses_instead_of_being_blessed(self):
        document = ContentRow(
            "Sheet",
            "sheet-1",
            sheets_data=json.dumps({"comments": {"Sheet 1": {"A1": "note"}}}),
            modified=STAMP,
            modified_by=OWNER,
        )
        source = FakeContent(documents=[document])
        env, target = self.environment(source)
        convert_document_comments(env, self.record, document, "node-1", batch_size=1000)
        comment_id = next(iter(target.comment_rows))
        target.comment_rows[comment_id]["idx"] = 7

        with self.assertRaisesRegex(InvalidLegacyContent, "field idx"):
            convert_document_comments(env, self.record, document, "node-1", batch_size=1000)

    def test_a_complete_thread_never_reads_the_container_fallback(self):
        # A document whose entries all carry an author and a valid stamp needs
        # no fallback, so an incomplete container stamp must not refuse it.
        ycomments = writer_update(
            {
                "top": {
                    "id": "top",
                    "text": "First",
                    "owner": "a@example.com",
                    "creation": 1_000,
                }
            }
        )
        document = ContentRow(
            "Writer Document", "writer-1", ycomments=ycomments, modified=None, modified_by=None
        )
        source = FakeContent(documents=[document], timezone="UTC")
        env, target = self.environment(source)

        self.assertEqual(convert_document_comments(env, self.record, document, "node-1", batch_size=10), 1)
        self.assertEqual(target.comment_rows["top"]["author"], "a@example.com")

    def test_a_sheet_with_no_comments_never_reads_the_container_fallback(self):
        document = ContentRow(
            "Sheet", "sheet-1", sheets_data='{"sheets":[]}', modified=None, modified_by=None
        )
        source = FakeContent(documents=[document], timezone="UTC")
        env, _ = self.environment(source)

        self.assertEqual(convert_document_comments(env, self.record, document, "node-1", batch_size=10), 0)

    def test_an_entry_that_needs_the_fallback_still_refuses_an_incomplete_one(self):
        ycomments = writer_update(
            {"top": {"id": "top", "text": "First", "owner": "a@example.com", "creation": "nope"}}
        )
        document = ContentRow(
            "Writer Document", "writer-1", ycomments=ycomments, modified=None, modified_by=None
        )
        source = FakeContent(documents=[document], timezone="UTC")
        env, _ = self.environment(source)

        with self.assertRaisesRegex(InvalidLegacyContent, "timestamp fallback"):
            convert_document_comments(env, self.record, document, "node-1", batch_size=10)


class LegacyCommentTest(unittest.TestCase):
    """The rows `new_writer.py` left in the table `Drive Comment` reuses.

    That patch named each child row after the Yjs entry it came from, so the
    ids Build derives from `ycomments` are ids the table already holds.
    """

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)
        self.record = ContentConversion()

    def environment(self, source):
        target = FakeContentTarget(content=source)
        return build_environment(self.path, content=source, content_target=target), target

    def legacy_row(self, target, name, *, file="file-1", text="<p>old</p>", resolved=0):
        target.comment_rows[name] = {
            "name": name,
            "parent": file,
            "parenttype": "Drive File",
            "parentfield": "comments",
            "content": text,
            "resolved": resolved,
            "owner": "old@example.com",
            "creation": LEGACY_STAMP,
            "modified": LEGACY_STAMP,
            "modified_by": "old@example.com",
        }
        return target.comment_rows[name]

    def writer(self, name="78033a50-d0c3-47e0-9c84-a15ff667ea29"):
        ycomments = writer_update(
            {name: {"id": name, "text": "First", "owner": "a@example.com", "creation": 1_000}}
        )
        return ContentRow(
            "Writer Document", "writer-1", ycomments=ycomments, modified=STAMP, modified_by=OWNER
        )

    def test_a_legacy_row_under_a_planned_id_is_completed_in_place(self):
        document = self.writer()
        name = "78033a50-d0c3-47e0-9c84-a15ff667ea29"
        env, target = self.environment(FakeContent(documents=[document], timezone="UTC"))
        self.legacy_row(target, name)

        count = convert_document_comments(env, self.record, document, "node-1", batch_size=10)

        self.assertEqual((count, self.record.legacy_comments_superseded), (1, 1))
        row = target.comment_rows[name]
        self.assertEqual((row["thread"], row["node"], row["idx"]), (name, "node-1", 1))
        self.assertEqual((row["content"], row["author"]), ("First", "a@example.com"))
        self.assertEqual(target.thread_rows[name]["anchor"], name)
        # The old child columns are ticket 35's to drop, not Build's.
        self.assertEqual((row["parent"], row["parenttype"]), ("file-1", "Drive File"))

    def test_the_document_converts_again_after_the_rewrite(self):
        document = self.writer()
        env, target = self.environment(FakeContent(documents=[document], timezone="UTC"))
        self.legacy_row(target, "78033a50-d0c3-47e0-9c84-a15ff667ea29")
        convert_document_comments(env, self.record, document, "node-1", batch_size=10)
        before = (dict(target.thread_rows), dict(target.comment_rows))

        convert_document_comments(env, self.record, document, "node-1", batch_size=10)

        self.assertEqual((dict(target.thread_rows), dict(target.comment_rows)), before)
        # The row stopped being legacy on the first pass, so the second one
        # compares it whole and counts nothing.
        self.assertEqual(self.record.legacy_comments_superseded, 1)

    def test_a_kill_before_the_thread_leaves_the_row_legacy(self):
        # The rewrite runs after the thread write, so an interrupted run
        # never leaves a comment whose thread no later pass knows to write.
        document = self.writer()
        name = "78033a50-d0c3-47e0-9c84-a15ff667ea29"
        env, target = self.environment(FakeContent(documents=[document], timezone="UTC"))
        self.legacy_row(target, name)
        target.fail_unit = name

        with self.assertRaises(InterruptedRun):
            convert_document_comments(env, self.record, document, "node-1", batch_size=10)

        self.assertEqual(target.thread_rows, {})
        self.assertIsNone(target.comment_rows[name].get("thread"))
        self.assertEqual(self.record.legacy_comments_superseded, 0)

    def test_a_sheet_id_meets_a_legacy_row_the_same_way(self):
        # Sheet ids are derived, not Yjs, so this collision is not one
        # production can produce. `_write_thread` answers it identically.
        workbook = {"comments": {"Sheet 1": {"A1": {"thread": [{"text": "one", "author": OWNER}]}}}}
        document = ContentRow(
            "Sheet", "sheet-1", sheets_data=json.dumps(workbook), modified=STAMP, modified_by=OWNER
        )
        env, target = self.environment(FakeContent(documents=[document], timezone="UTC"))
        thread_id = derived_name("drive-sheet-thread/1", "sheet-1", "Sheet 1", "A1")
        name = derived_name("drive-sheet-comment/1", thread_id, 0)
        self.legacy_row(target, name)

        convert_document_comments(env, self.record, document, "node-1", batch_size=10)

        self.assertEqual(self.record.legacy_comments_superseded, 1)
        self.assertEqual(target.comment_rows[name]["thread"], thread_id)
        self.assertEqual(target.comment_rows[name]["content"], "one")

    def test_a_row_no_entry_claims_becomes_its_own_thread(self):
        env, target = self.environment(FakeContent(timezone="UTC"))
        target.node_rows["file-1"] = {"name": "file-1", "kind": "document"}
        self.legacy_row(target, "orphan-1", resolved=1)

        port_legacy_comments(env, self.record, batch_size=10)

        self.assertEqual(self.record.legacy_comments_ported, 1)
        thread = target.thread_rows["orphan-1"]
        self.assertEqual((thread["node"], thread["anchor"], thread["resolved"]), ("file-1", "orphan-1", 1))
        self.assertEqual((thread["resolved_by"], thread["owner"]), ("old@example.com", "old@example.com"))
        row = target.comment_rows["orphan-1"]
        self.assertEqual((row["thread"], row["node"]), ("orphan-1", "file-1"))
        self.assertEqual((row["content"], row["author"]), ("<p>old</p>", "old@example.com"))
        self.assertEqual(row["creation"], LEGACY_STAMP)

    def test_a_row_whose_file_has_no_node_is_counted_and_kept(self):
        env, target = self.environment(FakeContent(timezone="UTC"))
        target.node_rows["file-2"] = {"name": "file-2", "kind": "document"}
        self.legacy_row(target, "a-orphan", file="file-1")
        self.legacy_row(target, "b-orphan", file="file-2")

        # One row per page, so the keyset has to step over the row it kept.
        port_legacy_comments(env, self.record, batch_size=1)

        self.assertEqual(self.record.legacy_comments_unported, 1)
        self.assertEqual(
            [(entry.name, entry.file) for entry in self.record.legacy_comment_rows],
            [("a-orphan", "file-1")],
        )
        self.assertEqual(self.record.legacy_comments_ported, 1)
        self.assertIsNone(target.comment_rows["a-orphan"].get("thread"))
        self.assertNotIn("a-orphan", target.thread_rows)

    def test_porting_the_same_rows_again_changes_nothing(self):
        env, target = self.environment(FakeContent(timezone="UTC"))
        target.node_rows["file-1"] = {"name": "file-1", "kind": "document"}
        self.legacy_row(target, "orphan-1")
        self.legacy_row(target, "orphan-2", file="gone")
        port_legacy_comments(env, self.record, batch_size=10)
        before = (dict(target.thread_rows), dict(target.comment_rows))

        port_legacy_comments(env, self.record, batch_size=10)

        self.assertEqual((dict(target.thread_rows), dict(target.comment_rows)), before)
        self.assertEqual(self.record.legacy_comments_ported, 1)
        # The row with no node is still legacy, and the sweep recounts it
        # rather than adding it to the census the last sweep took.
        self.assertEqual(self.record.legacy_comments_unported, 1)

    def test_a_blank_legacy_row_is_refused(self):
        env, target = self.environment(FakeContent(timezone="UTC"))
        target.node_rows["file-1"] = {"name": "file-1", "kind": "document"}
        self.legacy_row(target, "orphan-1", text="   ")

        with self.assertRaisesRegex(InvalidLegacyContent, "legacy comment text is blank"):
            port_legacy_comments(env, self.record, batch_size=10)


if __name__ == "__main__":
    unittest.main()
