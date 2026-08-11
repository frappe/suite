import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

import frappe

from suite.drive.overrides.file import File
from suite.drive.utils import WRITER_CONTENT_DOCTYPE
from suite.drive.utils.files import FileManager, get_s3_key, get_s3_url, storage_key


class TestStorageHelpers(unittest.TestCase):
    def test_permanent_delete_uses_the_blob_current_location(self):
        for blob_is_trashed in (False, True):
            with self.subTest(blob_is_trashed=blob_is_trashed):
                manager = Mock()
                entity = frappe._dict(name="file-id", file_url="private/files/file-id", manager=manager)
                with patch.object(frappe.db, "after_commit", Mock()) as after_commit:
                    File._delete_blob_after_commit(entity, blob_is_trashed)
                after_commit.add.call_args.args[0]()

                if blob_is_trashed:
                    manager.delete_from_trash.assert_called_once()
                    manager.delete_file.assert_not_called()
                else:
                    manager.delete_file.assert_called_once()
                    manager.delete_from_trash.assert_not_called()

    def test_writer_container_is_disk_managed(self):
        writer = frappe._dict(
            file_type="Document",
            file_url="team/writer-document",
            content_doctype=WRITER_CONTENT_DOCTYPE,
        )
        self.assertFalse(File._not_in_disk(writer))

    def test_other_content_references_are_not_disk_managed(self):
        reference = frappe._dict(
            file_type="Document",
            file_url="team/reference",
            content_doctype="Presentation",
        )
        self.assertTrue(File._not_in_disk(reference))

    def test_writer_container_follows_rename_trash_and_restore(self):
        with TemporaryDirectory() as site_folder:
            manager = object.__new__(FileManager)
            manager.s3_enabled = False
            manager.flat = False  # this exercises the mirrored-tree path
            manager.site_folder = Path(site_folder)
            entity = frappe._dict(
                name="w1a2b3c4d5",
                file_name="Renamed document",
                file_url="private/files/root/Original document",
                mime_type="frappe_doc",
                content_doctype=WRITER_CONTENT_DOCTYPE,
                parent_path=Path("private/files/root"),
            )
            embed = manager.site_folder / entity.file_url / ".embeds" / "image.png"
            embed.parent.mkdir(parents=True)
            embed.write_bytes(b"embed")

            entity.file_url = str(manager.rename(entity))
            renamed_embed = manager.site_folder / entity.file_url / ".embeds" / "image.png"
            self.assertEqual(renamed_embed.read_bytes(), b"embed")

            with patch(
                "suite.drive.utils.files.get_root_folder", return_value={"file_url": "private/files/root"}
            ):
                manager.move_to_trash(entity)
                self.assertFalse(renamed_embed.exists())
                manager.restore(entity)

            self.assertEqual(renamed_embed.read_bytes(), b"embed")

    def test_s3_url_roundtrip(self):
        # get_s3_url builds a stored file_url; storage_key must recover the key.
        for key in [
            "abc/def.png",
            "team one/sub folder/file name.pdf",
            "résumé/spaced key.txt",
            "a/b+c?d=e&f.bin",
        ]:
            self.assertEqual(storage_key(get_s3_url(key)), key)

    def test_storage_key_is_always_relative(self):
        # Never returns a leading slash, so `Path(base) / key` can't reset.
        for url in ["/private/files/x", "/files/y", "//z", "https://ext/u"]:
            self.assertFalse(storage_key(url).startswith("/"))

    def test_local_path_stays_in_files_roots(self):
        with TemporaryDirectory() as site_folder:
            manager = object.__new__(FileManager)
            manager.site_folder = Path(site_folder)
            (manager.site_folder / "private" / "files").mkdir(parents=True)
            path = manager.get_local_path("/private/files/folder/../file.txt")

            self.assertEqual(path, (manager.site_folder / "private" / "files" / "file.txt").resolve())

            with self.assertRaises(frappe.ValidationError):
                manager.get_local_path("/private/files/../../invalid.txt")

    def test_get_s3_key_strips_disk_prefix(self):
        self.assertEqual(get_s3_key("/private/files/a/b.png"), "a/b.png")
        self.assertEqual(get_s3_key("/files/a/b.png"), "a/b.png")
        # Already a bare key: unchanged.
        self.assertEqual(get_s3_key("a/b.png"), "a/b.png")

    def test_s3_root_paths_strip_disk_prefixes(self):
        manager = object.__new__(FileManager)
        manager.s3_enabled = True
        manager.flat = True
        manager.settings = frappe._dict(thumbnail_prefix=".thumbnails")

        for root_url in [
            "/private/files/prefix",
            "/files/prefix",
            get_s3_url("prefix"),
            "prefix",
        ]:
            with self.subTest(root_url=root_url):
                with patch("suite.drive.utils.files.get_root_folder", return_value={"file_url": root_url}):
                    self.assertEqual(
                        manager.get_disk_path(frappe._dict(name="file-id")), Path("prefix/file-id")
                    )
                    self.assertEqual(
                        manager.get_thumbnail_path("file-id"),
                        Path("prefix/.thumbnails/file-id.thumbnail"),
                    )
                    self.assertEqual(
                        manager._FileManager__get_trash_path(frappe._dict(name="file-id")),
                        Path("prefix/.trash/file-id"),
                    )

    def test_local_root_path_keeps_disk_prefix(self):
        manager = object.__new__(FileManager)
        manager.s3_enabled = False

        with patch(
            "suite.drive.utils.files.get_root_folder",
            return_value={"file_url": "/private/files/prefix"},
        ):
            self.assertEqual(manager.get_root_storage_key(), "private/files/prefix")

    def test_open_local_file_uses_site_relative_storage_key(self):
        with TemporaryDirectory() as site_folder:
            manager = object.__new__(FileManager)
            manager.s3_enabled = False
            manager.site_folder = Path(site_folder)
            file_path = manager.site_folder / "private/files/video.mp4"
            file_path.parent.mkdir(parents=True)
            file_path.write_bytes(b"video")

            with manager.open_file("/private/files/video.mp4") as file:
                self.assertEqual(file.read(), b"video")
