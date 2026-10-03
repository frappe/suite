"""§14.2 step 9 and §14.6: the record tables, retargeted rather than copied.

No site and no database. Every rule is read through `convert_records` with
`FakeRecords` on one side and `FakeRecordsTarget` on the other.
"""

import json
import tempfile
import unittest
from pathlib import Path

from suite.drive.patches.build import records as records_module
from suite.drive.patches.build.ports import (
    ACTIVE,
    REMOVED,
    TRASHED,
    ActivityLogRow,
    EntityRow,
    FavouriteRow,
    RecentRow,
    TreeRow,
)
from suite.drive.patches.build.records import BuildRecordError, convert_records
from suite.drive.patches.build.tests.fakes import (
    FakeDrive,
    FakeRecords,
    FakeRecordsTarget,
    FakeTree,
    InterruptedRun,
    build_environment,
)

OWNER = "owner@example.com"
FRIEND = "friend@example.com"
GHOST = "ghost@example.com"

SOURCE_CREATION = "2021-03-04 05:06:07.000000"
SOURCE_MODIFIED = "2021-03-05 05:06:07.000000"


def activity(name, entity, action_type="edit", **columns):
    columns.setdefault("owner", OWNER)
    columns.setdefault("creation", SOURCE_CREATION)
    columns.setdefault("modified", SOURCE_MODIFIED)
    columns.setdefault("modified_by", OWNER)
    return ActivityLogRow(name=name, entity=entity, action_type=action_type, **columns)


def tree_row(name, status, owner=OWNER):
    """A legacy `File` row, so the derived-verb map has a status to read."""
    return TreeRow(
        name=name,
        file_name=name,
        folder=None,
        is_folder=0,
        owner=owner,
        creation=SOURCE_CREATION,
        modified=SOURCE_MODIFIED,
        status=status,
    )


class RecordCase(unittest.TestCase):
    """One migrated node, one legacy id that never became one."""

    MIGRATED = "node000001"
    LOST = "file000002"

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)
        self.drive = FakeDrive()
        self.drive.node_rows[self.MIGRATED] = {"name": self.MIGRATED, "kind": "document"}
        self.legacy = FakeTree(drive=self.drive, users={OWNER: True, FRIEND: False})
        self.records = FakeRecords()
        self.target = FakeRecordsTarget(records=self.records, drive=self.drive)

    def run_records(self, batch_size=1000):
        self.env = build_environment(
            self.path,
            tree=self.legacy,
            drive=self.drive,
            records=self.records,
            records_target=self.target,
            tree_ready=True,
        )
        return convert_records(self.env, batch_size=batch_size)

    def favourite(self, name):
        return next(row for row in self.records.favourite_rows if row.name == name)


class GateTest(RecordCase):
    def test_it_refuses_before_the_trees_exist(self):
        env = build_environment(
            self.path, tree=self.legacy, drive=self.drive, records=self.records, records_target=self.target
        )
        with self.assertRaises(BuildRecordError):
            convert_records(env)

    def test_it_refuses_without_ports(self):
        env = build_environment(self.path, tree=self.legacy, drive=self.drive, tree_ready=True)
        env.records = None
        with self.assertRaises(BuildRecordError):
            convert_records(env)


