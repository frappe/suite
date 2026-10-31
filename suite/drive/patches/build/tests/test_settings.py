"""§14.2 step 11 and §14.8: quotas in bytes, reservations bound to roots.

The legacy columns are read and never written. Every test that maps a value
also proves the source it came from is still there, because §14.10 is what
removes it and §14.11 needs it to roll back.
"""

import tempfile
import unittest
from pathlib import Path

from suite.drive.patches.build.ports import ACTIVE, PERSONAL, ReservationRow, UserQuotaRow
from suite.drive.patches.build.root_pairs import ARCHIVED
from suite.drive.patches.build.settings import (
    MEGABYTE,
    BuildSettingsError,
    convert_settings,
)
from suite.drive.patches.build.tests.fakes import (
    FakeContent,
    FakeContentTarget,
    FakeDrive,
    FakeSettings,
    FakeSettingsTarget,
    FakeTree,
    InterruptedRun,
    build_environment,
)

OWNER = "owner@example.com"
FRIEND = "friend@example.com"
STRANGER = "stranger@example.com"


class SettingsCase(unittest.TestCase):
    """One user with a Personal Root, one user with none."""

    OWNER_ROOT = "root000001"

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)
        self.drive = FakeDrive()
        self.legacy = FakeTree(drive=self.drive)
        self.content = FakeContent(users={OWNER: True, FRIEND: True, STRANGER: True})
        self.content_target = FakeContentTarget(drive=self.drive, content=self.content)
        self.add_root(self.OWNER_ROOT, OWNER, ACTIVE)
        self.settings = FakeSettings()
        self.target = FakeSettingsTarget(settings=self.settings, drive=self.drive)

    def add_root(self, node, user, state):
        self.drive.node_rows[node] = {"name": node, "kind": "root", "state": ACTIVE}
        self.drive.root_rows[node] = {
            "name": node,
            "node": node,
            "kind": PERSONAL,
            "user": user,
            "state": state,
        }
        self.drive.commit()

    def run_settings(self, batch_size=1000, env=None):
        self.env = env if env is not None else self.make_env()
        return convert_settings(self.env, batch_size=batch_size)

    def make_env(self):
        return build_environment(
            self.path,
            tree=self.legacy,
            drive=self.drive,
            content=self.content,
            content_target=self.content_target,
            settings=self.settings,
            settings_target=self.target,
            tree_ready=True,
        )

    def reservation(self, name):
        return next(row for row in self.settings.reservation_rows if row.name == name)


class GateTest(SettingsCase):
    def test_it_refuses_before_the_trees_exist(self):
        env = build_environment(
            self.path,
            tree=self.legacy,
            drive=self.drive,
            content=self.content,
            content_target=self.content_target,
            settings=self.settings,
            settings_target=self.target,
        )
        with self.assertRaises(BuildSettingsError):
            convert_settings(env)

    def test_it_refuses_without_ports(self):
        env = self.make_env()
        env.settings_target = None
        with self.assertRaises(BuildSettingsError):
            convert_settings(env)


class SiteQuotaTest(SettingsCase):
    """§14.8's first two rows: MB to bytes, and `shared_quota` unlimited."""

    def test_it_multiplies_by_one_mebibyte(self):
        self.settings.quota_mb = 10
        result = self.run_settings()
        self.assertEqual(self.target.default_personal_quota, 10 * 1024 * 1024)
        self.assertEqual(result.default_personal_quota, 10 * MEGABYTE)
        self.assertEqual(result.disk_quota_mb, 10)

    def test_shared_quota_starts_unlimited(self):
        self.settings.quota_mb = 10
        result = self.run_settings()
        self.assertEqual(self.target.shared_quota, 0)
        self.assertEqual(result.shared_quota, 0)

    def test_the_legacy_column_is_left_alone(self):
        self.settings.quota_mb = 10
        self.run_settings()
        self.assertEqual(self.settings.quota_mb, 10)

    def test_a_missing_quota_maps_to_zero(self):
        self.settings.quota_mb = 0
        result = self.run_settings()
        self.assertEqual(result.default_personal_quota, 0)

    def test_a_rerun_writes_nothing(self):
        self.settings.quota_mb = 10
        self.run_settings()
        commits = self.target.commits
        self.run_settings()
        # The site quota write is one statement, so a rerun that skipped it
        # makes exactly the batch commits the two loops end with.
        self.assertEqual(self.target.commits - commits, 2)


