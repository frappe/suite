import frappe
from frappe.tests import IntegrationTestCase

from suite.drive.api.files import toggle_entity_status
from suite.drive.utils import (
    STATUS_ACTIVE,
    STATUS_TRASHED,
    create_drive_file,
    get_root_folder,
    get_user_folder,
)
from suite.drive.utils.files import FileManager, storage_key
from suite.drive.webdav import pathmap, structure
from suite.drive.webdav.errors import (
    BadRequest,
    Conflict,
    Forbidden,
    MethodNotAllowed,
    NotFoundError,
    UnsupportedMediaType,
)
from suite.drive.webdav.tests.utils import ensure_user_with_password, make_ctx, write_file_fixture
from suite.tests.utils import ensure_user

OWNER = "webdav-structure-owner@example.com"
READER = "webdav-structure-reader@example.com"
PASSWORD = "webdav-structure-pw"


class TestWebDAVMkcolDelete(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user_with_password(OWNER, PASSWORD)
        ensure_user(READER)
        with cls.set_user(OWNER):
            cls.home = get_user_folder(OWNER).name
            cls.base_name = f"Struct-{frappe.generate_hash(length=6)}"
            cls.base = create_drive_file(
                cls.base_name, cls.home, "Folder", lambda f: FileManager().create_folder(f)
            )

    def tearDown(self):
        frappe.set_user("Administrator")
        super().tearDown()

    def _mkcol(self, path: str, user: str = OWNER, data: bytes = b""):
        return structure.handle_mkcol(make_ctx("MKCOL", path, user, data=data))

    def _delete(self, path: str, user: str = OWNER):
        return structure.handle_delete(make_ctx("DELETE", path, user))

    def test_mkcol_creates_folder_and_storage(self):
        response = self._mkcol(f"/dav/Home/{self.base_name}/NewFolder")
        self.assertEqual(response.status_code, 201)

        pathmap.reset_memo()
        resolved = pathmap.resolve(["Home", self.base_name, "NewFolder"], OWNER)
        self.assertTrue(resolved.exists)
        self.assertTrue(resolved.is_collection)

        manager = FileManager()
        if not manager.flat:
            disk = manager.site_folder / storage_key(resolved.entity.file_url)
            self.assertTrue(disk.is_dir())

    def test_mkcol_statuses(self):
        with self.assertRaises(MethodNotAllowed):  # exists (the base folder itself)
            self._mkcol(f"/dav/Home/{self.base_name}")
        with self.assertRaises(Conflict):  # missing intermediate
            self._mkcol(f"/dav/Home/{self.base_name}/no/such")
        with self.assertRaises(UnsupportedMediaType):  # request body
            self._mkcol(f"/dav/Home/{self.base_name}/WithBody", data=b"<mkcol/>")
        with self.assertRaises(Forbidden):  # namespace mount
            self._mkcol("/dav/Home")
        with self.assertRaises(Conflict):  # new top-level mount
            self._mkcol("/dav/NewMount")
        with self.assertRaises(Forbidden):  # reserved name
            self._mkcol(f"/dav/Home/{self.base_name}/.embeds")
        with self.assertRaises(BadRequest):  # name too long
            self._mkcol(f"/dav/Home/{self.base_name}/{'a' * 141}")

    def test_mkcol_collides_with_existing_file_too(self):
        with self.set_user(OWNER):
            write_file_fixture(self.base.name, "taken.txt", b"x")
        with self.assertRaises(MethodNotAllowed):
            self._mkcol(f"/dav/Home/{self.base_name}/taken.txt")

    def test_mkcol_requires_upload_permission(self):
        with self.set_user(OWNER):
            shared = create_drive_file(
                f"shared-{frappe.generate_hash(length=6)}",
                get_root_folder().name,
                "Folder",
                lambda f: FileManager().create_folder(f),
            )
        shared_name = shared.file_name
        # READER inherits $GENERAL read on Everyone but no upload
        with self.assertRaises(Forbidden):
            self._mkcol(f"/dav/Everyone/{shared_name}/Intruder", user=READER)

    def test_everyone_root_is_read_only_for_non_admins(self):
        # the shared root carries only the $GENERAL read grant, so the same
        # resolver Drive uses leaves creation there to Drive admins
        with self.assertRaises(Forbidden):
            self._mkcol("/dav/Everyone/RootIntruder")
        with self.assertRaises(Forbidden):
            self._mkcol("/dav/Everyone/RootIntruder", user=READER)

    def test_delete_rolls_size_up_all_ancestors(self):
        with self.set_user(OWNER):
            nested = create_drive_file(
                "Nested", self.base.name, "Folder", lambda f: FileManager().create_folder(f)
            )
            victim = write_file_fixture(nested.name, "sized.txt", b"0123456789")

        def size(name):
            return frappe.db.get_value("File", name, "file_size") or 0

        before = (size(nested.name), size(self.base.name))
        response = self._delete(f"/dav/Home/{self.base_name}/Nested/sized.txt")
        self.assertEqual(response.status_code, 204)
        # trash decrements the parent AND the grandparent, not just doc.folder
        self.assertEqual(size(nested.name), before[0] - victim.file_size)
        self.assertEqual(size(self.base.name), before[1] - victim.file_size)

    def test_delete_moves_file_to_trash(self):
        with self.set_user(OWNER):
            victim = write_file_fixture(self.base.name, "victim.txt", b"bye")

        response = self._delete(f"/dav/Home/{self.base_name}/victim.txt")
        self.assertEqual(response.status_code, 204)
        self.assertEqual(frappe.db.get_value("File", victim.name, "status"), STATUS_TRASHED)

        pathmap.reset_memo()
        self.assertFalse(pathmap.resolve(["Home", self.base_name, "victim.txt"], OWNER).exists)

        # recoverable through Drive's own restore
        with self.set_user(OWNER):
            # The /dav DELETE path's own toggle, which `remove_or_restore` used
            # to reach. That name is now a §11.7 forwarder onto Drive Node, and
            # this test is about File rows.
            toggle_entity_status(frappe.get_doc("File", victim.name), FileManager(), set())
        self.assertEqual(frappe.db.get_value("File", victim.name, "status"), STATUS_ACTIVE)

    def test_delete_folder_hides_subtree(self):
        with self.set_user(OWNER):
            folder = create_drive_file(
                f"doomed-{frappe.generate_hash(length=6)}",
                self.base.name,
                "Folder",
                lambda f: FileManager().create_folder(f),
            )
            child = write_file_fixture(folder.name, "inner.txt", b"inner")

        response = self._delete(f"/dav/Home/{self.base_name}/{folder.file_name}")
        self.assertEqual(response.status_code, 204)
        self.assertEqual(frappe.db.get_value("File", folder.name, "status"), STATUS_TRASHED)
        # children stay Active (Drive semantics) but vanish from the namespace with the parent
        self.assertEqual(frappe.db.get_value("File", child.name, "status"), STATUS_ACTIVE)
        pathmap.reset_memo()
        self.assertFalse(
            pathmap.resolve(["Home", self.base_name, folder.file_name, "inner.txt"], OWNER).exists
        )

    def test_delete_statuses(self):
        with self.assertRaises(NotFoundError):
            self._delete(f"/dav/Home/{self.base_name}/never-there.txt")
        with self.assertRaises(Forbidden):
            self._delete("/dav/Home")
        with self.assertRaises(Forbidden):
            self._delete("/dav")

    def test_delete_requires_write(self):
        with self.set_user(OWNER):
            shared = create_drive_file(
                f"ro-{frappe.generate_hash(length=6)}",
                get_root_folder().name,
                "Folder",
                lambda f: FileManager().create_folder(f),
            )
            protected = write_file_fixture(shared.name, "keep.txt", b"safe")

        with self.assertRaises(frappe.PermissionError):
            self._delete(f"/dav/Everyone/{shared.file_name}/keep.txt", user=READER)
        self.assertEqual(frappe.db.get_value("File", protected.name, "status"), STATUS_ACTIVE)

    def test_write_verb_hides_unreadable_as_404(self):
        # a file READER cannot read must look absent (404), not forbidden (403),
        # so write verbs aren't an existence oracle for hidden resources
        with self.set_user(OWNER):
            secret = create_drive_file(
                f"secret-{frappe.generate_hash(length=6)}",
                get_root_folder().name,
                "Folder",
                lambda f: FileManager().create_folder(f),
            )
            write_file_fixture(secret.name, "hidden.txt", b"nope")
        # deny READER read on the whole subtree (a user-specific deny beats $GENERAL)
        frappe.get_doc(
            {"doctype": "Drive Permission", "entity": secret.name, "user": READER, "deny": 1, "read": 1}
        ).insert(ignore_permissions=True)

        path = f"/dav/Everyone/{secret.file_name}/hidden.txt"
        with self.assertRaises(NotFoundError):
            self._delete(path, user=READER)
        with self.assertRaises(NotFoundError):
            structure.handle_move(
                make_ctx("MOVE", path, READER, headers={"Destination": "/dav/Home/stolen.txt"})
            )

    def test_trashed_name_is_reusable(self):
        with self.set_user(OWNER):
            original = write_file_fixture(self.base.name, "cycle.txt", b"v1")
        self._delete(f"/dav/Home/{self.base_name}/cycle.txt")

        response = self._mkcol(f"/dav/Home/{self.base_name}/cycle.txt")
        self.assertEqual(response.status_code, 201)
        pathmap.reset_memo()
        replacement = pathmap.resolve(["Home", self.base_name, "cycle.txt"], OWNER)
        self.assertTrue(replacement.is_collection)
        self.assertNotEqual(replacement.entity.name, original.name)
