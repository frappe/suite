"""The skipped-row file and the refusal that goes with it."""

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from suite.drive.patches.build.skips import (
    SKIPPED_FILENAME,
    UnacceptedSkipsError,
    collect_skips,
    report_skips,
)
from suite.drive.patches.build.state import MissingBytes, SkippedRow
from suite.drive.patches.build.tests.fakes import build_environment


class SkipsCase(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def env(self, **kwargs):
        return build_environment(self.path, **kwargs)

    def with_skips(self, env, *, reachable=0, removed=0, missing=0):
        tree = env.state.tree()
        tree.over_capacity_skipped = reachable
        tree.removed_rows_skipped = removed
        for index in range(reachable):
            tree.record_skip(SkippedRow(file=f"deep{index}", reason="subtree deeper than the cap"))
        env.state.put_tree(tree)
        storage = env.state.storage()
        for index in range(missing):
            storage.record_missing(
                MissingBytes(file=f"m{index}", file_url="/private/files/m", reason="unreadable")
            )
        env.state.put_storage(storage)
        return env

    def written(self):
        return json.loads((self.path / SKIPPED_FILENAME).read_text())


class TestTheFile(SkipsCase):
    def test_every_skipped_row_and_its_reason_is_written_beside_the_record(self):
        env = self.with_skips(self.env(accept_skips=True), reachable=2, removed=3, missing=1)
        report_skips(env)
        document = self.written()
        self.assertEqual(document["refusing_total"], 2)
        self.assertEqual(document["refusing"]["over_capacity_skipped"], 2)
        self.assertEqual(document["reported"]["removed_rows_skipped"], 3)
        self.assertEqual(
            document["skipped_rows"],
            [
                {"file": "deep0", "reason": "subtree deeper than the cap"},
                {"file": "deep1", "reason": "subtree deeper than the cap"},
            ],
        )
        self.assertEqual(document["missing_bytes_total"], 1)
        self.assertEqual(document["missing_bytes"][0]["file"], "m0")
        self.assertTrue(document["accepted"])

    def test_a_clean_run_writes_a_file_that_says_nothing_was_skipped(self):
        report_skips(self.env())
        document = self.written()
        self.assertEqual(document["refusing_total"], 0)
        self.assertEqual(document["skipped_rows"], [])


class TestTheRefusal(SkipsCase):
    def test_a_reachable_row_without_a_node_stops_the_migration(self):
        env = self.with_skips(self.env(), reachable=1)
        with self.assertRaises(UnacceptedSkipsError) as caught:
            report_skips(env)
        self.assertIn("drive_build_accept_skips", str(caught.exception))
        # The file is written before the refusal, so the operator can read it.
        self.assertEqual(self.written()["refusing_total"], 1)

    def test_an_accepted_skip_lets_the_migration_finish(self):
        env = self.with_skips(self.env(accept_skips=True), reachable=1)
        self.assertEqual(report_skips(env)["refusing_total"], 1)

    def test_removed_rows_and_missing_bytes_are_reported_but_do_not_refuse(self):
        env = self.with_skips(self.env(), removed=5, missing=2)
        skips = report_skips(env)
        self.assertEqual(skips["refusing_total"], 0)
        self.assertEqual(skips["reported"]["removed_rows_skipped"], 5)
        self.assertEqual(skips["missing_bytes_total"], 2)

    def test_collect_reads_the_record_not_this_runs_memory(self):
        self.with_skips(self.env(), reachable=1)
        fresh = self.env()
        self.assertEqual(collect_skips(fresh)["refusing_total"], 1)
