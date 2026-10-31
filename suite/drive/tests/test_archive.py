import io
import zipfile
from unittest.mock import MagicMock, patch

import frappe
from frappe.storage.blob import put_blob
from frappe.storage.driver import get_driver
from frappe.tests import IntegrationTestCase, UnitTestCase

from suite.drive._core import archive
from suite.drive._core.access import grant, revoke
from suite.drive._core.errors import DriveNotFound
from suite.drive._core.nodes import create_file, create_folder, get, update
from suite.drive._core.principals import Principals
from suite.drive._core.roles import NONE, READ
from suite.drive._core.roots import create_root
from suite.drive.tests.fixtures import drop_node_rows, ensure_rootless_user


class TestFolderArchive(UnitTestCase):
    principals = Principals("reader@example.com", ("reader@example.com",), ("$PUBLIC",))

    @patch("suite.drive._core.archive._", new=lambda text: text)
    def test_one_refused_descendant_refuses_the_whole_build(self):
        folder = frappe._dict(
            name="folder", title="Folder", kind="folder", state="Active", root="root", path=""
        )
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
            parent_node="folder",
            title="report.txt",
            kind="file",
            blob="blob-1",
            size=4,
        )
        link = frappe._dict(
            name="link",
            parent_node="folder",
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
            "nodes": ["folder"],
        }
        blob = frappe._dict(name="archive-blob", status="Ready", is_private=1)
        with patch.object(archive, "_folder", return_value=folder):
            with patch.object(archive.frappe.db, "sql", return_value=[folder]):
                with patch.object(archive.node_core, "_readable_rows", return_value=[folder]):
                    with patch.object(archive.frappe, "cache", return_value=cache):
                        with patch.object(archive.frappe, "get_doc", return_value=blob):
                            self.assertEqual(
                                archive.download(self.principals, "folder"), (blob, "Folder.zip")
                            )


class TestArchiveRevocation(IntegrationTestCase):
    def setUp(self) -> None:
        super().setUp()
        frappe.set_user("Administrator")
        owner = "archive-owner@example.com"
        reader = "archive-reader@example.com"
        ensure_rootless_user(owner, reader)
        self.blobs_before = set(frappe.get_all("File Blob", pluck="name"))
        self.admin = Principals("Administrator", ("Administrator",), (), is_admin=True)
        self.reader = Principals(reader, (reader,), ("$PUBLIC",))
        self.root = create_root(kind="Personal", title="Archive test", user=owner)
        self.folder = create_folder(self.admin, self.root.name, "Shared")
        grant(self.folder, reader, READ, self.admin)
        blob = put_blob(io.BytesIO(b"confidential report"), is_private=True, filename="report.txt")
        self.file = create_file(
            self.admin,
            self.folder,
            "report.txt",
            blob=blob.name,
            size=blob.file_size,
            mime=blob.mime_type,
        )
        frappe.set_user(reader)
        archive.start(self.reader, self.folder)
        built, _ = archive.download(self.reader, self.folder)
        with get_driver(built.driver).read(built.key, is_private=True) as stream:
            with zipfile.ZipFile(io.BytesIO(stream.read())) as downloaded:
                self.assertEqual(downloaded.read("Shared/report.txt"), b"confidential report")

    def tearDown(self) -> None:
        frappe.set_user("Administrator")
        frappe.cache().delete_value(archive._cache_key(self.reader.user, self.folder))
        drop_node_rows(frappe.get_all("Drive Node", filters={"root": self.root.name}, pluck="name"))
        drop_node_rows([self.root.name])
        frappe.db.delete("Drive Root", {"name": self.root.name})
        for blob in set(frappe.get_all("File Blob", pluck="name")) - self.blobs_before:
            frappe.delete_doc("File Blob", blob, force=True, ignore_permissions=True)
        super().tearDown()

    def test_denying_one_descendant_blocks_the_previously_downloadable_archive(self) -> None:
        grant(self.file, self.reader.user, NONE, self.admin)
        self.assertEqual(get(self.reader, self.folder).name, self.folder)
        with self.assertRaises(DriveNotFound):
            get(self.reader, self.file)
        with self.assertRaises(DriveNotFound):
            archive.download(self.reader, self.folder)

    def test_a_moved_member_is_rechecked_even_after_it_leaves_the_archived_folder(self) -> None:
        grant(self.file, self.reader.user, READ, self.admin)
        update(self.admin, self.file, parent_node=self.root.name)
        revoke(self.file, self.reader.user, self.admin)
        self.assertEqual(get(self.reader, self.folder).name, self.folder)
        with self.assertRaises(DriveNotFound):
            get(self.reader, self.file)
        with self.assertRaises(DriveNotFound):
            archive.download(self.reader, self.folder)