class UserQuotaTest(SettingsCase):
    """§14.8: a per-user MB quota becomes that root's `quota_bytes`."""

    def test_it_writes_the_root_override_in_bytes(self):
        self.settings.user_quota_rows = [UserQuotaRow("s1", OWNER, 5)]
        result = self.run_settings()
        self.assertEqual(self.target.root_quotas[self.OWNER_ROOT], 5 * MEGABYTE)
        self.assertEqual(result.user_quotas_applied, 1)

    def test_the_legacy_row_is_left_alone(self):
        self.settings.user_quota_rows = [UserQuotaRow("s1", OWNER, 5)]
        self.run_settings()
        self.assertEqual(self.settings.user_quota_rows[0].quota, 5)

    def test_a_zero_quota_writes_nothing(self):
        self.settings.user_quota_rows = [UserQuotaRow("s1", OWNER, 0)]
        result = self.run_settings()
        self.assertEqual(self.target.root_quotas, {})
        self.assertEqual(result.user_quota_rows_seen, 1)
        self.assertEqual(result.user_quotas_applied, 0)

    def test_a_user_with_no_root_is_counted_and_no_root_is_created(self):
        self.settings.user_quota_rows = [UserQuotaRow("s1", STRANGER, 5)]
        result = self.run_settings()
        self.assertEqual(result.user_quotas_without_root, 1)
        self.assertEqual(len(self.drive.root_rows), 1)

    def test_an_archived_root_still_takes_the_quota(self):
        self.add_root("root000002", FRIEND, ARCHIVED)
        self.settings.user_quota_rows = [UserQuotaRow("s1", FRIEND, 5)]
        result = self.run_settings()
        self.assertEqual(self.target.root_quotas["root000002"], 5 * MEGABYTE)
        self.assertEqual(result.user_quotas_applied, 1)

    def test_a_rerun_reports_the_value_as_already_set(self):
        self.settings.user_quota_rows = [UserQuotaRow("s1", OWNER, 5)]
        self.run_settings()
        result = self.run_settings()
        self.assertEqual(result.user_quotas_applied, 0)
        self.assertEqual(result.user_quotas_already_set, 1)

    def test_a_root_whose_metadata_names_another_user_is_refused(self):
        self.drive.root_rows[self.OWNER_ROOT]["user"] = FRIEND
        self.settings.user_quota_rows = [UserQuotaRow("s1", OWNER, 5)]
        # `active_roots` reads the same metadata, so the mismatch has to be
        # planted where the resolver still finds the root.
        self.content_target.root_rows[self.OWNER_ROOT]["user"] = FRIEND
        result = self.run_settings()
        self.assertEqual(result.user_quotas_without_root, 1)


class ReservationTest(SettingsCase):
    """§3.12: a reservation moves from a storage owner to a root."""

    def test_it_binds_to_an_existing_root_and_clears_the_owner(self):
        self.settings.reservation_rows = [ReservationRow("v1", storage_owner=OWNER, reserved_bytes=99)]
        result = self.run_settings()
        row = self.reservation("v1")
        self.assertEqual(row.root, self.OWNER_ROOT)
        # The doctype allows a root or an owner, never both.
        self.assertIsNone(row.storage_owner)
        self.assertEqual(result.reservations_bound, 1)
        self.assertEqual(result.personal_roots_created_for_reservations, 0)

    def test_it_creates_a_missing_root_as_a_whole_pair(self):
        self.settings.reservation_rows = [ReservationRow("v1", storage_owner=STRANGER)]
        result = self.run_settings()
        created = self.reservation("v1").root
        self.assertIn(created, self.drive.node_rows)
        self.assertIn(created, self.drive.root_rows)
        self.assertEqual(self.drive.root_rows[created]["user"], STRANGER)
        self.assertEqual(result.personal_roots_created_for_reservations, 1)

    def test_a_row_that_already_names_a_root_is_left_alone(self):
        self.settings.reservation_rows = [ReservationRow("v1", root=self.OWNER_ROOT)]
        result = self.run_settings()
        self.assertEqual(result.reservations_already_bound, 1)
        self.assertEqual(result.reservations_bound, 0)

    def test_a_row_with_neither_a_root_nor_an_owner_is_counted(self):
        self.settings.reservation_rows = [ReservationRow("v1")]
        result = self.run_settings()
        self.assertEqual(result.reservations_unowned, 1)
        self.assertEqual(result.skipped_total, 1)

    def test_two_reservations_for_one_owner_share_one_new_root(self):
        self.settings.reservation_rows = [
            ReservationRow("v1", storage_owner=STRANGER),
            ReservationRow("v2", storage_owner=STRANGER),
        ]
        result = self.run_settings()
        self.assertEqual(self.reservation("v1").root, self.reservation("v2").root)
        self.assertEqual(result.personal_roots_created_for_reservations, 1)

    def test_the_created_root_count_does_not_double_on_a_rerun(self):
        self.settings.reservation_rows = [ReservationRow("v1", storage_owner=STRANGER)]
        self.run_settings()
        result = self.run_settings()
        self.assertEqual(result.personal_roots_created_for_reservations, 1)
        self.assertEqual(result.reservations_already_bound, 1)


