"""Direct tests for `readiness.run_preflight`'s probes: which port a pending
phase needs must be checked before phase 1 runs, never discovered partway
through one. `test_removal_order_and_resume.py` covers this at the
`run_cleanup` level; these tests isolate `run_preflight` itself so a gap in
one probe cannot hide behind another probe that happens to fail first.
"""

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from suite.drive.patches.cleanup.readiness import PortNotReadyError, run_preflight
from suite.drive.patches.cleanup.tests.fakes import (
    FakeSourceSchema,
    FakeThumbnails,
    RaisingS3,
    cleanup_environment,
    seed_snapshot,
)


class ReadyThumbnails(FakeThumbnails):
    """A `ThumbnailStore` that is ready even for an S3-enabled snapshot, so a
    test can isolate what `_probe_s3_backed_phases` checks about the S3 port
    itself without the thumbnails probe failing first."""

    def delete_sidecars(self, names, *, settings):
        return 0


class TestRunPreflightS3(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def test_a_ready_list_prefix_with_an_unready_enqueue_delete_still_refuses(self):
        """Finding: the old preflight only probed `s3.list_prefix`, never
        `s3.enqueue_delete` independently. A site with a working lister but
        a still-`NotImplementedError` deletion job would pass preflight and
        only fail inside phase 8, after phases 1-7 already ran."""

        class ListOnlyS3(RaisingS3):
            def list_prefix(self, prefix, after, limit):
                return []

        env = cleanup_environment(self.path, s3=ListOnlyS3(), thumbnails=ReadyThumbnails())
        seed_snapshot(env, enabled=True, root_folder="team")
        with self.assertRaises(PortNotReadyError):
            run_preflight(env)

    def test_a_ready_enqueue_delete_with_an_unready_list_prefix_still_refuses(self):
        class EnqueueOnlyS3(RaisingS3):
            def enqueue_delete(self, keys):
                return "job-1"

        env = cleanup_environment(self.path, s3=EnqueueOnlyS3(), thumbnails=ReadyThumbnails())
        seed_snapshot(env, enabled=True, root_folder="team")
        with self.assertRaises(PortNotReadyError):
            run_preflight(env)

    def test_disabled_s3_never_probes_either_s3_port(self):
        env = cleanup_environment(self.path, s3=RaisingS3())
        seed_snapshot(env)  # DEFAULT_DISK_SETTINGS: enabled=False
        run_preflight(env)  # must not raise


class TestRunPreflightSourceSchema(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def test_a_still_declared_ordinary_field_refuses(self):
        env = cleanup_environment(
            self.path, source_schema=FakeSourceSchema(still_declared={"Presentation": {"title"}})
        )
        with self.assertRaises(PortNotReadyError):
            run_preflight(env)

    def test_a_still_declared_single_field_refuses(self):
        env = cleanup_environment(
            self.path, source_schema=FakeSourceSchema(still_declared={"Drive Disk Settings": {"quota"}})
        )
        with self.assertRaises(PortNotReadyError):
            run_preflight(env)

    def test_a_still_declared_notification_column_refuses(self):
        env = cleanup_environment(
            self.path, source_schema=FakeSourceSchema(still_declared={"Drive Notification": {"from_user"}})
        )
        with self.assertRaises(PortNotReadyError):
            run_preflight(env)

    def test_a_still_present_permission_hook_refuses(self):
        env = cleanup_environment(self.path, source_schema=FakeSourceSchema(still_hooked={"Drive Token"}))
        with self.assertRaises(PortNotReadyError):
            run_preflight(env)

    def test_fully_ready_source_schema_does_not_refuse(self):
        env = cleanup_environment(self.path)  # default FakeSourceSchema is fully ready
        run_preflight(env)  # must not raise

    def test_runs_before_the_s3_probe(self):
        # An unready source schema and an unready S3 port both present: the
        # source-schema refusal must win, since it applies to phases 3 and 5
        # that run long before phase 8.
        env = cleanup_environment(
            self.path,
            source_schema=FakeSourceSchema(still_declared={"Presentation": {"title"}}),
            s3=RaisingS3(),
        )
        seed_snapshot(env, enabled=True, root_folder="team")
        with self.assertRaises(PortNotReadyError):
            run_preflight(env)


if __name__ == "__main__":
    unittest.main()
