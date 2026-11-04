"""§14.2: the whole Build order, composed, resumable, and reported.

Two kinds of test. The order tests replace each step with a spy, because
what `patch.py` owns is the sequence and the two `completed` flags. The
end-to-end test runs every real step over one small legacy tree, so the
report at the end is produced from rows the earlier steps wrote.
"""

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from suite.drive.patches.build import patch as patch_module
from suite.drive.patches.build import report as report_module
from suite.drive.patches.build.environment import LegacyS3Config
from suite.drive.patches.build.patch import CONTENT_PASSES, BuildPatchError, execute, run_build
from suite.drive.patches.build.ports import (
    ACTIVE,
    DRIVE_ROOT_ROW,
    TRASHED,
    USERS_ROW,
    ActivityLogRow,
    EntityRow,
    FavouriteRow,
    PermissionRow,
    RecentRow,
    ReservationRow,
    TreeRow,
    UserQuotaRow,
)
from suite.drive.patches.build.report import REPORT_KEYS
from suite.drive.patches.build.tests.fakes import (
    FakeDrive,
    FakeRecords,
    FakeRecordsTarget,
    FakeSettings,
    FakeSettingsTarget,
    FakeTree,
    InterruptedRun,
    build_environment,
)

OWNER = "owner@example.com"
SOURCE_CREATION = "2020-01-01 00:00:00.000000"
SOURCE_MODIFIED = "2020-01-02 00:00:00.000000"

# Every step `patch.py` calls, in the order §14.2 numbers them.
STEP_NAMES = (
    "prepare_legacy_bytes",
    "convert_root_pairs",
    "convert_trees",
    "convert_grants",
    "convert_history_and_comments",
    "convert_slides_and_templates",
    "convert_records",
    "link_content_documents",
    "convert_settings",
    "recompute_usage",
    "produce_report",
)


