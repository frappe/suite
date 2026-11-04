import io
import zipfile
from datetime import timedelta
from unittest.mock import patch

import frappe
from frappe.storage.blob import put_blob
from frappe.storage.driver import get_driver
from frappe.storage.gc import blob_reference_columns
from frappe.tests import IntegrationTestCase
from frappe.utils import now_datetime

from suite.drive._core import downloads
from suite.drive._core.access import grant, revoke
from suite.drive._core.activity import notifications
from suite.drive._core.errors import DriveForbidden, DriveNotFound
from suite.drive._core.nodes import create_file, create_folder, create_link, update
from suite.drive._core.principals import Principals
from suite.drive._core.roles import NONE, READ
from suite.drive._core.roots import create_root
from suite.drive.tests.fixtures import drop_node_rows, ensure_rootless_user

OWNER = "download-owner@example.com"
READER = "download-reader@example.com"
STRANGER = "download-stranger@example.com"


class TestDownloads(IntegrationTestCase):
    """A reader of a shared folder asks for zips of it, and gets them through their inbox."""

    def setUp(self) -> None:
        super().setUp()
        frappe.set_user("Administrator")
        ensure_rootless_user(OWNER, READER, STRANGER)
        self.blobs_before = set(frappe.get_all("File Blob", pluck="name"))
        self.admin = Principals("Administrator", ("Administrator",), (), is_admin=True, is_system=True)
        self.reader = Principals(READER, (READER,), ("$PUBLIC",))
        self.root = create_root(kind="Personal", title="Download test", user=OWNER)
        self.projects = create_folder(self.admin, self.root.name, "Projects")
        self.folder = create_folder(self.admin, self.projects, "Shared")
        grant(self.projects, READER, READ, self.admin)
        self.file = self.make_file(self.folder, "report.txt", b"confidential report")
        self.notes = self.make_file(self.projects, "notes.txt", b"loose notes")
        frappe.set_user(READER)

    def tearDown(self) -> None:
        frappe.set_user("Administrator")
        frappe.db.delete("Drive Notification", {"to_user": ["in", (READER, STRANGER)]})
        frappe.db.delete("Drive Download", {"requester": ["in", (READER, STRANGER)]})
        drop_node_rows(frappe.get_all("Drive Node", filters={"root": self.root.name}, pluck="name"))
        drop_node_rows([self.root.name])
        frappe.db.delete("Drive Root", {"name": self.root.name})
        for blob in set(frappe.get_all("File Blob", pluck="name")) - self.blobs_before:
            frappe.delete_doc("File Blob", blob, force=True, ignore_permissions=True)
        super().tearDown()

    def make_file(self, parent: str, title: str, body: bytes) -> str:
        blob = put_blob(io.BytesIO(body), is_private=True, filename=title)
        return create_file(
            self.admin, parent, title, blob=blob.name, size=blob.file_size, mime=blob.mime_type
        )

    def prepare(self, *nodes: str) -> frappe._dict:
        """Ask for a download and run its background job, as the worker would."""
        asked = downloads.start(self.reader, nodes)
        self.assertEqual(asked.status, "Preparing")
        downloads.build(asked.name, self.reader)
        return downloads.get(self.reader, asked.name)

    def zipped(self, download: str) -> dict[str, bytes]:
        blob, _title = downloads.ready_blob(self.reader, download)
        with get_driver(blob.driver).read(blob.key, is_private=True) as stream:
            with zipfile.ZipFile(io.BytesIO(stream.read())) as archive:
                return {name: archive.read(name) for name in archive.namelist()}

    def inbox(self, principals: Principals | None = None) -> list[frappe._dict]:
        """The download notifications in a person's inbox. A grant adds a share notification as well."""
        return [row for row in notifications(principals or self.reader)["rows"] if row.download]

    def test_a_folder_is_zipped_in_the_background_and_announced_in_the_requesters_inbox(self):
        self.assertEqual(self.inbox(), [])

        ready = self.prepare(self.folder)

        self.assertEqual((ready.status, ready.title), ("Ready", "Shared.zip"))
        self.assertEqual(self.zipped(ready.name)["Shared/report.txt"], b"confidential report")
        self.assertAlmostEqual(
            ready.expires_at, now_datetime() + timedelta(hours=24), delta=timedelta(minutes=1)
        )
        [notification] = self.inbox()
        self.assertEqual(notification.download.name, ready.name)
        self.assertEqual(notification.read, 0)

    def test_several_items_make_one_zip_named_after_their_folder(self):
        link = create_link(self.admin, self.projects, "Site", url="https://example.com")

        ready = self.prepare(self.folder, self.notes, link)

        self.assertEqual(ready.title, "Projects.zip")
        files = self.zipped(ready.name)
        self.assertEqual(files["Shared/report.txt"], b"confidential report")
        self.assertEqual(files["notes.txt"], b"loose notes")
        self.assertIn(b"URL=https://example.com", files["Site.url"])

    def test_one_unreadable_item_fails_the_zip_and_the_inbox_says_so(self):
        grant(self.file, READER, NONE, self.admin)

        failed = self.prepare(self.folder)

        self.assertEqual(failed.status, "Failed")
        self.assertIn("cannot be read", failed.error)
        self.assertIsNone(failed.blob)
        [notification] = self.inbox()
        self.assertEqual(notification.download.status, "Failed")

    def test_a_zip_over_the_cap_fails_with_the_cap_named(self):
        with patch.object(downloads, "MAX_DOWNLOAD_BYTES", 4):
            failed = self.prepare(self.folder)
        self.assertEqual(failed.status, "Failed")
        self.assertIn("larger than", failed.error)

    def test_denying_one_member_after_the_build_refuses_the_ready_zip(self):
        ready = self.prepare(self.folder)
        grant(self.file, READER, NONE, self.admin)
        with self.assertRaises(DriveNotFound):
            downloads.ready_blob(self.reader, ready.name)

    def test_a_member_moved_out_and_unshared_is_still_rechecked(self):
        grant(self.file, READER, READ, self.admin)
        ready = self.prepare(self.folder)
        update(self.admin, self.file, parent_node=self.root.name)
        revoke(self.file, READER, self.admin)
        with self.assertRaises(DriveNotFound):
            downloads.ready_blob(self.reader, ready.name)

    def test_a_download_belongs_to_the_person_who_asked_for_it(self):
        ready = self.prepare(self.folder)
        stranger = Principals(STRANGER, (STRANGER,), ("$PUBLIC",))
        grant(self.projects, STRANGER, READ, self.admin)
        with self.assertRaises(DriveNotFound):
            downloads.ready_blob(stranger, ready.name)
        self.assertEqual(self.inbox(stranger), [])

    def test_a_guest_cannot_ask_for_a_download(self):
        guest = Principals("Guest", (), ("$PUBLIC",))
        with self.assertRaises(DriveForbidden):
            downloads.start(guest, [self.folder])

    def test_an_expired_zip_leaves_with_its_notification(self):
        ready = self.prepare(self.folder)
        frappe.db.set_value("Drive Download", ready.name, "expires_at", now_datetime() - timedelta(seconds=1))

        self.assertEqual(downloads.purge_expired(), 1)

        self.assertFalse(frappe.db.exists("Drive Download", ready.name))
        self.assertEqual(self.inbox(), [])

    def test_the_storage_collector_keeps_a_zip_while_its_download_exists(self):
        self.assertIn(
            {"doctype": "Drive Download", "fieldname": "blob", "issingle": 0}, blob_reference_columns()
        )
