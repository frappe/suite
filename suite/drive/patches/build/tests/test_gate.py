"""§14.1: Build refuses before it mutates anything."""

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from suite.drive.patches.build import BuildGateError, check_gate, prepare_legacy_bytes
from suite.drive.patches.build.environment import LegacyS3Config
from suite.drive.patches.build.tests.fakes import FakeFiles, FakeStorage, build_environment


class TestBuildGate(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def env(self, **kwargs):
        return build_environment(self.path, **kwargs)

    def test_storage_v2_off_refuses(self):
        env = self.env(storage=FakeStorage(enabled=False))
        with self.assertRaises(BuildGateError) as caught:
            check_gate(env)
        self.assertIn("storage_v2", str(caught.exception))

    def test_local_site_with_s3_off_passes(self):
        # No S3 to copy, so the driver is the framework's business, not Build's.
        env = self.env(
            storage=FakeStorage(driver="local", config={}),
            legacy_s3=LegacyS3Config(enabled=False),
        )
        check_gate(env)

    def test_s3_drive_on_a_local_driver_refuses(self):
        env = self.env(storage=FakeStorage(driver="local", config={}))
        with self.assertRaises(BuildGateError) as caught:
            check_gate(env)
        self.assertIn("storage_driver", str(caught.exception))

    def test_s3_driver_without_a_configured_bucket_refuses(self):
        for config in ({}, {"region": "eu-central-1"}, {"bucket": ""}):
            with self.subTest(config=config):
                env = self.env(storage=FakeStorage(driver="s3", config=config))
                with self.assertRaises(BuildGateError) as caught:
                    check_gate(env)
                self.assertIn("storage_driver_config", str(caught.exception))

    def test_two_different_buckets_refuse(self):
        # §14.2 step 3 copies server-side "in the same bucket". Two buckets
        # would read nothing and report every Drive file as missing bytes.
        env = self.env(
            storage=FakeStorage(config={"bucket": "framework-bucket"}),
            legacy_s3=LegacyS3Config(enabled=True, bucket="drive-bucket"),
        )
        with self.assertRaises(BuildGateError) as caught:
            check_gate(env)
        self.assertIn("one bucket", str(caught.exception))

    def test_matching_buckets_pass(self):
        env = self.env(
            storage=FakeStorage(config={"bucket": "drive-bucket"}),
            legacy_s3=LegacyS3Config(enabled=True, bucket="drive-bucket"),
        )
        check_gate(env)

    def test_an_unnamed_legacy_bucket_refuses(self):
        # Without it there is nothing to compare, and "the same bucket" is
        # exactly the assumption the copy step cannot check for itself.
        env = self.env(
            storage=FakeStorage(config={"bucket": "drive-bucket"}),
            legacy_s3=LegacyS3Config(enabled=True, bucket=""),
        )
        with self.assertRaises(BuildGateError) as caught:
            check_gate(env)
        self.assertIn("Drive Disk Settings.bucket", str(caught.exception))

    def test_one_bucket_name_reached_at_two_endpoints_refuses(self):
        # A MinIO bucket and an AWS bucket can share a name. The copy would
        # then read nothing and report every Drive file as missing bytes.
        env = self.env(
            storage=FakeStorage(config={"bucket": "drive", "endpoint_url": None}),
            legacy_s3=LegacyS3Config(enabled=True, bucket="drive", endpoint_url="https://minio.internal"),
        )
        with self.assertRaises(BuildGateError) as caught:
            check_gate(env)
        self.assertIn("two different buckets", str(caught.exception))

    def test_one_endpoint_spelled_two_ways_passes(self):
        env = self.env(
            storage=FakeStorage(config={"bucket": "drive", "endpoint_url": "https://minio.internal/"}),
            legacy_s3=LegacyS3Config(enabled=True, bucket="drive", endpoint_url="https://minio.internal"),
        )
        check_gate(env)

    def test_a_refused_gate_mutates_nothing(self):
        files = FakeFiles.with_s3_files(("f1", "team/f1", "a.txt"))
        storage = FakeStorage(enabled=False)
        env = self.env(storage=storage, files=files)

        with self.assertRaises(BuildGateError):
            prepare_legacy_bytes(env)

        self.assertEqual(storage.backfill_calls, [])
        self.assertEqual(files.commits, 0)
        self.assertIsNone(files.blob_of("f1"))
        self.assertFalse(env.state.path.exists())


if __name__ == "__main__":
    unittest.main()
