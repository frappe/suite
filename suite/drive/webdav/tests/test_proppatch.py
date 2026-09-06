import unittest

import frappe
from frappe.tests import IntegrationTestCase
from lxml import etree

from suite.drive.utils import create_drive_file, get_user_folder
from suite.drive.utils.files import FileManager
from suite.drive.webdav import copy as copy_module
from suite.drive.webdav import deadprops, propfind, proppatch
from suite.drive.webdav.errors import BadRequest, Forbidden, NotFoundError
from suite.drive.webdav.tests.utils import (
    ensure_user_with_password,
    make_ctx,
)
from suite.drive.webdav.tests.utils import (
    legacy_file_fixture as write_file_fixture,
)
from suite.drive.webdav.xmlutil import dav
from suite.tests.utils import ensure_user

OWNER = "webdav-proppatch-owner@example.com"
READER = "webdav-proppatch-reader@example.com"
PASSWORD = "webdav-proppatch-pw"

SET_CUSTOM = (
    b'<?xml version="1.0"?><D:propertyupdate xmlns:D="DAV:" xmlns:z="urn:z">'
    b"<D:set><D:prop><z:color>indigo</z:color></D:prop></D:set></D:propertyupdate>"
)
REMOVE_CUSTOM = (
    b'<?xml version="1.0"?><D:propertyupdate xmlns:D="DAV:" xmlns:z="urn:z">'
    b"<D:remove><D:prop><z:color/></D:prop></D:remove></D:propertyupdate>"
)


PARKED_FOR_25 = "PROPPATCH is not relinked by ticket 24. `suite/drive/webdav/proppatch.py` still reads `webdav/perms.py` and writes the Win32 mtime onto a legacy `File` row, so the verb is absent from `RELINKED_METHODS` and `dispatch._HANDLERS` and answers 405. `deadprops.py` itself is already on node identity and is read on every PROPFIND. Un-skip in ticket 25, once PROPPATCH authorizes with EDIT on the node and stamps `content_modified` through `_core.nodes.update`, and after these cases are rewritten onto node fixtures - the MOVE and COPY cases here also need those verbs back."


