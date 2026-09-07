"""§14.2 steps 1 to 3 against the real `File` table.

The rules are proved site-free in `suite/drive/patches/build/tests/`. This
module proves the wiring: that the queries match the shipped schema, that
the framework backfill really does link local bytes in place, and that a
copied S3 object produces a `File Blob` the framework can read back.

Bytes are never sent to a bucket. `FakeBucket` stands in for S3, so the
test needs no credentials and no network.
"""

import hashlib
import os
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory

import frappe
from frappe.storage.tests import reset_file_controller
from frappe.tests import IntegrationTestCase
from frappe.utils import cint, get_files_path, now_datetime

from suite.drive.patches.build.environment import BuildEnvironment, LegacyS3Config
from suite.drive.patches.build.layout import blob_key, object_key
from suite.drive.patches.build.legacy_bytes import prepare_legacy_bytes
from suite.drive.patches.build.ports import SiteFiles, SiteStorage
from suite.drive.patches.build.state import STATE_FILENAME, BuildState
from suite.drive.patches.build.tests.fakes import FakeBucket
from suite.drive.utils.files import S3_URL_PREFIX, get_s3_url

BUCKET = "drive-build-test-bucket"


@contextmanager
def storage_v2_on(**config):
    """Turn on storage v2 and, optionally, the S3 driver, then put it back."""
    previous = {
        key: frappe.conf.get(key) for key in ("storage_v2", "storage_driver", "storage_driver_config")
    }
    frappe.conf["storage_v2"] = 1
    frappe.conf.update(config)
    reset_file_controller()
    try:
        yield
    finally:
        for key, value in previous.items():
            if value is None:
                frappe.conf.pop(key, None)
            else:
                frappe.conf[key] = value
        reset_file_controller()


class ScopedStorage(SiteStorage):
    """`SiteStorage` with the backfill narrowed to one test's rows.

    Production calls `backfill.run()` unfiltered (§14.2 step 2). Its
    unfiltered behaviour is the framework's own contract, covered by
    `frappe.storage.tests.test_gc_backfill`; running it over every row on a
    shared site would be slow and would say nothing extra.
    """

    def __init__(self, prefix):
        self.prefix = prefix

    def run_backfill(self, batch_size):
        from frappe.storage import backfill

        return backfill.run(batch_size=batch_size, filters={"name": ("like", self.prefix + "%")})


