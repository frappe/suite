from contextlib import contextmanager
from io import BytesIO
from unittest.mock import Mock, patch

import frappe
from frappe.tests import IntegrationTestCase
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request

from suite.drive.api.files import (
    create_auth_token,
    get_file_content,
    move,
    remove_or_restore,
    rename,
    stream_file_content,
    track_visit,
    update_access,
    upload_file,
)
from suite.drive.api.list import get_attachments
from suite.drive.api.permissions import (
    get_general_access,
    get_user_access,
    get_user_access_for_user,
    user_has_permission,
)
from suite.drive.utils import (
    GENERAL_USER,
    STATUS_ACTIVE,
    STATUS_TRASHED,
    create_drive_file,
    get_user_folder,
)
from suite.drive.utils.files import FileManager
from suite.tests.utils import ensure_user

OWNER = "drive-files-owner@example.com"
OTHER_USER = "drive-files-other@example.com"
MEMBER = "drive-files-member@example.com"


class TestDriveFilesAPI(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(OWNER)
        ensure_user(OTHER_USER)
        ensure_user(MEMBER)
        with cls.set_user(OWNER):
            cls.home = get_user_folder(OWNER).name

    def setUp(self):
        frappe.flags.mute_drive_activity_log = True
        with self.set_user(OWNER):
            manager = FileManager()
            self.folder = create_drive_file(
                frappe.generate_hash(8),
                self.home,
                "Folder",
                lambda file: manager.create_folder(file),
            )
            self.file = create_drive_file(
                f"{frappe.generate_hash(8)}.txt",
                self.folder.name,
                "Text",
                f"{self.folder.file_url}{frappe.generate_hash(8)}.txt",
                "text/plain",
                12,
            )

    def test_owner_can_list_attachment(self):
        self.file.db_set({"attached_to_doctype": "User", "attached_to_name": OWNER})

        with self.set_user(OWNER):
            attachments = get_attachments("User", OWNER)

        self.assertEqual([attachment["name"] for attachment in attachments], [self.file.name])

    def test_track_visit_resolves_backing_file(self):
        self.file.db_set({"content_doctype": "User", "content_docname": OWNER})

        with (
            self.set_user(OWNER),
            patch("suite.drive.api.files.mark_as_viewed") as mark_as_viewed,
            patch("suite.drive.api.files.frappe.db.set_value"),
        ):
            track_visit(doctype="User", docname=OWNER)

        self.assertEqual(mark_as_viewed.call_args.args[0].name, self.file.name)

    def tearDown(self):
        frappe.flags.mute_drive_activity_log = False
        super().tearDown()

    @contextmanager
    def upload_request(self, content, filename, session, chunk=None):
        builder = EnvironBuilder(
            path="/api/method/suite.drive.api.files.upload_file",
            method="POST",
            data={"file": (BytesIO(content), filename)},
        )
        frappe.local.request = Request(builder.get_environ())
        values = {
            "uuid": session,
            "chunk_index": "" if chunk is None else str(chunk[0]),
            "total_chunk_count": "" if chunk is None else str(chunk[1]),
            "chunk_byte_offset": "" if chunk is None else str(chunk[2]),
        }
        frappe.form_dict.update(values)
        try:
            yield
        finally:
            for key in values:
                frappe.form_dict.pop(key, None)
            del frappe.local.request

    def upload(self, content, filename="upload.txt", session=None, chunk=None, total_size=None):
        session = session or frappe.generate_hash(12)
        with (
            self.upload_request(content, filename, session, chunk),
            patch("suite.drive.api.files.validate_quota"),
            patch("suite.drive.api.files.frappe.publish_realtime"),
        ):
            return upload_file(
                total_file_size=total_size if total_size is not None else len(content),
                parent=self.folder.name,
            )

    def test_owner_can_read_and_unrelated_user_cannot(self):
        with self.set_user(OWNER):
            self.assertTrue(user_has_permission(self.file, "read"))
        with self.set_user(OTHER_USER):
            self.assertFalse(user_has_permission(self.file, "read"))
            with self.assertRaises(frappe.PermissionError):
                get_file_content(self.file.name)

    def test_site_share_and_guest_public_access(self):
        # Inside a user folder, other site users are denied by default.
        with self.set_user(MEMBER):
            self.assertFalse(user_has_permission(self.file, "read"))

        # A $GENERAL share opens it to site users, but not guests.
        with self.set_user(OWNER):
            self.file.share(user=GENERAL_USER, read=True)
        with self.set_user(MEMBER):
            self.assertTrue(user_has_permission(self.file, "read"))
        with self.set_user("Guest"):
            self.assertFalse(user_has_permission(self.file, "read"))

        # A public share opens it to guests too.
        with self.set_user(OWNER):
            self.file.share(read=True)
        with self.set_user("Guest"):
            self.assertTrue(user_has_permission(self.file, "read"))

    def test_upload_persists_local_file_and_denies_non_member(self):
        with self.set_user(OWNER):
            uploaded = self.upload(b"local file contents")
            with FileManager().get_file(uploaded) as stored:
                self.assertEqual(stored.read(), b"local file contents")

        with (
            self.set_user(OTHER_USER),
            self.upload_request(b"denied", "denied.txt", frappe.generate_hash(12)),
        ):
            with self.assertRaises(frappe.PermissionError):
                upload_file(total_file_size=6, parent=self.folder.name)

    def test_upload_with_unknown_mime_type(self):
        with self.set_user(OWNER):
            uploaded = self.upload(b"unknown file contents", "upload.unknownextension")

            self.assertEqual(uploaded.file_type, "Unknown")
            self.assertFalse(uploaded.mime_type)
            with FileManager().get_file(uploaded) as stored:
                self.assertEqual(stored.read(), b"unknown file contents")

    def test_file_url_update_requires_valid_storage_path(self):
        with self.set_user(OWNER):
            file = frappe.get_doc("File", self.file.name)
            file.file_url = "/private/files/../../invalid.txt"
            with self.assertRaises(frappe.ValidationError):
                file.save()

    def test_ordered_chunks_are_assembled_byte_for_byte(self):
        session = frappe.generate_hash(12)
        with self.set_user(OWNER):
            self.assertIsNone(self.upload(b"hello ", session=session, chunk=(0, 2, 0), total_size=11))
            uploaded = self.upload(b"world", session=session, chunk=(1, 2, 6), total_size=11)
            with FileManager().get_file(uploaded) as stored:
                self.assertEqual(stored.read(), b"hello world")

    def test_local_and_s3_file_manager_reads_have_the_same_boundary(self):
        with self.set_user(OWNER):
            uploaded = self.upload(b"storage boundary")
            with FileManager().get_file(uploaded) as stored:
                self.assertEqual(stored.read(), b"storage boundary")

        manager = FileManager()
        manager.s3_enabled = True
        manager.conn = Mock()
        manager.conn.get_object.return_value = {"Body": BytesIO(b"storage boundary")}
        self.assertEqual(manager.get_file(uploaded).read(), b"storage boundary")
        manager.conn.get_object.assert_called_once_with(
            Bucket=manager.bucket,
            Key=uploaded.file_url.lstrip("/"),
        )

    def test_private_video_range_stream_uses_storage_relative_path(self):
        self.file.file_type = "Video"
        self.file.mime_type = "video/mp4"
        self.file.file_size = 12
        self.file.save()
        request = Request(EnvironBuilder(headers={"Range": "bytes=0-"}).get_environ())

        @contextmanager
        def stored_file(path):
            self.assertEqual(path, self.file.file_url.lstrip("/"))
            yield BytesIO(b"video bytes!")

        frappe.local.request = request
        try:
            with (
                self.set_user(OWNER),
                patch.object(FileManager, "open_file", side_effect=stored_file),
            ):
                response = stream_file_content(self.file.name)
        finally:
            del frappe.local.request

        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.data, b"video bytes!")

    def test_direct_and_inherited_shares_grant_read_access(self):
        with self.set_user(OWNER):
            self.file.share(user=OTHER_USER, read=True)
        with self.set_user(OTHER_USER):
            self.assertEqual(get_user_access(self.file.name)["read"], 1)

        with self.set_user(OWNER):
            self.file.unshare(OTHER_USER)
            self.folder.share(user=OTHER_USER, read=True)
        with self.set_user(OTHER_USER):
            self.assertEqual(get_user_access(self.file.name)["read"], 1)

    def test_get_user_access_endpoint_cannot_inspect_another_user(self):
        with self.set_user(OWNER):
            self.file.share(user=OTHER_USER, read=True)
            with self.assertRaises(TypeError):
                get_user_access(self.file.name, OTHER_USER)
            self.assertEqual(get_user_access_for_user(self.file.name, OTHER_USER)["read"], 1)

    def test_general_access_reports_public_site_and_restricted_access(self):
        with self.set_user(OWNER):
            self.assertEqual(get_general_access(self.file)["type"], "restricted")
            self.file.share(user=GENERAL_USER, read=True)
            self.assertEqual(get_general_access(self.file)["type"], "site")
            self.file.share(read=True)
            self.assertEqual(get_general_access(self.file)["type"], "public")
            self.file.unshare()
            self.file.unshare(GENERAL_USER)

        with self.set_user(OTHER_USER):
            with self.assertRaises(frappe.PermissionError):
                get_general_access(self.file)

    def test_sharing_api_adds_and_removes_permission(self):
        with self.set_user(OWNER):
            update_access(self.file.name, "share", cmd="share", user=OTHER_USER, read=True)
            self.assertTrue(
                frappe.db.exists(
                    "Drive Permission", {"entity": self.file.name, "user": OTHER_USER, "read": 1}
                )
            )
            update_access(self.file.name, "unshare", cmd="unshare", user=OTHER_USER)
            self.assertFalse(
                frappe.db.exists("Drive Permission", {"entity": self.file.name, "user": OTHER_USER})
            )

    def test_download_token_is_single_use_sequentially(self):
        with self.set_user(OWNER):
            token = create_auth_token(self.file.name)

        with (
            self.set_user("Guest"),
            patch(
                "suite.drive.api.files.get_file_internal", return_value=b"file contents"
            ) as get_file_internal,
        ):
            self.assertEqual(get_file_content(self.file.name, token=token), b"file contents")
            get_file_internal.assert_called_once()
            self.assertFalse(frappe.db.exists("Drive Token", token))
            with self.assertRaises(frappe.PermissionError):
                get_file_content(self.file.name, token=token)

    def test_trash_and_restore_preserve_status(self):
        with (
            self.set_user(OWNER),
            patch("suite.drive.api.files.validate_quota"),
            patch("suite.drive.api.files.FileManager.move_to_trash") as move_to_trash,
            patch("suite.drive.api.files.FileManager.restore") as restore,
        ):
            remove_or_restore([self.file.name])
            self.assertEqual(frappe.db.get_value("File", self.file.name, "status"), STATUS_TRASHED)
            move_to_trash.assert_called_once()

            remove_or_restore([self.file.name])
            self.assertEqual(frappe.db.get_value("File", self.file.name, "status"), STATUS_ACTIVE)
            restore.assert_called_once()

    def test_unrelated_user_cannot_trash_file(self):
        with (
            self.set_user(OTHER_USER),
            patch("suite.drive.api.files.FileManager.move_to_trash") as move_to_trash,
        ):
            with self.assertRaises(frappe.PermissionError):
                remove_or_restore([self.file.name])
            move_to_trash.assert_not_called()

    def test_owner_can_rename_and_move_uploaded_file(self):
        with self.set_user(OWNER):
            manager = FileManager()
            uploaded = self.upload(b"move me", "before.txt")
            destination = create_drive_file(
                frappe.generate_hash(8),
                self.home,
                "Folder",
                lambda file: manager.create_folder(file),
            )

            rename(uploaded.name, "after.txt")
            uploaded.reload()
            self.assertEqual(uploaded.file_name, "after.txt")
            with FileManager().get_file(uploaded) as stored:
                self.assertEqual(stored.read(), b"move me")

            move([uploaded.name], new_parent=destination.name)
            uploaded.reload()
            self.assertEqual(uploaded.folder, destination.name)
            with FileManager().get_file(uploaded) as stored:
                self.assertEqual(stored.read(), b"move me")

    def test_unrelated_user_cannot_rename_or_move_file(self):
        with self.set_user(OWNER):
            manager = FileManager()
            destination = create_drive_file(
                frappe.generate_hash(8),
                self.home,
                "Folder",
                lambda file: manager.create_folder(file),
            )
        with self.set_user(OTHER_USER):
            with self.assertRaises(frappe.PermissionError):
                rename(self.file.name, "forbidden.txt")
            with self.assertRaises(frappe.PermissionError):
                move([self.file.name], new_parent=destination.name)
