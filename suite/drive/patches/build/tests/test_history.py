"""Writer and Sheet history conversion without a site."""

import json
import tempfile
import unittest
from pathlib import Path

from suite.drive.patches.build.history import BuildHistoryError, convert_history_and_comments
from suite.drive.patches.build.ports import ContentRow, SheetSnapshotRow, WriterVersionRow
from suite.drive.patches.build.tests.fakes import FakeContent, FakeContentTarget, build_environment

STAMP = "2024-01-02 03:04:05.000000"
OWNER = "owner@example.com"


def content_row(doctype, name, node):
    return ContentRow(
        doctype=doctype,
        name=name,
        node=node,
        owner=OWNER,
        creation=STAMP,
        modified=STAMP,
        modified_by=OWNER,
    )


def add_document_node(target, node, doctype, docname):
    target.node_rows[node] = {
        "name": node,
        "kind": "document",
        "content_doctype": doctype,
        "content_docname": docname,
    }


class HistoryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def environment(self, content):
        target = FakeContentTarget(content=content)
        env = build_environment(
            self.path,
            content=content,
            content_target=target,
            content_ready=True,
        )
        return env, target

    def test_writer_versions_keep_ids_html_and_creation_order(self):
        document = content_row("Writer Document", "writer-1", "node-1")
        versions = [
            WriterVersionRow(
                "version-b", "writer-1", "<p>two</p>", owner=OWNER, creation="2024-02-01", modified=STAMP
            ),
            WriterVersionRow(
                "version-a",
                "writer-1",
                "<p>one</p>",
                title="Named",
                manual=1,
                owner=OWNER,
                creation="2024-01-01",
                modified=STAMP,
                modified_by=OWNER,
            ),
        ]
        source = FakeContent(documents=[document], writer_versions=versions)
        env, target = self.environment(source)
        add_document_node(target, "node-1", "Writer Document", "writer-1")

        result = convert_history_and_comments(env, batch_size=1)

        self.assertTrue(result.history_completed)
        self.assertEqual(result.versions_seen, 2)
        self.assertEqual(target.version_rows["version-a"]["seq"], 1)
        self.assertEqual(target.version_rows["version-a"]["kind"], "named")
        self.assertEqual(target.version_rows["version-b"]["seq"], 2)
        blob = target.version_rows["version-a"]["blob"]
        self.assertEqual(target.read_blob(blob), b"<p>one</p>")
        self.assertGreaterEqual(target.commits, 2)

        before = dict(target.version_rows)
        convert_history_and_comments(env, batch_size=1)
        self.assertEqual(target.version_rows, before)

    def test_equal_writer_timestamps_use_source_ids_as_the_stable_sequence_tie_break(self):
        document = content_row("Writer Document", "writer-1", "node-1")
        versions = [
            WriterVersionRow(
                name,
                "writer-1",
                name,
                owner=OWNER,
                creation=STAMP,
                modified=STAMP,
            )
            for name in ("version-z", "version-a")
        ]
        source = FakeContent(documents=[document], writer_versions=versions)
        env, target = self.environment(source)
        add_document_node(target, "node-1", "Writer Document", "writer-1")

        convert_history_and_comments(env)

        self.assertEqual(target.version_rows["version-a"]["seq"], 1)
        self.assertEqual(target.version_rows["version-z"]["seq"], 2)

    def test_thinning_projection_uses_one_persisted_report_timestamp(self):
        source = FakeContent()

        class Target(FakeContentTarget):
            def __init__(self, **kwargs):
                super().__init__(**kwargs)
                self.report_times = []

            def versions_to_thin(self, report_at):
                self.report_times.append(report_at)
                return 7

        times = iter(("2024-04-01 00:00:00", "2024-04-02 00:00:00"))
        target = Target(content=source)
        env = build_environment(
            self.path,
            content=source,
            content_target=target,
            content_ready=True,
            clock=lambda: next(times),
        )

        first = convert_history_and_comments(env)
        second = convert_history_and_comments(env)

        self.assertEqual(first.report_at, "2024-04-01 00:00:00")
        self.assertEqual(second.report_at, first.report_at)
        self.assertEqual(target.report_times, [first.report_at, first.report_at])
        self.assertEqual(second.versions_to_thin, 7)

    def test_sheet_sequences_and_runtime_envelopes_keep_valid_gaps(self):
        document = ContentRow(
            **{
                **content_row("Sheet", "sheet-1", "node-1").__dict__,
                "head_snapshot": "snapshot-9",
            }
        )
        snapshots = [
            SheetSnapshotRow(
                "snapshot-2",
                "sheet-1",
                2,
                "auto",
                '{"sheets":[]}',
                actor=OWNER,
                owner=OWNER,
                creation=STAMP,
                modified=STAMP,
            ),
            SheetSnapshotRow(
                "snapshot-9",
                "sheet-1",
                9,
                "milestone",
                '{"sheets":[1]}',
                label="End",
                pinned=1,
                actor=OWNER,
                owner=OWNER,
                creation=STAMP,
                modified=STAMP,
                modified_by=OWNER,
            ),
        ]
        source = FakeContent(documents=[document], sheet_snapshots=snapshots)
        env, target = self.environment(source)
        add_document_node(target, "node-1", "Sheet", "sheet-1")

        convert_history_and_comments(env)

        self.assertEqual({row["seq"] for row in target.version_rows.values()}, {2, 9})
        raw = target.read_blob(target.version_rows["snapshot-9"]["blob"])
        self.assertEqual(
            json.loads(raw),
            {"schema": "sheet/1", "sheets_data": '{"sheets":[1]}', "head_seq": 9},
        )

    def test_duplicate_sheet_sequences_refuse_the_document(self):
        document = content_row("Sheet", "sheet-1", "node-1")
        snapshots = [
            SheetSnapshotRow(
                name, "sheet-1", 1, "auto", "{}", actor=OWNER, owner=OWNER, creation=STAMP, modified=STAMP
            )
            for name in ("snapshot-a", "snapshot-b")
        ]
        source = FakeContent(documents=[document], sheet_snapshots=snapshots)
        env, target = self.environment(source)
        add_document_node(target, "node-1", "Sheet", "sheet-1")

        with self.assertRaisesRegex(BuildHistoryError, "not unique"):
            convert_history_and_comments(env)
        self.assertFalse(target.version_rows)

    def test_unlinked_history_is_deferred_then_refused_by_the_drain(self):
        source = FakeContent(documents=[content_row("Writer Document", "orphan", None)])
        env, _ = self.environment(source)

        result = convert_history_and_comments(env)
        self.assertFalse(result.history_completed)
        self.assertEqual(result.history_deferred, 1)

        with self.assertRaisesRegex(BuildHistoryError, "still have no node"):
            convert_history_and_comments(env, allow_deferred=False)

    def test_residual_writer_child_versions_stop_before_any_copy(self):
        document = content_row("Writer Document", "writer-1", "node-1")
        source = FakeContent(documents=[document])
        source.residual_versions = ["legacy-child"]
        env, target = self.environment(source)
        add_document_node(target, "node-1", "Writer Document", "writer-1")

        with self.assertRaisesRegex(BuildHistoryError, "residual Writer Doc Version"):
            convert_history_and_comments(env)
        self.assertFalse(target.version_rows)

    def test_existing_version_with_changed_bytes_is_a_hard_conflict(self):
        document = content_row("Writer Document", "writer-1", "node-1")
        version = WriterVersionRow(
            "version-1", "writer-1", "source", owner=OWNER, creation=STAMP, modified=STAMP
        )
        source = FakeContent(documents=[document], writer_versions=[version])
        env, target = self.environment(source)
        add_document_node(target, "node-1", "Writer Document", "writer-1")
        wrong = target.add_blob("wrong", b"target")
        target.version_rows["version-1"] = {
            "name": "version-1",
            "node": "node-1",
            "seq": 1,
            "blob": wrong.name,
        }

        with self.assertRaisesRegex(BuildHistoryError, "target bytes"):
            convert_history_and_comments(env)


if __name__ == "__main__":
    unittest.main()
