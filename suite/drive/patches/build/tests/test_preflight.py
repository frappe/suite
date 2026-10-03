"""The preflight: GO or NO-GO from the fakes, writing nothing."""

import tempfile
import unittest
from pathlib import Path

from suite.drive.patches.build.environment import LegacyS3Config
from suite.drive.patches.build.legacy import (
    BARE_ROOT_KEY,
    LEADING_SLASH,
    ROOT_FOLDER,
    UNDER_ROOT_FOLDER,
    get_s3_url,
)
from suite.drive.patches.build.preflight import GO, NO_GO, DiskSettings, preflight
from suite.drive.patches.build.tests.fakes import FakeBucket, FakeFiles, FakeStorage, build_environment

ROOT_FOLDER_NAME = "drive"

# One legacy key per shape §14.1 names, as production holds them.
KEYS = {
    LEADING_SLASH: "/photos/holiday.jpg",
    BARE_ROOT_KEY: "report.pdf",
    UNDER_ROOT_FOLDER: f"{ROOT_FOLDER_NAME}/team/notes.txt",
    ROOT_FOLDER: "team/budget.xlsx",
}


class PreflightCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)
        self.disk = DiskSettings(root_folder=ROOT_FOLDER_NAME)

    def site(self, keys, *, missing=(), **overrides):
        """A site with one legacy S3 `File` row per key; `missing` keys have no object."""
        files = FakeFiles.with_s3_files(
            *((f"file-{index}", key, key.rsplit("/", 1)[-1]) for index, key in enumerate(keys))
        )
        bucket = FakeBucket()
        for key in keys:
            if key not in missing:
                bucket.put(key, b"bytes of " + key.encode())
        return build_environment(self.path, files=files, bucket=bucket, **overrides)


class HealthySite(PreflightCase):
    def test_every_sampled_object_is_found_and_the_verdict_is_go(self):
        env = self.site(KEYS.values())

        report = preflight(env, disk=self.disk)

        self.assertEqual(report.verdict, GO)
        self.assertEqual(
            {shape.shape: (shape.rows, shape.sampled, shape.found, shape.missing) for shape in report.shapes},
            {shape: (1, 1, 1, 0) for shape in KEYS},
        )
        self.assertEqual(report.blobless.s3, 4)
        rendered = report.render()
        self.assertIn("Drive Build preflight: GO", rendered)
        for shape in KEYS:
            self.assertIn(shape, rendered)

    def test_the_sample_is_bounded_per_shape_and_deterministic(self):
        keys = [f"/photos/{index:03d}.jpg" for index in range(60)]
        env = self.site(keys)

        first = preflight(env, disk=self.disk, sample_size=5)
        second = preflight(env, disk=self.disk, sample_size=5)

        (shape,) = first.shapes
        self.assertEqual((shape.rows, shape.sampled, shape.found), (60, 5, 5))
        self.assertEqual(first.as_dict(), second.as_dict())

    def test_a_blobless_row_build_cannot_reach_is_listed_but_does_not_block(self):
        env = self.site(KEYS.values())
        env.files.add("file-odd", "/somewhere/else.bin", "else.bin")

        report = preflight(env, disk=self.disk)

        self.assertEqual(report.verdict, GO)
        self.assertEqual(report.blobless.unreachable_rows, [("file-odd", "/somewhere/else.bin")])
        self.assertIn("file-odd  /somewhere/else.bin", report.render())


class MissingObjects(PreflightCase):
    def test_a_sampled_leading_slash_key_without_an_object_is_no_go_and_named(self):
        env = self.site(KEYS.values(), missing=(KEYS[LEADING_SLASH],))

        report = preflight(env, disk=self.disk)

        self.assertEqual(report.verdict, NO_GO)
        by_shape = {shape.shape: shape for shape in report.shapes}
        self.assertEqual(by_shape[LEADING_SLASH].missing_keys, [KEYS[LEADING_SLASH]])
        self.assertEqual(by_shape[BARE_ROOT_KEY].missing, 0)
        rendered = report.render()
        self.assertIn("Drive Build preflight: NO-GO", rendered)
        self.assertIn(f"missing: {KEYS[LEADING_SLASH]!r} ({LEADING_SLASH})", rendered)
        self.assertIn(f"1 of 1 sampled objects missing for {LEADING_SLASH!r}", rendered)

    def test_a_fetch_url_with_no_object_path_is_no_go(self):
        env = self.site(KEYS.values())
        env.files.add("file-blank", get_s3_url(""), "blank")

        report = preflight(env, disk=self.disk)

        self.assertEqual(report.verdict, NO_GO)
        self.assertEqual(report.blobless.empty_path_rows, ["file-blank"])


class GateFailures(PreflightCase):
    def test_a_local_driver_with_s3_on_is_no_go_and_skips_the_sample(self):
        env = self.site(KEYS.values(), storage=FakeStorage(driver="local", config={}))

        report = preflight(env, disk=self.disk)

        self.assertEqual(report.verdict, NO_GO)
        self.assertEqual([check.ok for check in report.checks], [False, False])
        self.assertIn("storage_driver", report.checks[0].detail)
        self.assertTrue(all(shape.sampled == 0 for shape in report.shapes))
        self.assertIn("[FAILED]", report.render())

    def test_a_site_with_s3_off_has_nothing_to_sample_and_is_go(self):
        env = self.site(
            (),
            storage=FakeStorage(driver="local", config={}),
            legacy_s3=LegacyS3Config(enabled=False),
        )

        report = preflight(env, disk=self.disk)

        self.assertEqual(report.verdict, GO)
        self.assertEqual(report.shapes, [])


class NothingIsWritten(PreflightCase):
    def test_the_fakes_are_untouched_afterwards(self):
        env = self.site(KEYS.values(), missing=(KEYS[BARE_ROOT_KEY],))
        before = {name: dict(row) for name, row in env.files.rows.items()}

        preflight(env, disk=self.disk)

        self.assertEqual(env.files.rows, before)
        self.assertEqual(env.files.commits, 0)
        self.assertEqual(env.bucket().copies, [])
        self.assertEqual(env.bucket().opened, [])
        self.assertFalse(env.state.path.exists())
