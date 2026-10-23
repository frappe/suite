"""The preflight: GO or NO-GO from the fakes, writing nothing."""

import json
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
from suite.drive.patches.build.ports import REMOVED, TRASHED
from suite.drive.patches.build.preflight import (
    ACCEPTED,
    BLOCKING,
    GO,
    MISSING,
    NO_GO,
    NO_OBJECT_PATH,
    NOT_MIGRATED,
    SIZE_DIFFERS,
    DiskSettings,
    preflight,
)
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
            {
                shape.shape: (shape.rows, shape.sampled, shape.healthy, shape.defective)
                for shape in report.shapes
            },
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
        self.assertEqual((shape.rows, shape.sampled, shape.healthy), (60, 5, 5))
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
        self.assertEqual((by_shape[LEADING_SLASH].defective, by_shape[BARE_ROOT_KEY].defective), (1, 0))
        self.assertEqual(
            [(d.file, d.key, d.kind, d.standing) for d in report.defects],
            [("file-0", KEYS[LEADING_SLASH], MISSING, BLOCKING)],
        )
        rendered = report.render()
        self.assertIn("Drive Build preflight: NO-GO", rendered)
        self.assertIn(f"file-0  Active  {KEYS[LEADING_SLASH]!r} ({LEADING_SLASH})  missing", rendered)
        self.assertIn("1 legacy object defect(s) not on the accepted list (1 missing)", rendered)

    def test_a_fetch_url_with_no_object_path_is_no_go(self):
        env = self.site(KEYS.values())
        env.files.add("file-blank", get_s3_url(""), "blank")

        report = preflight(env, disk=self.disk)

        self.assertEqual(report.verdict, NO_GO)
        self.assertEqual(
            [(d.file, d.kind, d.standing) for d in report.defects], [("file-blank", NO_OBJECT_PATH, BLOCKING)]
        )


class KnownDefects(PreflightCase):
    """A defect blocks only while nobody has looked at it (§14.1)."""

    def accepted_list(self, *entries):
        path = self.path / "private" / "accepted-defects.json"
        path.parent.mkdir(exist_ok=True)
        path.write_text(json.dumps({"defects": list(entries)}))
        return path

    def test_defects_on_removed_rows_are_listed_and_do_not_block(self):
        env = self.site(KEYS.values())
        env.files.add("file-gone", get_s3_url("/photos/gone.jpg"), "gone.jpg", status=REMOVED)
        env.files.add("file-blank", get_s3_url(""), "blank", status=REMOVED)

        report = preflight(env, disk=self.disk)

        self.assertEqual(report.verdict, GO)
        self.assertEqual(
            [(d.file, d.kind, d.standing) for d in report.defects],
            [("file-blank", NO_OBJECT_PATH, NOT_MIGRATED), ("file-gone", MISSING, NOT_MIGRATED)],
        )
        self.assertIn("Defects on Removed rows: not migrated, so they do not block (2)", report.render())

    def test_listed_defects_of_live_rows_are_accepted_and_every_other_one_blocks(self):
        # Sixty healthy objects, so a sample of five misses most rows: an
        # accepted defect is headed and confirmed whether it was sampled or not.
        healthy = [f"/photos/{index:03d}.jpg" for index in range(60)]
        env = self.site(healthy)
        bucket = env.bucket()
        files = env.files
        for index, key in enumerate(healthy):
            files.rows[f"file-{index}"]["file_size"] = len(b"bytes of " + key.encode())
        # Known, and on the list.
        files.add("file-lost", get_s3_url("/photos/lost.jpg"), "lost.jpg", status="Active", file_size=10)
        bucket.declare("/photos/cut.mov", 5_242_880)
        files.add("file-cut", get_s3_url("/photos/cut.mov"), "cut.mov", status=TRASHED, file_size=9_000_000)
        # New: not on the list, or on it as a different defect.
        bucket.declare("/photos/short.pdf", 100)
        files.add("file-short", get_s3_url("/photos/short.pdf"), "short.pdf", status="Active", file_size=400)
        files.add("file-other", get_s3_url("/photos/other.png"), "other.png", status="Active", file_size=50)
        path = self.accepted_list(
            {"file": "file-lost", "key": "/photos/lost.jpg", "defect": MISSING, "note": "lost before 2026"},
            {"file": "file-cut", "key": "/photos/cut.mov", "defect": SIZE_DIFFERS},
            {"file": "file-other", "key": "/photos/other.png", "defect": SIZE_DIFFERS},
            {"file": "file-3", "key": healthy[3], "defect": MISSING, "note": "came back"},
        )

        report = preflight(env, disk=self.disk, sample_size=5, accepted_defects=path)

        self.assertEqual(report.verdict, NO_GO)
        standing = {d.file: (d.kind, d.standing) for d in report.defects}
        self.assertEqual(standing["file-lost"], (MISSING, ACCEPTED))
        self.assertEqual(standing["file-cut"], (SIZE_DIFFERS, ACCEPTED))
        self.assertEqual(standing["file-other"], (MISSING, BLOCKING))
        # Not listed, so only blocking if the sample met it. Head them all to be sure.
        everything = preflight(env, disk=self.disk, sample_size=None, accepted_defects=path)
        self.assertEqual(
            sorted((d.file, d.kind) for d in everything.with_standing(BLOCKING)),
            [("file-other", MISSING), ("file-short", SIZE_DIFFERS)],
        )
        # An entry naming the wrong defect matches nothing, so it is stale as well.
        self.assertEqual(
            sorted((e.file, e.defect) for e in everything.stale),
            [("file-3", MISSING), ("file-other", SIZE_DIFFERS)],
        )
        rendered = everything.render()
        for heading in (
            "Blocking defects: not on the accepted list (2)",
            f"Accepted known defects, from {path} (2)",
            "Accepted-list entries no object matches: remove them from the list (2)",
        ):
            self.assertIn(heading, rendered)
        self.assertIn("note: lost before 2026", rendered)
        self.assertEqual(
            [d["file"] for d in everything.as_dict()["object_defects"][ACCEPTED]], ["file-cut", "file-lost"]
        )

        # Once the operator has looked at the two new ones, nothing blocks.
        path = self.accepted_list(
            {"file": "file-lost", "key": "/photos/lost.jpg", "defect": MISSING},
            {"file": "file-cut", "key": "/photos/cut.mov", "defect": SIZE_DIFFERS},
            {"file": "file-other", "key": "/photos/other.png", "defect": MISSING},
            {"file": "file-short", "key": "/photos/short.pdf", "defect": SIZE_DIFFERS},
        )
        accepted = preflight(env, disk=self.disk, sample_size=None, accepted_defects=path)
        self.assertEqual(accepted.verdict, GO)
        self.assertEqual(len(accepted.with_standing(ACCEPTED)), 4)
        self.assertEqual(accepted.stale, [])
        self.assertIn("4 of them accepted known defects", accepted.render())

    def test_a_list_that_cannot_be_read_is_no_go(self):
        env = self.site(KEYS.values())
        broken = self.path / "broken.json"
        broken.write_text("{not json")
        unknown = self.accepted_list({"file": "file-0", "key": KEYS[LEADING_SLASH], "defect": "corrupt"})

        for path, detail in (
            (broken, "is not valid JSON"),
            (unknown, '"defect" must be one of'),
            (self.path / "absent.json", "cannot read"),
        ):
            with self.subTest(path=path.name):
                report = preflight(env, disk=self.disk, accepted_defects=path)
                self.assertEqual(report.verdict, NO_GO)
                (failed,) = [check for check in report.checks if not check.ok]
                self.assertIn(detail, failed.detail)


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