class FavouriteTest(RecordCase):
    """§14.6: `entity` becomes `node`, and the legacy column stays put."""

    def test_it_fills_node_and_keeps_the_legacy_entity(self):
        self.records.favourite_rows = [FavouriteRow("f1", OWNER, entity=self.MIGRATED)]
        result = self.run_records()
        row = self.favourite("f1")
        self.assertEqual(row.node, self.MIGRATED)
        self.assertEqual(row.entity, self.MIGRATED)
        self.assertEqual(result.favourites_retargeted, 1)
        self.assertEqual(result.favourites_seen, 1)

    def test_an_unmigrated_entity_is_counted_and_left_alone(self):
        self.records.favourite_rows = [FavouriteRow("f1", OWNER, entity=self.LOST)]
        result = self.run_records()
        self.assertIsNone(self.favourite("f1").node)
        self.assertEqual(self.favourite("f1").entity, self.LOST)
        self.assertEqual(result.favourites_unmigrated, 1)
        self.assertEqual(result.favourites_retargeted, 0)

    def test_a_second_row_for_one_pair_collapses(self):
        # `fav_user_node` is unique; the legacy table has no such index.
        self.records.favourite_rows = [
            FavouriteRow("f1", OWNER, entity=self.MIGRATED),
            FavouriteRow("f2", OWNER, entity=self.MIGRATED),
        ]
        result = self.run_records()
        self.assertEqual(self.favourite("f1").node, self.MIGRATED)
        self.assertIsNone(self.favourite("f2").node)
        self.assertEqual(result.favourites_collapsed, 1)
        self.assertEqual(result.favourites_retargeted, 1)

    def test_the_collapse_holds_across_a_page_boundary(self):
        self.records.favourite_rows = [
            FavouriteRow("f1", OWNER, entity=self.MIGRATED),
            FavouriteRow("f2", OWNER, entity=self.MIGRATED),
        ]
        result = self.run_records(batch_size=1)
        self.assertEqual(self.favourite("f1").node, self.MIGRATED)
        self.assertIsNone(self.favourite("f2").node)
        self.assertEqual(result.favourites_collapsed, 1)

    def test_two_users_keep_their_own_favourite(self):
        self.records.favourite_rows = [
            FavouriteRow("f1", OWNER, entity=self.MIGRATED),
            FavouriteRow("f2", FRIEND, entity=self.MIGRATED),
        ]
        result = self.run_records()
        self.assertEqual(result.favourites_retargeted, 2)
        self.assertEqual(result.favourites_collapsed, 0)

    def test_a_row_that_already_names_a_node_is_left_alone(self):
        self.records.favourite_rows = [FavouriteRow("f1", OWNER, entity=None, node=self.MIGRATED)]
        result = self.run_records()
        self.assertEqual(result.favourites_already_linked, 1)
        self.assertEqual(result.favourites_retargeted, 0)

    def test_a_row_with_no_user_is_skipped(self):
        self.records.favourite_rows = [FavouriteRow("f1", "", entity=self.MIGRATED)]
        result = self.run_records()
        self.assertEqual(result.favourites_retargeted, 0)
        self.assertEqual(result.skipped_total, 1)

    def test_a_rerun_writes_nothing_and_reports_the_same(self):
        self.records.favourite_rows = [
            FavouriteRow("f1", OWNER, entity=self.MIGRATED),
            FavouriteRow("f2", OWNER, entity=self.MIGRATED),
            FavouriteRow("f3", FRIEND, entity=self.LOST),
        ]
        first = self.run_records().as_dict()
        second = self.run_records().as_dict()
        # The first run filled `node`, so the second reports those rows as
        # already linked rather than retargeting them again.
        self.assertEqual(second["favourites_seen"], first["favourites_seen"])
        self.assertEqual(second["favourites_retargeted"], 0)
        self.assertEqual(second["favourites_already_linked"], 1)
        self.assertEqual(second["favourites_unmigrated"], first["favourites_unmigrated"])


class RecentTest(RecordCase):
    """The rename already moved the values. This step only counts."""

    def test_it_counts_a_recent_whose_node_is_gone(self):
        self.records.recent_rows = [
            RecentRow("r1", OWNER, node=self.MIGRATED),
            RecentRow("r2", OWNER, node=self.LOST),
            RecentRow("r3", OWNER, node=None),
        ]
        result = self.run_records()
        self.assertEqual(result.recents_seen, 3)
        self.assertEqual(result.recents_unmigrated, 2)

    def test_it_writes_nothing(self):
        self.records.recent_rows = [RecentRow("r1", OWNER, node=self.LOST)]
        before = list(self.records.recent_rows)
        self.run_records()
        self.assertEqual(self.records.recent_rows, before)


