"""§14.2 step 13 and §14.9: the report, its keys, and its evidence trail.

Three properties, all of them stated by the spec: every key it names is
present and spelled its way, a rerun does not destroy the earlier report,
and no share-link token reaches the file or the migration log.
"""

import io
import json
import re
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

from suite.drive.patches.build import report as report_module
from suite.drive.patches.build.report import (
    REPORT_FILENAME,
    REPORT_KEYS,
    BuildReportError,
    build_report,
    print_report,
    produce_report,
    save_report,
)
from suite.drive.patches.build.state import DROP_REASONS, RemovedFileDocument, SkippedRow
from suite.drive.patches.build.tests.fakes import BUILD_STAMP, build_environment


class ReportCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)
        self.private = self.path / "private"
        self.real_directory = report_module._private_directory
        patcher = mock.patch.object(report_module, "_private_directory", lambda: self.private)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.env = build_environment(self.path)

    def put(self, **records):
        """Fill the durable record the report reads."""
        for step, values in records.items():
            stored = getattr(self.env.state, step)()
            for field, value in values.items():
                setattr(stored, field, value)
            getattr(self.env.state, f"put_{step}")(stored)

    def files(self):
        return sorted(p.name for p in self.private.glob("drive-build-report-*.json"))


class KeyTest(ReportCase):
    """§14.9's list, exactly."""

    def test_it_produces_every_specified_key(self):
        report = build_report(self.env)
        for key in REPORT_KEYS:
            with self.subTest(key=key):
                self.assertIn(key, report)

    def test_it_adds_nothing_to_that_namespace(self):
        report = build_report(self.env)
        extra = set(report) - set(REPORT_KEYS)
        self.assertEqual(extra, {"generated_at", "evidence"})

    def test_grant_rows_dropped_carries_the_four_reasons(self):
        self.put(grants={"grant_rows_dropped": {"dead_principal": 3}})
        report = build_report(self.env)
        self.assertEqual(sorted(report["grant_rows_dropped"]), sorted(DROP_REASONS))
        self.assertEqual(report["grant_rows_dropped"]["dead_principal"], 3)
        self.assertEqual(report["grant_rows_dropped"]["no_flags"], 0)

    def test_a_missing_key_fails_loudly(self):
        with mock.patch.object(report_module, "REPORT_KEYS", (*REPORT_KEYS, "invented")):
            with self.assertRaises(BuildReportError):
                build_report(self.env)


class SourceTest(ReportCase):
    """Which record each number is read from, including the three sums."""

    def test_it_reads_the_tree_and_grant_records(self):
        self.put(
            tree={"removed_rows_skipped": 4, "broken_chains_skipped": 5},
            grants={"links_minted": 6, "composite_rows_dropped": 7},
        )
        report = build_report(self.env)
        self.assertEqual(report["removed_rows_skipped"], 4)
        self.assertEqual(report["broken_chains_skipped"], 5)
        self.assertEqual(report["links_minted"], 6)
        self.assertEqual(report["composite_rows_dropped"], 7)

    def test_blobless_nodes_counts_both_steps_that_mint_them(self):
        self.put(tree={"blobless_nodes": 2}, content={"blobless_nodes": 3})
        self.assertEqual(build_report(self.env)["blobless_nodes"], 5)

    def test_title_renames_counts_both_steps_that_dedupe(self):
        self.put(tree={"title_renames": 2}, content={"title_renames": 3})
        self.assertEqual(build_report(self.env)["title_renames"], 5)

    def test_docshare_rows_dropped_counts_both_share_sources(self):
        self.put(grants={"docshare_rows_dropped": 2}, content={"docshare_rows_dropped": 3})
        self.assertEqual(build_report(self.env)["docshare_rows_dropped"], 5)

    def test_the_activity_keys_come_from_step_nine(self):
        self.put(records={"activity_rows_dropped": 8, "activity_verbs_derived": 9})
        report = build_report(self.env)
        self.assertEqual(report["activity_rows_dropped"], 8)
        self.assertEqual(report["activity_verbs_derived"], 9)

    def test_the_reservation_root_count_comes_from_step_eleven(self):
        self.put(settings={"personal_roots_created_for_reservations": 4})
        self.assertEqual(build_report(self.env)["personal_roots_created_for_reservations"], 4)

    def test_the_s3_keys_come_from_the_byte_preparation(self):
        self.put(storage={"s3_objects_copied": 11, "s3_bytes_copied": 2048})
        report = build_report(self.env)
        self.assertEqual(report["s3_objects_copied"], 11)
        self.assertEqual(report["s3_bytes_copied"], 2048)

    def test_the_evidence_block_carries_every_record(self):
        report = build_report(self.env)
        self.assertEqual(
            sorted(report["evidence"]),
            ["content", "grants", "records", "settings", "storage", "tree", "usage"],
        )

    def test_the_evidence_carries_the_removed_file_documents(self):
        # §14.9 names no key for them, so they ride in the evidence block
        # with the other skips the spec leaves unnamed, count and list.
        content = self.env.state.content()
        content.record_removed_file(RemovedFileDocument("Sheet", "sheet-1", "file-1"))
        self.env.state.put_content(content)

        evidence = build_report(self.env)["evidence"]["content"]

        self.assertEqual(evidence["removed_file_documents"], 1)
        self.assertEqual(
            evidence["removed_file_docs"],
            [{"doctype": "Sheet", "name": "sheet-1", "file": "file-1"}],
        )

    def test_it_is_stamped_with_the_build_clock(self):
        self.assertEqual(build_report(self.env)["generated_at"], BUILD_STAMP)


