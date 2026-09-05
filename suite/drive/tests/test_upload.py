import hashlib
import io
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from threading import Barrier, Event
from unittest.mock import patch
from uuid import uuid4

import frappe
import frappe.storage
from frappe.storage.blob import put_blob
from frappe.storage.blob import revive_blob as storage_revive_blob
from frappe.storage.gc import is_still_orphan
from frappe.storage.memory_driver import MemoryDriver
from frappe.storage.tests import reset_file_controller
from frappe.storage.upload import delete_session, get_session_paths
from frappe.tests import IntegrationTestCase, UnitTestCase

from suite.drive._core.access import require
from suite.drive._core.errors import (
    DriveConflict,
    DriveForbidden,
    DriveLinkExpired,
    DriveNotFound,
    DriveOverQuota,
)
from suite.drive._core.nodes import create_file, update
from suite.drive._core.principals import Principals
from suite.drive._core.quota import admit
from suite.drive._core.roles import EDIT, MANAGE, READ, UPLOAD
from suite.drive._core.roots import create_root
from suite.drive._core.upload import (
    _authorized_binding,
    _binding_key,
    create_upload,
    finish_upload,
    upload_chunk,
)
from suite.tests.utils import ensure_user

USER = "drive-upload-user@example.com"
OTHER = "drive-upload-other@example.com"
WEBSITE_USER = "drive-upload-website-user@example.com"
LINK = "$LINK:" + "U" * 22


@contextmanager
def storage_v2_on():
    previous = frappe.conf.get("storage_v2")
    frappe.conf["storage_v2"] = 1
    reset_file_controller()
    try:
        yield
    finally:
        if previous is None:
            frappe.conf.pop("storage_v2", None)
        else:
            frappe.conf["storage_v2"] = previous
        reset_file_controller()


class DirectTargetDriver(MemoryDriver):
    def upload_target(self, key, size, *, is_private=False):
        return {"url": "https://bucket.example/upload"}


@contextmanager
def use_driver(driver):
    previous = getattr(frappe.local, "storage_driver_override", None)
    frappe.local.storage_driver_override = driver
    try:
        yield driver
    finally:
        frappe.local.storage_driver_override = previous


class TestUploadBinding(UnitTestCase):
    guest = Principals("Guest", (), (LINK,))

    @patch("suite.drive._core.upload._store_binding")
    @patch("suite.drive._core.upload.create_blob_upload")
    @patch("suite.drive._core.upload.preflight")
    @patch("suite.drive._core.upload.root_for_node")
    @patch("suite.drive._core.upload.require", return_value=LINK)
    @patch("suite.drive._core.upload._validate_parent")
    @patch("suite.drive._core.upload._node")
    def test_create_preflights_then_binds_exact_guest_link_server_side(
        self,
        node,
        _validate_parent,
        require_access,
        root_for,
        preflight_quota,
        create_blob,
        store,
    ):
        parent = frappe._dict(name="folder", kind="folder", state="Active", root="root", path="")
        root = frappe._dict(name="root", kind="Personal", used_bytes=10, quota_bytes=100)
        node.return_value = parent
        root_for.return_value = root
        create_blob.return_value = {"mode": "chunked", "upload_id": "upload123"}

        result = create_upload(self.guest, "folder", "archive.zip", 20)

        self.assertEqual(result["upload_id"], "upload123")
        require_access.assert_called_once_with(parent, UPLOAD, self.guest)
        preflight_quota.assert_called_once_with(root, 20)
        create_blob.assert_called_once_with("archive.zip", 20, is_private=True)
        binding = store.call_args.args[1]
        self.assertEqual(binding["user"], "Guest")
        self.assertEqual(binding["parent"], "folder")
        self.assertEqual(binding["via_link"], LINK)

    @patch("suite.drive._core.upload.create_blob_upload")
    @patch("suite.drive._core.upload.preflight")
    @patch("suite.drive._core.upload.root_for_node", return_value={"used_bytes": 0})
    @patch("suite.drive._core.upload.require", return_value=None)
    @patch("suite.drive._core.upload._validate_parent")
    @patch("suite.drive._core.upload._node", return_value=frappe._dict(name="public"))
    def test_guest_public_identity_does_not_create_an_unclaimable_session(
        self, _node, _parent, _require, _root, _preflight, create_blob
    ):
        with self.assertRaises(DriveForbidden):
            create_upload(Principals("Guest", (), ("$PUBLIC",)), "public", "a.bin", 1)
        create_blob.assert_not_called()

    def test_suite_declares_drive_upload_puts_as_streaming(self):
        from suite import hooks

        self.assertIn("/api/suite/drive/uploads/", hooks.streaming_request_paths)

    @patch("suite.drive._core.upload.frappe.cache")
    def test_guest_identity_alone_cannot_claim_another_link_upload(self, cache):
        cache.return_value.get_value.return_value = frappe.as_json(
            {
                "parent": "folder",
                "user": "Guest",
                "authority": "link",
                "via_link": LINK,
                "filename": "a.bin",
                "declared_size": 1,
            }
        )
        with self.assertRaises(DriveForbidden):
            _authorized_binding(Principals("Guest", (), ("$LINK:" + "V" * 22,)), "upload123")

    @patch("suite.drive._core.upload._store_binding")
    @patch("suite.drive._core.upload.upload_blob_chunk", return_value={"received": 4})
    @patch("suite.drive._core.upload._reauthorize_original_destination")
    @patch("suite.drive._core.upload._authorized_binding")
    def test_every_chunk_reauthorizes_and_refreshes_the_binding(
        self, binding, reauthorize, storage_chunk, store
    ):
        bound = {"parent": "folder", "user": "Guest", "authority": "link", "via_link": LINK}
        binding.return_value = bound

        result = upload_chunk(self.guest, "upload123", 0, b"data")

        self.assertEqual(result, {"received": 4})
        reauthorize.assert_called_once_with(self.guest, bound)
        storage_chunk.assert_called_once_with("upload123", 0, b"data")
        store.assert_called_once_with("upload123", bound)

    @patch("suite.drive._core.upload.frappe.cache")
    def test_replayed_finish_has_no_drive_binding(self, cache):
        cache.return_value.get_value.return_value = None
        with self.assertRaises(DriveNotFound):
            _authorized_binding(self.guest, "finished")

    @patch("suite.drive._core.upload._authorized_binding")
    def test_create_and_replace_finish_arguments_are_mutually_exclusive(self, binding):
        invalid = (
            {},
            {"parent": "folder"},
            {"title": "a.txt"},
            {"replaces": ""},
            {"parent": "folder", "title": "a.txt", "replaces": "node"},
        )
        for kwargs in invalid:
            with self.subTest(kwargs=kwargs), self.assertRaises(frappe.ValidationError):
                finish_upload(self.guest, "upload123", **kwargs)
        binding.assert_not_called()

    @patch("suite.drive._core.access._point_state")
    def test_require_returns_the_deciding_link_but_prefers_sufficient_own_access(self, point_state):
        node = {"name": "folder", "kind": "folder", "root": "root", "path": ""}
        principals = Principals(USER, (USER,), (LINK,))
        rows = [
            frappe._dict(node="root", principal=USER, role=READ, password_hash=None),
            frappe._dict(node="folder", principal=LINK, role=UPLOAD, password_hash=None),
        ]
        point_state.return_value = (UPLOAD, rows, {"root": 0, "folder": 1}, {})
        self.assertEqual(require(node, UPLOAD, principals), LINK)

        rows[0].role = MANAGE
        point_state.return_value = (MANAGE, rows, {"root": 0, "folder": 1}, {})
        self.assertIsNone(require(node, UPLOAD, principals))


