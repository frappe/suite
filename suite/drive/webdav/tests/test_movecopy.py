import unittest

import frappe
from frappe.tests import IntegrationTestCase

from suite.drive.utils import STATUS_TRASHED, create_drive_file, get_root_folder, get_user_folder
from suite.drive.utils.files import FileManager
from suite.drive.webdav import copy as copy_module
from suite.drive.webdav import pathmap, structure
from suite.drive.webdav.errors import (
    BadGateway,
    Conflict,
    Forbidden,
    InsufficientStorage,
    NotFoundError,
    PreconditionFailed,
)
from suite.drive.webdav.tests.utils import (
    ensure_user_with_password,
    make_ctx,
)
from suite.drive.webdav.tests.utils import (
    legacy_file_fixture as write_file_fixture,
)
from suite.tests.utils import ensure_user

OWNER = "webdav-movecopy-owner@example.com"
READER = "webdav-movecopy-reader@example.com"
PASSWORD = "webdav-movecopy-pw"


def blob_bytes(entity_name: str) -> bytes:
    manager = FileManager()
    file_url = frappe.db.get_value("File", entity_name, "file_url")
    return manager.get_local_path(file_url).read_bytes()


PARKED_FOR_25 = "MOVE and COPY are not relinked by ticket 24. `suite/drive/webdav/structure.py` and `copy.py` still move and clone legacy `File` rows, and `copy.py` is the last caller of `webdav/perms.py`, so both verbs are absent from `RELINKED_METHODS` and `dispatch._HANDLERS` and answer 405. Un-skip in ticket 25, once MOVE goes through `_core.nodes.update(parent=...)` and COPY through the §8.9 copy primitive, and after these cases are rewritten onto node fixtures: there is one mount now, so the cross-root and `Everyone` cases describe a namespace that no longer exists."