class PrivacyTest(ReportCase):
    """§14.9 reports how many links were minted, never which token."""

    def test_it_refuses_to_write_a_share_link_principal(self):
        tree = self.env.state.tree()
        tree.record_skip(SkippedRow("f1", "refused for $LINK:abcdefghijklmnopqrstuv"))
        self.env.state.put_tree(tree)
        with self.assertRaises(BuildReportError):
            build_report(self.env)

    def test_no_token_reaches_the_saved_file(self):
        self.put(grants={"links_minted": 3, "link_nodes": ["node1", "node2"]})
        _report, path = produce_report(self.env)
        body = Path(path).read_text()
        self.assertNotIn("$LINK:", body)
        self.assertIn('"links_minted": 3', body)

    def test_it_is_saved_under_the_private_directory(self):
        # The rest of the suite redirects the directory. This one test reads
        # the real resolver, because "saved privately" is the requirement.
        with mock.patch.object(report_module, "_private_directory", self.real_directory):
            with mock.patch("frappe.get_site_path", return_value=str(self.private)) as site_path:
                self.assertEqual(report_module._private_directory(), self.private)
        site_path.assert_called_once_with("private")


class SaveTest(ReportCase):
    """Evidence survives a rerun."""

    def test_it_writes_an_immutable_copy_and_a_latest_pointer(self):
        report = build_report(self.env)
        path = save_report(self.env, report)
        self.assertTrue(Path(path).exists())
        latest = self.private / REPORT_FILENAME
        self.assertEqual(json.loads(latest.read_text()), json.loads(Path(path).read_text()))

    def test_a_second_run_does_not_overwrite_the_first(self):
        first = save_report(self.env, build_report(self.env))
        self.put(tree={"removed_rows_skipped": 42})
        second = save_report(self.env, build_report(self.env))
        self.assertNotEqual(first, second)
        self.assertEqual(json.loads(Path(first).read_text())["removed_rows_skipped"], 0)
        self.assertEqual(json.loads(Path(second).read_text())["removed_rows_skipped"], 42)
        self.assertEqual(len(self.files()), 2)

    def test_the_latest_pointer_follows_the_last_run(self):
        save_report(self.env, build_report(self.env))
        self.put(tree={"removed_rows_skipped": 42})
        save_report(self.env, build_report(self.env))
        latest = json.loads((self.private / REPORT_FILENAME).read_text())
        self.assertEqual(latest["removed_rows_skipped"], 42)

    def test_the_durable_record_lists_every_run(self):
        save_report(self.env, build_report(self.env))
        save_report(self.env, build_report(self.env))
        record = self.env.state.report()
        self.assertEqual(record.runs_total, 2)
        self.assertEqual(len(record.runs), 2)
        self.assertEqual(sorted(run.path for run in record.runs), self.files())

    def test_no_temporary_file_is_left_behind(self):
        save_report(self.env, build_report(self.env))
        self.assertEqual(sorted(p.name for p in self.private.glob("*.tmp")), [])


class PrintTest(ReportCase):
    """The migration log gets §14.9's keys and not the evidence."""

    def capture(self, report):
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            print_report(report)
        return buffer.getvalue()

    def test_it_prints_every_specified_key(self):
        printed = json.loads(self.capture(build_report(self.env)))
        self.assertEqual(sorted(printed), sorted(REPORT_KEYS))

    def test_it_does_not_print_the_evidence(self):
        self.put(tree={"skipped_total": 5})
        printed = self.capture(build_report(self.env))
        self.assertNotIn("skipped_total", printed)
        self.assertNotIn("evidence", printed)

    def test_produce_report_prints_saves_and_returns_the_path(self):
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            report, path = produce_report(self.env)
        self.assertTrue(Path(path).exists())
        self.assertIn("links_minted", buffer.getvalue())
        self.assertEqual(report["links_minted"], 0)
        self.assertTrue(re.search(r"drive-build-report-\d{8}-\d{6}-\d+\.json$", path))


if __name__ == "__main__":
    unittest.main()