class ActivityVerbTest(RecordCase):
    """§14.6: eight verbs map one for one, and `delete` is derived."""

    def convert(self, row):
        self.records.activity_rows = [row]
        result = self.run_records()
        return result, self.target.activity_rows.get(row.name)

    def test_every_direct_verb_passes_through(self):
        for verb in sorted(records_module.DIRECT_VERBS):
            with self.subTest(verb=verb):
                self.setUp()
                result, written = self.convert(activity("a1", self.MIGRATED, verb))
                self.assertEqual(written["action"], verb)
                self.assertEqual(result.activity_verbs_derived, 0)

    def test_delete_is_derived_from_the_file_status(self):
        for status, expected in ((TRASHED, "trash"), (REMOVED, "delete"), (ACTIVE, "restore")):
            with self.subTest(status=status):
                self.setUp()
                self.legacy.add(self.MIGRATED, folder=None, status=status)
                result, written = self.convert(activity("a1", self.MIGRATED, "delete"))
                self.assertEqual(written["action"], expected)
                self.assertEqual(result.activity_verbs_derived, 1)
                self.assertEqual(result.derived_verbs, {expected: 1})

    def test_an_unknown_status_falls_back_to_trash(self):
        self.legacy.add(self.MIGRATED, folder=None, status="Something Else")
        _result, written = self.convert(activity("a1", self.MIGRATED, "delete"))
        self.assertEqual(written["action"], "trash")

    def test_a_missing_file_row_derives_delete(self):
        # The node exists and its `File` does not, which is the one case the
        # status table cannot answer.
        _result, written = self.convert(activity("a1", self.MIGRATED, "delete"))
        self.assertEqual(written["action"], "delete")

    def test_an_unknown_verb_is_dropped(self):
        result, written = self.convert(activity("a1", self.MIGRATED, "teleport"))
        self.assertIsNone(written)
        self.assertEqual(result.activity_rows_dropped, 1)


class ActivityPayloadTest(RecordCase):
    """§14.6: the payload columns fold into `detail`, with `migrated`."""

    def convert(self, row):
        self.records.activity_rows = [row]
        self.run_records()
        return json.loads(self.target.activity_rows[row.name]["detail"])

    def test_detail_always_says_migrated(self):
        self.assertEqual(self.convert(activity("a1", self.MIGRATED)), {"migrated": True})

    def test_it_folds_every_payload_column(self):
        detail = self.convert(
            activity(
                "a1",
                self.MIGRATED,
                "rename",
                message="renamed",
                document_field="title",
                old_value="a",
                new_value="b",
                meta_value="m",
            )
        )
        self.assertEqual(
            detail,
            {
                "migrated": True,
                "message": "renamed",
                "document_field": "title",
                "old_value": "a",
                "new_value": "b",
                "meta_value": "m",
            },
        )

    def test_an_empty_column_is_left_out(self):
        detail = self.convert(activity("a1", self.MIGRATED, "rename", message="", old_value=None))
        self.assertEqual(detail, {"migrated": True})

    def test_the_row_keeps_its_source_id_and_stamps(self):
        self.records.activity_rows = [activity("a1", self.MIGRATED)]
        self.run_records()
        written = self.target.activity_rows["a1"]
        self.assertEqual(written["name"], "a1")
        self.assertEqual(written["node"], self.MIGRATED)
        self.assertEqual(written["at"], SOURCE_CREATION)
        self.assertEqual(written["creation"], SOURCE_CREATION)
        self.assertEqual(written["modified"], SOURCE_MODIFIED)
        self.assertIsNone(written["via_link"])
        self.assertIsNone(written["client"])


