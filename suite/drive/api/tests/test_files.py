from contextlib import contextmanager
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
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
    can_create_in_folder,
    get_general_access,
    get_user_access,
    get_user_access_for_user,
    user_has_permission,
)
from suite.drive.overrides.file import File as DriveFile
from suite.drive.utils import (
    APP_FOLDERS,
    FRAMEWORK_FOLDERS,
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

    def test_upload_rejects_absolute_session_before_writing(self):
        with TemporaryDirectory() as temp_dir:
            storage_root = Path(temp_dir) / "private" / "files"
            storage_root.mkdir(parents=True)
            outside = Path(temp_dir) / "outside"
            outside.mkdir()
            session = str(outside / "escaped")
            escaped_file = outside / "escaped_upload.txt"

            with (
                self.set_user(OWNER),
                patch("suite.drive.api.files.frappe.get_site_path", return_value=str(storage_root)),
                patch(
                    "suite.drive.api.files.frappe.get_single",
                    return_value=frappe._dict(root_folder=""),
                ),
                self.assertRaises(frappe.ValidationError),
            ):
                self.upload(b"partial", session=session, chunk=(0, 2, 0), total_size=20)

            self.assertFalse(escaped_file.exists())

    def test_upload_rejects_parent_session_before_writing(self):
        with TemporaryDirectory() as temp_dir:
            storage_root = Path(temp_dir) / "private" / "files"
            storage_root.mkdir(parents=True)
            outside = Path(temp_dir) / "outside"
            outside.mkdir()
            escaped_file = outside / "escaped_upload.txt"

            with (
                self.set_user(OWNER),
                patch("suite.drive.api.files.frappe.get_site_path", return_value=str(storage_root)),
                patch(
                    "suite.drive.api.files.frappe.get_single",
                    return_value=frappe._dict(root_folder=""),
                ),
                self.assertRaises(frappe.ValidationError),
            ):
                self.upload(
                    b"partial",
                    session="../../../outside/escaped",
                    chunk=(0, 2, 0),
                    total_size=20,
                )

            self.assertFalse(escaped_file.exists())

    def test_single_upload_without_session_uses_safe_staging_path(self):
        with TemporaryDirectory() as temp_dir:
            storage_root = Path(temp_dir) / "private" / "files"
            storage_root.mkdir(parents=True)

            with (
                self.set_user(OWNER),
                patch("suite.drive.api.files.frappe.get_site_path", return_value=str(storage_root)),
                patch(
                    "suite.drive.api.files.frappe.get_single",
                    return_value=frappe._dict(root_folder=""),
                ),
                self.upload_request(b"partial", "upload.txt", session=None),
            ):
                upload_file(total_file_size=20, parent=self.folder.name)

            staged_files = list((storage_root / ".uploads").iterdir())
            self.assertEqual(len(staged_files), 1)
            self.assertEqual(staged_files[0].parent, storage_root / ".uploads")

    def test_chunked_upload_without_session_is_rejected_before_writing(self):
        with TemporaryDirectory() as temp_dir:
            storage_root = Path(temp_dir) / "private" / "files"
            storage_root.mkdir(parents=True)

            with (
                self.set_user(OWNER),
                patch("suite.drive.api.files.frappe.get_site_path", return_value=str(storage_root)),
                patch(
                    "suite.drive.api.files.frappe.get_single",
                    return_value=frappe._dict(root_folder=""),
                ),
                self.upload_request(b"partial", "upload.txt", session=None, chunk=(0, 2, 0)),
                self.assertRaises(frappe.ValidationError),
            ):
                upload_file(total_file_size=20, parent=self.folder.name)

            self.assertFalse((storage_root / ".uploads").exists())

    def test_chunked_upload_with_empty_session_is_rejected_before_writing(self):
        with TemporaryDirectory() as temp_dir:
            storage_root = Path(temp_dir) / "private" / "files"
            storage_root.mkdir(parents=True)

            with (
                self.set_user(OWNER),
                patch("suite.drive.api.files.frappe.get_site_path", return_value=str(storage_root)),
                patch(
                    "suite.drive.api.files.frappe.get_single",
                    return_value=frappe._dict(root_folder=""),
                ),
                self.upload_request(b"partial", "upload.txt", session="", chunk=(0, 2, 0)),
                self.assertRaises(frappe.ValidationError),
            ):
                upload_file(total_file_size=20, parent=self.folder.name)

            self.assertFalse((storage_root / ".uploads").exists())

    def test_upload_rejects_backslash_session_before_writing(self):
        with TemporaryDirectory() as temp_dir:
            storage_root = Path(temp_dir) / "private" / "files"
            storage_root.mkdir(parents=True)

            with (
                self.set_user(OWNER),
                patch("suite.drive.api.files.frappe.get_site_path", return_value=str(storage_root)),
                patch(
                    "suite.drive.api.files.frappe.get_single",
                    return_value=frappe._dict(root_folder=""),
                ),
                self.assertRaises(frappe.ValidationError),
            ):
                self.upload(
                    b"partial",
                    session=r"..\..\outside\escaped",
                    chunk=(0, 2, 0),
                    total_size=20,
                )

            self.assertFalse((storage_root / ".uploads").exists())

    def test_upload_rejects_non_opaque_session_before_writing(self):
        with TemporaryDirectory() as temp_dir:
            storage_root = Path(temp_dir) / "private" / "files"
            storage_root.mkdir(parents=True)

            with (
                self.set_user(OWNER),
                patch("suite.drive.api.files.frappe.get_site_path", return_value=str(storage_root)),
                patch(
                    "suite.drive.api.files.frappe.get_single",
                    return_value=frappe._dict(root_folder=""),
                ),
                self.assertRaises(frappe.ValidationError),
            ):
                self.upload(
                    b"partial",
                    session="not an opaque id",
                    chunk=(0, 2, 0),
                    total_size=20,
                )

            self.assertFalse((storage_root / ".uploads").exists())

    def test_upload_rejects_staging_symlink_escape_before_writing(self):
        with TemporaryDirectory() as temp_dir:
            storage_root = Path(temp_dir) / "private" / "files"
            uploads_root = storage_root / ".uploads"
            uploads_root.mkdir(parents=True)
            outside_file = Path(temp_dir) / "outside.txt"
            (uploads_root / "valid-session_upload.txt").symlink_to(outside_file)

            with (
                self.set_user(OWNER),
                patch("suite.drive.api.files.frappe.get_site_path", return_value=str(storage_root)),
                patch(
                    "suite.drive.api.files.frappe.get_single",
                    return_value=frappe._dict(root_folder=""),
                ),
                self.assertRaises(frappe.ValidationError),
            ):
                self.upload(
                    b"partial",
                    session="valid-session",
                    chunk=(0, 2, 0),
                    total_size=20,
                )

            self.assertFalse(outside_file.exists())

    def test_owner_can_read_and_unrelated_user_cannot(self):
        with self.set_user(OWNER):
            self.assertTrue(user_has_permission(self.file, "read"))
        with self.set_user(OTHER_USER):
            self.assertFalse(user_has_permission(self.file, "read"))
            with self.assertRaises(frappe.PermissionError):
                get_file_content(self.file.name)

    def test_content_link_cannot_be_forged_to_hijack_another_users_document(self):
        """content_doctype/content_docname are the sole permission delegation
        point for content documents like Writer Document (see
        content_has_permission in suite/drive/overrides/file.py): whoever's
        File claims a document inherits full access to it. Only Drive's own
        creation flow may ever set these fields — a user must not be able to
        point their own File at someone else's document and hijack it."""
        with self.set_user(OWNER):
            victim_doc = frappe.get_doc({"doctype": "Writer Document"}).insert()
            DriveFile.create_for_doc(victim_doc)

        with self.set_user(OTHER_USER):
            self.assertFalse(frappe.has_permission("Writer Document", "read", victim_doc.name))

            attacker_file = create_drive_file(
                f"{frappe.generate_hash(8)}.txt",
                get_user_folder(OTHER_USER).name,
                "Text",
                None,
            )

            # Forging the link via an update to a File the attacker owns must fail.
            forged = frappe.get_doc("File", attacker_file.name)
            forged.content_doctype = "Writer Document"
            forged.content_docname = victim_doc.name
            with self.assertRaises(frappe.PermissionError):
                forged.save()

            # Forging the link directly at insert time must fail too.
            with self.assertRaises(frappe.PermissionError):
                frappe.get_doc(
                    {
                        "doctype": "File",
                        "file_name": "forged.txt",
                        "is_private": 1,
                        "folder": get_user_folder(OTHER_USER).name,
                        "content_doctype": "Writer Document",
                        "content_docname": victim_doc.name,
                    }
                ).insert()

            self.assertFalse(frappe.has_permission("Writer Document", "read", victim_doc.name))

    def test_content_link_cannot_be_cleared_by_a_shared_collaborator(self):
        """File write access can come from a Drive share, not just ownership.
        A collaborator who only has write access to the File backing a
        document must not be able to clear content_doctype/content_docname —
        doing so would sever content_has_permission's delegation and orphan
        the document relative to after_delete's cascade-delete."""
        with self.set_user(OWNER):
            victim_doc = frappe.get_doc({"doctype": "Writer Document"}).insert()
            backing_file = DriveFile.create_for_doc(victim_doc)
            backing_file.share(user=MEMBER, write=True)

        with self.set_user(MEMBER):
            self.assertTrue(user_has_permission(backing_file, "write"))
            doc = frappe.get_doc("File", backing_file.name)
            doc.content_doctype = None
            doc.content_docname = None
            with self.assertRaises(frappe.PermissionError):
                doc.save()

        self.assertEqual(
            frappe.db.get_value("File", backing_file.name, "content_docname"),
            victim_doc.name,
        )

    def test_cannot_create_inside_another_users_folder(self):
        """`create` used to be granted unconditionally, so the generic REST API
        (`frappe.client.insert`, core's `/api/method/upload_file`) let any user
        insert a File with `folder` pointing anywhere - planting content inside a
        folder they hold no `upload` on. Drive's own endpoints checked `upload`,
        but nothing checked it behind them."""
        with self.set_user(OTHER_USER):
            self.assertFalse(user_has_permission(self.folder, "upload"))

            for values in (
                {"file_name": "planted.txt", "is_private": 1},
                {"file_name": "planted", "is_folder": 1},
            ):
                with self.assertRaises(frappe.PermissionError):
                    frappe.get_doc({"doctype": "File", "folder": self.folder.name, **values}).insert()

        self.assertFalse(
            frappe.db.exists("File", {"folder": self.folder.name, "file_name": ["like", "planted%"]})
        )

    def test_upload_access_is_enough_to_create(self):
        """The check is `upload` on the parent, not ownership: a collaborator
        granted upload keeps `create`, so sharing a folder for contribution still
        works. Asserted at the hook the framework actually calls on insert."""
        with self.set_user(OWNER):
            self.folder.share(user=MEMBER, read=True, upload=True)

        incoming = frappe.get_doc(
            {
                "doctype": "File",
                "folder": self.folder.name,
                "file_name": f"{frappe.generate_hash(8)}.txt",
                "is_private": 1,
            }
        )

        with self.set_user(MEMBER):
            self.assertTrue(user_has_permission(self.folder, "upload"))
            self.assertTrue(user_has_permission(incoming, "create"))

        with self.set_user(OTHER_USER):
            self.assertFalse(user_has_permission(incoming, "create"))

    def test_framework_upload_flow_still_permitted(self):
        """Core inserts attachments into `Home`/`Home/Attachments`, and resolves
        an unset `folder` to one of them in `validate` - after the create check.
        Denying either would break every attachment upload in the suite."""
        with self.set_user(OTHER_USER):
            for folder in (*FRAMEWORK_FOLDERS, None, ""):
                self.assertTrue(can_create_in_folder(folder))

            # Drive's own flow inserts into the user's own folder.
            self.assertTrue(can_create_in_folder(get_user_folder(OTHER_USER).name))

    def test_app_folder_upload_still_permitted(self):
        """Mail's compose uploads name `Home/Frappe Mail` explicitly. It is an
        app-owned bucket outside Drive's tree, created by Administrator at
        install, so no user holds `upload` on it - denying it broke every
        attachment sent from the Mail UI."""
        for folder in APP_FOLDERS:
            self.assertTrue(frappe.db.exists("File", folder), f"{folder} should exist")

            with self.set_user(OTHER_USER):
                self.assertFalse(get_user_access_for_user(folder, OTHER_USER).get("upload"))
                self.assertTrue(can_create_in_folder(folder))

                attachment = frappe.get_doc(
                    {
                        "doctype": "File",
                        "folder": folder,
                        "file_name": f"{frappe.generate_hash(8)}.txt",
                        "is_private": 1,
                        "content": "attachment contents",
                    }
                ).insert()

            # What lands there stays owner-scoped: the bucket is shared, the rows aren't.
            with self.set_user(MEMBER):
                self.assertFalse(user_has_permission(attachment, "read"))

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
        session = "123e4567-e89b-42d3-a456-426614174000"
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
