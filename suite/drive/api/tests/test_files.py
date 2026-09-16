"""The legacy `api/files` surface, on both sides of ticket 23's boundary.

Two permission stores answer here until Build runs, so the module is split by
the store a name reads, not by the file the name lives in.

- `TestDriveFileRules` covers what still reads `File` and `Drive Permission`:
  the framework `has_permission` hooks, the content-link delegation, the
  retained `get_attachments`, and the legacy `FileManager`. Ticket 23 left
  every one of those bodies alone, so these cases are the pre-ticket ones.
- `TestLegacyFilesAPI`, `TestLegacyRetired`, and `TestLegacySearch` cover the
  whitelisted names. §11.7 forwards them into the `_core` workflows, so they
  answer about `Drive Node` and the fixtures have to be nodes.

A `File` row cannot answer a forwarder and a `Drive Node` cannot answer a
`has_permission` hook, so a case that mixes the two proves nothing about
either.
"""

import io
from contextlib import contextmanager
from io import BytesIO
from unittest.mock import Mock, patch
from urllib.parse import quote

import frappe
from frappe.storage.blob import put_blob
from frappe.tests import IntegrationTestCase
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request

from suite import drive
from suite.drive._core import nodes as node_core
from suite.drive._core import quota
from suite.drive._core.errors import DriveConflict, DriveForbidden, DriveNotFound, DriveOverQuota
from suite.drive._core.nodes import create_folder
from suite.drive._core.roots import personal_root_for, provision_personal_root
from suite.drive.api.files import (
    create_auth_token,
    does_entity_exist,
    get_file_content,
    get_new_title,
    move,
    remove_or_restore,
    rename,
    search,
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
from suite.drive.framework import principals_for
from suite.drive.http.shims import DriveRetired
from suite.drive.overrides.file import File as DriveFile
from suite.drive.patches.normalize_attachment_file_types import execute as normalize_attachment_file_types
from suite.drive.tests.fixtures import drop_node_rows, drop_record_rows, nodes_in_root, storage_v2
from suite.drive.utils import (
    APP_FOLDERS,
    FRAMEWORK_FOLDERS,
    GENERAL_USER,
    create_drive_file,
    get_file_type,
    get_user_folder,
)
from suite.drive.utils.files import FileManager, get_s3_url
from suite.tests.utils import ensure_user

# `upload()` has to tell "no session" from "give me one", and both are
# falsy, so the default cannot be `None`.
MINT = object()

OWNER = "drive-files-owner@example.com"
OTHER_USER = "drive-files-other@example.com"
MEMBER = "drive-files-member@example.com"


class TestDriveFileRules(IntegrationTestCase):
    """The `File` doctype rules ticket 23 did not touch.

    `user_has_permission`, `can_create_in_folder`, and
    `get_user_access_for_user` are not whitelisted names, so §11.7 left them
    on `File` and `Drive Permission` deliberately: `/dav`, the retained
    listings, and the framework's own attachment flow still read them. So does
    `File.share`, which is the store these cases write with.
    """

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

    def tearDown(self):
        frappe.flags.mute_drive_activity_log = False
        super().tearDown()

    def stored_bytes(self, file, content: bytes):
        """Put real bytes where `file.file_url` says they are.

        The legacy upload path that used to do this is gone: `upload_file`
        writes through `_core.upload` into a `File Blob` now. `FileManager`
        still reads a `File` row's own url for `/dav` and the retained
        downloads, so these cases stage the blob the way the disk holds it.
        """
        path = FileManager().get_local_path(file.file_url)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        self.addCleanup(path.unlink, True)
        return path

    def test_owner_can_list_attachment(self):
        self.file.db_set({"attached_to_doctype": "User", "attached_to_name": OWNER})

        with self.set_user(OWNER):
            attachments = get_attachments("User", OWNER)

        self.assertEqual([attachment["name"] for attachment in attachments], [self.file.name])

    def test_attachment_patch_normalizes_framework_file_type(self):
        try:
            self.file.db_set(
                {
                    "attached_to_doctype": "User",
                    "attached_to_name": OWNER,
                    "file_type": "TXT",
                }
            )

            normalize_attachment_file_types()

            self.file.reload()
            self.assertEqual(self.file.file_type, "Text")
            self.assertEqual(self.file.mime_type, "text/plain")
        finally:
            self.file.db_set({"attached_to_doctype": None, "attached_to_name": None})

    def _migrated_document(self):
        """One `Writer Document` in the shape Build leaves: a node, and a `File`.

        Ticket 29 registered the doctype, so `require_node` refuses a document
        with no node and the bare insert this used to make is impossible.
        §14.3 gives a migrated document the same id in both stores and §14.10
        keeps the legacy `File` until Cleanup, so the row these two cases guard
        is a linked document that still carries one.
        """
        home = personal_root_for(frappe.session.user) or provision_personal_root(frappe.session.user)
        node = drive.create_document(
            home, f"Victim {frappe.generate_hash(6)}", content_doctype="Writer Document"
        )
        docname = frappe.db.get_value("Drive Node", node, "content_docname")
        self.addCleanup(self._purge_document, node)
        return frappe.get_doc("Writer Document", docname)

    @staticmethod
    def _purge_document(node: str):
        frappe.set_user("Administrator")
        if not frappe.db.exists("Drive Node", node):
            return
        admin = principals_for()
        node_core.update(admin, node, state="Trashed")
        node_core.purge(admin, node)

    def test_content_link_cannot_be_forged_to_hijack_another_users_document(self):
        """content_doctype/content_docname are the sole permission delegation
        point for content documents like Writer Document (see
        content_has_permission in suite/drive/overrides/file.py): whoever's
        File claims a document inherits full access to it. Only Drive's own
        creation flow may ever set these fields — a user must not be able to
        point their own File at someone else's document and hijack it."""
        with self.set_user(OWNER):
            victim_doc = self._migrated_document()
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
            victim_doc = self._migrated_document()
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

    def test_owner_can_read_and_unrelated_user_cannot(self):
        with self.set_user(OWNER):
            self.assertTrue(user_has_permission(self.file, "read"))
        with self.set_user(OTHER_USER):
            self.assertFalse(user_has_permission(self.file, "read"))

    def test_get_user_access_for_user_still_reads_a_drive_permission_row(self):
        """The one legacy access read `_visible_rows` still calls.

        `api/list.py` moved off the whitelisted `get_user_access` for exactly
        this: `get_attachments` walks `File` rows, and the whitelisted name now
        answers about `Drive Node`.
        """
        with self.set_user(OWNER):
            self.file.share(user=OTHER_USER, read=True)
            self.assertEqual(get_user_access_for_user(self.file.name, OTHER_USER)["read"], 1)

    def test_file_url_update_requires_valid_storage_path(self):
        with self.set_user(OWNER):
            file = frappe.get_doc("File", self.file.name)
            file.file_url = "/private/files/../../invalid.txt"
            with self.assertRaises(frappe.ValidationError):
                file.save()

    def test_local_and_s3_file_manager_reads_have_the_same_boundary(self):
        self.stored_bytes(self.file, b"storage boundary")

        with self.set_user(OWNER), FileManager().get_file(self.file) as stored:
            self.assertEqual(stored.read(), b"storage boundary")

        manager = FileManager()
        manager.s3_enabled = True
        manager.conn = Mock()
        manager.conn.get_object.return_value = {"Body": BytesIO(b"storage boundary")}
        remote = frappe._dict(file_url=get_s3_url(f"team/{self.file.name}"))
        self.assertEqual(manager.get_file(remote).read(), b"storage boundary")
        manager.conn.get_object.assert_called_once_with(
            Bucket=manager.bucket,
            Key=f"team/{self.file.name}",
        )

    def test_framework_attachment_blob_reads_from_disk_even_with_s3(self):
        # Adopted framework uploads keep their /private/files url and their blob
        # on the site's disk; enabling S3 must not send their reads to the bucket.
        self.stored_bytes(self.file, b"disk blob")

        manager = FileManager()
        manager.s3_enabled = True
        manager.conn = Mock()
        with manager.get_file(self.file) as stored:
            self.assertEqual(stored.read(), b"disk blob")
        manager.conn.get_object.assert_not_called()


class LegacyNodeCase(IntegrationTestCase):
    """One `Drive Node` fixture tree below the caller's own Personal root.

    The forwarders resolve their destination through `shims._home`, which is
    `roots.personal_root_for` - the root `after_user_insert` provisions. The
    fixtures hang off that root rather than a second one made here, so a name
    called with no `parent` lands where the shim says it lands.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        for user in (OWNER, OTHER_USER, MEMBER):
            ensure_user(user)

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.home = personal_root_for(OWNER) or provision_personal_root(OWNER)
        self.owner = principals_for(OWNER)
        self.other = principals_for(OTHER_USER)
        self.nodes_before = nodes_in_root(self.home)
        self.blobs_before = set(frappe.get_all("File Blob", pluck="name"))
        self.folder = create_folder(self.owner, self.home, f"folder-{frappe.generate_hash(6)}")

    def tearDown(self):
        frappe.set_user("Administrator")
        created = nodes_in_root(self.home) - self.nodes_before
        drop_record_rows(created)
        drop_node_rows(created)
        for blob in set(frappe.get_all("File Blob", pluck="name")) - self.blobs_before:
            frappe.delete_doc("File Blob", blob, force=1, ignore_permissions=True, ignore_missing=True)
        # The rows went out from under the counter, so recount rather than
        # leave the next case's quota reading the fixtures this one deleted.
        quota.recompute_usage(self.home)
        super().tearDown()

    def make_file(self, parent: str, title: str, content: bytes = b"drive bytes") -> str:
        """One node with bytes in it, through the workflow a route would use."""
        blob = put_blob(io.BytesIO(content), is_private=True, filename=title)
        return node_core.create_file(
            self.owner,
            parent,
            title,
            blob=blob.name,
            size=blob.file_size,
            mime=blob.mime_type,
        )

    def bytes_of(self, node: str) -> bytes:
        stream, _mime = node_core.read_file(self.owner, node)
        try:
            return stream.read()
        finally:
            stream.close()

    def children_of(self, parent: str) -> list[str]:
        return frappe.get_all("Drive Node", filters={"parent": parent, "state": "Active"}, pluck="name")

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

    def upload(self, content, filename="upload.txt", session=MINT, chunk=None, total_size=None, parent=None):
        """One legacy upload call, which is one chunk.

        `total_file_size` defaults to the bytes in hand because that is what
        Dropzone sends for anything below its chunk size: the field arrives
        only on a chunked upload. `session` defaults to a fresh id; `None` and
        `""` are sent as themselves, because a client that names no session is
        one of the cases.
        """
        if session is MINT:
            session = frappe.generate_hash(12)
        with (
            storage_v2(),
            self.upload_request(content, filename, session, chunk),
            patch("suite.drive.api.files.frappe.publish_realtime"),
        ):
            return upload_file(
                total_file_size=total_size if total_size is not None else len(content),
                parent=parent or self.folder,
            )


class TestLegacyFilesAPI(LegacyNodeCase):
    """The §11.7 forwarders, against the nodes they now answer about."""

    def setUp(self):
        super().setUp()
        self.file = self.make_file(self.folder, f"{frappe.generate_hash(8)}.txt", b"drive bytes")

    # -- uploads ----------------------------------------------------------

    def test_upload_persists_the_bytes_and_answers_a_legacy_row(self):
        with self.set_user(OWNER):
            row = self.upload(b"local file contents")

        self.assertEqual(row["file_name"], "upload.txt")
        self.assertEqual(row["folder"], self.folder)
        self.assertEqual(row["file_size"], len(b"local file contents"))
        self.assertEqual(row["is_folder"], 0)
        self.assertEqual(row["owner"], OWNER)
        self.assertEqual(self.bytes_of(row["name"]), b"local file contents")

    def test_upload_declares_the_bytes_in_hand_when_the_client_declares_none(self):
        """Dropzone sends `total_file_size` on a chunked upload only.

        A session that declared zero refused its own first chunk and deleted
        itself, so every upload below the twenty megabyte chunk size failed.
        """
        with self.set_user(OWNER):
            row = self.upload(b"undeclared bytes", total_size=0)

        self.assertEqual(row["file_size"], len(b"undeclared bytes"))
        self.assertEqual(self.bytes_of(row["name"]), b"undeclared bytes")

    def test_upload_denies_a_non_member_and_creates_nothing(self):
        before = self.children_of(self.folder)

        with self.set_user(OTHER_USER), self.assertRaises(DriveNotFound):
            self.upload(b"denied", "denied.txt")

        self.assertEqual(self.children_of(self.folder), before)

    def test_ordered_chunks_are_assembled_byte_for_byte(self):
        session = "123e4567-e89b-42d3-a456-426614174000"
        with self.set_user(OWNER):
            self.assertIsNone(self.upload(b"hello ", session=session, chunk=(0, 2, 0), total_size=11))
            row = self.upload(b"world", session=session, chunk=(1, 2, 6), total_size=11)

        self.assertEqual(self.bytes_of(row["name"]), b"hello world")

    def test_a_chunked_upload_refuses_a_session_id_that_is_not_opaque(self):
        """The session id is a cache key now, never a path.

        The old body spelled it into a staging filename, so it had to be
        refused before the write. It is still refused, and before the
        destination is read, so a probe learns nothing about the folder.
        """
        before = self.children_of(self.folder)
        cases = {
            "absolute": "/tmp/outside/escaped",
            "parent": "../../../outside/escaped",
            "backslash": r"..\..\outside\escaped",
            "spaces": "not an opaque id",
            "missing": None,
            "empty": "",
        }

        for label, session in cases.items():
            with self.subTest(session=label), self.set_user(OWNER):
                with self.assertRaises(frappe.ValidationError) as caught:
                    self.upload(b"partial", session=session, chunk=(0, 2, 0), total_size=20)
                self.assertIn("Invalid upload session", str(caught.exception))

        self.assertEqual(self.children_of(self.folder), before)

    def test_a_single_chunk_upload_mints_its_own_session(self):
        """The old body minted an id only when the client named none and sent
        one chunk. Minting per chunk instead bound every chunk to a new
        `upload_id`, and the last one finished a file with holes."""
        with (
            self.set_user(OWNER),
            storage_v2(),
            self.upload_request(b"unnamed session", "upload.txt", session=None),
            patch("suite.drive.api.files.frappe.publish_realtime"),
        ):
            row = upload_file(total_file_size=0, parent=self.folder)

        self.assertEqual(self.bytes_of(row["name"]), b"unnamed session")

    def test_an_upload_over_the_root_quota_charges_nothing(self):
        used = frappe.db.get_value("Drive Root", self.home, "used_bytes")
        frappe.db.set_value("Drive Root", self.home, "quota_bytes", used + 4)
        self.addCleanup(frappe.db.set_value, "Drive Root", self.home, "quota_bytes", 0)
        before = self.children_of(self.folder)

        with self.set_user(OWNER), self.assertRaises(DriveOverQuota):
            self.upload(b"more bytes than the root will take")

        self.assertEqual(self.children_of(self.folder), before)
        self.assertEqual(frappe.db.get_value("Drive Root", self.home, "used_bytes"), used)

    def test_upload_file_type_comes_from_the_mime_storage_recorded(self):
        """Legacy `file_type` is the mime table's answer for the node's mime.

        The old body sniffed the staged bytes with libmagic and typed the file
        from that. §14 gives the mime to storage, and `finish_upload` takes
        `blob.mime_type`, so an extension the site cannot name reads back as
        the blob's fallback rather than as the sniffed content type.
        """
        with self.set_user(OWNER):
            row = self.upload(b"unknown file contents", "upload.unknownextension")

        mime = frappe.db.get_value("Drive Node", row["name"], "mime")
        self.assertEqual(mime, "application/octet-stream")
        self.assertEqual(row["file_type"], get_file_type(mime))
        self.assertEqual(self.bytes_of(row["name"]), b"unknown file contents")

    def test_an_upload_publishes_the_list_row_to_the_uploader(self):
        """`GenericPage.vue` still appends `list-add` to the open folder.

        It is sent to the uploader alone: §5 does not let a node row travel to
        a session that was never authorized for it.
        """
        with (
            self.set_user(OWNER),
            storage_v2(),
            self.upload_request(b"published", "published.txt", session=None),
            patch("suite.drive.api.files.frappe.publish_realtime") as publish,
        ):
            row = upload_file(total_file_size=0, parent=self.folder)

        # The patch is on the module global, so the framework's own `doc_update`
        # and `list_update` events for every row the upload writes land here
        # too. Only the shim's own event is under test.
        sent = [call for call in publish.call_args_list if call.args[0] == "list-add"]
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0].kwargs["user"], OWNER)
        payload = sent[0].args[1]
        self.assertEqual(payload["file"]["name"], row["name"])
        self.assertEqual(payload["file"]["file_name"], "published.txt")

    # -- content ----------------------------------------------------------

    def test_get_file_content_answers_a_signed_redirect(self):
        blob = frappe.db.get_value("Drive Node", self.file, "blob")
        title = frappe.db.get_value("Drive Node", self.file, "title")

        with self.set_user(OWNER):
            self.assertIsNone(get_file_content(self.file))

        self.assertEqual(frappe.local.response["type"], "redirect")
        location = frappe.local.response["location"]
        self.assertEqual(location.split("?")[0], f"/f/{blob}/{quote(title)}")
        self.assertIn("e=", location)
        self.assertIn("s=", location)

    def test_stream_file_content_answers_the_same_redirect(self):
        """Ranges are storage's now, behind the signed URL.

        The old body read up to twenty megabytes into this worker and answered
        206 itself; there is nothing left for a separate entry point to do.
        """
        with self.set_user(OWNER):
            self.assertIsNone(get_file_content(self.file))
            signed = frappe.local.response["location"]
            self.assertIsNone(stream_file_content(self.file))
            streamed = frappe.local.response["location"]

        self.assertEqual(streamed.split("?")[0], signed.split("?")[0])

    def test_an_unrelated_user_is_refused_the_bytes(self):
        with self.set_user(OTHER_USER), self.assertRaises(DriveNotFound):
            get_file_content(self.file)

    # -- lifecycle --------------------------------------------------------

    def test_owner_can_rename_and_move_and_the_answer_is_what_the_client_routes_on(self):
        with self.set_user(OWNER):
            destination = create_folder(self.owner, self.home, f"dest-{frappe.generate_hash(6)}")
            renamed = rename(self.file, "after.txt")
            self.assertEqual(renamed["file_name"], "after.txt")
            self.assertEqual(self.bytes_of(self.file), b"drive bytes")

            # `File.move` answered the destination, and both frontend `move`
            # resources read it that way: the toast names it and "Go" opens it.
            moved = move([self.file], new_parent=destination)

        self.assertEqual(moved["name"], destination)
        self.assertEqual(moved["folder"], self.home)
        self.assertEqual(frappe.db.get_value("Drive Node", destination, "title"), moved["file_name"])
        self.assertEqual(frappe.db.get_value("Drive Node", self.file, "parent"), destination)
        self.assertEqual(self.bytes_of(self.file), b"drive bytes")

    def test_unrelated_user_cannot_rename_or_move_file(self):
        with self.set_user(OWNER):
            destination = create_folder(self.owner, self.home, f"dest-{frappe.generate_hash(6)}")

        with self.set_user(OTHER_USER):
            with self.assertRaises(DriveNotFound):
                rename(self.file, "forbidden.txt")
            with self.assertRaises(DriveNotFound):
                move([self.file], new_parent=destination)

        self.assertEqual(frappe.db.get_value("Drive Node", self.file, "parent"), self.folder)

    def test_trash_and_restore_toggle_the_node_state(self):
        with self.set_user(OWNER):
            remove_or_restore([self.file])
            self.assertEqual(frappe.db.get_value("Drive Node", self.file, "state"), "Trashed")

            remove_or_restore([self.file])
            self.assertEqual(frappe.db.get_value("Drive Node", self.file, "state"), "Active")

    def test_unrelated_user_cannot_trash_file(self):
        with self.set_user(OTHER_USER), self.assertRaises(DriveNotFound):
            remove_or_restore([self.file])

        self.assertEqual(frappe.db.get_value("Drive Node", self.file, "state"), "Active")

    def test_a_restore_names_no_destination(self):
        """§8.7 puts a node back where it was and refuses when that place is
        gone. The forwarder passes the refusal on rather than picking a home
        the client never named."""
        with self.set_user(OWNER):
            nested = create_folder(self.owner, self.folder, "nested")
            inner = self.make_file(nested, "inner.txt", b"inner")
            remove_or_restore([inner])
            remove_or_restore([nested])

            with self.assertRaises(DriveConflict):
                remove_or_restore([inner])

        self.assertEqual(frappe.db.get_value("Drive Node", inner, "state"), "Trashed")

    # -- access -----------------------------------------------------------

    def test_direct_and_inherited_shares_grant_read_access(self):
        with self.set_user(OWNER):
            update_access(self.file, "share", cmd="share", user=OTHER_USER, read=True)
        with self.set_user(OTHER_USER):
            self.assertEqual(get_user_access(self.file)["read"], 1)

        with self.set_user(OWNER):
            update_access(self.file, "unshare", cmd="unshare", user=OTHER_USER)
            update_access(self.folder, "share", cmd="share", user=OTHER_USER, read=True)
        with self.set_user(OTHER_USER):
            self.assertEqual(get_user_access(self.file)["read"], 1)

    def test_sharing_api_adds_and_removes_a_grant_and_writes_no_deny(self):
        """§5.10 keeps removal and denial apart.

        `File.unshare` inserted a `deny=1` row to cut inheritance. A client
        that wants a denial has to send `deny=1` itself now, so an unshare must
        leave no row at all - a role 0 row would cut inheritance from above.
        """
        with self.set_user(OWNER):
            update_access(self.file, "share", cmd="share", user=OTHER_USER, read=True)
            self.assertTrue(
                frappe.db.exists("Drive Grant", {"node": self.file, "principal": OTHER_USER, "role": 10})
            )

            update_access(self.file, "unshare", cmd="unshare", user=OTHER_USER)

        self.assertFalse(frappe.db.exists("Drive Grant", {"node": self.file, "principal": OTHER_USER}))

    def test_a_share_that_reaches_no_rung_is_refused(self):
        """Role 0 is §5.10's deny. `File.share` left an unnamed bit at whatever
        the row already held and never wrote a deny, so an all-zero share was
        "no access" - writing 0 here would cut inherited access instead."""
        with self.set_user(OWNER), self.assertRaises(frappe.ValidationError):
            update_access(self.file, "share", cmd="share", user=OTHER_USER, comment=True)

        self.assertFalse(frappe.db.exists("Drive Grant", {"node": self.file, "principal": OTHER_USER}))

    def test_get_user_access_answers_zeros_for_a_node_the_caller_cannot_see(self):
        """The old body answered an all-zero dict for an entity with no decided
        row, and callers merge this into list rows and test bits. A 404 would
        break a payload that only ever asked a question."""
        with self.set_user(OTHER_USER):
            answer = get_user_access(self.file)

        self.assertEqual(
            answer, {"read": 0, "comment": 0, "upload": 0, "write": 0, "share": 0, "type": "guest"}
        )

    def test_get_user_access_endpoint_cannot_inspect_another_user(self):
        with self.set_user(OWNER), self.assertRaises(TypeError):
            get_user_access(self.file, OTHER_USER)

    def test_general_access_reports_public_site_and_restricted_access(self):
        """The site-wide rows are written by an admin here, not by the owner.

        `test_a_site_wide_share_drops_the_sharer_below_manage` says why: the
        second write would refuse. The answer under test is the three-way
        report, which needs READ, so the owner still reads every step of it.
        """
        with self.set_user(OWNER):
            self.assertEqual(get_general_access(self.file)["type"], "restricted")

        with self.set_user("Administrator"):
            update_access(self.file, "share", cmd="share", user=GENERAL_USER, read=True)
        with self.set_user(OWNER):
            self.assertEqual(get_general_access(self.file)["type"], "site")

        with self.set_user("Administrator"):
            update_access(self.file, "share", cmd="share", user="", read=True)
        with self.set_user(OWNER):
            self.assertEqual(get_general_access(self.file)["type"], "public")

        with self.set_user("Administrator"):
            # One gesture, both rows: the dialog's "Restricted" sends $GENERAL
            # alone, and revoking one row would leave a published file published.
            update_access(self.file, "unshare", cmd="unshare", user=GENERAL_USER)
        with self.set_user(OWNER):
            self.assertEqual(get_general_access(self.file)["type"], "restricted")

        with self.set_user(OTHER_USER), self.assertRaises(DriveNotFound):
            get_general_access(self.file)

    def test_a_site_wide_share_drops_the_sharer_below_manage(self):
        """§5.1 resolves own principals nearest-first, and `$GENERAL` is one.

        The owner of a Personal root holds MANAGE from the root anchor, which
        is the shallowest row in the chain. A `$GENERAL` READ row on the file
        is nearer, so it decides, and the owner falls to READ on their own
        file. The next share refuses, and so does the unshare that would undo
        it: both need MANAGE.

        The old body had no such rule. `get_user_access_for_user` answered full
        access to an owner before it read a row, so a legacy publish gesture
        never cut the person making it. This test pins the new answer rather
        than the old one, because §5.1 is the engine's rule and this shim does
        not get to hold a second one. It is recorded as a carried risk.
        """
        with self.set_user(OWNER):
            update_access(self.file, "share", cmd="share", user=GENERAL_USER, read=True)

            self.assertEqual(get_user_access(self.file)["read"], 1)
            self.assertEqual(get_user_access(self.file)["share"], 0)

            with self.assertRaises(DriveForbidden):
                update_access(self.file, "share", cmd="share", user="", read=True)
            with self.assertRaises(DriveForbidden):
                update_access(self.file, "unshare", cmd="unshare", user=GENERAL_USER)

        self.assertFalse(frappe.db.exists("Drive Grant", {"node": self.file, "principal": "$PUBLIC"}))
        self.assertTrue(frappe.db.exists("Drive Grant", {"node": self.file, "principal": "$GENERAL"}))

    def test_a_legacy_caller_cannot_mint_a_share_link(self):
        """§8.5's route issues a link. No legacy name has that contract, and
        `File.share` had no branch for it."""
        with self.set_user(OWNER), self.assertRaises(frappe.ValidationError):
            update_access(self.file, "share", cmd="share", user="$LINK", read=True)

        self.assertFalse(
            frappe.get_all("Drive Grant", filters={"node": self.file, "principal": ("like", "$LINK:%")})
        )

    # -- probes -----------------------------------------------------------

    def test_owner_can_still_probe_own_folder_and_default_home(self):
        title = frappe.db.get_value("Drive Node", self.file, "title")

        with self.set_user(OWNER):
            self.assertTrue(does_entity_exist(name=title, folder=self.folder))
            self.assertFalse(does_entity_exist(name=f"{frappe.generate_hash(8)}.txt"))

    def test_unrelated_user_cannot_probe_folder_for_filenames(self):
        title = frappe.db.get_value("Drive Node", self.file, "title")

        with self.set_user(OTHER_USER), self.assertRaises(DriveNotFound):
            does_entity_exist(name=title, folder=self.folder)

    def test_read_access_alone_cannot_probe_folder_for_filenames(self):
        """The realistic caller: access was granted, the folder ID was learned,
        then access was taken away. The ID outlives the grant. Read is not
        enough either - only the upload flow needs this answer."""
        title = frappe.db.get_value("Drive Node", self.file, "title")

        with self.set_user(OWNER):
            update_access(self.folder, "share", cmd="share", user=OTHER_USER, read=True)
        with self.set_user(OTHER_USER), self.assertRaises(DriveForbidden):
            does_entity_exist(name=title, folder=self.folder)

        with self.set_user(OWNER):
            update_access(self.folder, "unshare", cmd="unshare", user=OTHER_USER)
        with self.set_user(OTHER_USER), self.assertRaises(DriveNotFound):
            does_entity_exist(name=title, folder=self.folder)

    def test_upload_access_answers_the_probe(self):
        title = frappe.db.get_value("Drive Node", self.file, "title")

        with self.set_user(OWNER):
            update_access(
                self.folder, "share", cmd="share", user=OTHER_USER, read=True, comment=True, upload=True
            )

        with self.set_user(OTHER_USER):
            self.assertIs(does_entity_exist(name=title, folder=self.folder), True)
            self.assertIs(does_entity_exist(name="unclaimed.txt", folder=self.folder), False)

    # -- records ----------------------------------------------------------

    def test_track_visit_resolves_the_node_backing_a_content_document(self):
        document = self.content_node("ToDo", f"visit-{frappe.generate_hash(8)}")

        with self.set_user(OWNER):
            track_visit(
                doctype="ToDo", docname=frappe.db.get_value("Drive Node", document, "content_docname")
            )

        self.assertTrue(frappe.db.exists("Drive Recent", {"node": document, "user": OWNER}))

    def test_track_visit_refuses_a_document_with_no_node(self):
        with self.set_user(OWNER), self.assertRaises(frappe.ValidationError) as caught:
            track_visit(doctype="ToDo", docname=frappe.generate_hash(10))

        self.assertIn("A Drive file or content document is required", str(caught.exception))

    def content_node(self, doctype: str, docname: str) -> str:
        """A `kind=document` node, inserted directly.

        `create_document` reads `drive_content_types`, which ticket 29 leaves
        empty, so no `_core` helper can mint one here.
        """
        return (
            frappe.get_doc(
                {
                    "doctype": "Drive Node",
                    "title": "Deck",
                    "parent": self.folder,
                    "root": self.home,
                    "path": f"/{self.folder}/",
                    "kind": "document",
                    "content_doctype": doctype,
                    "content_docname": docname,
                    "mime": "frappe/test",
                    "state": "Active",
                    "owner": OWNER,
                }
            )
            .insert(ignore_permissions=True, ignore_links=True)
            .name
        )


class TestLegacyRetired(LegacyNodeCase):
    """The three names §11.7 drops, at the site boundary.

    `test_shims` holds the same contract against stubs. These cases add the
    one thing a stub cannot show: that a real row exists, is reachable, and is
    still not served.
    """

    def setUp(self):
        super().setUp()
        self.file = self.make_file(self.folder, f"{frappe.generate_hash(8)}.txt", b"drive bytes")

    def test_create_auth_token_refuses_and_mints_nothing(self):
        before = frappe.db.count("Drive Token")

        with self.set_user(OWNER), self.assertRaises(DriveRetired) as caught:
            create_auth_token(self.file)

        self.assertEqual(caught.exception.http_status_code, 410)
        self.assertIn("GET /api/suite/drive/nodes/:id/content", str(caught.exception))
        self.assertEqual(frappe.db.count("Drive Token"), before)

    def test_a_download_token_is_refused_before_the_node_is_read(self):
        """`create_auth_token` mints nothing, so any token presented here is
        expired or forged. It is refused before the id is resolved, so a
        forged token cannot be used to probe which nodes exist."""
        with self.set_user("Guest"), self.assertRaises(DriveRetired):
            get_file_content(frappe.generate_hash(10), token=frappe.generate_hash(10))

    def test_get_new_title_refuses_and_renames_nothing(self):
        title = frappe.db.get_value("Drive Node", self.file, "title")

        with self.set_user(OWNER), self.assertRaises(DriveRetired) as caught:
            get_new_title(title, self.folder)

        self.assertEqual(caught.exception.http_status_code, 410)
        self.assertEqual(frappe.db.get_value("Drive Node", self.file, "title"), title)

    def test_the_dedupe_rule_survives_where_the_upload_path_needs_it(self):
        """`get_new_title` is retired, but the contract it served is not:
        `upload_file` had to rename around a sibling clash because it has no
        dialog to ask a new title with. §8.6's own suffix rule answers it."""
        title = frappe.db.get_value("Drive Node", self.file, "title")

        with self.set_user(OWNER):
            row = self.upload(b"same name", filename=title)

        self.assertEqual(row["file_name"], f"{title.removesuffix('.txt')} (2).txt")


class TestLegacySearch(LegacyNodeCase):
    """`search` resolves access per row, so what it scans and what it returns
    are different counts. These cover the gap between them."""

    # Enough files to sit past a shrunken scan window several times over.
    FILE_COUNT = 7
    # Small enough that the tests can force a multi-window scan without seeding
    # the two hundred rows a real window would need.
    WINDOW = 2

    def setUp(self):
        super().setUp()
        # A token no other node on the site can match, so the result set is
        # exactly what this test seeded.
        self.token = f"zqx{frappe.generate_hash(10)}"
        self.files = [
            self.make_file(self.folder, f"{self.token}{index}.txt", b"searchable")
            for index in range(self.FILE_COUNT)
        ]

    def search_names(self, query):
        return [row["name"] for row in search(query)]

    def test_owner_sees_every_seeded_row(self):
        with self.set_user(OWNER):
            self.assertCountEqual(self.search_names(self.token), self.files)

    def test_returns_only_readable_rows(self):
        with self.set_user(OWNER):
            update_access(self.files[0], "share", cmd="share", user=OTHER_USER, read=True)

        with self.set_user(OTHER_USER):
            self.assertEqual(self.search_names(self.token), [self.files[0]])

    def test_unshared_user_gets_nothing(self):
        with self.set_user(OTHER_USER):
            self.assertEqual(search(self.token), [])

    def test_reaches_readable_rows_past_the_first_window(self):
        """The regression: filtering one fixed window makes the reply depend on
        how many *unreadable* rows sort first."""
        with self.set_user(OWNER):
            ordered = self.search_names(self.token)
            self.assertEqual(len(ordered), self.FILE_COUNT)
            # Share only the last row in scan order - several windows deep.
            last = ordered[-1]
            update_access(last, "share", cmd="share", user=OTHER_USER, read=True)

        with (
            self.set_user(OTHER_USER),
            patch("suite.drive._core.nodes.MAX_PAGE_SIZE", self.WINDOW),
        ):
            self.assertEqual(self.search_names(self.token), [last])

    def test_scan_stops_at_the_budget(self):
        """The walk is bounded, so a match set larger than the budget comes
        back short rather than running the whole table one window at a time."""
        windows = []
        real_views = node_core.views

        def counted(*args, **kwargs):
            windows.append(kwargs.get("cursor"))
            return real_views(*args, **kwargs)

        with (
            self.set_user(OWNER),
            patch("suite.drive._core.nodes.MAX_PAGE_SIZE", self.WINDOW),
            patch("suite.drive.http.shims.MAX_SEARCH_WINDOWS", 2),
            patch("suite.drive._core.nodes.views", counted),
        ):
            found = self.search_names(self.token)

        self.assertEqual(len(windows), 2)
        self.assertEqual(len(found), self.WINDOW * 2)
        self.assertLess(len(found), self.FILE_COUNT)

    def test_stops_once_the_page_is_full(self):
        with (
            self.set_user(OWNER),
            patch("suite.drive.http.shims.SEARCH_PAGE_LENGTH", 3),
            patch("suite.drive._core.nodes.MAX_PAGE_SIZE", self.WINDOW),
        ):
            self.assertEqual(len(self.search_names(self.token)), 3)

    def test_blank_query_short_circuits(self):
        with self.set_user(OWNER), patch("suite.drive._core.nodes.views") as views:
            for query in ("", "   ", "\t\n"):
                self.assertEqual(search(query), [])
        views.assert_not_called()

    def test_trashed_rows_are_excluded(self):
        with self.set_user(OWNER):
            remove_or_restore([self.files[0]])
            found = self.search_names(self.token)

        self.assertNotIn(self.files[0], found)
        self.assertCountEqual(found, self.files[1:])

    def test_a_search_row_carries_the_columns_the_old_query_selected(self):
        with self.set_user(OWNER):
            row = next(row for row in search(self.token) if row["name"] == self.files[0])

        self.assertEqual(
            set(row),
            {
                "name",
                "file_name",
                "file_type",
                "is_folder",
                "owner",
                "attached_to_doctype",
                "attached_to_name",
                "content_doctype",
                "content_docname",
                "user_name",
                "user_image",
                "full_name",
            },
        )
        self.assertEqual(row["owner"], OWNER)
        self.assertEqual(row["user_name"], OWNER)
        self.assertEqual(row["is_folder"], 0)

    def test_a_folder_is_searchable_and_marked_as_one(self):
        with self.set_user(OWNER):
            folder = create_folder(self.owner, self.folder, f"{self.token}-folder")
            row = next(row for row in search(self.token) if row["name"] == folder)

        self.assertEqual(row["is_folder"], 1)
        self.assertEqual(row["file_type"], "Folder")