class TestBuildStoragePreparation(IntegrationTestCase):
    def setUp(self):
        super().setUp()
        self.prefix = "bldut" + frappe.generate_hash(length=8)
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.state = BuildState(Path(self.tmp.name) / STATE_FILENAME)
        self.bucket = FakeBucket(BUCKET)

    def tearDown(self):
        frappe.db.delete("File", {"name": ("like", self.prefix + "%")})
        frappe.db.delete("File Blob", {"key": ("like", f"../{self.prefix}%")})
        super().tearDown()

    # fixtures

    def insert_row(self, file_url, file_name, is_private=1):
        doc = frappe.new_doc("File")
        doc.update(
            {
                "file_name": file_name,
                "file_url": file_url,
                "is_private": cint(is_private),
                "is_folder": 0,
            }
        )
        doc.name = self.prefix + frappe.generate_hash(length=10)
        doc.owner = doc.modified_by = "Administrator"
        doc.creation = doc.modified = now_datetime()
        doc.db_insert()
        return doc.name

    def local_file(self, content, create_bytes=True):
        filename = f"{self.prefix}-{frappe.generate_hash(length=10)}.txt"
        path = get_files_path(filename, is_private=True)
        if create_bytes:
            with open(path, "wb") as f:
                f.write(content)
            self.addCleanup(lambda p=path: os.path.exists(p) and os.remove(p))
        return self.insert_row("/private/files/" + filename, filename), path

    def s3_file(self, key, content, file_name="report.PDF"):
        self.bucket.put(key, content)
        return self.insert_row(get_s3_url(key), file_name)

    def row(self, name):
        return frappe.db.get_value("File", name, ["name", "blob", "file_url", "file_name"], as_dict=True)

    def environment(self, legacy_s3):
        return BuildEnvironment(
            storage=ScopedStorage(self.prefix),
            files=SiteFiles(S3_URL_PREFIX),
            state=self.state,
            legacy_s3=legacy_s3,
            open_bucket=lambda: self.bucket,
        )

    def prepare_local(self):
        with storage_v2_on():
            return prepare_legacy_bytes(self.environment(LegacyS3Config(enabled=False)))

    def prepare_s3(self):
        with storage_v2_on(storage_driver="s3", storage_driver_config={"bucket": BUCKET}):
            return prepare_legacy_bytes(self.environment(LegacyS3Config(enabled=True, bucket=BUCKET)))

    # the framework local backfill

    def test_local_bytes_are_linked_in_place_and_left_untouched(self):
        content = b"drive bytes for the build test"
        drive_row, drive_path = self.local_file(content)
        # A framework attachment outside any Drive tree. Build must leave it
        # working: the backfill links it in place, it is never moved.
        attachment, attachment_path = self.local_file(b"an unrelated attachment")
        before = {name: self.row(name) for name in (drive_row, attachment)}

        prep = self.prepare_local()

        for name in (drive_row, attachment):
            after = self.row(name)
            self.assertTrue(after.blob, f"{name} was not linked")
            self.assertEqual(after.file_url, before[name].file_url)
            self.assertEqual(after.file_name, before[name].file_name)
        self.assertEqual(Path(drive_path).read_bytes(), content)
        self.assertEqual(Path(attachment_path).read_bytes(), b"an unrelated attachment")
        self.assertEqual(prep.backfill_linked, 2)
        self.assertTrue(prep.completed)

    def test_a_local_row_with_no_bytes_is_reported_and_stays_blobless(self):
        missing, _ = self.local_file(b"never written", create_bytes=False)
        present, _ = self.local_file(b"written")

        prep = self.prepare_local()

        self.assertIsNone(self.row(missing).blob)
        self.assertTrue(self.row(present).blob)
        reported = {row.file: row.reason for row in prep.missing_bytes}
        self.assertIn(missing, reported)
        self.assertIn("cannot read", reported[missing])

    def test_a_second_run_links_nothing_new(self):
        self.local_file(b"idempotent bytes")
        first = self.prepare_local()
        blobs = frappe.db.count("File Blob", {"key": ("like", f"../{self.prefix}%")})

        second = self.prepare_local()

        self.assertEqual(first.backfill_linked, 1)
        self.assertEqual(second.backfill_linked, 0)
        self.assertEqual(second.backfill_blobs_created, 0)
        self.assertEqual(frappe.db.count("File Blob", {"key": ("like", f"../{self.prefix}%")}), blobs)

    # the legacy S3 copy

    def test_a_legacy_s3_object_becomes_a_real_private_s3_blob(self):
        content = b"%PDF-1.4 legacy drive object"
        checksum = hashlib.sha256(content).hexdigest()
        key = f"{self.prefix}/team/report.pdf"
        name = self.s3_file(key, content)

        prep = self.prepare_s3()

        row = self.row(name)
        self.assertTrue(row.blob)
        blob = frappe.get_doc("File Blob", row.blob)
        self.addCleanup(
            frappe.delete_doc, "File Blob", blob.name, force=1, ignore_permissions=True, ignore_missing=True
        )
        self.assertEqual(blob.key, blob_key(checksum, "report.PDF"))
        self.assertEqual(blob.checksum, checksum)
        self.assertEqual(blob.file_size, len(content))
        self.assertEqual(blob.driver, "s3")
        self.assertEqual(cint(blob.is_private), 1)
        self.assertEqual(blob.status, "Ready")

        destination = object_key(checksum, "report.PDF")
        self.assertEqual(self.bucket.copies, [("copy_object", key, destination)])
        self.assertEqual(self.bucket.objects[destination], content)
        # The source object and its url are preserved until Cleanup (§14.10).
        self.assertEqual(self.bucket.objects[key], content)
        self.assertEqual(row.file_url, get_s3_url(key))
        self.assertEqual(prep.s3_objects_copied, 1)
        self.assertEqual(prep.s3_bytes_copied, len(content))

    def test_a_rerun_reads_and_copies_nothing(self):
        content = b"resume me"
        key = f"{self.prefix}/team/resume.bin"
        self.s3_file(key, content)
        self.prepare_s3()
        blob_names = set(
            frappe.get_all("File Blob", {"checksum": hashlib.sha256(content).hexdigest()}, pluck="name")
        )
        for blob in blob_names:
            self.addCleanup(
                frappe.delete_doc, "File Blob", blob, force=1, ignore_permissions=True, ignore_missing=True
            )
        self.bucket.opened.clear()
        self.bucket.copies.clear()

        self.prepare_s3()

        self.assertEqual(self.bucket.opened, [])
        self.assertEqual(self.bucket.copies, [])

    def test_a_missing_s3_object_leaves_the_row_blobless_and_reported(self):
        name = self.insert_row(get_s3_url(f"{self.prefix}/team/gone.bin"), "gone.bin")

        prep = self.prepare_s3()

        self.assertIsNone(self.row(name).blob)
        self.assertIn(name, {row.file for row in prep.missing_bytes})

    # where the record lives

    def test_the_record_is_saved_under_the_sites_private_directory(self):
        path = BuildState.for_site().path
        self.assertEqual(path, Path(frappe.get_site_path("private", STATE_FILENAME)))
        self.assertEqual(path.parent.name, "private")

    def test_the_record_is_readable_after_the_run(self):
        self.local_file(b"recorded bytes")
        self.prepare_local()

        saved = BuildState(self.state.path).storage()

        self.assertTrue(saved.completed)
        self.assertEqual(saved.backfill_linked, 1)