@unittest.skip(PARKED_FOR_25)
class TestWebDAVProppatch(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user_with_password(OWNER, PASSWORD)
        ensure_user(READER)
        with cls.set_user(OWNER):
            cls.home = get_user_folder(OWNER).name

    def setUp(self):
        frappe.set_user(OWNER)
        with self.set_user(OWNER):
            self.base_name = f"PP-{frappe.generate_hash(length=6)}"
            self.base = create_drive_file(
                self.base_name, self.home, "Folder", lambda f: FileManager().create_folder(f)
            )
            self.file = write_file_fixture(self.base.name, "target.txt", b"props")

    def tearDown(self):
        frappe.set_user("Administrator")
        super().tearDown()

    def _proppatch(self, body: bytes, path: str | None = None, user: str = OWNER):
        path = path or f"/dav/Home/{self.base_name}/target.txt"
        return proppatch.handle(make_ctx("PROPPATCH", path, user, data=body))

    def _propfind_prop(self, body: bytes):
        ctx = make_ctx(
            "PROPFIND",
            f"/dav/Home/{self.base_name}/target.txt",
            OWNER,
            headers={"Depth": "0"},
            data=body,
        )
        return etree.fromstring(propfind.handle(ctx).get_data())

    def test_set_and_roundtrip_custom_property(self):
        response = self._proppatch(SET_CUSTOM)
        self.assertEqual(response.status_code, 207)
        parsed = etree.fromstring(response.get_data())
        status = parsed.find(f"{dav('response')}/{dav('propstat')}/{dav('status')}").text
        self.assertIn("200", status)

        body = (
            b'<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop>'
            b'<z:color xmlns:z="urn:z"/></D:prop></D:propfind>'
        )
        found = self._propfind_prop(body)
        color = found.find(f"{dav('response')}/{dav('propstat')}/{dav('prop')}/{{urn:z}}color")
        self.assertEqual(color.text, "indigo")

    def test_allprop_includes_dead_properties(self):
        self._proppatch(SET_CUSTOM)
        found = self._propfind_prop(b"")
        color = found.find(f"{dav('response')}/{dav('propstat')}/{dav('prop')}/{{urn:z}}color")
        self.assertIsNotNone(color)

    def test_remove_is_idempotent(self):
        self._proppatch(SET_CUSTOM)
        for _ in range(2):
            response = self._proppatch(REMOVE_CUSTOM)
            parsed = etree.fromstring(response.get_data())
            status = parsed.find(f"{dav('response')}/{dav('propstat')}/{dav('status')}").text
            self.assertIn("200", status)
        self.assertEqual(deadprops.count(self.file.name), 0)

    def test_update_overwrites_in_place(self):
        self._proppatch(SET_CUSTOM)
        self._proppatch(SET_CUSTOM.replace(b"indigo", b"crimson"))
        self.assertEqual(deadprops.count(self.file.name), 1)
        props = deadprops.get_dead_props([self.file.name])[self.file.name]
        self.assertEqual(props["{urn:z}color"].text, "crimson")

    def test_protected_property_fails_atomically(self):
        body = (
            b'<?xml version="1.0"?><D:propertyupdate xmlns:D="DAV:" xmlns:z="urn:z">'
            b"<D:set><D:prop><z:ok>fine</z:ok><D:getetag>forged</D:getetag></D:prop></D:set>"
            b"</D:propertyupdate>"
        )
        response = self._proppatch(body)
        parsed = etree.fromstring(response.get_data())
        statuses = {
            propstat.find(dav("status")).text
            for propstat in parsed.findall(f"{dav('response')}/{dav('propstat')}")
        }
        self.assertIn("HTTP/1.1 403 Forbidden", statuses)
        self.assertIn("HTTP/1.1 424 Failed Dependency", statuses)
        # nothing was applied — atomicity
        self.assertEqual(deadprops.count(self.file.name), 0)

    def test_win32_mtime_updates_drive_mtime(self):
        body = (
            b'<?xml version="1.0"?><D:propertyupdate xmlns:D="DAV:" '
            b'xmlns:Z="urn:schemas-microsoft-com:"><D:set><D:prop>'
            b"<Z:Win32LastModifiedTime>Thu, 20 Aug 2026 10:00:00 GMT</Z:Win32LastModifiedTime>"
            b"</D:prop></D:set></D:propertyupdate>"
        )
        response = self._proppatch(body)
        parsed = etree.fromstring(response.get_data())
        self.assertIn("200", parsed.find(f"{dav('response')}/{dav('propstat')}/{dav('status')}").text)

        stored = frappe.utils.get_datetime(frappe.db.get_value("File", self.file.name, "file_modified"))
        from suite.drive.webdav.properties import rfc1123

        self.assertEqual(rfc1123(stored), "Thu, 20 Aug 2026 10:00:00 GMT")
        # stored as a dead prop too, so Explorer reads back what it wrote
        self.assertEqual(deadprops.count(self.file.name), 1)

    def test_errors(self):
        with self.assertRaises(BadRequest):
            self._proppatch(b"<wrong-root/>")
        with self.assertRaises(NotFoundError):
            self._proppatch(SET_CUSTOM, path=f"/dav/Home/{self.base_name}/ghost.txt")
        # a path READER can read but not write -> 403; their own Home lacks the
        # path entirely -> 404
        from suite.drive.utils import get_root_folder

        with self.set_user("Administrator"):
            shared = create_drive_file(
                f"pp-ro-{frappe.generate_hash(length=6)}",
                get_root_folder().name,
                "Folder",
                lambda f: FileManager().create_folder(f),
                owner=OWNER,
            )
        with self.set_user(OWNER):
            write_file_fixture(shared.name, "ro.txt", b"ro")
        with self.assertRaises(Forbidden):
            self._proppatch(SET_CUSTOM, path=f"/dav/Everyone/{shared.file_name}/ro.txt", user=READER)
        with self.assertRaises(NotFoundError):
            self._proppatch(SET_CUSTOM, user=READER)

    def test_move_keeps_and_copy_clones_dead_props(self):
        from suite.drive.webdav import structure

        self._proppatch(SET_CUSTOM)

        structure.handle_move(
            make_ctx(
                "MOVE",
                f"/dav/Home/{self.base_name}/target.txt",
                OWNER,
                headers={"Destination": f"/dav/Home/{self.base_name}/moved.txt"},
            )
        )
        self.assertEqual(deadprops.count(self.file.name), 1)

        copy_module.handle(
            make_ctx(
                "COPY",
                f"/dav/Home/{self.base_name}/moved.txt",
                OWNER,
                headers={"Destination": f"/dav/Home/{self.base_name}/cloned.txt"},
            )
        )
        from suite.drive.webdav import pathmap

        pathmap.reset_memo()
        clone = pathmap.resolve(["Home", self.base_name, "cloned.txt"], OWNER).entity
        clone_props = deadprops.get_dead_props([clone.name]).get(clone.name, {})
        self.assertEqual(clone_props["{urn:z}color"].text, "indigo")

    def test_delete_cascade_wipes_dead_props(self):
        self._proppatch(SET_CUSTOM)
        doc = frappe.get_doc("File", self.file.name)
        doc.db_set("status", "Removed", update_modified=False)
        doc.reload()
        doc.delete(ignore_permissions=True, force=True)
        self.assertEqual(frappe.db.count("Drive DAV Property", {"entity": self.file.name}), 0)
