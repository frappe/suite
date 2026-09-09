"""§14.10: "refuses to run unless all three hold." Combinations, not just one."""

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from suite.drive.patches.cleanup.gate import (
    CleanupAuthorizationError,
    GCDiscoveryGateError,
    LegacyCallerGateError,
    ReachableNodesGateError,
    check_gates,
    require_authorization,
)
from suite.drive.patches.cleanup.tests.fakes import (
    FakeClientCallerEvidence,
    FakeFileTable,
    FakeForwarders,
    cleanup_environment,
    fake_blob_columns,
)


def _healthy_env(tmp_path, **overrides):
    files = FakeFileTable().add("Drive").add("a", folder="Drive", has_node=True)
    forwarders = FakeForwarders({"api.s3.fetch": "permanent"})
    kwargs = dict(files=files, blob_columns=fake_blob_columns(), forwarders=forwarders)
    kwargs.update(overrides)
    return cleanup_environment(tmp_path, **kwargs)


class TestGatesCombined(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def test_all_three_healthy_passes(self):
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

    def test_only_gate_three_failing_refuses_with_gate_three(self):
        env = _healthy_env(
            self.path,
            forwarders=FakeForwarders({"api.files.upload_file": "forwarder"}),
            callers=FakeClientCallerEvidence({"api.files.upload_file"}),
        )
        with self.assertRaises(LegacyCallerGateError):
            check_gates(env)

    def test_gate_one_failing_is_reported_even_when_two_and_three_also_fail(self):
        # `check_gates` runs gate 1 first: a site failing every gate at once
        # must not have its worst-first message buried behind a later one.
        files = FakeFileTable().add("Drive").add("a", folder="Drive", has_node=False)
        env = _healthy_env(
            self.path,
            files=files,
            blob_columns=fake_blob_columns([]),
            forwarders=FakeForwarders({"api.files.upload_file": "forwarder"}),
            callers=FakeClientCallerEvidence({"api.files.upload_file"}),
        )
        with self.assertRaises(ReachableNodesGateError):
            check_gates(env)

    def test_two_of_three_failing_reports_the_earlier_one(self):
        env = _healthy_env(
            self.path,
            blob_columns=fake_blob_columns([]),
            forwarders=FakeForwarders({"api.files.upload_file": "forwarder"}),
            callers=FakeClientCallerEvidence({"api.files.upload_file"}),
        )
        with self.assertRaises(GCDiscoveryGateError):
            check_gates(env)

    def test_gates_passing_is_not_enough_without_authorization(self):
        env = _healthy_env(self.path)
        check_gates(env)  # all three hold
        with self.assertRaises(CleanupAuthorizationError):
            require_authorization(env)

    def test_authorized_with_no_backup_ref_still_refuses(self):
        env = _healthy_env(self.path, authorized=True)
        with self.assertRaises(CleanupAuthorizationError) as caught:
            require_authorization(env)
        self.assertIn("backup", str(caught.exception).lower())

    def test_backup_ref_with_no_authorization_still_refuses(self):
        env = _healthy_env(self.path, backup_ref="s3://backups/2026-09-09")
        with self.assertRaises(CleanupAuthorizationError) as caught:
            require_authorization(env)
        self.assertIn("authorization", str(caught.exception).lower())

    def test_both_authorized_and_backed_up_passes(self):
        env = _healthy_env(self.path, authorized=True, backup_ref="s3://backups/2026-09-09")
        check_gates(env)
        require_authorization(env)


if __name__ == "__main__":
    unittest.main()