class ReservationLedgerTest(SettingsCase):
    """The write-ahead ledger, on both sides of the database commit."""

    def setUp(self):
        super().setUp()
        self.settings.reservation_rows = [ReservationRow("v1", storage_owner=STRANGER)]

    def kill_before_the_commit(self):
        self.target.fail_bind = "v1"
        with self.assertRaises(InterruptedRun):
            self.run_settings()
        self.target.fail_bind = None

    def test_the_intent_is_written_before_the_pair_is_committed(self):
        self.kill_before_the_commit()
        stored = self.env.state.settings()
        self.assertEqual(len(stored.pending_reservation_roots), 1)
        self.assertEqual(stored.personal_roots_created_for_reservations, 0)

    def test_a_rolled_back_pair_is_counted_once_after_the_resume(self):
        self.kill_before_the_commit()
        # The kill rolled the uncommitted pair back with its batch.
        self.target.rollback()
        result = self.run_settings(env=self.env)
        self.assertEqual(result.personal_roots_created_for_reservations, 1)
        self.assertEqual(result.pending_reservation_roots, [])
        self.assertEqual(len(self.drive.root_rows), 2)

    def test_a_committed_pair_is_counted_once_after_the_resume(self):
        self.kill_before_the_commit()
        # The other side of the same kill: the pair landed, and only the
        # cumulative counter was still owed.
        self.drive.commit()
        landed = self.env.state.settings().pending_reservation_roots[0]
        result = self.run_settings(env=self.env)
        self.assertEqual(result.personal_roots_created_for_reservations, 1)
        self.assertEqual(result.pending_reservation_roots, [])
        self.assertEqual(self.reservation("v1").root, landed)


class BatchTest(SettingsCase):
    """§14.2: commit per batch, and resume at any batch boundary."""

    def populate(self, count=6):
        self.settings.user_quota_rows = [
            UserQuotaRow(f"s{index}", f"user{index}@example.com", index + 1) for index in range(count)
        ]
        for index in range(count):
            self.add_root(f"root{index:06d}", f"user{index}@example.com", ACTIVE)
        self.settings.reservation_rows = [
            ReservationRow(f"v{index}", storage_owner=f"user{index}@example.com") for index in range(count)
        ]

    def test_it_commits_more_than_once_at_a_small_batch(self):
        self.populate()
        self.run_settings(batch_size=2)
        self.assertGreater(self.target.commits, 3)

    def test_a_kill_at_every_reservation_resumes_to_one_state(self):
        self.populate()
        clean = self.run_settings(batch_size=2)
        expected = {row.name: row.root for row in self.settings.reservation_rows}
        for victim in ("v1", "v3", "v5"):
            with self.subTest(killed=victim):
                self.setUp()
                self.populate()
                self.target.fail_bind = victim
                with self.assertRaises(InterruptedRun):
                    self.run_settings(batch_size=2)
                self.target.rollback()
                self.target.fail_bind = None
                resumed = self.run_settings(batch_size=2, env=self.env)
                self.assertEqual({row.name: row.root for row in self.settings.reservation_rows}, expected)
                self.assertEqual(
                    resumed.personal_roots_created_for_reservations,
                    clean.personal_roots_created_for_reservations,
                )
                self.assertTrue(resumed.completed)


class DurableRecordTest(SettingsCase):
    def test_it_stores_the_census_and_marks_the_step_complete(self):
        self.settings.quota_mb = 3
        self.settings.user_quota_rows = [UserQuotaRow("s1", OWNER, 5)]
        self.run_settings()
        stored = self.env.state.settings()
        self.assertTrue(stored.completed)
        self.assertEqual(stored.default_personal_quota, 3 * MEGABYTE)
        self.assertEqual(stored.user_quotas_applied, 1)


if __name__ == "__main__":
    unittest.main()