@unittest.skip(PARKED_FOR_25)
class TestWebDAVMoveCopy(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user_with_password(OWNER, PASSWORD)
        ensure_user(READER)
        ensure_user_with_password(READER, PASSWORD)
        with cls.set_user(OWNER):
            cls.home = get_user_folder(OWNER).name

    def setUp(self):
        frappe.set_user(OWNER)
        manager = FileManager()
        with self.set_user(OWNER):
            self.base_name = f"MC-{frappe.generate_hash(length=6)}"
            self.base = create_drive_file(
                self.base_name, self.home, "Folder", lambda f: manager.create_folder(f)
            )
            self.sub = create_drive_file("sub", self.base.name, "Folder", lambda f: manager.create_folder(f))
            self.file = write_file_fixture(self.base.name, "b.txt", b"move me")

    def tearDown(self):
        frappe.set_user("Administrator")
        super().tearDown()

    def _move(self, path: str, destination: str, user: str = OWNER, overwrite: bool | None = None):
        headers = {"Destination": destination}
        if overwrite is not None:
            headers["Overwrite"] = "T" if overwrite else "F"
        return structure.handle_move(make_ctx("MOVE", path, user, headers=headers))

    def _copy(self, path: str, destination: str, user: str = OWNER, **headers):
        return copy_module.handle(
            make_ctx("COPY", path, user, headers={"Destination": destination, **headers})
        )

    def _resolve(self, path: str, user: str = OWNER):
        pathmap.reset_memo()
        return pathmap.resolve([segment for segment in path.split("/") if segment], user)

    def test_move_and_copy_into_everyone_root_are_forbidden(self):
        # the shared root is read-only for non-admins, exactly as in Drive
        with self.assertRaises(Forbidden):
            self._move(f"/dav/Home/{self.base_name}/b.txt", "/dav/Everyone/b.txt")
        with self.assertRaises(Forbidden):
            self._copy(f"/dav/Home/{self.base_name}/b.txt", "/dav/Everyone/b.txt")

    def test_move_renames_in_place(self):
        response = self._move(f"/dav/Home/{self.base_name}/b.txt", f"/dav/Home/{self.base_name}/renamed.txt")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(frappe.db.get_value("File", self.file.name, "file_name"), "renamed.txt")
        self.assertFalse(self._resolve(f"Home/{self.base_name}/b.txt").exists)
        self.assertEqual(blob_bytes(self.file.name), b"move me")

    def test_move_reparents(self):
        response = self._move(f"/dav/Home/{self.base_name}/b.txt", f"/dav/Home/{self.base_name}/sub/b.txt")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(frappe.db.get_value("File", self.file.name, "folder"), self.sub.name)
        self.assertEqual(blob_bytes(self.file.name), b"move me")

    def test_move_reparent_and_rename(self):
        self._move(f"/dav/Home/{self.base_name}/b.txt", f"/dav/Home/{self.base_name}/sub/c.txt")
        self.assertEqual(frappe.db.get_value("File", self.file.name, "folder"), self.sub.name)
        self.assertEqual(frappe.db.get_value("File", self.file.name, "file_name"), "c.txt")

    def test_move_case_only_rename(self):
        response = self._move(f"/dav/Home/{self.base_name}/b.txt", f"/dav/Home/{self.base_name}/B.TXT")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(frappe.db.get_value("File", self.file.name, "file_name"), "B.TXT")

    def test_move_to_self_is_403(self):
        with self.assertRaises(Forbidden):
            self._move(f"/dav/Home/{self.base_name}/b.txt", f"/dav/Home/{self.base_name}/b.txt")

    def test_move_overwrite_semantics(self):
        with self.set_user(OWNER):
            target = write_file_fixture(self.base.name, "existing.txt", b"old")

        with self.assertRaises(PreconditionFailed):
            self._move(
                f"/dav/Home/{self.base_name}/b.txt",
                f"/dav/Home/{self.base_name}/existing.txt",
                overwrite=False,
            )

        response = self._move(
            f"/dav/Home/{self.base_name}/b.txt",
            f"/dav/Home/{self.base_name}/existing.txt",
            overwrite=True,
        )
        self.assertEqual(response.status_code, 204)
        self.assertEqual(frappe.db.get_value("File", target.name, "status"), STATUS_TRASHED)
        # the mover took the exact name — no "(1)" auto-rename
        self.assertEqual(frappe.db.get_value("File", self.file.name, "file_name"), "existing.txt")
        self.assertEqual(blob_bytes(self.file.name), b"move me")

    def test_move_into_own_subtree_is_409(self):
        with self.assertRaises(Conflict):
            self._move(f"/dav/Home/{self.base_name}", f"/dav/Home/{self.base_name}/sub/inner")

    def test_move_error_statuses(self):
        with self.assertRaises(NotFoundError):
            self._move(f"/dav/Home/{self.base_name}/ghost.txt", f"/dav/Home/{self.base_name}/x")
        with self.assertRaises(Conflict):
            self._move(f"/dav/Home/{self.base_name}/b.txt", f"/dav/Home/{self.base_name}/nope/x")
        with self.assertRaises(BadGateway):
            self._move(f"/dav/Home/{self.base_name}/b.txt", "http://elsewhere.example/dav/Home/x.txt")
        with self.assertRaises(Forbidden):
            self._move(f"/dav/Home/{self.base_name}/b.txt", "/dav/Home")

    def test_move_cross_root(self):
        # a shared folder the owner controls (owner rows grant everything)
        with self.set_user("Administrator"):
            shared = create_drive_file(
                f"mc-shared-{frappe.generate_hash(length=6)}",
                get_root_folder().name,
                "Folder",
                lambda f: FileManager().create_folder(f),
                owner=OWNER,
            )
        response = self._move(f"/dav/Home/{self.base_name}/b.txt", f"/dav/Everyone/{shared.file_name}/b.txt")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(frappe.db.get_value("File", self.file.name, "folder"), shared.name)

    def test_copy_file(self):
        response = self._copy(f"/dav/Home/{self.base_name}/b.txt", f"/dav/Home/{self.base_name}/sub/copy.txt")
        self.assertEqual(response.status_code, 201)

        duplicate = self._resolve(f"Home/{self.base_name}/sub/copy.txt").entity
        self.assertIsNotNone(duplicate)
        self.assertNotEqual(duplicate.name, self.file.name)
        self.assertEqual(blob_bytes(duplicate.name), b"move me")
        self.assertEqual(duplicate.owner, OWNER)
        # source untouched
        self.assertTrue(self._resolve(f"Home/{self.base_name}/b.txt").exists)

    def test_copy_folder_recursive(self):
        with self.set_user(OWNER):
            write_file_fixture(self.sub.name, "deep.txt", b"deep-data")

        response = self._copy(f"/dav/Home/{self.base_name}", f"/dav/Home/{self.base_name}-copy")
        self.assertEqual(response.status_code, 201)

        copied_root = self._resolve(f"Home/{self.base_name}-copy").entity
        self.assertTrue(copied_root.is_folder)
        copied_deep = self._resolve(f"Home/{self.base_name}-copy/sub/deep.txt").entity
        self.assertEqual(blob_bytes(copied_deep.name), b"deep-data")
        # rolled-up size on the copied tree
        self.assertEqual(
            frappe.db.get_value("File", copied_root.name, "file_size"),
            len(b"move me") + len(b"deep-data"),
        )

    def test_copy_depth_zero_copies_shell_only(self):
        response = self._copy(
            f"/dav/Home/{self.base_name}",
            f"/dav/Home/{self.base_name}-shell",
            **{"Depth": "0"},
        )
        self.assertEqual(response.status_code, 201)
        self.assertTrue(self._resolve(f"Home/{self.base_name}-shell").is_collection)
        self.assertFalse(self._resolve(f"Home/{self.base_name}-shell/b.txt").exists)

    def test_copy_skips_unreadable_children(self):
        with self.set_user(OWNER):
            shared = create_drive_file(
                f"mc-ro-{frappe.generate_hash(length=6)}",
                get_root_folder().name,
                "Folder",
                lambda f: FileManager().create_folder(f),
            )
            write_file_fixture(shared.name, "open.txt", b"open")
            hidden = write_file_fixture(shared.name, "hidden.txt", b"hidden")
        frappe.get_doc(
            {"doctype": "Drive Permission", "entity": hidden.name, "user": READER, "read": 1, "deny": 1}
        ).insert(ignore_permissions=True)

        reader_home = get_user_folder(READER).name
        response = self._copy(
            f"/dav/Everyone/{shared.file_name}", f"/dav/Home/{shared.file_name}", user=READER
        )
        self.assertEqual(response.status_code, 201)
        copied = self._resolve(f"Home/{shared.file_name}", user=READER).entity
        self.assertEqual(copied.owner, READER)
        self.assertEqual(copied.folder, reader_home)
        self.assertTrue(self._resolve(f"Home/{shared.file_name}/open.txt", user=READER).exists)
        self.assertFalse(self._resolve(f"Home/{shared.file_name}/hidden.txt", user=READER).exists)

    def test_unreadable_destination_reads_as_absent(self):
        # neither the Overwrite:F 412 nor the overwrite path's 403 may confirm
        # a name READER cannot see — fail closed as 404, like PUT
        with self.set_user(OWNER):
            shared = create_drive_file(
                f"mc-dst-{frappe.generate_hash(length=6)}",
                get_root_folder().name,
                "Folder",
                lambda f: FileManager().create_folder(f),
            )
            hidden = write_file_fixture(shared.name, "spot.txt", b"hidden")
        frappe.get_doc(
            {"doctype": "Drive Permission", "entity": shared.name, "user": READER, "read": 1, "upload": 1}
        ).insert(ignore_permissions=True)
        frappe.get_doc(
            {"doctype": "Drive Permission", "entity": hidden.name, "user": READER, "read": 1, "deny": 1}
        ).insert(ignore_permissions=True)
        with self.set_user(READER):
            write_file_fixture(shared.name, "mine.txt", b"mine")

        for overwrite in (False, None):
            with self.assertRaises(NotFoundError):
                self._move(
                    f"/dav/Everyone/{shared.file_name}/mine.txt",
                    f"/dav/Everyone/{shared.file_name}/spot.txt",
                    user=READER,
                    overwrite=overwrite,
                )
        # the hidden destination was never trashed
        self.assertEqual(frappe.db.get_value("File", hidden.name, "status"), "Active")

    def test_copy_overwrite_semantics(self):
        with self.set_user(OWNER):
            target = write_file_fixture(self.base.name, "spot.txt", b"old")

        with self.assertRaises(PreconditionFailed):
            self._copy(
                f"/dav/Home/{self.base_name}/b.txt",
                f"/dav/Home/{self.base_name}/spot.txt",
                Overwrite="F",
            )

        response = self._copy(f"/dav/Home/{self.base_name}/b.txt", f"/dav/Home/{self.base_name}/spot.txt")
        self.assertEqual(response.status_code, 204)
        self.assertEqual(frappe.db.get_value("File", target.name, "status"), STATUS_TRASHED)

    def test_copy_quota_is_507(self):
        big = frappe.get_doc("File", self.file.name)
        big.db_set("file_size", 5 * 1024 * 1024, update_modified=False)
        frappe.db.set_value("Drive Settings", OWNER, "quota", 1, update_modified=False)
        try:
            with self.assertRaises(InsufficientStorage):
                self._copy(f"/dav/Home/{self.base_name}/b.txt", f"/dav/Home/{self.base_name}/too-big.txt")
        finally:
            frappe.db.set_value("Drive Settings", OWNER, "quota", 0, update_modified=False)
