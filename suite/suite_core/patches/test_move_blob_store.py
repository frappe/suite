import os
import tempfile
import unittest
from unittest import mock

from suite.suite_core.patches import move_blob_store_out_of_files, move_blob_store_out_of_private


class MoveBlobStorePatchTests:
    """Regression tests shared by both blob-store relocation patches.

    The patches move (or drop) directories on disk, so each branch is exercised against a
    throwaway bench laid out in a temp directory: a populated move, a pre-existing destination,
    a rerun after success, and a symlinked source.
    """

    module = None  # patch module under test
    old_relative: tuple[str, ...] = ()  # legacy blob-store location, relative to the site directory

    SITE = "blob-store-patch-test-site"

    def setUp(self):
        self.bench_path = self.enterContext(tempfile.TemporaryDirectory())
        self.site_path = os.path.join(self.bench_path, "sites", self.SITE)
        self.old_path = os.path.join(self.site_path, *self.old_relative)
        self.new_path = os.path.join(self.site_path, "blob-store")
        os.makedirs(self.site_path)

        # Point both the patch module and suite.store (get_blob_base_path) at the temp bench.
        for name in (self.module.__name__, "suite.store"):
            frappe_mock = self.enterContext(mock.patch(f"{name}.frappe"))
            frappe_mock.local.site = self.SITE
            self.enterContext(mock.patch(f"{name}.get_bench_path", return_value=self.bench_path))

    def write_blob(self, base: str, *relative: str, content: bytes = b"x") -> None:
        path = os.path.join(base, *relative)
        os.makedirs(os.path.dirname(path))
        with open(path, "wb") as f:
            f.write(content)

    def read_blob(self, base: str, *relative: str) -> bytes:
        with open(os.path.join(base, *relative), "rb") as f:
            return f.read()

    def test_moves_populated_store_to_site_root(self):
        self.write_blob(self.old_path, "mail", "account%40example.com", "data.mdb", content=b"blob-bytes")

        self.module.execute()

        self.assertFalse(os.path.exists(self.old_path))
        self.assertEqual(
            self.read_blob(self.new_path, "mail", "account%40example.com", "data.mdb"), b"blob-bytes"
        )

    def test_drops_old_store_when_destination_exists(self):
        self.write_blob(self.old_path, "mail", "stale.mdb", content=b"stale")
        self.write_blob(self.new_path, "mail", "fresh.mdb", content=b"fresh")

        self.module.execute()

        self.assertFalse(os.path.exists(self.old_path))
        self.assertEqual(os.listdir(os.path.join(self.new_path, "mail")), ["fresh.mdb"])
        self.assertEqual(self.read_blob(self.new_path, "mail", "fresh.mdb"), b"fresh")

    def test_rerun_after_successful_move_is_a_noop(self):
        self.write_blob(self.old_path, "mail", "data.mdb", content=b"blob-bytes")
        self.module.execute()

        self.module.execute()

        self.assertFalse(os.path.exists(self.old_path))
        self.assertEqual(self.read_blob(self.new_path, "mail", "data.mdb"), b"blob-bytes")

    def test_noop_when_nothing_to_migrate(self):
        self.module.execute()

        self.assertFalse(os.path.exists(self.new_path))

    def test_leaves_symlinked_store_alone(self):
        target = os.path.join(self.site_path, "blob-store-elsewhere")
        self.write_blob(target, "mail", "data.mdb", content=b"blob-bytes")
        os.makedirs(os.path.dirname(self.old_path), exist_ok=True)
        os.symlink(target, self.old_path)

        self.module.execute()

        self.assertTrue(os.path.islink(self.old_path))
        self.assertFalse(os.path.exists(self.new_path))
        self.assertEqual(self.read_blob(target, "mail", "data.mdb"), b"blob-bytes")


class MoveBlobStoreOutOfFiles(MoveBlobStorePatchTests, unittest.TestCase):
    module = move_blob_store_out_of_files
    old_relative = ("private", "files", "blob-store")


class MoveBlobStoreOutOfPrivate(MoveBlobStorePatchTests, unittest.TestCase):
    module = move_blob_store_out_of_private
    old_relative = ("private", "blob-store")