class OrderCase(unittest.TestCase):
    """Every step replaced by a spy that records its name."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.env = build_environment(Path(self.tmp.name))
        self.calls = []
        self.content = self.env.state.content()
        self.content.completed = True
        for name in STEP_NAMES:
            self.spy(name)

    def spy(self, name, result=None):
        def recorded(*args, **kwargs):
            self.calls.append(name)
            if name == "produce_report":
                return ({}, "report.json")
            if name == "convert_root_pairs":
                return []
            if name in ("convert_slides_and_templates", "link_content_documents"):
                return self.content
            return result

        patcher = mock.patch.object(patch_module, name, recorded)
        patcher.start()
        self.addCleanup(patcher.stop)


class OrderTest(OrderCase):
    def test_it_runs_every_step_in_the_order_the_spec_numbers_them(self):
        run_build(self.env)
        self.assertEqual(self.calls, list(STEP_NAMES))

    def test_it_answers_the_report(self):
        self.assertEqual(run_build(self.env), {})

    def test_step_nine_runs_before_the_content_links(self):
        run_build(self.env)
        self.assertLess(self.calls.index("convert_records"), self.calls.index("link_content_documents"))

    def test_the_recompute_is_the_last_step_that_writes(self):
        run_build(self.env)
        self.assertEqual(self.calls[-2:], ["recompute_usage", "produce_report"])


class CompletionFlagTest(OrderCase):
    """The two flags every later phase reads and no phase sets."""

    def test_it_marks_the_tree_and_the_grants_complete(self):
        run_build(self.env)
        self.assertTrue(self.env.state.tree().completed)
        self.assertTrue(self.env.state.grants().completed)

    def test_a_failed_tree_walk_leaves_the_flag_false(self):
        with mock.patch.object(patch_module, "convert_trees", side_effect=RuntimeError("killed")):
            with self.assertRaises(RuntimeError):
                run_build(self.env)
        self.assertFalse(self.env.state.tree().completed)

    def test_a_failed_grant_step_leaves_the_flag_false(self):
        with mock.patch.object(patch_module, "convert_grants", side_effect=RuntimeError("killed")):
            with self.assertRaises(RuntimeError):
                run_build(self.env)
        self.assertTrue(self.env.state.tree().completed)
        self.assertFalse(self.env.state.grants().completed)


class ContentPassTest(OrderCase):
    """Step 10 adopts a deck that step 8 has already passed."""

    def test_a_second_pass_converts_what_step_ten_adopted(self):
        self.content.completed = False

        def link(*_args, **_kwargs):
            self.calls.append("link_content_documents")
            # The first link pass adopts a deck, so the slides record is
            # still incomplete. The second finds nothing left to adopt.
            self.content.completed = self.calls.count("link_content_documents") > 1
            return self.content

        with mock.patch.object(patch_module, "link_content_documents", link):
            run_build(self.env)
        self.assertEqual(self.calls.count("convert_slides_and_templates"), 2)
        self.assertEqual(self.calls.count("link_content_documents"), 2)
        # Step 9 stays where §14.2 puts it, whatever the content passes do.
        self.assertEqual(self.calls.count("convert_records"), 1)

    def test_a_record_that_never_completes_stops_the_migration(self):
        self.content.completed = False
        with self.assertRaises(BuildPatchError):
            run_build(self.env)
        self.assertEqual(self.calls.count("link_content_documents"), CONTENT_PASSES)
        self.assertNotIn("recompute_usage", self.calls)


class EntryPointTest(unittest.TestCase):
    def test_execute_runs_build_against_the_site_environment(self):
        environment = object()
        with mock.patch.object(patch_module.BuildEnvironment, "for_site", return_value=environment):
            with mock.patch.object(patch_module, "run_build") as build:
                execute()
        build.assert_called_once_with(environment)


def folder(name, parent):
    return TreeRow(
        name=name,
        file_name=name,
        folder=parent,
        is_folder=1,
        owner=OWNER,
        creation=SOURCE_CREATION,
        modified=SOURCE_MODIFIED,
        status=ACTIVE,
    )


class WholePatchTest(unittest.TestCase):
    """One legacy tree, every real step, one report at the end."""

    PERSONAL = "personal01"
    DOCUMENT = "document01"

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)
        self.private = self.path / "private"
        patcher = mock.patch.object(report_module, "_private_directory", lambda: self.private)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.drive = FakeDrive()
        self.legacy = FakeTree(drive=self.drive, users={OWNER: True})
        for row in (
            TreeRow(
                name=DRIVE_ROOT_ROW,
                file_name="Drive",
                folder=None,
                is_folder=1,
                owner="Administrator",
                creation=SOURCE_CREATION,
                modified=SOURCE_MODIFIED,
                status=ACTIVE,
            ),
            TreeRow(
                name=USERS_ROW,
                file_name="Users",
                folder=None,
                is_folder=1,
                owner="Administrator",
                creation=SOURCE_CREATION,
                modified=SOURCE_MODIFIED,
                status=ACTIVE,
            ),
            TreeRow(
                name=self.PERSONAL,
                file_name=OWNER,
                folder=USERS_ROW,
                is_folder=1,
                owner=OWNER,
                creation=SOURCE_CREATION,
                modified=SOURCE_MODIFIED,
                status=ACTIVE,
            ),
            TreeRow(
                name=self.DOCUMENT,
                file_name="notes.txt",
                folder=self.PERSONAL,
                is_folder=0,
                owner=OWNER,
                creation=SOURCE_CREATION,
                modified=SOURCE_MODIFIED,
                status=ACTIVE,
                file_size=120,
            ),
        ):
            self.legacy.rows[row.name] = row

    def make_env(self):
        return build_environment(
            self.path,
            tree=self.legacy,
            drive=self.drive,
            legacy_s3=LegacyS3Config(enabled=False),
        )

    def test_it_migrates_the_tree_and_reports_on_it(self):
        env = self.make_env()
        report = run_build(env)
        self.assertIn(self.DOCUMENT, self.drive.node_rows)
        self.assertEqual(self.drive.node_rows[self.DOCUMENT]["root"], self.PERSONAL)
        self.assertEqual(report["removed_rows_skipped"], 0)
        self.assertEqual(report["broken_chains_skipped"], 0)

    def test_every_step_ends_complete(self):
        env = self.make_env()
        run_build(env)
        self.assertTrue(env.state.storage().completed)
        self.assertTrue(env.state.tree().completed)
        self.assertTrue(env.state.grants().completed)
        self.assertTrue(env.state.content().completed)
        self.assertTrue(env.state.records().completed)
        self.assertTrue(env.state.settings().completed)
        self.assertTrue(env.state.usage().completed)

    def test_the_recompute_charges_the_migrated_bytes_to_the_root(self):
        env = self.make_env()
        env.usage.total_rows = {self.PERSONAL: {"nodes": 120, "versions": 0, "reserved": 0}}
        run_build(env)
        self.assertEqual(self.drive.root_rows[self.PERSONAL]["used_bytes"], 120)
        self.assertEqual(env.state.usage().reconciliation_mismatches, 0)

    def test_the_report_is_saved_privately_and_survives_a_rerun(self):
        env = self.make_env()
        run_build(env)
        run_build(env)
        saved = sorted(self.private.glob("drive-build-report-*.json"))
        self.assertEqual(len(saved), 2)
        self.assertEqual(env.state.report().runs_total, 2)
        for path in saved:
            self.assertNotIn("$LINK:", path.read_text())

    def test_a_rerun_writes_no_second_node(self):
        env = self.make_env()
        first = run_build(env)
        nodes = dict(self.drive.node_rows)
        second = run_build(env)
        self.assertEqual(self.drive.node_rows, nodes)
        # §14.9's own keys are decided from the source rows, so the rerun
        # reports the same migration. The evidence block below them is not:
        # `shared_anchors_written` counts writes, and the second run makes
        # none.
        self.assertEqual(
            json.dumps({key: first[key] for key in REPORT_KEYS}, sort_keys=True),
            json.dumps({key: second[key] for key in REPORT_KEYS}, sort_keys=True),
        )

    def test_a_kill_inside_the_tree_walk_resumes_to_the_same_result(self):
        killed = self.make_env()
        self.drive.fail_pair = self.PERSONAL
        with self.assertRaises(Exception):
            run_build(killed)
        self.drive.fail_pair = None
        self.drive.rollback()
        resumed = self.make_env()
        run_build(resumed)
        self.assertIn(self.DOCUMENT, self.drive.node_rows)
        self.assertTrue(resumed.state.usage().completed)


OTHER = "other@example.com"


class ReportCensusTest(unittest.TestCase):
    """§14.9's keys are the migration's numbers, not one run's numbers.

    §14.2 lets a rerun skip a complete record, so every key here has to be
    decided from the source rows. The fixture is chosen to make each of the
    three kinds of key non-zero: one derived from a source column
    (`activity_verbs_derived`), one published once and remembered
    (`links_minted`), and one whose subject cannot be recognised twice
    (`personal_roots_created_for_reservations`).
    """

    PERSONAL = "personal01"
    DOCUMENT = "document01"
    TRASHED_ROW = "trashed001"

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)
        self.private = self.path / "private"
        patcher = mock.patch.object(report_module, "_private_directory", lambda: self.private)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.drive = FakeDrive()
        self.legacy = FakeTree(drive=self.drive, users={OWNER: True, OTHER: True})
        for row in (
            folder(DRIVE_ROOT_ROW, None),
            folder(USERS_ROW, None),
            TreeRow(
                name=self.PERSONAL,
                file_name=OWNER,
                folder=USERS_ROW,
                is_folder=1,
                owner=OWNER,
                creation=SOURCE_CREATION,
                modified=SOURCE_MODIFIED,
                status=ACTIVE,
            ),
            TreeRow(
                name=self.DOCUMENT,
                file_name="notes.txt",
                folder=self.PERSONAL,
                is_folder=0,
                owner=OWNER,
                creation=SOURCE_CREATION,
                modified=SOURCE_MODIFIED,
                status=ACTIVE,
                file_size=120,
            ),
            TreeRow(
                name=self.TRASHED_ROW,
                file_name="gone.txt",
                folder=self.PERSONAL,
                is_folder=0,
                owner=OWNER,
                creation=SOURCE_CREATION,
                modified=SOURCE_MODIFIED,
                status=TRASHED,
                file_size=7,
            ),
        ):
            self.legacy.rows[row.name] = row
        # §14.5: a `user = ""` row above read mints a link.
        self.legacy.permissions_rows = [
            PermissionRow(name="p1", entity=self.DOCUMENT, user="", read=1, write=1, creation=SOURCE_CREATION)
        ]

        self.records = FakeRecords()
        self.records.activity_rows = [
            # §14.6 derives each of these from the `File.status` it names.
            self.deleted("a1", self.DOCUMENT),
            self.deleted("a2", self.TRASHED_ROW),
            self.deleted("a3", "missing0001"),
            ActivityLogRow(
                name="a4",
                entity=self.DOCUMENT,
                action_type="edit",
                owner=OWNER,
                creation=SOURCE_CREATION,
                modified=SOURCE_MODIFIED,
                modified_by=OWNER,
            ),
        ]
        self.records.favourite_rows = [FavouriteRow("1", OWNER, entity=self.DOCUMENT)]
        self.records.recent_rows = [RecentRow("r1", OWNER, node=self.DOCUMENT)]
        self.records.route_rows = [EntityRow("old1", self.DOCUMENT)]
        self.records.notification_counts = (5, 5)
        self.records_target = FakeRecordsTarget(records=self.records, drive=self.drive)

        # §14.8: an owner with no Personal Root gets one created in Build.
        self.settings = FakeSettings(
            quota_mb=10,
            user_quotas=[UserQuotaRow("s1", OWNER, 50)],
            reservations=[ReservationRow("res1", root=None, storage_owner=OTHER, reserved_bytes=99)],
        )
        self.settings_target = FakeSettingsTarget(settings=self.settings, drive=self.drive)

    @staticmethod
    def deleted(name, entity):
        return ActivityLogRow(
            name=name,
            entity=entity,
            action_type="delete",
            owner=OWNER,
            creation=SOURCE_CREATION,
            modified=SOURCE_MODIFIED,
            modified_by=OWNER,
        )

    def make_env(self):
        return build_environment(
            self.path,
            tree=self.legacy,
            drive=self.drive,
            records=self.records,
            records_target=self.records_target,
            settings=self.settings,
            settings_target=self.settings_target,
            legacy_s3=LegacyS3Config(enabled=False),
        )

    def keys(self, report):
        return {key: report[key] for key in REPORT_KEYS}

    def test_the_fixture_makes_the_three_kinds_of_key_non_zero(self):
        """Otherwise the comparisons below would pass on a report of zeros."""
        report = self.keys(run_build(self.make_env()))
        self.assertEqual(report["activity_verbs_derived"], 2)
        self.assertEqual(report["activity_rows_dropped"], 1)
        self.assertEqual(report["links_minted"], 1)
        self.assertEqual(report["personal_roots_created_for_reservations"], 1)

    def test_a_rerun_reports_the_same_migration(self):
        first = self.keys(run_build(self.make_env()))
        second = self.keys(run_build(self.make_env()))
        self.assertEqual(second, first)

    def test_a_run_killed_inside_the_activity_batch_resumes_to_the_same_report(self):
        clean = self.keys(run_build(self.make_env()))

        self.setUp()
        # `a3` is dropped, so it is never inserted; `a4` is the last insert.
        self.records_target.fail_insert = "a4"
        with self.assertRaises(InterruptedRun):
            run_build(self.make_env(), batch_size=2)
        # What a killed connection leaves behind.
        self.records_target.rollback()
        self.drive.rollback()
        self.records_target.fail_insert = None

        resumed = self.keys(run_build(self.make_env(), batch_size=2))
        self.assertEqual(resumed, clean)

    def test_every_run_keeps_its_own_report_file(self):
        run_build(self.make_env())
        run_build(self.make_env())
        saved = sorted(self.private.glob("drive-build-report-*.json"))
        self.assertEqual(len(saved), 2)
        for path in saved:
            self.assertNotIn("$LINK:", path.read_text())


if __name__ == "__main__":
    unittest.main()