class ActivityActorTest(RecordCase):
    def test_a_row_with_no_actor_is_dropped(self):
        self.records.activity_rows = [activity("a1", self.MIGRATED, owner="  ")]
        result = self.run_records()
        self.assertNotIn("a1", self.target.activity_rows)
        self.assertEqual(result.activity_rows_dropped, 1)

    def test_a_dead_actor_is_kept_and_counted(self):
        self.records.activity_rows = [activity("a1", self.MIGRATED, owner=GHOST)]
        result = self.run_records()
        self.assertEqual(self.target.activity_rows["a1"]["actor"], GHOST)
        self.assertEqual(result.activity_actors_missing, 1)
        self.assertEqual(result.activity_rows_dropped, 0)

    def test_a_disabled_actor_is_not_counted_missing(self):
        self.records.activity_rows = [activity("a1", self.MIGRATED, owner=FRIEND)]
        result = self.run_records()
        self.assertEqual(result.activity_actors_missing, 0)


class ActivityEntityTest(RecordCase):
    def test_an_unmigrated_entity_drops_the_row(self):
        self.records.activity_rows = [activity("a1", self.LOST)]
        result = self.run_records()
        self.assertEqual(self.target.activity_rows, {})
        self.assertEqual(result.activity_rows_dropped, 1)
        self.assertEqual(result.activity_rows_seen, 1)

    def test_a_row_already_written_is_not_written_twice(self):
        self.records.activity_rows = [activity("a1", self.MIGRATED)]
        self.run_records()
        result = self.run_records()
        self.assertEqual(result.activity_rows_already_present, 1)
        self.assertEqual(result.activity_rows_written, 0)
        self.assertEqual(len(self.target.activity_rows), 1)

    def test_a_rerun_derives_the_same_verbs_it_derived_the_first_time(self):
        """§14.9's two activity keys are a census of the source rows.

        Counting only what this run inserted made a rerun over a finished
        site report `activity_verbs_derived: 0`, which is neither what Build
        did nor what the previous report said.
        """
        self.legacy.rows[self.MIGRATED] = tree_row(self.MIGRATED, TRASHED)
        self.records.activity_rows = [
            activity("a1", self.MIGRATED, action_type="delete"),
            activity("a2", self.MIGRATED, action_type="delete"),
            activity("a3", self.LOST, action_type="delete"),
        ]
        first = self.run_records()
        second = self.run_records()
        self.assertEqual(first.activity_verbs_derived, 2)
        self.assertEqual(second.activity_verbs_derived, first.activity_verbs_derived)
        self.assertEqual(second.derived_verbs, first.derived_verbs)
        self.assertEqual(second.activity_rows_dropped, first.activity_rows_dropped)
        self.assertEqual(second.activity_rows_already_present, 2)
        self.assertEqual(second.activity_rows_written, 0)

    def test_a_resumed_run_derives_the_verbs_the_killed_run_had_written(self):
        self.legacy.rows[self.MIGRATED] = tree_row(self.MIGRATED, TRASHED)
        self.records.activity_rows = [
            activity(f"a{index}", self.MIGRATED, action_type="delete") for index in range(4)
        ]
        clean = self.run_records()

        self.setUp()
        self.legacy.rows[self.MIGRATED] = tree_row(self.MIGRATED, TRASHED)
        self.records.activity_rows = [
            activity(f"a{index}", self.MIGRATED, action_type="delete") for index in range(4)
        ]
        self.target.fail_insert = "a2"
        with self.assertRaises(InterruptedRun):
            self.run_records(batch_size=2)
        self.target.rollback()
        self.target.fail_insert = None
        resumed = self.run_records(batch_size=2)
        self.assertEqual(resumed.activity_verbs_derived, clean.activity_verbs_derived)
        self.assertEqual(resumed.derived_verbs, clean.derived_verbs)


class NotificationTest(RecordCase):
    """§14.6: the inbox starts empty, and the report says how empty."""

    def test_it_counts_and_writes_nothing(self):
        self.records.notification_counts = (12, 12)
        result = self.run_records()
        self.assertEqual(result.notification_rows, 12)
        self.assertEqual(result.notification_rows_dropped, 12)
        self.assertEqual(self.target.activity_rows, {})


