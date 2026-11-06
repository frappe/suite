import io
import zipfile
from datetime import timedelta
from unittest.mock import patch

import frappe
from frappe.storage.blob import put_blob
from frappe.storage.driver import get_driver
from frappe.storage.gc import blob_reference_columns
from frappe.tests import IntegrationTestCase, UnitTestCase
from frappe.utils import now_datetime

from suite.drive._core import archive as archive_core
from suite.drive._core import downloads
from suite.drive._core.access import grant, revoke
from suite.drive._core.activity import notifications
from suite.drive._core.errors import DriveConflict, DriveNotFound
from suite.drive._core.nodes import create_file, create_folder, create_link, update
from suite.drive._core.principals import Principals
from suite.drive._core.roles import NONE, READ
from suite.drive._core.roots import create_root
from suite.drive.http.shapes import download_shape
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
        frappe.db.delete("Drive Download", {"requester": ["in", (READER, STRANGER, "Guest")]})
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

    def prepare(self, *nodes: str, principals: Principals | None = None) -> frappe._dict:
        """Ask for a download and run its background job, as the worker would."""
        principals = principals or self.reader
        asked = downloads.start(principals, nodes)
        self.assertEqual(asked.status, "Preparing")
        downloads.build(asked.name, principals)
        return downloads.get(principals, asked.name)

    def zipped(self, download: str, principals: Principals | None = None) -> dict[str, bytes]:
        blob, _title = downloads.ready_blob(principals or self.reader, download)
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
        with patch.object(archive_core, "MAX_DOWNLOAD_BYTES", 4):
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

    def share_link(self) -> str:
        return grant(self.folder, "$LINK", READ, self.admin)["principal"]

    def test_a_guest_with_a_share_link_gets_the_zip_on_the_page_that_asked(self):
        link = self.share_link()
        with_header = Principals("Guest", (), ("$PUBLIC", link))
        # A browser navigation carries the session, never the link header.
        navigation = Principals("Guest", (), ("$PUBLIC",))

        ready = self.prepare(self.folder, principals=with_header)

        self.assertEqual((ready.status, ready.delivery), ("Ready", "Page"))
        self.assertEqual(len(ready.name), 32)
        self.assertEqual(self.zipped(ready.name, navigation)["Shared/report.txt"], b"confidential report")
        self.assertFalse(frappe.db.exists("Drive Notification", {"download": ready.name}))

    def test_revoking_the_link_refuses_the_guests_ready_zip(self):
        link = self.share_link()
        ready = self.prepare(self.folder, principals=Principals("Guest", (), ("$PUBLIC", link)))

        revoke(self.folder, link, self.admin)

        with self.assertRaises(DriveNotFound):
            downloads.ready_blob(Principals("Guest", (), ("$PUBLIC",)), ready.name)

    def test_a_signed_in_person_who_reads_only_through_a_link_gets_a_page_download(self):
        link = self.share_link()
        stranger = Principals(STRANGER, (STRANGER,), ("$PUBLIC", link))

        ready = self.prepare(self.folder, principals=stranger)

        self.assertEqual(ready.delivery, "Page")
        self.assertIn(
            "Shared/report.txt", self.zipped(ready.name, Principals(STRANGER, (STRANGER,), ("$PUBLIC",)))
        )
        self.assertEqual(self.inbox(Principals(STRANGER, (STRANGER,), ("$PUBLIC",))), [])

    def test_a_guessed_or_borrowed_download_name_is_not_found(self):
        ready = self.prepare(self.folder)
        for caller in (
            Principals("Guest", (), ("$PUBLIC",)),
            Principals(STRANGER, (STRANGER,), ("$PUBLIC",)),
        ):
            with self.assertRaises(DriveNotFound):
                downloads.get(caller, ready.name)
            with self.assertRaises(DriveNotFound):
                downloads.ready_blob(caller, ready.name)

    def test_asking_again_reuses_the_zip_being_prepared_or_ready(self):
        asked = downloads.start(self.reader, [self.folder, self.notes])
        self.assertEqual(downloads.start(self.reader, [self.notes, self.folder]).name, asked.name)

        downloads.build(asked.name, self.reader)

        again = downloads.start(self.reader, [self.folder, self.notes])
        self.assertEqual((again.name, again.status), (asked.name, "Ready"))

    def test_a_person_can_have_only_a_few_downloads_preparing_at_once(self):
        link = create_link(self.admin, self.projects, "Site", url="https://example.com")
        for nodes in ([self.folder], [self.notes], [link]):
            downloads.start(self.reader, nodes)
        with self.assertRaises(DriveConflict):
            downloads.start(self.reader, [self.folder, self.notes])

    def test_an_expired_zip_answers_expired_without_a_url(self):
        ready = self.prepare(self.folder)
        self.assertIsNotNone(download_shape(ready)["url"])

        frappe.db.set_value("Drive Download", ready.name, "expires_at", now_datetime() - timedelta(seconds=1))

        shape = download_shape(downloads.get(self.reader, ready.name))
        self.assertEqual((shape["status"], shape["url"]), ("Expired", None))
        with self.assertRaises(DriveNotFound):
            downloads.ready_blob(self.reader, ready.name)

    def test_a_download_whose_job_never_finished_fails_and_says_so(self):
        asked = downloads.start(self.reader, [self.folder])
        frappe.db.set_value(
            "Drive Download",
            asked.name,
            "creation",
            now_datetime() - timedelta(hours=2),
            update_modified=False,
        )

        downloads.purge_expired()

        self.assertEqual(downloads.get(self.reader, asked.name).status, "Failed")
        [notification] = self.inbox()
        self.assertEqual(notification.download.status, "Failed")

    def test_a_download_that_cannot_be_queued_fails_at_once(self):
        asked = downloads.start(self.reader, [self.folder])

        with (
            patch.object(downloads.frappe, "enqueue", side_effect=ConnectionError("redis is down")),
            patch.object(downloads.frappe.db, "commit"),
        ):
            downloads.queue_build(asked.name, self.reader)

        failed = downloads.get(self.reader, asked.name)
        self.assertEqual(failed.status, "Failed")
        [notification] = self.inbox()
        self.assertEqual(notification.download.name, asked.name)

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


class Zeros:
    """A stream of `size` zero bytes that never holds more than one block."""

    BLOCK = bytes(1024 * 1024)

    def __init__(self, size: int) -> None:
        self.left = size

    def read(self, limit: int) -> bytes:
        block = self.BLOCK[: min(limit, self.left)]
        self.left -= len(block)
        return block

    def close(self) -> None:
        pass


class Discard(io.RawIOBase):
    """A write-only sink that keeps nothing, as a spooled file would keep everything."""

    def writable(self) -> bool:
        return True

    def write(self, data) -> int:
        return len(data)


class TestLargeEntries(UnitTestCase):
    def test_a_file_over_two_gib_fits_in_the_zip(self):
        size = 2**31 + 1
        with zipfile.ZipFile(Discard(), "w", zipfile.ZIP_STORED) as archive:
            self.assertEqual(archive_core._write(archive, "big.bin", Zeros(size), 0), size)
        [entry] = archive.infolist()
        self.assertEqual(entry.file_size, size)