class TestDriveFileAccounting(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(USER)
        ensure_user(OTHER)
        ensure_user(WEBSITE_USER)
        frappe.db.set_value("User", WEBSITE_USER, "user_type", "Website User")
        frappe.db.delete("Has Role", {"parent": WEBSITE_USER})

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self._upload_ids = []
        self._nodes_before = set(frappe.get_all("Drive Node", pluck="name"))
        self._roots_before = set(frappe.get_all("Drive Root", pluck="name"))
        self._blobs_before = set(frappe.get_all("File Blob", pluck="name"))
        self.root = create_root(kind="Personal", title="Upload root", user=USER)
        self._root_ids = {self.root.name}
        self.principals = Principals(USER, (USER,), ("$PUBLIC",))

    def tearDown(self):
        frappe.set_user("Administrator")
        for upload_id in self._upload_ids:
            frappe.cache().delete_value(_binding_key(upload_id))
            meta_path, part_path = get_session_paths(upload_id)
            delete_session(meta_path, meta_path + ".finishing", part_path)
        placeholders = ", ".join(["%s"] * len(self._root_ids))
        nodes = {
            row[0]
            for row in frappe.db.sql(
                f"SELECT name FROM `tabDrive Node` WHERE name IN ({placeholders}) "
                f"OR root IN ({placeholders})",
                tuple(self._root_ids) * 2,
            )
        }
        if nodes:
            frappe.db.delete("Drive Node Version", {"node": ["in", tuple(nodes)]})
            frappe.db.delete("Drive Grant", {"node": ["in", tuple(nodes)]})
            frappe.db.delete("Drive Activity", {"node": ["in", tuple(nodes)]})
            frappe.db.delete("Drive Node", {"name": ["in", tuple(nodes)]})
        frappe.db.delete("Drive Root", {"name": ["in", tuple(self._root_ids)]})
        blobs = set(frappe.get_all("File Blob", pluck="name")) - self._blobs_before
        for blob in blobs:
            frappe.delete_doc("File Blob", blob, force=1, ignore_permissions=True, ignore_missing=True)
        frappe.db.commit()
        self.assertFalse(
            frappe.db.sql(
                f"SELECT name FROM `tabDrive Node` WHERE name IN ({placeholders}) "
                f"OR root IN ({placeholders}) LIMIT 1",
                tuple(self._root_ids) * 2,
            )
        )
        self.assertFalse(frappe.db.exists("Drive Root", {"name": ["in", tuple(self._root_ids)]}))
        super().tearDown()

    def _blob(self, content: bytes, filename: str = "file.bin"):
        return put_blob(io.BytesIO(content), is_private=True, filename=filename)

    def _folder(self, title: str = "Folder"):
        return frappe.get_doc(
            {
                "doctype": "Drive Node",
                "title": title,
                "parent": self.root.name,
                "root": self.root.name,
                "path": "",
                "kind": "folder",
                "state": "Active",
                "size": 0,
            }
        ).insert(ignore_permissions=True)

    def _link_grant(self, node: str, *, expires_on=None):
        return frappe.get_doc(
            {
                "doctype": "Drive Grant",
                "node": node,
                "principal": LINK,
                "role": UPLOAD,
                "expires_on": expires_on,
            }
        ).insert(ignore_permissions=True)

    def _open(self, principals: Principals, parent: str, filename: str, size: int):
        opened = create_upload(principals, parent, filename, size)
        self._upload_ids.append(opened["upload_id"])
        return opened

    def test_replace_keeps_one_nonempty_head_and_charges_each_reference_once(self):
        with frappe.storage.fake():
            old = self._blob(b"old-head")
            node = create_file(
                self.principals,
                self.root.name,
                "file.bin",
                blob=old.name,
                size=old.file_size,
                mime=old.mime_type,
            )
            new = self._blob(b"new-head-content")
            update(
                self.principals,
                node,
                blob=new.name,
                size=new.file_size,
                mime=new.mime_type,
                content_modified=1_700_000_000_000,
            )

        version = frappe.get_all(
            "Drive Node Version", filters={"node": node}, fields=["seq", "kind", "blob", "size"]
        )
        self.assertEqual(
            [(row.seq, row.kind, row.blob, row.size) for row in version],
            [(1, "auto", old.name, old.file_size)],
        )
        self.assertEqual(
            frappe.db.get_value("Drive Root", self.root.name, "used_bytes"),
            old.file_size + new.file_size,
        )
        self.assertEqual(frappe.db.get_value("Drive Node", node, "blob"), new.name)

    def test_same_blob_replacement_still_pays_twice_logically(self):
        with frappe.storage.fake():
            blob = self._blob(b"same bytes")
            node = create_file(
                self.principals,
                self.root.name,
                "same.bin",
                blob=blob.name,
                size=blob.file_size,
                mime=blob.mime_type,
            )
            update(
                self.principals,
                node,
                blob=blob.name,
                size=blob.file_size,
                mime=blob.mime_type,
            )
        self.assertEqual(
            frappe.db.get_value("Drive Root", self.root.name, "used_bytes"),
            2 * blob.file_size,
        )
        self.assertEqual(frappe.db.count("Drive Node Version", {"node": node}), 1)

    def test_zero_byte_head_creates_no_version(self):
        with frappe.storage.fake():
            empty = self._blob(b"", "empty.bin")
            node = create_file(
                self.principals,
                self.root.name,
                "empty.bin",
                blob=empty.name,
                size=0,
                mime=empty.mime_type,
            )
            new = self._blob(b"nonempty")
            update(
                self.principals,
                node,
                blob=new.name,
                size=new.file_size,
                mime=new.mime_type,
            )
        self.assertEqual(frappe.db.count("Drive Node Version", {"node": node}), 0)
        self.assertEqual(frappe.db.get_value("Drive Root", self.root.name, "used_bytes"), new.file_size)

    def test_quota_refusal_rolls_back_version_node_counter_and_activity(self):
        with frappe.storage.fake():
            old = self._blob(b"123")
            node = create_file(
                self.principals,
                self.root.name,
                "limited.bin",
                blob=old.name,
                size=old.file_size,
                mime=old.mime_type,
            )
            frappe.db.set_value("Drive Root", self.root.name, "quota_bytes", 5)
            new = self._blob(b"456")
            activity_before = frappe.db.count("Drive Activity", {"node": node})
            with self.assertRaises(DriveOverQuota):
                update(
                    self.principals,
                    node,
                    blob=new.name,
                    size=new.file_size,
                    mime=new.mime_type,
                )

        self.assertEqual(frappe.db.count("Drive Node Version", {"node": node}), 0)
        self.assertEqual(frappe.db.get_value("Drive Node", node, "blob"), old.name)
        self.assertEqual(frappe.db.get_value("Drive Root", self.root.name, "used_bytes"), old.file_size)
        self.assertEqual(frappe.db.count("Drive Activity", {"node": node}), activity_before)

    def test_guest_link_create_has_no_creator_grant_and_records_link_actor(self):
        folder = self._folder("Drop box")
        self._link_grant(folder.name)
        guest = Principals("Guest", (), (LINK,))

        with frappe.storage.fake():
            blob = self._blob(b"guest bytes")
            node = create_file(
                guest,
                folder.name,
                "guest.bin",
                blob=blob.name,
                size=blob.file_size,
                mime=blob.mime_type,
            )

        self.assertFalse(frappe.db.exists("Drive Grant", {"node": node, "principal": "Guest"}))
        activity = frappe.db.get_value(
            "Drive Activity", {"node": node, "action": "create"}, ["actor", "via_link"], as_dict=True
        )
        self.assertEqual((activity.actor, activity.via_link), ("Guest", LINK))
        self.assertEqual(frappe.db.get_value("Drive Node", node, "owner"), "Guest")

    def test_declared_quota_preflight_creates_no_storage_session(self):
        frappe.set_user(USER)
        frappe.db.set_value("Drive Root", self.root.name, "quota_bytes", 5)
        with patch("suite.drive._core.upload.create_blob_upload") as storage_create:
            with self.assertRaises(DriveOverQuota):
                create_upload(self.principals, self.root.name, "too-large.bin", 6)
        storage_create.assert_not_called()

    def test_empty_upload_keeps_its_binding_and_can_be_retried(self):
        frappe.set_user(USER)
        content = b"eventual bytes"
        with storage_v2_on(), frappe.storage.fake():
            opened = self._open(self.principals, self.root.name, "retry.bin", len(content))
            with self.assertRaises(frappe.ValidationError):
                finish_upload(
                    self.principals,
                    opened["upload_id"],
                    parent=self.root.name,
                    title="retry.bin",
                )
            self.assertTrue(frappe.cache().get_value(_binding_key(opened["upload_id"])))

            upload_chunk(self.principals, opened["upload_id"], 0, content)
            node = finish_upload(
                self.principals,
                opened["upload_id"],
                parent=self.root.name,
                title="retry.bin",
            )

        self.assertTrue(frappe.db.exists("Drive Node", node))
        self.assertFalse(frappe.cache().get_value(_binding_key(opened["upload_id"])))

    def test_revoked_and_expired_bound_links_refuse_chunk_and_finish(self):
        folder = self._folder("Guest destination")
        grant = self._link_grant(folder.name)
        guest = Principals("Guest", (), (LINK,))
        frappe.set_user("Guest")
        with storage_v2_on(), frappe.storage.fake():
            revoked = self._open(guest, folder.name, "revoked.bin", 4)
            frappe.set_user("Administrator")
            frappe.delete_doc("Drive Grant", grant.name, force=True, ignore_permissions=True)
            frappe.set_user("Guest")
            with self.assertRaises(DriveNotFound):
                upload_chunk(guest, revoked["upload_id"], 0, b"data")
            with self.assertRaises(DriveNotFound):
                finish_upload(
                    guest,
                    revoked["upload_id"],
                    parent=folder.name,
                    title="revoked.bin",
                )

            frappe.set_user("Administrator")
            grant = self._link_grant(folder.name)
            frappe.set_user("Guest")
            expired = self._open(guest, folder.name, "expired.bin", 4)
            frappe.set_user("Administrator")
            frappe.db.set_value("Drive Grant", grant.name, "expires_on", "2000-01-01 00:00:00")
            frappe.set_user("Guest")
            with self.assertRaises(DriveLinkExpired):
                upload_chunk(guest, expired["upload_id"], 0, b"data")
            with self.assertRaises(DriveLinkExpired):
                finish_upload(
                    guest,
                    expired["upload_id"],
                    parent=folder.name,
                    title="expired.bin",
                )

    def test_cross_parent_create_and_replace_are_refused_before_finalization(self):
        frappe.set_user(USER)
        first = self._folder("Bound parent")
        second = self._folder("Forged parent")
        with storage_v2_on(), frappe.storage.fake():
            opened = self._open(self.principals, first.name, "forged.bin", 4)
            upload_chunk(self.principals, opened["upload_id"], 0, b"data")
            with patch("suite.drive._core.upload.finish_upload_to_blob") as finalizer:
                with self.assertRaises(DriveForbidden):
                    finish_upload(
                        self.principals,
                        opened["upload_id"],
                        parent=second.name,
                        title="forged.bin",
                    )
            finalizer.assert_not_called()

            existing_blob = self._blob(b"existing")
            existing = create_file(
                self.principals,
                second.name,
                "existing.bin",
                blob=existing_blob.name,
                size=existing_blob.file_size,
                mime=existing_blob.mime_type,
            )
            with patch("suite.drive._core.upload.finish_upload_to_blob") as finalizer:
                with self.assertRaises(DriveForbidden):
                    finish_upload(
                        self.principals,
                        opened["upload_id"],
                        replaces=existing,
                    )
            finalizer.assert_not_called()

    def test_create_failure_rolls_back_counter_node_creator_grant_and_activity(self):
        folder = self._folder("Contributor folder")
        frappe.get_doc(
            {"doctype": "Drive Grant", "node": folder.name, "principal": OTHER, "role": UPLOAD}
        ).insert(ignore_permissions=True)
        contributor = Principals(OTHER, (OTHER,), ("$PUBLIC",))
        before = {
            "nodes": frappe.db.count("Drive Node"),
            "grants": frappe.db.count("Drive Grant"),
            "activity": frappe.db.count("Drive Activity"),
            "used": frappe.db.get_value("Drive Root", self.root.name, "used_bytes"),
        }
        with frappe.storage.fake():
            blob = self._blob(b"rollback bytes")
            with patch("suite.drive._core.nodes._record_activity", side_effect=RuntimeError("boom")):
                with self.assertRaisesRegex(RuntimeError, "boom"):
                    create_file(
                        contributor,
                        folder.name,
                        "rollback.bin",
                        blob=blob.name,
                        size=blob.file_size,
                        mime=blob.mime_type,
                    )

        self.assertEqual(frappe.db.count("Drive Node"), before["nodes"])
        self.assertEqual(frappe.db.count("Drive Grant"), before["grants"])
        self.assertEqual(frappe.db.count("Drive Activity"), before["activity"])
        self.assertEqual(frappe.db.get_value("Drive Root", self.root.name, "used_bytes"), before["used"])

    def test_corrupt_parent_root_and_path_are_refused_without_charging(self):
        other_root = create_root(kind="Personal", title="Other root", user=OTHER)
        self._root_ids.add(other_root.name)
        bad_root = self._folder("Bad root")
        bad_path = self._folder("Bad path")
        frappe.db.set_value("Drive Node", bad_root.name, "root", other_root.name)
        frappe.db.set_value("Drive Node", bad_path.name, "path", "/not-canonical/")
        admin = Principals("Administrator", ("Administrator",), ("$PUBLIC",), is_admin=True)
        with frappe.storage.fake():
            blob = self._blob(b"position")
            for parent in (bad_root.name, bad_path.name):
                with self.subTest(parent=parent), self.assertRaises(DriveConflict):
                    create_file(
                        admin,
                        parent,
                        f"{parent}.bin",
                        blob=blob.name,
                        size=blob.file_size,
                        mime=blob.mime_type,
                    )
        self.assertEqual(frappe.db.get_value("Drive Root", self.root.name, "used_bytes"), 0)
        self.assertEqual(frappe.db.get_value("Drive Root", other_root.name, "used_bytes"), 0)

    def test_file_parent_and_malformed_root_pair_are_refused(self):
        with frappe.storage.fake():
            blob = self._blob(b"parent-shape")
            file_parent = create_file(
                self.principals,
                self.root.name,
                "not-a-folder.bin",
                blob=blob.name,
                size=blob.file_size,
                mime=blob.mime_type,
            )
            with self.assertRaises(DriveConflict):
                create_file(
                    self.principals,
                    file_parent,
                    "child.bin",
                    blob=blob.name,
                    size=blob.file_size,
                    mime=blob.mime_type,
                )

            frappe.db.set_value("Drive Node", self.root.name, "mime", "application/broken")
            with self.assertRaises(DriveNotFound):
                create_file(
                    self.principals,
                    self.root.name,
                    "root-shape.bin",
                    blob=blob.name,
                    size=blob.file_size,
                    mime=blob.mime_type,
                )

    def test_replace_refuses_a_stored_file_parent_even_with_matching_path_and_root(self):
        with frappe.storage.fake():
            old = self._blob(b"old")
            target = create_file(
                self.principals,
                self.root.name,
                "corrupt-target.bin",
                blob=old.name,
                size=old.file_size,
                mime=old.mime_type,
            )
            parent_blob = self._blob(b"parent")
            file_parent = create_file(
                self.principals,
                self.root.name,
                "file-parent.bin",
                blob=parent_blob.name,
                size=parent_blob.file_size,
                mime=parent_blob.mime_type,
            )
            replacement = self._blob(b"replacement")

            frappe.db.set_value(
                "Drive Node",
                target,
                {"parent": file_parent, "path": f"/{file_parent}/"},
            )
            with self.assertRaises(DriveConflict):
                update(
                    self.principals,
                    target,
                    blob=replacement.name,
                    size=replacement.file_size,
                    mime=replacement.mime_type,
                )

    def test_version_identity_and_bytes_are_immutable_but_label_and_pin_are_editable(self):
        with frappe.storage.fake():
            old = self._blob(b"immutable-old")
            replacement = self._blob(b"immutable-new")
            node = create_file(
                self.principals,
                self.root.name,
                "immutable.bin",
                blob=old.name,
                size=old.file_size,
                mime=old.mime_type,
            )
            update(
                self.principals,
                node,
                blob=replacement.name,
                size=replacement.file_size,
                mime=replacement.mime_type,
            )

        version = frappe.get_last_doc("Drive Node Version", filters={"node": node})
        version.label = "Keep"
        version.pinned = 1
        version.save(ignore_permissions=True)
        version.size += 1
        with self.assertRaises(frappe.ValidationError):
            version.save(ignore_permissions=True)

    def test_content_time_accepts_epoch_milliseconds_and_defaults_to_now(self):
        fixed = datetime(2026, 9, 6, 12, 34, 56)
        with frappe.storage.fake(), patch("suite.drive._core.nodes.now_datetime", return_value=fixed):
            first_blob = self._blob(b"first")
            first = create_file(
                self.principals,
                self.root.name,
                "default-time.bin",
                blob=first_blob.name,
                size=first_blob.file_size,
                mime=first_blob.mime_type,
            )
            second_blob = self._blob(b"second")
            second = create_file(
                self.principals,
                self.root.name,
                "epoch-time.bin",
                blob=second_blob.name,
                size=second_blob.file_size,
                mime=second_blob.mime_type,
                content_modified=1_700_000_000_000,
            )

        expected = frappe.utils.convert_utc_to_system_timezone(
            datetime.fromtimestamp(1_700_000_000, tz=UTC)
        ).replace(tzinfo=None)
        self.assertEqual(
            frappe.utils.get_datetime(frappe.db.get_value("Drive Node", first, "content_modified")),
            fixed,
        )
        self.assertEqual(
            frappe.utils.get_datetime(frappe.db.get_value("Drive Node", second, "content_modified")),
            expected,
        )

    def test_signed_in_creator_gets_edit_but_link_authority_gets_no_grant(self):
        own_folder = self._folder("Own upload")
        link_folder = self._folder("Link upload")
        frappe.get_doc(
            {"doctype": "Drive Grant", "node": own_folder.name, "principal": OTHER, "role": UPLOAD}
        ).insert(ignore_permissions=True)
        self._link_grant(link_folder.name)
        own = Principals(OTHER, (OTHER,), ("$PUBLIC",))
        linked = Principals(OTHER, (OTHER,), ("$PUBLIC", LINK))

        with frappe.storage.fake():
            own_blob = self._blob(b"own")
            own_node = create_file(
                own,
                own_folder.name,
                "own.bin",
                blob=own_blob.name,
                size=own_blob.file_size,
                mime=own_blob.mime_type,
            )
            link_blob = self._blob(b"linked")
            link_node = create_file(
                linked,
                link_folder.name,
                "linked.bin",
                blob=link_blob.name,
                size=link_blob.file_size,
                mime=link_blob.mime_type,
            )

        self.assertEqual(
            frappe.db.get_value("Drive Grant", {"node": own_node, "principal": OTHER}, "role"),
            40,
        )
        self.assertFalse(frappe.db.exists("Drive Grant", {"node": link_node, "principal": OTHER}))
        self.assertEqual(frappe.db.get_value("Drive Activity", {"node": link_node}, "via_link"), LINK)

    def test_bound_link_keeps_creator_and_activity_semantics_if_own_access_changes(self):
        folder = self._folder("Bound link semantics")
        self._link_grant(folder.name)
        linked = Principals(OTHER, (OTHER,), ("$PUBLIC", LINK))
        frappe.set_user(OTHER)
        content = b"link-bound"
        with storage_v2_on(), frappe.storage.fake():
            opened = self._open(linked, folder.name, "bound.bin", len(content))
            upload_chunk(linked, opened["upload_id"], 0, content)
            frappe.set_user("Administrator")
            frappe.get_doc(
                {
                    "doctype": "Drive Grant",
                    "node": folder.name,
                    "principal": OTHER,
                    "role": 40,
                }
            ).insert(ignore_permissions=True)
            frappe.set_user(OTHER)
            node = finish_upload(linked, opened["upload_id"], parent=folder.name, title="bound.bin")

        self.assertFalse(frappe.db.exists("Drive Grant", {"node": node, "principal": OTHER}))
        self.assertEqual(frappe.db.get_value("Drive Activity", {"node": node}, "via_link"), LINK)

    def test_link_bound_upload_uses_fresh_ordinary_edit_authority_for_replace(self):
        folder = self._folder("Link replacement")
        self._link_grant(folder.name)
        with frappe.storage.fake():
            old = self._blob(b"old replace")
            target = create_file(
                self.principals,
                folder.name,
                "target.bin",
                blob=old.name,
                size=old.file_size,
                mime=old.mime_type,
            )
        frappe.get_doc({"doctype": "Drive Grant", "node": target, "principal": OTHER, "role": EDIT}).insert(
            ignore_permissions=True
        )
        linked = Principals(OTHER, (OTHER,), ("$PUBLIC", LINK))
        guest = Principals("Guest", (), (LINK,))
        replacement = b"replacement"

        frappe.set_user(OTHER)
        with storage_v2_on(), frappe.storage.fake():
            opened = self._open(linked, folder.name, "replacement.bin", len(replacement))
            upload_chunk(linked, opened["upload_id"], 0, replacement)
            finish_upload(linked, opened["upload_id"], replaces=target)

            frappe.set_user("Guest")
            guest_opened = self._open(guest, folder.name, "guest-replacement.bin", 1)
            with patch("suite.drive._core.upload.finish_upload_to_blob") as finalizer:
                with self.assertRaises(DriveForbidden):
                    finish_upload(guest, guest_opened["upload_id"], replaces=target)
            finalizer.assert_not_called()

        activity = frappe.db.get_value(
            "Drive Activity",
            {"node": target, "action": "edit"},
            ["actor", "via_link"],
            as_dict=True,
        )
        self.assertEqual((activity.actor, activity.via_link), (OTHER, LINK))

    def test_direct_finish_cleans_temp_and_late_quota_refusal_leaves_no_reference(self):
        frappe.set_user(USER)
        content = b"direct content"
        driver = DirectTargetDriver()
        with storage_v2_on(), use_driver(driver):
            opened = self._open(self.principals, self.root.name, "direct.bin", len(content))
            self.assertEqual(opened["mode"], "direct")
            driver.write(f"uploads/{opened['upload_id']}", io.BytesIO(content), is_private=True)
            frappe.db.set_value(
                "Drive Root",
                self.root.name,
                {"quota_bytes": len(content), "used_bytes": 1},
            )
            with self.assertRaises(DriveOverQuota):
                finish_upload(
                    self.principals,
                    opened["upload_id"],
                    parent=self.root.name,
                    title="direct.bin",
                )
            self.assertFalse(driver.exists(f"uploads/{opened['upload_id']}", is_private=True))

        self.assertFalse(frappe.db.exists("Drive Node", {"title": "direct.bin", "root": self.root.name}))
        self.assertFalse(frappe.cache().get_value(_binding_key(opened["upload_id"])))
        unreferenced = set(frappe.get_all("File Blob", pluck="name")) - self._blobs_before
        self.assertTrue(unreferenced)
        for blob in unreferenced:
            self.assertFalse(frappe.db.exists("Drive Node", {"blob": blob}))
            self.assertFalse(frappe.db.exists("File", {"blob": blob}))

    def test_direct_finish_success_deletes_the_temporary_object(self):
        frappe.set_user(USER)
        content = b"direct success"
        driver = DirectTargetDriver()
        with storage_v2_on(), use_driver(driver):
            opened = self._open(self.principals, self.root.name, "direct-ok.bin", len(content))
            driver.write(f"uploads/{opened['upload_id']}", io.BytesIO(content), is_private=True)
            node = finish_upload(
                self.principals,
                opened["upload_id"],
                parent=self.root.name,
                title="direct-ok.bin",
            )
            self.assertFalse(driver.exists(f"uploads/{opened['upload_id']}", is_private=True))
        self.assertTrue(frappe.db.exists("Drive Node", node))

    def test_gc_recheck_cannot_delete_a_blob_while_create_file_adopts_it(self):
        marker = uuid4().hex
        with frappe.storage.fake():
            blob = self._blob(f"adopt-{marker}".encode())
        frappe.db.set_value(
            "File Blob",
            blob.name,
            "modified",
            frappe.utils.add_to_date(frappe.utils.now_datetime(), hours=-25),
            update_modified=False,
        )
        frappe.db.commit()
        site = frappe.local.site
        blob_locked = Event()
        gc_started = Event()

        def paused_revive(blob_name):
            revived = storage_revive_blob(blob_name)
            blob_locked.set()
            self.assertTrue(gc_started.wait(timeout=10))
            return revived

        def adopt():
            frappe.init(site, force=True)
            frappe.connect()
            frappe.set_user(USER)
            try:
                created = create_file(
                    self.principals,
                    self.root.name,
                    f"adopt-{marker}.bin",
                    blob=blob.name,
                    size=blob.file_size,
                    mime=blob.mime_type,
                )
                frappe.db.commit()
                return created
            finally:
                frappe.destroy()

        def gc_recheck():
            frappe.init(site, force=True)
            frappe.connect()
            try:
                self.assertTrue(blob_locked.wait(timeout=10))
                gc_started.set()
                cutoff = frappe.utils.now_datetime() - timedelta(hours=24)
                orphan = is_still_orphan(blob.name, cutoff)
                frappe.db.rollback()
                return orphan
            finally:
                frappe.destroy()

        with patch("suite.drive._core.nodes.revive_blob", side_effect=paused_revive):
            with ThreadPoolExecutor(max_workers=2) as pool:
                adopted = pool.submit(adopt)
                checked = pool.submit(gc_recheck)
                node = adopted.result(timeout=30)
                self.assertFalse(checked.result(timeout=30))

        frappe.db.rollback()
        self.assertEqual(frappe.db.get_value("Drive Node", node, "blob"), blob.name)

    def test_website_zip_roundtrip_uses_blob_only_session_and_creates_no_file(self):
        frappe.get_doc(
            {
                "doctype": "Drive Grant",
                "node": self.root.name,
                "principal": WEBSITE_USER,
                "role": UPLOAD,
            }
        ).insert(ignore_permissions=True)
        principals = Principals(WEBSITE_USER, (WEBSITE_USER,), ("$PUBLIC",))
        frappe.set_user(WEBSITE_USER)
        self.assertEqual(frappe.db.get_value("User", WEBSITE_USER, "user_type"), "Website User")
        self.assertFalse(frappe.get_doc("User", WEBSITE_USER).has_desk_access())
        content = b"PK\x03\x04website zip " + frappe.generate_hash(length=12).encode()
        hook_calls = []
        original_get_hooks = frappe.get_hooks

        def get_hooks(hook=None, *args, **kwargs):
            if hook == "after_file_upload":
                return [lambda *, doc: hook_calls.append(doc)]
            return original_get_hooks(hook, *args, **kwargs)

        with storage_v2_on(), frappe.storage.fake(), patch.object(frappe, "get_hooks", side_effect=get_hooks):
            opened = self._open(principals, self.root.name, "website.zip", len(content) + 10)
            self.assertEqual(opened["mode"], "chunked")
            upload_chunk(principals, opened["upload_id"], 0, content)
            node = finish_upload(
                principals,
                opened["upload_id"],
                parent=self.root.name,
                title="website.zip",
                checksum=hashlib.sha256(content).hexdigest(),
            )

        blob = frappe.db.get_value("Drive Node", node, "blob")
        self.assertFalse(frappe.db.exists("File", {"blob": blob}))
        self.assertEqual(hook_calls, [])
        self.assertEqual(frappe.db.get_value("Drive Root", self.root.name, "used_bytes"), len(content))

        with self.assertRaises(DriveNotFound):
            finish_upload(
                principals,
                opened["upload_id"],
                parent=self.root.name,
                title="website-copy.zip",
            )

    def test_atomic_admission_allows_only_one_near_quota_writer(self):
        frappe.db.set_value("Drive Root", self.root.name, {"quota_bytes": 10, "used_bytes": 0})
        frappe.db.commit()
        site = frappe.local.site
        barrier = Barrier(2)

        def attempt():
            frappe.init(site, force=True)
            frappe.connect()
            try:
                barrier.wait(timeout=10)
                try:
                    admit(self.root.name, 6)
                    frappe.db.commit()
                    return "admitted"
                except DriveOverQuota:
                    frappe.db.rollback()
                    return "refused"
            finally:
                frappe.destroy()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = [future.result(timeout=30) for future in (pool.submit(attempt), pool.submit(attempt))]

        frappe.db.rollback()
        self.assertEqual(sorted(results), ["admitted", "refused"])
        self.assertEqual(frappe.db.get_value("Drive Root", self.root.name, "used_bytes"), 6)

    def test_two_near_quota_finishes_commit_one_node_without_loser_drift(self):
        frappe.set_user(USER)
        frappe.db.set_value("Drive Root", self.root.name, {"quota_bytes": 10, "used_bytes": 0})
        marker = uuid4().hex
        contents = (b"first1", b"second")
        driver = MemoryDriver()
        sessions = []
        with storage_v2_on(), use_driver(driver):
            for index, content in enumerate(contents):
                opened = self._open(
                    self.principals,
                    self.root.name,
                    f"quota-{marker}-{index}.bin",
                    len(content),
                )
                upload_chunk(self.principals, opened["upload_id"], 0, content)
                sessions.append(opened)
        frappe.db.commit()
        site = frappe.local.site
        barrier = Barrier(2)

        def finish(index: int):
            frappe.init(site, force=True)
            frappe.connect()
            frappe.conf["storage_v2"] = 1
            frappe.local.storage_driver_override = driver
            frappe.set_user(USER)
            try:
                barrier.wait(timeout=10)
                try:
                    node = finish_upload(
                        self.principals,
                        sessions[index]["upload_id"],
                        parent=self.root.name,
                        title=f"quota-{marker}-{index}.bin",
                    )
                    frappe.db.commit()
                    return ("created", node)
                except DriveOverQuota:
                    frappe.db.rollback()
                    return ("refused", None)
            finally:
                frappe.destroy()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = [
                future.result(timeout=30) for future in (pool.submit(finish, 0), pool.submit(finish, 1))
            ]

        frappe.db.rollback()
        self.assertEqual(sorted(status for status, _node in results), ["created", "refused"])
        nodes = frappe.get_all(
            "Drive Node",
            filters={"root": self.root.name, "title": ["like", f"quota-{marker}-%"]},
            pluck="name",
        )
        self.assertEqual(len(nodes), 1)
        self.assertEqual(frappe.db.get_value("Drive Root", self.root.name, "used_bytes"), 6)
        self.assertEqual(frappe.db.count("Drive Activity", {"node": nodes[0], "action": "create"}), 1)
        self.assertEqual(
            frappe.db.count("File", {"blob": frappe.db.get_value("Drive Node", nodes[0], "blob")}),
            0,
        )

    def test_concurrent_replace_preserves_the_intermediate_head_with_unique_sequences(self):
        marker = uuid4().hex
        with frappe.storage.fake():
            old = self._blob(f"old-{marker}".encode())
            first = self._blob(f"first-new-{marker}".encode())
            second = self._blob(f"second-new-value-{marker}".encode())
            node = create_file(
                self.principals,
                self.root.name,
                f"race-{marker}.bin",
                blob=old.name,
                size=old.file_size,
                mime=old.mime_type,
            )
        frappe.db.commit()
        site = frappe.local.site
        barrier = Barrier(2)

        def replace(blob_name: str, size: int, mime: str):
            frappe.init(site, force=True)
            frappe.connect()
            frappe.set_user(USER)
            try:
                barrier.wait(timeout=10)
                update(
                    self.principals,
                    node,
                    blob=blob_name,
                    size=size,
                    mime=mime,
                )
                frappe.db.commit()
                return blob_name
            finally:
                frappe.destroy()

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = (
                pool.submit(replace, first.name, first.file_size, first.mime_type),
                pool.submit(replace, second.name, second.file_size, second.mime_type),
            )
            self.assertEqual({future.result(timeout=30) for future in futures}, {first.name, second.name})

        frappe.db.rollback()
        head = frappe.db.get_value("Drive Node", node, "blob")
        versions = frappe.get_all(
            "Drive Node Version",
            filters={"node": node},
            fields=["seq", "blob"],
            order_by="seq",
        )
        self.assertEqual([row.seq for row in versions], [1, 2])
        self.assertEqual(
            {row.blob for row in versions},
            {old.name, ({first.name, second.name} - {head}).pop()},
        )
        self.assertEqual(
            frappe.db.get_value("Drive Root", self.root.name, "used_bytes"),
            old.file_size + first.file_size + second.file_size,
        )

    def test_concurrent_finish_has_one_node_and_one_activity(self):
        frappe.set_user(USER)
        marker = uuid4().hex
        content = f"finish-race-{marker}".encode()
        driver = MemoryDriver()
        with storage_v2_on(), use_driver(driver):
            opened = self._open(
                self.principals,
                self.root.name,
                f"finish-{marker}.bin",
                len(content),
            )
            upload_chunk(self.principals, opened["upload_id"], 0, content)
        frappe.db.commit()
        site = frappe.local.site
        barrier = Barrier(2)

        def compete():
            frappe.init(site, force=True)
            frappe.connect()
            frappe.conf["storage_v2"] = 1
            frappe.local.storage_driver_override = driver
            frappe.set_user(USER)
            try:
                barrier.wait(timeout=10)
                try:
                    created = finish_upload(
                        self.principals,
                        opened["upload_id"],
                        parent=self.root.name,
                        title=f"finish-{marker}.bin",
                    )
                    frappe.db.commit()
                    return ("created", created)
                except (DriveNotFound, frappe.ValidationError):
                    frappe.db.rollback()
                    return ("refused", None)
            finally:
                frappe.destroy()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = [future.result(timeout=30) for future in (pool.submit(compete), pool.submit(compete))]

        frappe.db.rollback()
        self.assertEqual(sorted(status for status, _node in results), ["created", "refused"])
        nodes = frappe.get_all(
            "Drive Node",
            filters={"root": self.root.name, "title": f"finish-{marker}.bin"},
            pluck="name",
        )
        self.assertEqual(len(nodes), 1)
        self.assertEqual(frappe.db.count("Drive Activity", {"node": nodes[0], "action": "create"}), 1)
        self.assertEqual(frappe.db.get_value("Drive Root", self.root.name, "used_bytes"), len(content))