class SideTableTest(RecordCase):
    """Routes, locks, and properties keep their ids and are proved."""

    def test_it_counts_each_table_separately(self):
        self.records.route_rows = [EntityRow("t1", self.MIGRATED), EntityRow("t2", self.LOST)]
        self.records.lock_rows = [EntityRow("l1", self.LOST)]
        self.records.property_rows = [EntityRow("p1", self.MIGRATED)]
        result = self.run_records()
        self.assertEqual((result.legacy_routes_seen, result.legacy_routes_unmigrated), (2, 1))
        self.assertEqual((result.dav_locks_seen, result.dav_locks_unmigrated), (1, 1))
        self.assertEqual((result.dav_properties_seen, result.dav_properties_unmigrated), (1, 0))

    def test_it_rewrites_no_value(self):
        self.records.route_rows = [EntityRow("t1", self.MIGRATED)]
        before = list(self.records.route_rows)
        self.run_records()
        self.assertEqual(self.records.route_rows, before)


class BatchTest(RecordCase):
    """§14.2: commit per batch, and resume at any batch boundary."""

    def populate(self, count=5):
        self.records.favourite_rows = [
            FavouriteRow(f"f{index}", f"user{index}@example.com", entity=self.MIGRATED)
            for index in range(count)
        ]
        self.records.activity_rows = [activity(f"a{index}", self.MIGRATED) for index in range(count)]

    def test_it_commits_more_than_once_at_a_small_batch(self):
        self.populate()
        self.run_records(batch_size=2)
        self.assertGreater(self.target.commits, 2)

    def test_a_kill_inside_an_activity_batch_resumes_without_duplicates(self):
        self.populate()
        self.target.fail_insert = "a3"
        with self.assertRaises(InterruptedRun):
            self.run_records(batch_size=2)
        # What a killed connection leaves: everything since the last commit
        # is gone, and the state file still holds the counters it wrote.
        self.target.rollback()
        partial = dict(self.target.activity_rows)
        self.target.fail_insert = None
        resumed = self.run_records(batch_size=2)
        self.assertEqual(len(self.target.activity_rows), 5)
        self.assertEqual(resumed.activity_rows_seen, 5)
        self.assertEqual(
            resumed.activity_rows_written + resumed.activity_rows_already_present,
            5,
        )
        self.assertEqual(resumed.activity_rows_already_present, len(partial))
        self.assertTrue(resumed.completed)

    def test_a_kill_at_every_batch_boundary_ends_in_one_state(self):
        clean = self.fresh_run()
        for victim in ("a1", "a2", "a3", "a4"):
            with self.subTest(killed=victim):
                self.setUp()
                self.populate()
                self.target.fail_insert = victim
                with self.assertRaises(InterruptedRun):
                    self.run_records(batch_size=2)
                self.target.rollback()
                self.target.fail_insert = None
                self.run_records(batch_size=2)
                self.assertEqual(sorted(self.target.activity_rows), sorted(clean))
                self.assertEqual(
                    {name: row.node for name, row in self.favourites().items()},
                    dict.fromkeys(self.favourites(), self.MIGRATED),
                )

    def fresh_run(self):
        self.setUp()
        self.populate()
        self.run_records(batch_size=2)
        rows = dict(self.target.activity_rows)
        return rows

    def favourites(self):
        return {row.name: row for row in self.records.favourite_rows}


class DurableRecordTest(RecordCase):
    """The record on disk is what a later step and the report read."""

    def test_it_stores_the_census_and_marks_the_step_complete(self):
        self.records.favourite_rows = [FavouriteRow("f1", OWNER, entity=self.MIGRATED)]
        self.records.activity_rows = [activity("a1", self.MIGRATED)]
        self.run_records()
        stored = self.env.state.records()
        self.assertTrue(stored.completed)
        self.assertEqual(stored.favourites_retargeted, 1)
        self.assertEqual(stored.activity_rows_written, 1)


if __name__ == "__main__":
    unittest.main()
