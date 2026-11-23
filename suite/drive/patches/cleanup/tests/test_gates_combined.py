"""§14.10: "refuses to run unless the gates hold", and then only with a backup
on record. Combinations, not just one."""

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from suite.drive.patches.cleanup.gate import (
    CleanupAuthorizationError,
    GCDiscoveryGateError,
    ReachableNodesGateError,
    check_gates,
    require_backup,
)
from suite.drive.patches.cleanup.tests.fakes import (
    FakeFileTable,
    cleanup_environment,
    fake_blob_columns,
)


def _healthy_env(tmp_path, **overrides):
    files = FakeFileTable().add("Drive").add("a", folder="Drive", has_node=True)
    kwargs = dict(files=files, blob_columns=fake_blob_columns())
    kwargs.update(overrides)
    return cleanup_environment(tmp_path, **kwargs)


class TestGatesCombined(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def test_both_healthy_passes(self):
        check_gates(_healthy_env(self.path))

    def test_only_gate_one_failing_refuses_with_gate_one(self):
        files = FakeFileTable().add("Drive").add("a", folder="Drive", has_node=False)
        env = _healthy_env(self.path, files=files)
        with self.assertRaises(ReachableNodesGateError):
            check_gates(env)

    def test_only_gate_two_failing_refuses_with_gate_two(self):
        env = _healthy_env(self.path, blob_columns=fake_blob_columns([]))
        with self.assertRaises(GCDiscoveryGateError):
            check_gates(env)

    def test_gate_one_failing_is_reported_even_when_gate_two_also_fails(self):
        # `check_gates` runs gate 1 first: a site failing both gates at once
        # must not have its worst-first message buried behind a later one.
        files = FakeFileTable().add("Drive").add("a", folder="Drive", has_node=False)
        env = _healthy_env(self.path, files=files, blob_columns=fake_blob_columns([]))
        with self.assertRaises(ReachableNodesGateError):
            check_gates(env)

    def test_gates_passing_is_not_enough_without_a_backup_on_record(self):
        env = _healthy_env(self.path)
        check_gates(env)  # both hold
        with self.assertRaises(CleanupAuthorizationError) as caught:
            require_backup(env)
        message = str(caught.exception)
        self.assertIn("backup", message.lower())
        # The refusal tells the operator exactly what to run.
        self.assertIn('set-config drive_cleanup_backup "', message)

    def test_a_blank_backup_counts_as_none(self):
        env = _healthy_env(self.path, backup="   ")
        with self.assertRaises(CleanupAuthorizationError):
            require_backup(env)

    def test_gates_and_a_recorded_backup_together_pass(self):
        env = _healthy_env(self.path, backup="s3://backups/2026-09-09")
        check_gates(env)
        require_backup(env)


if __name__ == "__main__":
    unittest.main()
