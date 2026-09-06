import unittest
from unittest.mock import Mock, patch

import frappe

from suite.drive.api.scripts import sync_from_disk, sync_preview
from suite.drive.http.shims import DriveRetired


class TestSyncPermissions(unittest.TestCase):
    """`sync_preview` lists files that have no `File` record yet, so no share or
    folder permission can filter them. Only a site admin may read that listing.

    `sync_preview` is retained by §11.7: the route it was mapped onto uploads a
    thumbnail, so nothing replaces the disk listing and its gate is still the
    one that matters. `sync_from_disk` is retired, and its case below records
    what a retired name answers instead."""

    def _run(self, fn, is_admin):
        with patch("suite.drive.api.scripts.is_drive_site_admin", return_value=is_admin):
            # Patched so the test asserts on the permission gate, not on disk state.
            with patch("suite.drive.api.scripts.FileManager") as manager:
                manager.return_value.fetch_new_files.return_value = {}
                return fn()

    def test_sync_preview_is_refused_without_admin(self):
        with self.assertRaises(frappe.PermissionError):
            self._run(sync_preview, is_admin=False)

    def test_sync_preview_is_allowed_for_admin(self):
        self.assertEqual(list(self._run(sync_preview, is_admin=True)), [])

    def test_sync_from_disk_is_retired_and_refuses_everyone(self):
        # §11.7 drops it, because the Build migration takes over the disk
        # import. It refuses an admin too: a name that answered "nothing was
        # new" would read as a successful run.
        for is_admin in (False, True):
            with self.subTest(is_admin=is_admin):
                with self.assertRaises(DriveRetired) as caught:
                    self._run(sync_from_disk, is_admin=is_admin)
                self.assertEqual(caught.exception.http_status_code, 410)

    def test_sync_from_disk_creates_nothing_on_its_way_out(self):
        with patch("suite.drive.api.scripts.create_drive_file") as writer:
            with self.assertRaises(DriveRetired):
                self._run(sync_from_disk, is_admin=True)
        writer.assert_not_called()

    def test_sync_preview_does_not_touch_storage_before_refusing(self):
        """The refusal must precede `FileManager()`, so a non-admin request never
        reaches the filesystem or S3 at all."""
        with patch("suite.drive.api.scripts.is_drive_site_admin", return_value=False):
            with patch("suite.drive.api.scripts.FileManager") as manager:
                with self.assertRaises(frappe.PermissionError):
                    sync_preview()
        manager.assert_not_called()
