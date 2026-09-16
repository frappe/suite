import io
import zipfile
from unittest.mock import MagicMock, patch

import frappe
from frappe.tests import UnitTestCase

from suite.drive._core import archive
from suite.drive._core.errors import DriveNotFound
from suite.drive._core.principals import Principals


class TestFolderArchive(UnitTestCase):
    principals = Principals("reader@example.com", ("reader@example.com",), ("$PUBLIC",))

    def test_one_refused_descendant_refuses_the_whole_build(self):
        folder = frappe._dict(name="folder", title="Folder", kind="folder", state="Active", root="root", path="")
        children = [
            frappe._dict(name="readable", kind="file", root="root", path="/folder/"),
            frappe._dict(name="refused", kind="file", root="root", path="/folder/"),
        ]
        with patch.object(archive, "_folder", return_value=folder):
            with patch.object(archive.frappe.db, "sql", return_value=children):
                with patch.object(archive.node_core, "_readable_rows", return_value=children[:1]):
                    with self.assertRaises(DriveNotFound):
                        archive._authorized_rows(self.principals, "folder")

    def test_the_build_streams_files_and_links_into_one_private_blob(self):
        folder = frappe._dict(name="folder", title="Folder", kind="folder", root="root", path="", size=0)
        file_row = frappe._dict(
            name="file",
            parent="folder",
            title="report.txt",
            kind="file",
            blob="blob-1",
            size=4,
        )
        link = frappe._dict(
            name="link",
            parent="folder",
            title="Site",
            kind="link",
            url="https://example.com",
            size=0,
        )
        blob = frappe._dict(
            name="blob-1",
            key="key-1",
            driver="local",
            is_private=1,
            status="Ready",
        )
        driver = MagicMock()
        driver.read.return_value = io.BytesIO(b"body")
        captured = {}

        def store(stream, **kwargs):
            captured["bytes"] = stream.read()
            captured.update(kwargs)
            return frappe._dict(name="archive-blob")

        with patch.object(archive.frappe, "get_all", return_value=[blob]):
            with patch.object(archive, "get_driver", return_value=driver):
                with patch.object(archive, "put_blob", side_effect=store):
                    name, size = archive._build(self.principals, folder, [folder, file_row, link])

        self.assertEqual(name, "archive-blob")
        self.assertGreater(size, 0)
        self.assertTrue(captured["is_private"])
        with zipfile.ZipFile(io.BytesIO(captured["bytes"])) as built:
            self.assertEqual(built.read("Folder/report.txt"), b"body")
            self.assertIn(b"URL=https://example.com", built.read("Folder/Site.url"))

    def test_download_requires_a_ready_live_private_blob(self):
        folder = frappe._dict(name="folder", title="Folder", kind="folder", state="Active")
        cache = MagicMock()
        cache.get_value.return_value = {
            "status": "ready",
            "blob": "archive-blob",
            "file_name": "Folder.zip",
        }
        blob = frappe._dict(name="archive-blob", status="Ready", is_private=1)
        with patch.object(archive, "_folder", return_value=folder):
            with patch.object(archive.frappe, "cache", return_value=cache):
                with patch.object(archive.frappe, "get_doc", return_value=blob):
                    self.assertEqual(archive.download(self.principals, "folder"), (blob, "Folder.zip"))
