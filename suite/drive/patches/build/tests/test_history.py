"""Writer and Sheet history conversion without a site."""

import json
import tempfile
import unittest
from pathlib import Path

from suite.drive.patches.build.content_mapping import MAX_VERSION_SEQ
from suite.drive.patches.build.history import BuildHistoryError, convert_history_and_comments
from suite.drive.patches.build.ports import (
    REMOVED,
    ContentRow,
    SheetSnapshotRow,
    TreeRow,
    WriterVersionRow,
)
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

    def test_a_killed_pass_does_not_move_the_frozen_thinning_census(self):
        """§14.6: the census counts what the ladder will thin after Build.

        A pass that dies partway writes a partial `versions_seen` next to the
        earlier pass's `report_at`, because the record is written per document.
        Reading that partial count as "new history arrived" would re-mint
        `report_at` to today and sweep in every version written since.
        """
        document = content_row("Writer Document", "writer-1", "node-1")
        versions = [
            WriterVersionRow(
                f"version-{index}", "writer-1", "<p>x</p>", owner=OWNER, creation=STAMP, modified=STAMP
            )
            for index in range(3)
        ]
        source = FakeContent(documents=[document], writer_versions=versions)
        times = iter(("2024-04-01 00:00:00", "2024-04-02 00:00:00", "2024-04-03 00:00:00"))
        target = FakeContentTarget(content=source)
        env = build_environment(
            self.path,
            content=source,
            content_target=target,
            content_ready=True,
            clock=lambda: next(times),
        )
        add_document_node(target, "node-1", "Writer Document", "writer-1")

        first = convert_history_and_comments(env)
        self.assertEqual(first.report_at, "2024-04-01 00:00:00")
        self.assertEqual(first.versions_seen, 3)

        # The kill: a pass that reset the phase and counted one document before
        # it stopped. Nothing about the source changed.
        killed = env.state.content()
        killed.history_completed = False
        killed.versions_seen = 1
        env.state.put_content(killed)

        third = convert_history_and_comments(env)

        self.assertEqual(third.report_at, first.report_at)
        self.assertEqual(third.versions_seen, 3)
        self.assertTrue(third.history_completed)

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

    def test_a_broken_reciprocal_link_is_recorded_before_it_raises(self):
        document = content_row("Writer Document", "writer-1", "node-1")
        source = FakeContent(documents=[document])
        env, _ = self.environment(source)

        with self.assertRaisesRegex(BuildHistoryError, "broken reciprocal link"):
            convert_history_and_comments(env)

        # Resolving the node ran outside the guard, so this refusal used to
        # end the run with no issue recorded and no state written.
        state = env.state.content()
        self.assertEqual(len(state.issues), 1)
        self.assertIn("broken reciprocal link", state.issues[0].reason)

    def test_a_missing_sheet_sequence_is_a_content_refusal_not_a_type_error(self):
        document = content_row("Sheet", "sheet-1", "node-1")
        snapshot = SheetSnapshotRow(
            "snapshot-a",
            "sheet-1",
            None,
            "auto",
            "{}",
            actor=OWNER,
            owner=OWNER,
            creation=STAMP,
            modified=STAMP,
        )
        source = FakeContent(documents=[document], sheet_snapshots=[snapshot])
        env, target = self.environment(source)
        add_document_node(target, "node-1", "Sheet", "sheet-1")

        # `int(None)` raises `TypeError`, which the guard does not catch.
        with self.assertRaisesRegex(BuildHistoryError, "does not fit the target positive Int"):
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

    def test_new_source_history_invalidates_the_frozen_report_timestamp(self):
        document = content_row("Writer Document", "writer-1", "node-1")
        source = FakeContent(documents=[document], writer_versions=[])
        times = iter(("2024-04-01 00:00:00", "2024-04-02 00:00:00", "2024-04-03 00:00:00"))
        target = FakeContentTarget(content=source)
        env = build_environment(
            self.path,
            content=source,
            content_target=target,
            content_ready=True,
            clock=lambda: next(times),
        )
        add_document_node(target, "node-1", "Writer Document", "writer-1")

        first = convert_history_and_comments(env)
        source.writer_version_rows.append(
            WriterVersionRow(
                "version-1", "writer-1", "<p>new</p>", owner=OWNER, creation=STAMP, modified=STAMP
            )
        )
        second = convert_history_and_comments(env)

        # §8: an unchanged completed rerun reuses its timestamp, and history
        # that arrived after it finalizes a new census against a new one.
        self.assertEqual(first.report_at, "2024-04-01 00:00:00")
        self.assertNotEqual(second.report_at, first.report_at)
        self.assertEqual(second.versions_seen, 1)

    def test_a_removed_file_fails_completion_with_recorded_evidence(self):
        document = content_row("Writer Document", "writer-1", None)
        source = FakeContent(documents=[document])
        source.file_rows.append(
            TreeRow(
                "file-1",
                status=REMOVED,
                content_doctype="Writer Document",
                content_docname="writer-1",
            )
        )
        env, _ = self.environment(source)

        with self.assertRaisesRegex(BuildHistoryError, "Removed"):
            convert_history_and_comments(env)

        # A Removed File is not an orphan and not a crash: the run fails with
        # bounded evidence in the durable state.
        stored = env.state.content()
        self.assertEqual([issue.source for issue in stored.issues], ["Writer Document:writer-1"])
        self.assertFalse(stored.history_completed)

    def test_every_writer_version_column_carries_its_source_value(self):
        # `exact_fields` compares a stored row against a plan the same code
        # builds, so a rerun cannot catch a wrong mapping: both sides move.
        # These assertions read the written row instead.
        document = content_row("Writer Document", "writer-1", "node-1")
        versions = [
            WriterVersionRow(
                "version-auto",
                "writer-1",
                "<p>auto</p>",
                title="Autosave",
                manual=0,
                owner="author@example.com",
                creation="2024-01-01 00:00:00.000000",
                modified="2024-03-03 00:00:00.000000",
                modified_by="editor@example.com",
            ),
            WriterVersionRow(
                "version-named",
                "writer-1",
                "<p>named</p>",
                title="Draft two",
                manual=1,
                owner="author@example.com",
                creation="2024-02-01 00:00:00.000000",
                modified=STAMP,
            ),
        ]
        source = FakeContent(documents=[document], writer_versions=versions)
        env, target = self.environment(source)
        add_document_node(target, "node-1", "Writer Document", "writer-1")

        convert_history_and_comments(env)

        auto = target.version_rows["version-auto"]
        named = target.version_rows["version-named"]
        self.assertEqual(auto["kind"], "auto")
        self.assertEqual(named["kind"], "named")
        self.assertEqual(auto["label"], "Autosave")
        self.assertEqual(named["label"], "Draft two")
        # §8: a Writer version has no pin, and its actor is its own owner, not
        # the document owner and not the last editor.
        self.assertEqual(auto["pinned"], 0)
        self.assertEqual(named["pinned"], 0)
        self.assertEqual(auto["actor"], "author@example.com")
        self.assertEqual(auto["size"], len(b"<p>auto</p>"))
        self.assertEqual(named["size"], len(b"<p>named</p>"))
        self.assertEqual(auto["owner"], "author@example.com")
        self.assertEqual(auto["creation"], "2024-01-01 00:00:00.000000")
        self.assertEqual(auto["modified"], "2024-03-03 00:00:00.000000")
        self.assertEqual(auto["modified_by"], "editor@example.com")
        # `modified_by` falls back to the row owner, never to the document.
        self.assertEqual(named["modified_by"], "author@example.com")

    def test_every_sheet_snapshot_column_carries_its_source_value(self):
        document = content_row("Sheet", "sheet-1", "node-1")
        payload = '{"sheets":[1]}'
        snapshots = [
            SheetSnapshotRow(
                "snapshot-1",
                "sheet-1",
                1,
                "milestone",
                payload,
                label="Quarter close",
                pinned=1,
                actor="actor@example.com",
                owner="author@example.com",
                creation="2024-01-01 00:00:00.000000",
                modified="2024-03-03 00:00:00.000000",
                modified_by="editor@example.com",
            ),
        ]
        source = FakeContent(documents=[document], sheet_snapshots=snapshots)
        env, target = self.environment(source)
        add_document_node(target, "node-1", "Sheet", "sheet-1")

        convert_history_and_comments(env)

        row = target.version_rows["snapshot-1"]
        expected = json.dumps({"schema": "sheet/1", "sheets_data": payload, "head_seq": 1}).encode()
        self.assertEqual(row["kind"], "milestone")
        self.assertEqual(row["label"], "Quarter close")
        self.assertEqual(row["pinned"], 1)
        # A Sheet snapshot carries its own `actor`, which is not its owner.
        self.assertEqual(row["actor"], "actor@example.com")
        self.assertEqual(row["owner"], "author@example.com")
        self.assertEqual(row["modified_by"], "editor@example.com")
        self.assertEqual(row["size"], len(expected))
        self.assertEqual(target.read_blob(row["blob"]), expected)

    def test_an_invalid_snapshot_kind_refuses_the_document(self):
        document = content_row("Sheet", "sheet-1", "node-1")
        snapshots = [
            SheetSnapshotRow(
                "snapshot-1",
                "sheet-1",
                1,
                "manual",
                "{}",
                actor=OWNER,
                owner=OWNER,
                creation=STAMP,
                modified=STAMP,
            )
        ]
        source = FakeContent(documents=[document], sheet_snapshots=snapshots)
        env, target = self.environment(source)
        add_document_node(target, "node-1", "Sheet", "sheet-1")

        with self.assertRaisesRegex(BuildHistoryError, "invalid kind"):
            convert_history_and_comments(env)
        self.assertFalse(target.version_rows)

    def test_a_version_without_an_actor_refuses_the_document(self):
        document = content_row("Sheet", "sheet-1", "node-1")
        snapshots = [
            SheetSnapshotRow(
                "snapshot-1",
                "sheet-1",
                1,
                "auto",
                "{}",
                actor=None,
                owner=OWNER,
                creation=STAMP,
                modified=STAMP,
            )
        ]
        source = FakeContent(documents=[document], sheet_snapshots=snapshots)
        env, target = self.environment(source)
        add_document_node(target, "node-1", "Sheet", "sheet-1")

        with self.assertRaisesRegex(BuildHistoryError, "no actor"):
            convert_history_and_comments(env)

    def test_incomplete_source_stamps_refuse_the_document(self):
        document = content_row("Sheet", "sheet-1", "node-1")
        snapshots = [
            SheetSnapshotRow(
                "snapshot-1",
                "sheet-1",
                1,
                "auto",
                "{}",
                actor=OWNER,
                owner=OWNER,
                creation=STAMP,
                modified=None,
            )
        ]
        source = FakeContent(documents=[document], sheet_snapshots=snapshots)
        env, target = self.environment(source)
        add_document_node(target, "node-1", "Sheet", "sheet-1")

        with self.assertRaisesRegex(BuildHistoryError, "incomplete standard stamps"):
            convert_history_and_comments(env)

    def test_a_sequence_outside_the_target_int_refuses_the_document(self):
        for seq in (0, MAX_VERSION_SEQ + 1):
            with self.subTest(seq=seq):
                document = content_row("Sheet", "sheet-1", "node-1")
                snapshots = [
                    SheetSnapshotRow(
                        "snapshot-1",
                        "sheet-1",
                        seq,
                        "auto",
                        "{}",
                        actor=OWNER,
                        owner=OWNER,
                        creation=STAMP,
                        modified=STAMP,
                    )
                ]
                source = FakeContent(documents=[document], sheet_snapshots=snapshots)
                env, target = self.environment(source)
                add_document_node(target, "node-1", "Sheet", "sheet-1")

                with self.assertRaisesRegex(BuildHistoryError, "positive Int"):
                    convert_history_and_comments(env)
                self.assertFalse(target.version_rows)

    def test_a_sequence_another_version_already_holds_refuses_the_document(self):
        # `Drive Node Version` has a real unique index on `(node, seq)`, so this
        # preflight is what keeps a site run off an IntegrityError.
        document = content_row("Sheet", "sheet-1", "node-1")
        snapshots = [
            SheetSnapshotRow(
                "snapshot-new",
                "sheet-1",
                4,
                "auto",
                "{}",
                actor=OWNER,
                owner=OWNER,
                creation=STAMP,
                modified=STAMP,
            )
        ]
        source = FakeContent(documents=[document], sheet_snapshots=snapshots)
        env, target = self.environment(source)
        add_document_node(target, "node-1", "Sheet", "sheet-1")
        target.version_rows["squatter"] = {"name": "squatter", "node": "node-1", "seq": 4}

        with self.assertRaisesRegex(BuildHistoryError, "sequence 4 is occupied"):
            convert_history_and_comments(env)
        self.assertNotIn("snapshot-new", target.version_rows)

    def test_a_stored_version_whose_sequence_moved_refuses_the_document(self):
        # The other occupied branch: the id is already migrated and validates,
        # but a different row now sits on the sequence it needs.
        document = content_row("Sheet", "sheet-1", "node-1")
        payload = "{}"
        snapshots = [
            SheetSnapshotRow(
                "snapshot-1",
                "sheet-1",
                3,
                "auto",
                payload,
                actor=OWNER,
                owner=OWNER,
                creation=STAMP,
                modified=STAMP,
            )
        ]
        source = FakeContent(documents=[document], sheet_snapshots=snapshots)
        env, target = self.environment(source)
        add_document_node(target, "node-1", "Sheet", "sheet-1")
        convert_history_and_comments(env)
        target.version_rows["squatter"] = {"name": "squatter", "node": "node-1", "seq": 3}
        target.version_rows["snapshot-1"]["seq"] = 3

        with self.assertRaisesRegex(BuildHistoryError, "sequence 3 is occupied"):
            convert_history_and_comments(env)

    def test_the_target_refuses_a_duplicate_node_and_sequence_pair(self):
        # The fake models `version_node_seq`. Without it the preflights above
        # could be deleted and every history test would stay green.
        target = FakeContentTarget(content=FakeContent())
        target.insert_versions([{"name": "a", "node": "node-1", "seq": 1}])
        with self.assertRaisesRegex(ValueError, "node/seq"):
            target.insert_versions([{"name": "b", "node": "node-1", "seq": 1}])

    def test_a_head_snapshot_outside_the_source_refuses_the_document(self):
        document = ContentRow(
            **{**content_row("Sheet", "sheet-1", "node-1").__dict__, "head_snapshot": "snapshot-gone"}
        )
        snapshots = [
            SheetSnapshotRow(
                "snapshot-1",
                "sheet-1",
                1,
                "auto",
                "{}",
                actor=OWNER,
                owner=OWNER,
                creation=STAMP,
                modified=STAMP,
            )
        ]
        source = FakeContent(documents=[document], sheet_snapshots=snapshots)
        env, target = self.environment(source)
        add_document_node(target, "node-1", "Sheet", "sheet-1")

        with self.assertRaisesRegex(BuildHistoryError, "head_snapshot"):
            convert_history_and_comments(env)

    def test_a_head_snapshot_pointing_at_another_node_refuses_the_document(self):
        document = ContentRow(
            **{**content_row("Sheet", "sheet-1", "node-1").__dict__, "head_snapshot": "snapshot-1"}
        )
        snapshots = [
            SheetSnapshotRow(
                "snapshot-1",
                "sheet-1",
                1,
                "auto",
                "{}",
                actor=OWNER,
                owner=OWNER,
                creation=STAMP,
                modified=STAMP,
            )
        ]
        source = FakeContent(documents=[document], sheet_snapshots=snapshots)
        env, target = self.environment(source)
        add_document_node(target, "node-1", "Sheet", "sheet-1")
        convert_history_and_comments(env)
        # §8: the head keeps its source id, and that id must still name this
        # node's version. A row moved under another node breaks the relation.
        target.version_rows["snapshot-1"]["node"] = "node-other"

        with self.assertRaisesRegex(BuildHistoryError, "field node"):
            convert_history_and_comments(env)

    def test_the_source_is_read_in_bounded_pages_with_a_keyset_cursor(self):
        # Plan §13: `(doc, creation, name)` and `(sheet, seq, name)`. One
        # `sheets_data` reaches 75 MB, so an unpaged read is not an option.
        document = content_row("Writer Document", "writer-1", "node-1")
        versions = [
            WriterVersionRow(
                f"version-{index}",
                "writer-1",
                f"<p>{index}</p>",
                owner=OWNER,
                creation=f"2024-01-{index:02d} 00:00:00.000000",
                modified=STAMP,
            )
            for index in range(1, 6)
        ]
        source = FakeContent(documents=[document], writer_versions=versions)
        calls = []
        original = source.writer_versions

        def recording(doc, after, limit):
            calls.append((doc, after, limit))
            return original(doc, after, limit)

        source.writer_versions = recording
        env, target = self.environment(source)
        add_document_node(target, "node-1", "Writer Document", "writer-1")

        convert_history_and_comments(env, batch_size=4)

        self.assertEqual([call[2] for call in calls], [2, 2, 2])
        self.assertEqual(calls[0][1], ("", ""))
        self.assertEqual(calls[1][1], ("2024-01-02 00:00:00.000000", "version-2"))
        self.assertEqual(len(target.version_rows), 5)
        self.assertEqual(target.version_rows["version-5"]["seq"], 5)

    def test_history_evidence_does_not_accumulate_across_runs(self):
        # The three phases share one record, so a history rerun must clear the
        # history evidence and leave every other phase's numbers alone.
        document = content_row("Writer Document", "writer-1", None)
        source = FakeContent(documents=[document])
        source.file_rows.append(
            TreeRow("file-1", status=REMOVED, content_doctype="Writer Document", content_docname="writer-1")
        )
        env, _ = self.environment(source)
        stored = env.state.content()
        stored.record_issue("Presentation:deck-1", "kept", phase="slides")
        stored.media_nodes_created = 3
        env.state.put_content(stored)

        for _ in range(2):
            with self.assertRaises(BuildHistoryError):
                convert_history_and_comments(env)

        after = env.state.content()
        self.assertEqual(after.issues_total, 2)
        self.assertEqual(
            sorted(issue.source for issue in after.issues),
            ["Presentation:deck-1", "Writer Document:writer-1"],
        )
        self.assertEqual(after.media_nodes_created, 3)


if __name__ == "__main__":
    unittest.main()
