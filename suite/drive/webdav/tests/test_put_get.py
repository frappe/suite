from pathlib import Path

import frappe
from frappe.tests import IntegrationTestCase

from suite.drive.utils import create_drive_file, get_user_folder
from suite.drive.utils.files import FileManager, get_s3_url, storage_key
from suite.drive.webdav import get as get_module
from suite.drive.webdav.errors import NotFoundError
from suite.drive.webdav.properties import compute_etag
from suite.drive.webdav.tests.utils import (
    dispatch,
    ensure_user_with_password,
    make_ctx,
    write_file_fixture,
)
from suite.tests.utils import ensure_user

OWNER = "webdav-content-owner@example.com"
STRANGER = "webdav-content-stranger@example.com"
PASSWORD = "webdav-content-pw"


def pending_putparts(name: str) -> list:
    """This row's staged bytes in the id-keyed pending store."""
    from suite.drive.webdav import put as put_module

    return list(put_module._pending_swap_dir(FileManager()).glob(f"{name}.*.putpart"))


DATA = b"0123456789abcdefghij"
PIXEL_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082"
)


class TestWebDAVContent(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user_with_password(OWNER, PASSWORD)
        ensure_user(STRANGER)
        with cls.set_user(OWNER):
            cls.home = get_user_folder(OWNER).name
            manager = FileManager()
            # committed fixtures survive across runs, so names must be unique
            cls.folder_name = f"Media-{frappe.generate_hash(length=6)}"
            cls.media = create_drive_file(
                cls.folder_name, cls.home, "Folder", lambda f: manager.create_folder(f)
            )
            cls.blob = write_file_fixture(cls.media.name, "data.bin", DATA, "application/octet-stream")
        frappe.db.commit()

    def tearDown(self):
        frappe.set_user("Administrator")
        super().tearDown()

    def _get(self, path: str, user: str = OWNER, method: str = "GET", headers: dict | None = None):
        return get_module.handle(make_ctx(method, path, user, headers=headers))

    @staticmethod
    def _body(response) -> bytes:
        if response.direct_passthrough:
            return b"".join(response.response)
        return response.get_data()

    def test_get_streams_content_with_etag(self):
        response = self._get(f"/dav/Home/{self.folder_name}/data.bin")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._body(response), DATA)
        self.assertEqual(response.headers["Content-Type"], "application/octet-stream")
        self.assertEqual(response.headers["Accept-Ranges"], "bytes")
        self.assertTrue(response.headers["ETag"])
        self.assertTrue(response.headers["Last-Modified"].endswith(" GMT"))
        # user bytes must come back inert for browsers; DAV clients ignore all three
        self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(response.headers["Content-Security-Policy"], "sandbox")
        self.assertEqual(response.headers["Content-Disposition"], "attachment; filename=data.bin")

    def test_range_request_yields_206(self):
        response = self._get(f"/dav/Home/{self.folder_name}/data.bin", headers={"Range": "bytes=0-4"})
        self.assertEqual(response.status_code, 206)
        self.assertEqual(self._body(response), DATA[:5])
        self.assertIn("bytes 0-4/", response.headers["Content-Range"])

    def test_if_none_match_yields_304(self):
        row = frappe._dict(
            name=self.blob.name,
            file_size=len(DATA),
            content_hash=None,
            modified=self.blob.file_modified or self.blob.modified,
        )
        etag = compute_etag(row)
        response = self._get(f"/dav/Home/{self.folder_name}/data.bin", headers={"If-None-Match": etag})
        self.assertEqual(response.status_code, 304)

    def test_head_reports_length(self):
        response = self._get(f"/dav/Home/{self.folder_name}/data.bin", method="HEAD")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Content-Length"], str(len(DATA)))
        self.assertEqual(response.headers["Content-Disposition"], "attachment; filename=data.bin")

    def test_collection_get_redirects_to_spa(self):
        response = self._get(f"/dav/Home/{self.folder_name}")
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers["Location"], f"/drive/d/{self.media.name}")

        response = self._get("/dav")
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers["Location"], "/drive")

        response = self._get(f"/dav/Home/{self.folder_name}", method="HEAD")
        self.assertEqual(response.status_code, 200)

    def test_missing_and_unreadable_are_404(self):
        with self.assertRaises(NotFoundError):
            self._get(f"/dav/Home/{self.folder_name}/absent.bin")
        home_name = frappe.db.get_value("File", self.home, "file_name")
        with self.assertRaises(NotFoundError):
            self._get(f"/dav/Everyone/{home_name}/{self.folder_name}/data.bin", user=STRANGER)

    def test_end_to_end_get_through_dispatcher(self):
        from suite.drive.webdav.tests.utils import enable_user_webdav

        frappe.db.set_single_value("Drive Disk Settings", "webdav_enabled", 1)
        frappe.clear_document_cache("Drive Disk Settings", "Drive Disk Settings")
        enable_user_webdav(OWNER)
        frappe.db.commit()
        try:
            response = dispatch(
                "GET", f"/dav/Home/{self.folder_name}/data.bin", user=OWNER, password=PASSWORD
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(self._body(response), DATA)

            response = dispatch(
                "PROPFIND",
                f"/dav/Home/{self.folder_name}",
                user=OWNER,
                password=PASSWORD,
                headers={"Depth": "1"},
            )
            self.assertEqual(response.status_code, 207)
            self.assertIn(b"data.bin", response.get_data())
        finally:
            frappe.db.set_single_value("Drive Disk Settings", "webdav_enabled", 0)
            frappe.clear_document_cache("Drive Disk Settings", "Drive Disk Settings")
            frappe.db.set_value("Drive Settings", OWNER, "webdav_enabled", 0, update_modified=False)
            frappe.db.commit()


class TestWebDAVPut(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user_with_password(OWNER, PASSWORD)
        ensure_user(STRANGER)
        with cls.set_user(OWNER):
            cls.home = get_user_folder(OWNER).name

    def setUp(self):
        frappe.set_user(OWNER)
        with self.set_user(OWNER):
            self.base_name = f"Put-{frappe.generate_hash(length=6)}"
            self.base = create_drive_file(
                self.base_name, self.home, "Folder", lambda f: FileManager().create_folder(f)
            )

    def tearDown(self):
        frappe.set_user("Administrator")
        super().tearDown()

    def _put(self, path: str, data: bytes, user: str = OWNER, headers: dict | None = None):
        from suite.drive.webdav import put as put_module

        return put_module.handle(
            make_ctx("PUT", path, user, data=data, content_type="application/octet-stream", headers=headers)
        )

    def _resolve(self, path: str, user: str = OWNER):
        from suite.drive.webdav import pathmap

        pathmap.reset_memo()
        return pathmap.resolve([segment for segment in path.split("/") if segment], user)

    def test_put_creates_file(self):
        body = b"fresh content here"
        response = self._put(f"/dav/Home/{self.base_name}/new.txt", body)
        self.assertEqual(response.status_code, 201)

        import hashlib

        expected_hash = hashlib.sha256(body).hexdigest()
        self.assertEqual(response.headers["ETag"], f'"sha256-{expected_hash[:32]}"')

        row = self._resolve(f"Home/{self.base_name}/new.txt").entity
        self.assertEqual(row.file_size, len(body))
        self.assertEqual(row.content_hash, expected_hash)
        self.assertEqual(row.mime_type, "text/plain")
        manager = FileManager()
        # the byte move rides on the commit the dispatcher issues before the
        # response leaves
        frappe.db.commit()
        self.assertEqual(manager.get_local_path(row.file_url).read_bytes(), body)
        # parent rollup grew
        self.assertEqual(frappe.db.get_value("File", self.base.name, "file_size"), len(body))

    def test_put_rolls_size_up_the_ancestor_chain(self):
        with self.set_user(OWNER):
            sub = create_drive_file(
                f"Sub-{frappe.generate_hash(length=6)}",
                self.base.name,
                "Folder",
                lambda f: FileManager().create_folder(f),
            )

        self._put(f"/dav/Home/{self.base_name}/{sub.file_name}/a.txt", b"12345")
        self.assertEqual(frappe.db.get_value("File", sub.name, "file_size"), 5)
        self.assertEqual(frappe.db.get_value("File", self.base.name, "file_size"), 5)

        # an overwrite rolls up the delta, shrinking included
        self._put(f"/dav/Home/{self.base_name}/{sub.file_name}/a.txt", b"123")
        self.assertEqual(frappe.db.get_value("File", sub.name, "file_size"), 3)
        self.assertEqual(frappe.db.get_value("File", self.base.name, "file_size"), 3)

    def test_put_unreadable_target_hidden_as_404(self):
        # the read-gate must run before preconditions/locks/the 405 collection
        # reply, so an unreadable resource is indistinguishable from an absent one
        from suite.drive.utils import get_root_folder

        with self.set_user(OWNER):
            secret = create_drive_file(
                f"put-secret-{frappe.generate_hash(length=6)}",
                get_root_folder().name,
                "Folder",
                lambda f: FileManager().create_folder(f),
            )
            write_file_fixture(secret.name, "hidden.txt", b"nope")
        frappe.get_doc(
            {"doctype": "Drive Permission", "entity": secret.name, "user": STRANGER, "deny": 1, "read": 1}
        ).insert(ignore_permissions=True)

        path = f"/dav/Everyone/{secret.file_name}/hidden.txt"
        # If-None-Match: * would be a 412 existence oracle on an existing resource
        with self.assertRaises(NotFoundError):
            self._put(path, b"x", user=STRANGER, headers={"If-None-Match": "*"})
        # a plain overwrite attempt is 404, not 403
        with self.assertRaises(NotFoundError):
            self._put(path, b"x", user=STRANGER)

    def test_put_out_of_range_mtime_is_ignored(self):
        # a wildly large X-OC-Mtime must not overflow datetime.fromtimestamp / 500
        response = self._put(
            f"/dav/Home/{self.base_name}/stamped.txt",
            b"data",
            headers={"X-OC-Mtime": "99999999999999999999"},
        )
        self.assertEqual(response.status_code, 201)

    def test_put_overwrites_in_place(self):
        with self.set_user(OWNER):
            target = write_file_fixture(self.base.name, "doc.txt", b"version-one")
        response = self._put(f"/dav/Home/{self.base_name}/doc.txt", b"v2!")
        self.assertEqual(response.status_code, 204)

        row = self._resolve(f"Home/{self.base_name}/doc.txt").entity
        # same entity, no auto-rename
        self.assertEqual(row.name, target.name)
        self.assertEqual(row.file_size, 3)
        manager = FileManager()
        # the byte swap rides on the commit the dispatcher issues before the
        # response leaves
        frappe.db.commit()
        self.assertEqual(manager.get_local_path(row.file_url).read_bytes(), b"v2!")
        # edit activity was logged
        self.assertTrue(
            frappe.db.exists("Drive Entity Activity Log", {"entity": target.name, "action_type": "edit"})
        )

    def test_put_succeeds_when_thumbnail_fails(self):
        # thumbnails are cosmetic: once the bytes and metadata are committed
        # and promoted, a thumbnail failure must not turn the PUT into a
        # client-visible error — the client would retry a finished save
        from unittest.mock import patch

        png = PIXEL_PNG
        response = self._put(f"/dav/Home/{self.base_name}/pixel.png", png)
        self.assertEqual(response.status_code, 201)
        row = self._resolve(f"Home/{self.base_name}/pixel.png").entity
        self.assertTrue(row.mime_type.startswith("image/"))

        with patch("frappe.enqueue", side_effect=RuntimeError):
            frappe.db.commit()  # must not raise — the save already succeeded

        self.assertEqual(FileManager().get_local_path(row.file_url).read_bytes(), png)
        self.assertTrue(frappe.db.exists("Error Log", {"method": "Drive: could not create WebDAV thumbnail"}))

    def test_put_succeeds_when_thumbnail_logging_fails_too(self):
        # by promotion time the write is complete — even the failure LOGGING
        # failing on top must not turn the committed PUT into a client-visible
        # error and provoke a retry of a finished save
        from unittest.mock import patch

        png = PIXEL_PNG
        response = self._put(f"/dav/Home/{self.base_name}/pixel2.png", png)
        self.assertEqual(response.status_code, 201)
        row = self._resolve(f"Home/{self.base_name}/pixel2.png").entity

        with (
            patch("frappe.enqueue", side_effect=RuntimeError),
            patch("frappe.log_error", side_effect=RuntimeError),
        ):
            frappe.db.commit()  # must not raise — the save already succeeded

        self.assertEqual(FileManager().get_local_path(row.file_url).read_bytes(), png)

    def test_put_rollup_failure_fails_the_put(self):
        # a suppressed rollup failure would commit ancestor sizes that no
        # reconciliation repairs — the PUT must fail so the whole transaction,
        # staged bytes included, rolls back for the client to retry
        from unittest.mock import patch

        from suite.drive.webdav import put as put_module

        with (
            patch.object(put_module, "apply_file_size_delta", side_effect=frappe.QueryTimeoutError),
            self.assertRaises(frappe.QueryTimeoutError),
        ):
            self._put(f"/dav/Home/{self.base_name}/rollup.txt", b"counted?")

        row = self._resolve(f"Home/{self.base_name}/rollup.txt").entity
        blob_path = FileManager().get_local_path(row.file_url)
        frappe.db.rollback()  # what dispatch does on any handler exception

        self.assertFalse(frappe.db.exists("File", row.name))
        self.assertFalse(blob_path.exists())
        self.assertEqual(pending_putparts(row.name), [])

    def test_put_create_rollback_leaves_no_orphan_blob(self):
        # the dispatcher commits only after the handler returns; if that
        # commit fails and degrades to a rollback, the staged bytes must be
        # discarded — nothing may sit at the final path outside quota
        response = self._put(f"/dav/Home/{self.base_name}/stranded.txt", b"stranded?")
        self.assertEqual(response.status_code, 201)
        row = self._resolve(f"Home/{self.base_name}/stranded.txt").entity
        blob_path = FileManager().get_local_path(row.file_url)
        frappe.db.rollback()

        self.assertFalse(blob_path.exists())
        self.assertEqual(pending_putparts(row.name), [])

    def test_put_create_failure_leaves_no_orphan_blob(self):
        # the blob move is irreversible while the File insert rolls back with
        # the transaction, so a DB failure after the move would strand an
        # unreferenced blob at its final path — the move must come last
        from unittest.mock import patch

        from suite.drive.webdav import put as put_module

        with (
            patch.object(put_module, "_bump_folder_size", side_effect=frappe.ValidationError),
            self.assertRaises(frappe.ValidationError),
        ):
            self._put(f"/dav/Home/{self.base_name}/orphan.txt", b"stranded?")

        row = self._resolve(f"Home/{self.base_name}/orphan.txt").entity
        self.assertFalse(FileManager().get_local_path(row.file_url).exists())

    def test_put_overwrite_promotion_failure_reverts_metadata(self):
        # if the commit-time promotion itself fails, the transaction is
        # already committed — compensation must step the metadata and rollup
        # back to match the unchanged bytes, and the failure must surface
        from unittest.mock import patch

        with self.set_user(OWNER):
            target = write_file_fixture(self.base.name, "doc.txt", b"version-one")
        blob_path = FileManager().get_local_path(target.file_url)
        base_size = frappe.db.get_value("File", self.base.name, "file_size")

        response = self._put(f"/dav/Home/{self.base_name}/doc.txt", b"v2!")
        self.assertEqual(response.status_code, 204)
        with patch("os.replace", side_effect=OSError), self.assertRaises(OSError):
            frappe.db.commit()

        self.assertEqual(blob_path.read_bytes(), b"version-one")
        self.assertEqual(frappe.db.get_value("File", target.name, "file_size"), len(b"version-one"))
        self.assertIsNone(frappe.db.get_value("File", target.name, "content_hash"))
        self.assertEqual(frappe.db.get_value("File", self.base.name, "file_size"), base_size)
        self.assertEqual(pending_putparts(target.name), [])
        # no history for an edit that never took effect
        self.assertFalse(
            frappe.db.exists("Drive Entity Activity Log", {"entity": target.name, "action_type": "edit"})
        )

    def test_put_create_promotion_failure_removes_row(self):
        # compensation for a failed create promotion: without bytes the row
        # must not exist, nor its share of the folder rollup
        from unittest.mock import patch

        response = self._put(f"/dav/Home/{self.base_name}/ghost.txt", b"boo")
        self.assertEqual(response.status_code, 201)
        row = self._resolve(f"Home/{self.base_name}/ghost.txt").entity
        blob_path = FileManager().get_local_path(row.file_url)
        with patch("os.replace", side_effect=OSError), self.assertRaises(OSError):
            frappe.db.commit()

        self.assertFalse(frappe.db.exists("File", row.name))
        self.assertEqual(frappe.db.get_value("File", self.base.name, "file_size"), 0)
        self.assertFalse(blob_path.exists())
        self.assertEqual(pending_putparts(row.name), [])

    def test_put_overwrite_compensation_yields_to_newer_write(self):
        # a writer that slips in between our commit and the failed promotion
        # computed its delta against our committed state — its metadata and
        # accounting already describe the disk truth, and stepping back to
        # our snapshot would clobber them
        from unittest.mock import patch

        with self.set_user(OWNER):
            target = write_file_fixture(self.base.name, "doc.txt", b"version-one")
        base_size = frappe.db.get_value("File", self.base.name, "file_size")

        response = self._put(f"/dav/Home/{self.base_name}/doc.txt", b"v2!")
        self.assertEqual(response.status_code, 204)

        def newer_write_then_fail(*args):
            # what a racing PUT leaves behind once it commits: a fresh stamp
            frappe.db.set_value("File", target.name, {"file_size": 7, "content_hash": "newer"})
            raise OSError

        with patch("os.replace", side_effect=newer_write_then_fail), self.assertRaises(OSError):
            frappe.db.commit()

        # the newer write survives untouched...
        self.assertEqual(frappe.db.get_value("File", target.name, "file_size"), 7)
        self.assertEqual(frappe.db.get_value("File", target.name, "content_hash"), "newer")
        # ...and so does our forward delta, which the newer writer built upon
        expected = (base_size or 0) + len(b"v2!") - len(b"version-one")
        self.assertEqual(frappe.db.get_value("File", self.base.name, "file_size"), expected)
        self.assertEqual(pending_putparts(target.name), [])
        # but the failed edit must not stay recorded as a successful one —
        # the audit row is ours alone, so yielding does not spare it
        self.assertFalse(
            frappe.db.exists("Drive Entity Activity Log", {"entity": target.name, "action_type": "edit"})
        )

    def test_put_create_compensation_yields_to_newer_write(self):
        # same yield rule on the create path: the row a racing writer now
        # owns must not be deleted out from under it
        from unittest.mock import patch

        response = self._put(f"/dav/Home/{self.base_name}/claimed.txt", b"boo")
        self.assertEqual(response.status_code, 201)
        row = self._resolve(f"Home/{self.base_name}/claimed.txt").entity

        def newer_write_then_fail(*args):
            frappe.db.set_value("File", row.name, {"content_hash": "newer"})
            raise OSError

        with patch("os.replace", side_effect=newer_write_then_fail), self.assertRaises(OSError):
            frappe.db.commit()

        self.assertTrue(frappe.db.exists("File", row.name))
        self.assertEqual(frappe.db.get_value("File", row.name, "content_hash"), "newer")
        # the create's rollup contribution stands — the newer write built on it
        self.assertEqual(frappe.db.get_value("File", self.base.name, "file_size"), len(b"boo"))

    DRIFT_LOG = "Drive: metadata left ahead of bytes after failed promotion"

    def test_put_compensation_parks_replayable_spec_when_queue_is_down(self):
        # with the database failing and the queue down too, the handoff must
        # not vanish: the recorded spec alone has to be enough to replay the
        # repair verbatim once services return
        import json
        from unittest.mock import patch

        from suite.drive.webdav import put as put_module

        # drain swaps a prior test may have left queued — they must not meet
        # this test's failure patches
        frappe.db.commit()
        with self.set_user(OWNER):
            target = write_file_fixture(self.base.name, "doc.txt", b"version-one")
        base_size = frappe.db.get_value("File", self.base.name, "file_size")

        response = self._put(f"/dav/Home/{self.base_name}/doc.txt", b"v2!")
        self.assertEqual(response.status_code, 204)

        with (
            patch("os.replace", side_effect=OSError),
            patch.object(put_module, "apply_file_size_delta", side_effect=frappe.QueryTimeoutError),
            patch("frappe.enqueue", side_effect=RuntimeError),
            self.assertRaises(OSError),
        ):
            frappe.db.commit()
        frappe.db.rollback()  # what dispatch does before answering the 500

        record = frappe.db.get_value(
            "Error Log", {"method": self.DRIFT_LOG, "reference_name": target.name}, "error"
        )
        spec = json.loads(record.splitlines()[-1])
        put_module.repair_promotion_drift(**spec)

        self.assertEqual(frappe.db.get_value("File", target.name, "file_size"), len(b"version-one"))
        self.assertEqual(frappe.db.get_value("File", self.base.name, "file_size"), base_size)
        self.assertFalse(
            frappe.db.exists("Drive Entity Activity Log", {"entity": target.name, "action_type": "edit"})
        )

    def test_put_compensation_survives_a_broken_file_log(self):
        # the file log sits on the very disk that may have failed the
        # promotion — a failure opening or writing it must not gate the
        # database record or the queued repair, which ride other services
        import contextlib
        import io
        from unittest.mock import patch

        from suite.drive.webdav import put as put_module

        # drain swaps a prior test may have left queued — they must not meet
        # this test's failure patches
        frappe.db.commit()
        with self.set_user(OWNER):
            target = write_file_fixture(self.base.name, "doc.txt", b"version-one")

        response = self._put(f"/dav/Home/{self.base_name}/doc.txt", b"v2!")
        self.assertEqual(response.status_code, 204)

        real_logger = frappe.logger

        def broken_drive_logger(name=None, *args, **kwargs):
            if name == "drive":
                raise RuntimeError
            return real_logger(name, *args, **kwargs)

        with (
            patch("os.replace", side_effect=OSError),
            patch.object(put_module, "apply_file_size_delta", side_effect=frappe.QueryTimeoutError),
            patch("frappe.logger", side_effect=broken_drive_logger),
            patch("frappe.enqueue") as enqueue_mock,
            # the stderr rung fires; keep it off the runner's console
            contextlib.redirect_stderr(io.StringIO()),
            self.assertRaises(OSError),
        ):
            frappe.db.commit()
        frappe.db.rollback()  # what dispatch does before answering the 500

        self.assertTrue(
            frappe.db.exists("Error Log", {"method": self.DRIFT_LOG, "reference_name": target.name})
        )
        self.assertEqual(enqueue_mock.call_args.args, (put_module.repair_promotion_drift,))

    def test_put_compensation_spares_an_identical_winner(self):
        # a racing PUT of the identical body looks like a metadata-only
        # writer to the row fingerprint — only the bytes settle it: they
        # deliver the stamped claim, so the restore must stand down
        import hashlib
        from unittest.mock import patch

        # drain swaps a prior test may have left queued — they must not meet
        # this test's failure patches
        frappe.db.commit()
        with self.set_user(OWNER):
            target = write_file_fixture(self.base.name, "doc.txt", b"version-one")
        blob_path = FileManager().get_local_path(target.file_url)
        base_size = frappe.db.get_value("File", self.base.name, "file_size")

        response = self._put(f"/dav/Home/{self.base_name}/doc.txt", b"v2!")
        self.assertEqual(response.status_code, 204)

        def identical_winner_then_fail(*args):
            # what the racing identical PUT leaves once it wins: the same
            # content claim under a newer clock, and the bytes delivered
            frappe.db.set_value(
                "File", target.name, "modified", frappe.utils.now_datetime(), update_modified=False
            )
            blob_path.write_bytes(b"v2!")
            raise OSError

        with patch("os.replace", side_effect=identical_winner_then_fail), self.assertRaises(OSError):
            frappe.db.commit()

        # the winner's write stands: claim, bytes and accounting untouched
        self.assertEqual(frappe.db.get_value("File", target.name, "file_size"), len(b"v2!"))
        self.assertEqual(
            frappe.db.get_value("File", target.name, "content_hash"), hashlib.sha256(b"v2!").hexdigest()
        )
        self.assertEqual(blob_path.read_bytes(), b"v2!")
        expected = (base_size or 0) + len(b"v2!") - len(b"version-one")
        self.assertEqual(frappe.db.get_value("File", self.base.name, "file_size"), expected)

    def test_put_compensation_spares_a_committed_but_unswapped_twin(self):
        # a twin-content PUT commits its stamp before its own swap installs
        # the bytes — the fingerprint carries and the target still holds old
        # bytes, but its staged .putpart proves the claim is pending: the
        # restore must stand down or the imminent install lands under stale
        # metadata with the rollup unbalanced
        import hashlib
        import os
        from unittest.mock import patch

        from suite.drive.webdav import put as put_module

        # drain swaps a prior test may have left queued — they must not meet
        # this test's failure patches
        frappe.db.commit()
        with self.set_user(OWNER):
            target = write_file_fixture(self.base.name, "doc.txt", b"version-one")
        blob_path = FileManager().get_local_path(target.file_url)
        base_size = frappe.db.get_value("File", self.base.name, "file_size")

        response = self._put(f"/dav/Home/{self.base_name}/doc.txt", b"v2!")
        self.assertEqual(response.status_code, 204)

        twin_staged = put_module._pending_swap_dir(FileManager()) / f"{target.name}.aaaabbbbcccc.putpart"

        def twin_committed_then_fail(*args):
            # what the twin leaves at our compensation's locked read: the
            # same content stamp under its own clock, bytes still staged
            frappe.db.set_value(
                "File", target.name, "modified", frappe.utils.now_datetime(), update_modified=False
            )
            twin_staged.parent.mkdir(exist_ok=True)
            twin_staged.write_bytes(b"v2!")
            raise OSError

        with patch("os.replace", side_effect=twin_committed_then_fail), self.assertRaises(OSError):
            frappe.db.commit()

        # no restore: claim, delta and the staged twin all stand
        expected_hash = hashlib.sha256(b"v2!").hexdigest()
        self.assertEqual(frappe.db.get_value("File", target.name, "content_hash"), expected_hash)
        self.assertEqual(frappe.db.get_value("File", target.name, "file_size"), len(b"v2!"))
        expected = (base_size or 0) + len(b"v2!") - len(b"version-one")
        self.assertEqual(frappe.db.get_value("File", self.base.name, "file_size"), expected)

        # the twin's swap then installs, and everything lines up
        os.replace(twin_staged, blob_path)
        self.assertEqual(blob_path.read_bytes(), b"v2!")

    def test_put_compensation_spares_a_twin_across_a_move(self):
        # the twin's staged bytes are keyed by row id, not by path: a MOVE
        # that rewrites file_url between the twin's commit and our
        # compensation must not hide the pending install — a probe beside
        # the row's current path would miss it, and the restore would land
        # stale metadata under the twin's imminent bytes
        import hashlib
        import os
        from unittest.mock import patch

        from suite.drive.webdav import put as put_module

        frappe.db.commit()  # drain stray after_commit swaps
        with self.set_user(OWNER):
            dest = create_drive_file(
                f"Dest-{frappe.generate_hash(length=6)}",
                self.home,
                "Folder",
                lambda f: FileManager().create_folder(f),
            )
            target = write_file_fixture(self.base.name, "doc.txt", b"version-one")
        manager = FileManager()
        blob_path = manager.get_local_path(target.file_url)
        moved_rel = Path(storage_key(frappe.db.get_value("File", dest.name, "file_url"))) / "doc.txt"
        moved_path = manager.site_folder / moved_rel

        response = self._put(f"/dav/Home/{self.base_name}/doc.txt", b"v2!")
        self.assertEqual(response.status_code, 204)

        twin_staged = put_module._pending_swap_dir(manager) / f"{target.name}.aaaabbbbcccc.putpart"

        def twin_commits_then_move_lands_then_fail(*args):
            # the twin's committed stamp and staged bytes, then a MOVE that
            # relocates the old blob and rewrites the pointer — the id-keyed
            # pending store is the only trace of the twin the row still has
            frappe.db.set_value(
                "File", target.name, "modified", frappe.utils.now_datetime(), update_modified=False
            )
            twin_staged.parent.mkdir(exist_ok=True)
            twin_staged.write_bytes(b"v2!")
            blob_path.rename(moved_path)
            frappe.db.set_value("File", target.name, {"file_url": "/" + str(moved_rel), "folder": dest.name})
            raise OSError

        with (
            patch("os.replace", side_effect=twin_commits_then_move_lands_then_fail),
            self.assertRaises(OSError),
        ):
            frappe.db.commit()

        # no restore: the pending twin was found by id at the moved row
        self.assertEqual(
            frappe.db.get_value("File", target.name, "content_hash"),
            hashlib.sha256(b"v2!").hexdigest(),
        )
        self.assertEqual(frappe.db.get_value("File", target.name, "file_size"), len(b"v2!"))

        # the twin's swap then follows the pointer and installs
        os.replace(twin_staged, moved_path)
        self.assertEqual(moved_path.read_bytes(), b"v2!")

    def test_put_compensation_survives_a_metadata_only_writer(self):
        # a rename that slips in bumps the row clock but carries our stale
        # content claim along — that is no reason to yield: the content
        # metadata must still step back while the rename and its newer clock
        # survive
        from unittest.mock import patch

        # drain swaps a prior test may have left queued — they must not meet
        # this test's failure patches
        frappe.db.commit()
        with self.set_user(OWNER):
            target = write_file_fixture(self.base.name, "doc.txt", b"version-one")
        base_size = frappe.db.get_value("File", self.base.name, "file_size")

        response = self._put(f"/dav/Home/{self.base_name}/doc.txt", b"v2!")
        self.assertEqual(response.status_code, 204)

        bumped = []

        def rename_then_fail(*args):
            frappe.db.set_value("File", target.name, "file_name", "renamed.txt")
            bumped.append(frappe.db.get_value("File", target.name, "modified"))
            raise OSError

        with patch("os.replace", side_effect=rename_then_fail), self.assertRaises(OSError):
            frappe.db.commit()

        # content claim and rollup reverted to match the unchanged bytes...
        self.assertEqual(frappe.db.get_value("File", target.name, "file_size"), len(b"version-one"))
        self.assertIsNone(frappe.db.get_value("File", target.name, "content_hash"))
        self.assertEqual(frappe.db.get_value("File", self.base.name, "file_size"), base_size)
        # ...while the rename and the clock it advanced survive
        self.assertEqual(frappe.db.get_value("File", target.name, "file_name"), "renamed.txt")
        self.assertEqual(frappe.db.get_value("File", target.name, "modified"), bumped[0])

    def test_put_compensation_follows_a_move(self):
        # a move that slips in carries our stale content claim (and its
        # rollup share) into another folder — the reversal must land where
        # the rollup went, not where the file used to be
        from unittest.mock import patch

        from suite.drive.utils import apply_file_size_delta

        # drain swaps a prior test may have left queued — they must not meet
        # this test's failure patches
        frappe.db.commit()
        with self.set_user(OWNER):
            sub = create_drive_file(
                f"Sub-{frappe.generate_hash(length=6)}",
                self.base.name,
                "Folder",
                lambda f: FileManager().create_folder(f),
            )
            target = write_file_fixture(self.base.name, "doc.txt", b"version-one")
        base_size = frappe.db.get_value("File", self.base.name, "file_size")

        response = self._put(f"/dav/Home/{self.base_name}/doc.txt", b"v2!")
        self.assertEqual(response.status_code, 204)

        def move_then_fail(*args):
            # what MOVE leaves behind: reparented row, rollup share carried
            size_now = frappe.db.get_value("File", target.name, "file_size")
            frappe.db.set_value("File", target.name, "folder", sub.name)
            apply_file_size_delta(self.base.name, -size_now)
            apply_file_size_delta(sub.name, size_now)
            raise OSError

        with patch("os.replace", side_effect=move_then_fail), self.assertRaises(OSError):
            frappe.db.commit()

        self.assertEqual(frappe.db.get_value("File", target.name, "folder"), sub.name)
        self.assertEqual(frappe.db.get_value("File", target.name, "file_size"), len(b"version-one"))
        self.assertEqual(frappe.db.get_value("File", sub.name, "file_size"), len(b"version-one"))
        self.assertEqual(frappe.db.get_value("File", self.base.name, "file_size"), base_size)

    def test_put_create_compensation_cleans_linked_records(self):
        # the row comes off through the controller, so records another
        # request linked to it in the window go with it — a raw row delete
        # would orphan them beyond any future cleanup's reach
        from unittest.mock import patch

        # drain swaps a prior test may have left queued — they must not meet
        # this test's failure patches
        frappe.db.commit()
        response = self._put(f"/dav/Home/{self.base_name}/linked.txt", b"boo")
        self.assertEqual(response.status_code, 201)
        row = self._resolve(f"Home/{self.base_name}/linked.txt").entity

        def link_then_fail(*args):
            frappe.get_doc(
                {"doctype": "Drive Permission", "entity": row.name, "user": STRANGER, "read": 1}
            ).insert(ignore_permissions=True)
            raise OSError

        with patch("os.replace", side_effect=link_then_fail), self.assertRaises(OSError):
            frappe.db.commit()

        self.assertFalse(frappe.db.exists("File", row.name))
        self.assertFalse(frappe.db.exists("Drive Permission", {"entity": row.name}))
        self.assertEqual(frappe.db.get_value("File", self.base.name, "file_size"), 0)

    def test_put_compensation_balances_a_move_across_sibling_folders(self):
        # the stamped delta the PUT left on the source chain and the stamped
        # size the move subtracted from it telescope to exactly the true
        # bytes leaving; the reversal belongs only where the move added the
        # stamped size — the destination — and both ledgers must land exact
        from unittest.mock import patch

        from suite.drive.utils import apply_file_size_delta

        # drain swaps a prior test may have left queued — they must not meet
        # this test's failure patches
        frappe.db.commit()
        with self.set_user(OWNER):
            dest = create_drive_file(
                f"Dest-{frappe.generate_hash(length=6)}",
                self.home,
                "Folder",
                lambda f: FileManager().create_folder(f),
            )
            target = write_file_fixture(self.base.name, "doc.txt", b"version-one")
        base_size = frappe.db.get_value("File", self.base.name, "file_size")

        response = self._put(f"/dav/Home/{self.base_name}/doc.txt", b"v2!")
        self.assertEqual(response.status_code, 204)

        def move_then_fail(*args):
            size_now = frappe.db.get_value("File", target.name, "file_size")
            frappe.db.set_value("File", target.name, "folder", dest.name)
            apply_file_size_delta(self.base.name, -size_now)
            apply_file_size_delta(dest.name, size_now)
            raise OSError

        with patch("os.replace", side_effect=move_then_fail), self.assertRaises(OSError):
            frappe.db.commit()

        self.assertEqual(frappe.db.get_value("File", target.name, "file_size"), len(b"version-one"))
        # source: the true bytes left, nothing more, nothing less
        expected_source = (base_size or 0) - len(b"version-one")
        self.assertEqual(frappe.db.get_value("File", self.base.name, "file_size"), expected_source)
        # destination: the true bytes arrived
        self.assertEqual(frappe.db.get_value("File", dest.name, "file_size"), len(b"version-one"))

    def test_put_overwrite_charges_the_folder_the_row_sits_in(self):
        # the resolve-time parent spans the whole body spool — a move that
        # commits in that window must not receive the size delta; it belongs
        # to the folder the locked row actually sits in at commit
        from unittest.mock import patch

        from suite.drive.utils import apply_file_size_delta
        from suite.drive.webdav import put as put_module

        with self.set_user(OWNER):
            dest = create_drive_file(
                f"Dest-{frappe.generate_hash(length=6)}",
                self.home,
                "Folder",
                lambda f: FileManager().create_folder(f),
            )
            target = write_file_fixture(self.base.name, "doc.txt", b"version-one")
        base_size = frappe.db.get_value("File", self.base.name, "file_size")

        real_lock = put_module.acquire_owner_storage_lock

        def move_then_lock(owner):
            # a move landing between path resolution and the row lock
            size_now = frappe.db.get_value("File", target.name, "file_size")
            frappe.db.set_value("File", target.name, "folder", dest.name)
            apply_file_size_delta(self.base.name, -size_now)
            apply_file_size_delta(dest.name, size_now)
            return real_lock(owner)

        with patch.object(put_module, "acquire_owner_storage_lock", side_effect=move_then_lock):
            response = self._put(f"/dav/Home/{self.base_name}/doc.txt", b"v2!")
        self.assertEqual(response.status_code, 204)
        frappe.db.commit()

        # the delta landed where the file lives now, not where it was resolved
        self.assertEqual(frappe.db.get_value("File", dest.name, "file_size"), len(b"v2!"))
        expected_source = (base_size or 0) - len(b"version-one")
        self.assertEqual(frappe.db.get_value("File", self.base.name, "file_size"), expected_source)

    def test_put_compensation_after_trash_skips_settled_accounting(self):
        # trashing subtracted the stamped size from the chain, which already
        # telescoped the stamped delta away — reversing it again would
        # double-subtract; only the content metadata still needs stepping
        # back, so a later restore-from-trash re-adds the true size
        from unittest.mock import patch

        from suite.drive.utils import STATUS_TRASHED, apply_file_size_delta

        # drain swaps a prior test may have left queued — they must not meet
        # this test's failure patches
        frappe.db.commit()
        with self.set_user(OWNER):
            target = write_file_fixture(self.base.name, "doc.txt", b"version-one")
        base_size = frappe.db.get_value("File", self.base.name, "file_size")

        response = self._put(f"/dav/Home/{self.base_name}/doc.txt", b"v2!")
        self.assertEqual(response.status_code, 204)

        def trash_then_fail(*args):
            # what toggle_entity_status leaves once it trashes the row
            size_now = frappe.db.get_value("File", target.name, "file_size")
            frappe.db.set_value(
                "File",
                target.name,
                {"status": STATUS_TRASHED, "file_modified": frappe.utils.now_datetime()},
            )
            apply_file_size_delta(self.base.name, -size_now)
            raise OSError

        with patch("os.replace", side_effect=trash_then_fail), self.assertRaises(OSError):
            frappe.db.commit()

        # content claim stepped back, so a restore-from-trash is consistent
        self.assertEqual(frappe.db.get_value("File", target.name, "file_size"), len(b"version-one"))
        self.assertIsNone(frappe.db.get_value("File", target.name, "content_hash"))
        self.assertEqual(frappe.db.get_value("File", target.name, "status"), STATUS_TRASHED)
        # chain reflects exactly the true bytes leaving for the trash
        expected = (base_size or 0) - len(b"version-one")
        self.assertEqual(frappe.db.get_value("File", self.base.name, "file_size"), expected)

    def test_put_compensation_survives_a_touch(self):
        # a writer that only advances file_modified (a PROPPATCH timestamp
        # write) carries our stale content claim like any metadata writer —
        # the content fingerprint must not yield over a moved clock
        from unittest.mock import patch

        # drain swaps a prior test may have left queued — they must not meet
        # this test's failure patches
        frappe.db.commit()
        with self.set_user(OWNER):
            target = write_file_fixture(self.base.name, "doc.txt", b"version-one")
        base_size = frappe.db.get_value("File", self.base.name, "file_size")

        response = self._put(f"/dav/Home/{self.base_name}/doc.txt", b"v2!")
        self.assertEqual(response.status_code, 204)

        def touch_then_fail(*args):
            frappe.db.set_value("File", target.name, "file_modified", frappe.utils.now_datetime())
            raise OSError

        with patch("os.replace", side_effect=touch_then_fail), self.assertRaises(OSError):
            frappe.db.commit()

        self.assertEqual(frappe.db.get_value("File", target.name, "file_size"), len(b"version-one"))
        self.assertIsNone(frappe.db.get_value("File", target.name, "content_hash"))
        self.assertEqual(frappe.db.get_value("File", self.base.name, "file_size"), base_size)

    def test_put_swap_follows_a_move_committed_in_the_gap(self):
        # a move landing between the commit and the swap has already carried
        # the old bytes to the new path and rewritten file_url — the replace
        # must follow the committed row there, not recreate the abandoned
        # path as an orphan while the moved file serves old bytes
        from suite.drive.utils import apply_file_size_delta

        with self.set_user(OWNER):
            dest = create_drive_file(
                f"Dest-{frappe.generate_hash(length=6)}",
                self.home,
                "Folder",
                lambda f: FileManager().create_folder(f),
            )
            target = write_file_fixture(self.base.name, "doc.txt", b"version-one")
        manager = FileManager()
        old_path = manager.get_local_path(target.file_url)

        response = self._put(f"/dav/Home/{self.base_name}/doc.txt", b"v2!")
        self.assertEqual(response.status_code, 204)

        # what a committed MOVE leaves in the gap: blob carried, row rewritten
        new_rel = Path(storage_key(frappe.db.get_value("File", dest.name, "file_url"))) / "doc.txt"
        new_path = manager.site_folder / new_rel
        old_path.rename(new_path)
        size_now = frappe.db.get_value("File", target.name, "file_size")
        frappe.db.set_value("File", target.name, {"file_url": "/" + str(new_rel), "folder": dest.name})
        apply_file_size_delta(self.base.name, -size_now)
        apply_file_size_delta(dest.name, size_now)

        frappe.db.commit()  # runs the swap

        self.assertEqual(new_path.read_bytes(), b"v2!")
        self.assertFalse(old_path.exists())
        self.assertEqual(pending_putparts(target.name), [])

    def test_put_swap_waits_out_a_mid_flight_move(self):
        # a mover renames the blob away BEFORE it takes the row lock — the
        # missing overwrite target is that signature, and the swap must wait
        # for the mover's commit and then follow it, not recreate the
        # abandoned path while old bytes land under the new metadata
        from unittest.mock import patch

        from suite.drive.utils import apply_file_size_delta

        with self.set_user(OWNER):
            dest = create_drive_file(
                f"Dest-{frappe.generate_hash(length=6)}",
                self.home,
                "Folder",
                lambda f: FileManager().create_folder(f),
            )
            target = write_file_fixture(self.base.name, "doc.txt", b"version-one")
        manager = FileManager()
        old_path = manager.get_local_path(target.file_url)
        new_rel = Path(storage_key(frappe.db.get_value("File", dest.name, "file_url"))) / "doc.txt"
        new_path = manager.site_folder / new_rel

        response = self._put(f"/dav/Home/{self.base_name}/doc.txt", b"v2!")
        self.assertEqual(response.status_code, 204)

        # the mover's disk transfer has happened; its row write has not
        old_path.rename(new_path)

        def mover_commits(_seconds):
            size_now = frappe.db.get_value("File", target.name, "file_size")
            frappe.db.set_value("File", target.name, {"file_url": "/" + str(new_rel), "folder": dest.name})
            apply_file_size_delta(self.base.name, -size_now)
            apply_file_size_delta(dest.name, size_now)

        with patch("time.sleep", side_effect=mover_commits) as waited:
            frappe.db.commit()  # runs the swap

        self.assertEqual(waited.call_count, 1)
        self.assertEqual(new_path.read_bytes(), b"v2!")
        self.assertFalse(old_path.exists())
        self.assertEqual(pending_putparts(target.name), [])

    def test_put_swap_still_heals_a_missing_blob(self):
        # a genuinely lost blob shows the same missing-target signature; the
        # bounded wait must fall through and let the overwrite recreate it
        from unittest.mock import patch

        with self.set_user(OWNER):
            target = write_file_fixture(self.base.name, "doc.txt", b"version-one")
        blob_path = FileManager().get_local_path(target.file_url)

        response = self._put(f"/dav/Home/{self.base_name}/doc.txt", b"v2!")
        self.assertEqual(response.status_code, 204)

        blob_path.unlink()  # the blob is simply gone; nobody is mid-flight

        with patch("time.sleep") as waited, patch("frappe.enqueue") as queued:
            frappe.db.commit()  # runs the swap

        self.assertEqual(waited.call_count, 3)
        self.assertEqual(blob_path.read_bytes(), b"v2!")
        self.assertEqual(pending_putparts(target.name), [])
        # the timed-out wait hands a settlement check to a worker — a peer
        # stalled beyond the wait would surface exactly here
        self.assertEqual(queued.call_count, 1)

    def test_put_swap_settlement_finishes_a_delayed_move(self):
        # a mover stalled past the in-request waits commits eventually; the
        # queued settlement must then finish the follow — new bytes onto the
        # row's real location, orphan removed
        from unittest.mock import patch

        from suite.drive.utils import apply_file_size_delta
        from suite.drive.webdav import put as put_module

        with self.set_user(OWNER):
            dest = create_drive_file(
                f"Dest-{frappe.generate_hash(length=6)}",
                self.home,
                "Folder",
                lambda f: FileManager().create_folder(f),
            )
            target = write_file_fixture(self.base.name, "doc.txt", b"version-one")
        manager = FileManager()
        old_path = manager.get_local_path(target.file_url)
        new_rel = Path(storage_key(frappe.db.get_value("File", dest.name, "file_url"))) / "doc.txt"
        new_path = manager.site_folder / new_rel

        response = self._put(f"/dav/Home/{self.base_name}/doc.txt", b"v2!")
        self.assertEqual(response.status_code, 204)

        # the mover's disk transfer has happened; its row write stalls past
        # every in-request wait
        old_path.rename(new_path)
        with patch("time.sleep"), patch("frappe.enqueue") as queued:
            frappe.db.commit()  # swap times out and heals at the old path
        self.assertEqual(old_path.read_bytes(), b"v2!")
        self.assertEqual(queued.call_args.args, (put_module.settle_swap_destination,))

        # now the stalled mover finally commits
        size_now = frappe.db.get_value("File", target.name, "file_size")
        frappe.db.set_value("File", target.name, {"file_url": "/" + str(new_rel), "folder": dest.name})
        apply_file_size_delta(self.base.name, -size_now)
        apply_file_size_delta(dest.name, size_now)

        spec = {key: value for key, value in queued.call_args.kwargs.items() if key != "queue"}
        with patch("time.sleep"):
            put_module.settle_swap_destination(**spec)

        self.assertEqual(new_path.read_bytes(), b"v2!")
        self.assertFalse(old_path.exists())

    def test_put_swap_settlement_leaves_a_healed_blob_alone(self):
        # when the blob was simply missing, the pointer never moves — the
        # settlement checks drain quietly and the healed bytes stand
        from unittest.mock import patch

        from suite.drive.webdav import put as put_module

        with self.set_user(OWNER):
            target = write_file_fixture(self.base.name, "doc.txt", b"version-one")
        blob_path = FileManager().get_local_path(target.file_url)

        response = self._put(f"/dav/Home/{self.base_name}/doc.txt", b"v2!")
        self.assertEqual(response.status_code, 204)
        blob_path.unlink()
        with patch("time.sleep"), patch("frappe.enqueue") as queued:
            frappe.db.commit()

        spec = {key: value for key, value in queued.call_args.kwargs.items() if key != "queue"}
        with patch("time.sleep") as slept:
            put_module.settle_swap_destination(**spec)

        self.assertEqual(slept.call_count, 5)
        self.assertEqual(blob_path.read_bytes(), b"v2!")

    def test_put_swap_settlement_follows_a_second_relocation(self):
        # a further move can empty the destination between the settlement's
        # locked read and its replace (disk transfers are not lock-gated) —
        # the settlement must re-verify after placing and follow, or it
        # recreates a stale path and strands the bytes all over again
        import os
        from unittest.mock import patch

        from suite.drive.utils import apply_file_size_delta
        from suite.drive.webdav import put as put_module

        with self.set_user(OWNER):
            dest1 = create_drive_file(
                f"Dest1-{frappe.generate_hash(length=6)}",
                self.home,
                "Folder",
                lambda f: FileManager().create_folder(f),
            )
            dest2 = create_drive_file(
                f"Dest2-{frappe.generate_hash(length=6)}",
                self.home,
                "Folder",
                lambda f: FileManager().create_folder(f),
            )
            target = write_file_fixture(self.base.name, "doc.txt", b"version-one")
        manager = FileManager()
        old_path = manager.get_local_path(target.file_url)
        rel1 = Path(storage_key(frappe.db.get_value("File", dest1.name, "file_url"))) / "doc.txt"
        rel2 = Path(storage_key(frappe.db.get_value("File", dest2.name, "file_url"))) / "doc.txt"
        path1 = manager.site_folder / rel1
        path2 = manager.site_folder / rel2

        response = self._put(f"/dav/Home/{self.base_name}/doc.txt", b"v2!")
        self.assertEqual(response.status_code, 204)
        old_path.rename(path1)  # the stalled first mover's disk transfer
        with patch("time.sleep"), patch("frappe.enqueue") as queued:
            frappe.db.commit()  # times out, heals at the old path, queues

        # mover one commits; mover two has already carried the blob onward
        # but its row write is still pending — it lands mid-settlement
        size_now = frappe.db.get_value("File", target.name, "file_size")
        frappe.db.set_value("File", target.name, {"file_url": "/" + str(rel1), "folder": dest1.name})
        apply_file_size_delta(self.base.name, -size_now)
        apply_file_size_delta(dest1.name, size_now)
        path1.rename(path2)  # mover two's disk transfer

        real_replace = os.replace
        landed = []

        def replace_then_mover_two_commits(src, dst):
            real_replace(src, dst)
            if not landed:
                landed.append(True)
                frappe.db.set_value("File", target.name, {"file_url": "/" + str(rel2), "folder": dest2.name})
                apply_file_size_delta(dest1.name, -size_now)
                apply_file_size_delta(dest2.name, size_now)

        spec = {key: value for key, value in queued.call_args.kwargs.items() if key != "queue"}
        with patch("time.sleep"), patch("os.replace", side_effect=replace_then_mover_two_commits):
            put_module.settle_swap_destination(**spec)

        self.assertEqual(path2.read_bytes(), b"v2!")  # followed to the final home
        self.assertFalse(path1.exists())  # no stale path recreated
        self.assertFalse(old_path.exists())

    def test_put_swap_settlement_chains_past_an_exhausted_budget(self):
        # when relocations outlast one job's budget, the final replace must
        # not be the last word — the remainder chains to a fresh job whose
        # first locked read is the missing verification
        import hashlib
        import itertools
        import os
        from unittest.mock import patch

        from suite.drive.webdav import put as put_module

        # drain swaps a prior test may have left queued — the job commits
        # internally and must not fire them under this test's patches
        frappe.db.commit()
        with self.set_user(OWNER):
            dest1 = create_drive_file(
                f"Dest1-{frappe.generate_hash(length=6)}",
                self.home,
                "Folder",
                lambda f: FileManager().create_folder(f),
            )
            dest2 = create_drive_file(
                f"Dest2-{frappe.generate_hash(length=6)}",
                self.home,
                "Folder",
                lambda f: FileManager().create_folder(f),
            )
            target = write_file_fixture(self.base.name, "doc.txt", b"version-one")
        manager = FileManager()
        old_path = manager.get_local_path(target.file_url)
        rel_a = Path(storage_key(frappe.db.get_value("File", dest1.name, "file_url"))) / "doc.txt"
        rel_b = Path(storage_key(frappe.db.get_value("File", dest2.name, "file_url"))) / "doc.txt"
        path_a = manager.site_folder / rel_a
        path_b = manager.site_folder / rel_b

        # synthetic drift: row stamped with the new content, our healed bytes
        # at the old path, pointer at A where a mover carried the stale blob
        new_hash = hashlib.sha256(b"v2!").hexdigest()
        frappe.db.set_value(
            "File", target.name, {"content_hash": new_hash, "file_size": 3, "file_url": "/" + str(rel_a)}
        )
        old_path.write_bytes(b"v2!")
        path_a.write_bytes(b"version-one")
        stamp = {"content_hash": new_hash, "file_size": 3}

        real_replace = os.replace
        churn = itertools.cycle([(rel_b, path_b), (rel_a, path_a)])

        def relocate_after_each_replace(src, dst):
            real_replace(src, dst)
            rel, path = next(churn)
            frappe.db.set_value("File", target.name, "file_url", "/" + str(rel))
            path.write_bytes(b"version-one")

        with (
            patch.object(put_module, "_SETTLE_DELAYS", ()),
            patch("os.replace", side_effect=relocate_after_each_replace),
            patch("frappe.enqueue") as chained,
            patch("time.sleep"),
        ):
            put_module.settle_swap_destination(target.name, stamp, str(old_path))

        kwargs = chained.call_args.kwargs
        self.assertEqual(kwargs["hops"], 1)

        # the churn stops; the chained hop verifies and finishes the follow
        with patch("time.sleep"):
            put_module.settle_swap_destination(
                kwargs["file"], kwargs["stamp"], kwargs["placed"], hops=kwargs["hops"]
            )
        final = manager.get_local_path(frappe.db.get_value("File", target.name, "file_url"))
        self.assertEqual(final.read_bytes(), b"v2!")
        self.assertFalse(Path(kwargs["placed"]).exists())

    def _settlement_churn_scaffold(self):
        """Synthetic drift state shared by the churn tests: row stamped with
        v2 content, healed bytes at the old path, pointer at A with a stale
        planted blob."""
        import hashlib

        with self.set_user(OWNER):
            dest1 = create_drive_file(
                f"Dest1-{frappe.generate_hash(length=6)}",
                self.home,
                "Folder",
                lambda f: FileManager().create_folder(f),
            )
            dest2 = create_drive_file(
                f"Dest2-{frappe.generate_hash(length=6)}",
                self.home,
                "Folder",
                lambda f: FileManager().create_folder(f),
            )
            target = write_file_fixture(self.base.name, "doc.txt", b"version-one")
        manager = FileManager()
        old_path = manager.get_local_path(target.file_url)
        rel_a = Path(storage_key(frappe.db.get_value("File", dest1.name, "file_url"))) / "doc.txt"
        rel_b = Path(storage_key(frappe.db.get_value("File", dest2.name, "file_url"))) / "doc.txt"
        path_a = manager.site_folder / rel_a
        path_b = manager.site_folder / rel_b
        new_hash = hashlib.sha256(b"v2!").hexdigest()
        frappe.db.set_value(
            "File", target.name, {"content_hash": new_hash, "file_size": 3, "file_url": "/" + str(rel_a)}
        )
        old_path.write_bytes(b"v2!")
        path_a.write_bytes(b"version-one")
        stamp = {"content_hash": new_hash, "file_size": 3}
        return target, stamp, old_path, (rel_a, path_a), (rel_b, path_b)

    def test_put_swap_settlement_continues_inline_when_queue_is_down(self):
        # exhausting the budget with the queue unavailable must not abandon
        # the verification — the database is alive on that path, so the
        # chase continues inline under the same hop cap
        import itertools
        import os
        from unittest.mock import patch

        from suite.drive.webdav import put as put_module

        frappe.db.commit()  # drain stray after_commit swaps
        target, stamp, old_path, (rel_a, path_a), (rel_b, path_b) = self._settlement_churn_scaffold()

        real_replace = os.replace
        churn = itertools.cycle([(rel_b, path_b), (rel_a, path_a)])
        ticks = []

        def churn_three_times(src, dst):
            real_replace(src, dst)
            if len(ticks) < 3:
                ticks.append(True)
                rel, path = next(churn)
                frappe.db.set_value("File", target.name, "file_url", "/" + str(rel))
                path.write_bytes(b"version-one")

        with (
            patch.object(put_module, "_SETTLE_DELAYS", ()),
            patch("os.replace", side_effect=churn_three_times),
            patch("frappe.enqueue", side_effect=RuntimeError) as chained,
            patch("time.sleep"),
        ):
            put_module.settle_swap_destination(target.name, stamp, str(old_path))

        self.assertEqual(chained.call_count, 1)
        final = FileManager().get_local_path(frappe.db.get_value("File", target.name, "file_url"))
        self.assertEqual(final.read_bytes(), b"v2!")

    def test_put_swap_settlement_records_terminal_churn(self):
        # churn that survives every hop with the queue down ends in a
        # committed Error Log record, not just a log line — the database is
        # alive on that path
        import itertools
        import os
        from unittest.mock import patch

        from suite.drive.webdav import put as put_module

        frappe.db.commit()  # drain stray after_commit swaps
        target, stamp, old_path, (rel_a, path_a), (rel_b, path_b) = self._settlement_churn_scaffold()

        real_replace = os.replace
        churn = itertools.cycle([(rel_b, path_b), (rel_a, path_a)])

        def endless_churn(src, dst):
            real_replace(src, dst)
            rel, path = next(churn)
            frappe.db.set_value("File", target.name, "file_url", "/" + str(rel))
            path.write_bytes(b"version-one")

        with (
            patch.object(put_module, "_SETTLE_DELAYS", ()),
            patch("os.replace", side_effect=endless_churn),
            patch("frappe.enqueue", side_effect=RuntimeError),
            patch("time.sleep"),
        ):
            put_module.settle_swap_destination(target.name, stamp, str(old_path))

        self.assertTrue(
            frappe.db.exists(
                "Error Log",
                {"method": "Drive: swap settlement exhausted mid-churn", "reference_name": target.name},
            )
        )

    def test_put_swap_settlement_verifies_before_recording_terminal_churn(self):
        # churn that stops exactly at the last hop's final replace has in
        # fact settled — the terminal lane's closing locked read must see
        # that and exit quietly instead of recording a false drift alarm
        import itertools
        import os
        from unittest.mock import patch

        from suite.drive.webdav import put as put_module

        frappe.db.commit()  # drain stray after_commit swaps
        target, stamp, old_path, (rel_a, path_a), (rel_b, path_b) = self._settlement_churn_scaffold()

        real_replace = os.replace
        churn = itertools.cycle([(rel_b, path_b), (rel_a, path_a)])
        ticks = []

        # cap 2 + empty delays = three 3-iteration hops: eight ticks keep
        # every read one step behind, and the ninth replace goes unanswered
        def churn_until_the_final_replace(src, dst):
            real_replace(src, dst)
            if len(ticks) < 8:
                ticks.append(True)
                rel, path = next(churn)
                frappe.db.set_value("File", target.name, "file_url", "/" + str(rel))
                path.write_bytes(b"version-one")

        with (
            patch.object(put_module, "_SETTLE_DELAYS", ()),
            patch.object(put_module, "_SETTLE_HOPS", 2),
            patch("os.replace", side_effect=churn_until_the_final_replace),
            patch("frappe.enqueue", side_effect=RuntimeError) as chained,
            patch("time.sleep"),
        ):
            put_module.settle_swap_destination(target.name, stamp, str(old_path))

        self.assertEqual(chained.call_count, 2)  # one per pre-cap hop
        self.assertFalse(
            frappe.db.exists(
                "Error Log",
                {"method": "Drive: swap settlement exhausted mid-churn", "reference_name": target.name},
            )
        )
        final = FileManager().get_local_path(frappe.db.get_value("File", target.name, "file_url"))
        self.assertEqual(final.read_bytes(), b"v2!")

    def test_put_swap_settlement_yields_to_a_newer_put(self):
        # a newer PUT that landed (and moved on) before the worker gets
        # there owns the row — the settlement must not replace its bytes,
        # and reaps only a copy that provably still delivers our stamp
        from unittest.mock import patch

        from suite.drive.utils import apply_file_size_delta
        from suite.drive.webdav import put as put_module

        with self.set_user(OWNER):
            dest = create_drive_file(
                f"Dest-{frappe.generate_hash(length=6)}",
                self.home,
                "Folder",
                lambda f: FileManager().create_folder(f),
            )
            target = write_file_fixture(self.base.name, "doc.txt", b"version-one")
        manager = FileManager()
        old_path = manager.get_local_path(target.file_url)
        new_rel = Path(storage_key(frappe.db.get_value("File", dest.name, "file_url"))) / "doc.txt"
        new_path = manager.site_folder / new_rel

        response = self._put(f"/dav/Home/{self.base_name}/doc.txt", b"v2!")
        self.assertEqual(response.status_code, 204)
        old_path.rename(new_path)  # the stalled mover's disk transfer
        with patch("time.sleep"), patch("frappe.enqueue") as queued:
            frappe.db.commit()  # times out, heals at the old path, queues

        # the mover commits, and then a newer PUT overwrites at the new home
        size_now = frappe.db.get_value("File", target.name, "file_size")
        frappe.db.set_value("File", target.name, {"file_url": "/" + str(new_rel), "folder": dest.name})
        apply_file_size_delta(self.base.name, -size_now)
        apply_file_size_delta(dest.name, size_now)
        newest = b"NEWEST!"
        new_path.write_bytes(newest)
        frappe.db.set_value("File", target.name, {"content_hash": "newer-hash", "file_size": len(newest)})

        spec = {key: value for key, value in queued.call_args.kwargs.items() if key != "queue"}
        with patch("time.sleep"):
            put_module.settle_swap_destination(**spec)

        self.assertEqual(new_path.read_bytes(), newest)  # the newer write stands
        self.assertFalse(old_path.exists())  # our superseded copy was reaped

    def test_put_swap_stands_down_for_a_row_trashed_in_the_gap(self):
        # a trash in the gap carried the bytes off — recreating the path
        # would orphan a blob nothing references, and a later restore-from-
        # trash would clobber it; the claim steps back instead
        from suite.drive.utils import STATUS_TRASHED, apply_file_size_delta

        with self.set_user(OWNER):
            target = write_file_fixture(self.base.name, "doc.txt", b"version-one")
        blob_path = FileManager().get_local_path(target.file_url)
        base_size = frappe.db.get_value("File", self.base.name, "file_size")

        response = self._put(f"/dav/Home/{self.base_name}/doc.txt", b"v2!")
        self.assertEqual(response.status_code, 204)

        # what toggle_entity_status leaves in the gap: blob off to the
        # trash, row flagged, chain settled with the stamped size
        trashed_blob = blob_path.with_name(blob_path.name + ".intrash")
        blob_path.rename(trashed_blob)
        size_now = frappe.db.get_value("File", target.name, "file_size")
        frappe.db.set_value(
            "File",
            target.name,
            {"status": STATUS_TRASHED, "file_modified": frappe.utils.now_datetime()},
        )
        apply_file_size_delta(self.base.name, -size_now)

        frappe.db.commit()  # must not raise — the swap stands down quietly

        self.assertFalse(blob_path.exists())  # no orphan recreated
        self.assertEqual(trashed_blob.read_bytes(), b"version-one")
        # the claim stepped back to match the trashed bytes; the chain keeps
        # the trash flow's own settlement
        self.assertEqual(frappe.db.get_value("File", target.name, "file_size"), len(b"version-one"))
        self.assertIsNone(frappe.db.get_value("File", target.name, "content_hash"))
        self.assertEqual(
            frappe.db.get_value("File", self.base.name, "file_size"),
            (base_size or 0) - len(b"version-one"),
        )
        self.assertEqual(pending_putparts(target.name), [])
        trashed_blob.unlink()

    def test_put_swap_spares_bytes_a_trash_carried_off(self):
        # the other trash interleaving: the swap places the new bytes and
        # releases the row lock, then trash slips in and carries those bytes
        # into the trash store before the next pass. The edit took effect —
        # the compensation's trash-aware delivery check must leave the stamp
        # standing, or a later restore-from-trash serves the new content
        # under the old size, hash and accounting
        import hashlib
        import os
        from unittest.mock import patch

        from suite.drive.utils import STATUS_TRASHED, apply_file_size_delta

        frappe.db.commit()  # drain stray after_commit swaps
        with self.set_user(OWNER):
            target = write_file_fixture(self.base.name, "doc.txt", b"version-one")
        manager = FileManager()
        blob_path = manager.get_local_path(target.file_url)
        trash_blob = manager.site_folder / manager.get_trash_path(target)
        base_size = frappe.db.get_value("File", self.base.name, "file_size")

        response = self._put(f"/dav/Home/{self.base_name}/doc.txt", b"v2!")
        self.assertEqual(response.status_code, 204)

        real_replace = os.replace
        interleaved = []

        def trash_after_the_placement(src, dst):
            real_replace(src, dst)
            if interleaved:
                return
            interleaved.append(True)
            # what toggle_entity_status does once it wins the released lock:
            # the blob — now the new bytes — off to the trash, row flagged,
            # chain settled with the committed stamped size
            size_now = frappe.db.get_value("File", target.name, "file_size")
            trash_blob.parent.mkdir(exist_ok=True)
            Path(dst).rename(trash_blob)
            frappe.db.set_value(
                "File",
                target.name,
                {"status": STATUS_TRASHED, "file_modified": frappe.utils.now_datetime()},
            )
            apply_file_size_delta(self.base.name, -size_now)

        with patch("os.replace", side_effect=trash_after_the_placement):
            frappe.db.commit()  # fires the swap; the trash interleaves

        self.assertEqual(trash_blob.read_bytes(), b"v2!")  # trash carried the new bytes
        # the stamp stands: the claimed content is delivered, in the trash store
        self.assertEqual(
            frappe.db.get_value("File", target.name, "content_hash"),
            hashlib.sha256(b"v2!").hexdigest(),
        )
        self.assertEqual(frappe.db.get_value("File", target.name, "file_size"), 3)
        self.assertEqual(
            frappe.db.get_value("File", self.base.name, "file_size"),
            (base_size or 0) - len(b"version-one"),
        )
        # restore-from-trash round-trips: the new bytes under the new metadata
        manager.restore(frappe._dict(name=target.name, file_url=target.file_url))
        self.assertEqual(blob_path.read_bytes(), b"v2!")
        self.assertFalse(trash_blob.exists())

    def test_put_compensation_spec_reaches_stderr_when_all_else_fails(self):
        # logging, database persistence and queueing all down at once: the
        # replayable spec must still leave the process — stderr is an
        # already-open descriptor that shares fate with none of them
        import contextlib
        import io
        import json
        from unittest.mock import patch

        from suite.drive.webdav import put as put_module

        # drain swaps a prior test may have left queued — they must not meet
        # this test's failure patches
        frappe.db.commit()
        with self.set_user(OWNER):
            target = write_file_fixture(self.base.name, "doc.txt", b"version-one")

        response = self._put(f"/dav/Home/{self.base_name}/doc.txt", b"v2!")
        self.assertEqual(response.status_code, 204)

        real_logger = frappe.logger

        def broken_drive_logger(name=None, *args, **kwargs):
            if name == "drive":
                raise RuntimeError
            return real_logger(name, *args, **kwargs)

        err = io.StringIO()
        with (
            patch("os.replace", side_effect=OSError),
            patch.object(put_module, "apply_file_size_delta", side_effect=frappe.QueryTimeoutError),
            patch("frappe.logger", side_effect=broken_drive_logger),
            patch("frappe.log_error", side_effect=RuntimeError),
            patch("frappe.enqueue", side_effect=RuntimeError),
            contextlib.redirect_stderr(err),
            self.assertRaises(OSError),
        ):
            frappe.db.commit()

        output = err.getvalue()
        self.assertIn(target.name, output)
        spec_lines = [line for line in output.splitlines() if line.startswith("{")]
        spec = json.loads(spec_lines[0])
        self.assertEqual(spec["file"], target.name)  # replayable verbatim

    def test_put_compensation_retries_on_a_fresh_transaction(self):
        # a deadlock victim or lock timeout fails once and survives a retry —
        # the compensation must not give up (and record drift) on first blood
        from unittest.mock import patch

        from suite.drive.webdav import put as put_module

        # drain swaps a prior test may have left queued — they must not meet
        # this test's failure patches
        frappe.db.commit()
        with self.set_user(OWNER):
            target = write_file_fixture(self.base.name, "doc.txt", b"version-one")
        base_size = frappe.db.get_value("File", self.base.name, "file_size")

        response = self._put(f"/dav/Home/{self.base_name}/doc.txt", b"v2!")
        self.assertEqual(response.status_code, 204)

        real_delta = put_module.apply_file_size_delta
        calls = []

        def flaky_delta(*args):
            calls.append(args)
            if len(calls) == 1:
                raise frappe.QueryTimeoutError
            return real_delta(*args)

        with (
            patch("os.replace", side_effect=OSError),
            patch.object(put_module, "apply_file_size_delta", side_effect=flaky_delta),
            self.assertRaises(OSError),
        ):
            frappe.db.commit()

        # second attempt landed: metadata and rollup reverted, no drift recorded
        self.assertEqual(len(calls), 2)
        self.assertEqual(frappe.db.get_value("File", target.name, "file_size"), len(b"version-one"))
        self.assertEqual(frappe.db.get_value("File", self.base.name, "file_size"), base_size)
        self.assertFalse(
            frappe.db.exists("Error Log", {"method": self.DRIFT_LOG, "reference_name": target.name})
        )

    def test_put_compensation_double_failure_leaves_durable_trace(self):
        # when the compensation fails twice, the drift record must survive the
        # rollback the dispatcher issues after the 500 — an uncommitted Error
        # Log row would vanish with it, leaving the inconsistency invisible
        from unittest.mock import patch

        from suite.drive.webdav import put as put_module

        # drain swaps a prior test may have left queued — they must not meet
        # this test's failure patches
        frappe.db.commit()
        with self.set_user(OWNER):
            target = write_file_fixture(self.base.name, "doc.txt", b"version-one")
        base_size = frappe.db.get_value("File", self.base.name, "file_size")

        response = self._put(f"/dav/Home/{self.base_name}/doc.txt", b"v2!")
        self.assertEqual(response.status_code, 204)

        with (
            patch("os.replace", side_effect=OSError),
            patch.object(put_module, "apply_file_size_delta", side_effect=frappe.QueryTimeoutError),
            patch("frappe.enqueue") as enqueue_mock,
            self.assertRaises(OSError),
        ):
            frappe.db.commit()
        frappe.db.rollback()  # what dispatch does before answering the 500

        self.assertTrue(
            frappe.db.exists("Error Log", {"method": self.DRIFT_LOG, "reference_name": target.name})
        )

        # the compensation was handed to a worker; run it as the worker would
        self.assertEqual(enqueue_mock.call_args.args, (put_module.repair_promotion_drift,))
        spec = {key: value for key, value in enqueue_mock.call_args.kwargs.items() if key != "queue"}
        put_module.repair_promotion_drift(**spec)

        self.assertEqual(frappe.db.get_value("File", target.name, "file_size"), len(b"version-one"))
        self.assertIsNone(frappe.db.get_value("File", target.name, "content_hash"))
        self.assertEqual(frappe.db.get_value("File", self.base.name, "file_size"), base_size)
        self.assertFalse(
            frappe.db.exists("Drive Entity Activity Log", {"entity": target.name, "action_type": "edit"})
        )
        # a repeat run finds the stamp gone and changes nothing
        put_module.repair_promotion_drift(**spec)
        self.assertEqual(frappe.db.get_value("File", target.name, "file_size"), len(b"version-one"))
        self.assertEqual(frappe.db.get_value("File", self.base.name, "file_size"), base_size)

    def test_put_overwrite_commit_failure_keeps_old_bytes(self):
        # the dispatcher commits only after the handler returns; if that
        # commit fails and degrades to a rollback, the staged bytes must be
        # discarded and the target must never have changed
        with self.set_user(OWNER):
            target = write_file_fixture(self.base.name, "doc.txt", b"version-one")
        blob_path = FileManager().get_local_path(target.file_url)

        response = self._put(f"/dav/Home/{self.base_name}/doc.txt", b"v2!")
        self.assertEqual(response.status_code, 204)
        frappe.db.rollback()

        self.assertEqual(blob_path.read_bytes(), b"version-one")
        self.assertEqual(pending_putparts(target.name), [])

    def test_put_overwrite_failure_leaves_old_bytes(self):
        # the blob swap is irreversible while every DB write rolls back with the
        # transaction, so a failure after the swap would leave new bytes served
        # under the old size/hash/mtime — the swap must come last
        from unittest.mock import patch

        from suite.drive.webdav import put as put_module

        with self.set_user(OWNER):
            target = write_file_fixture(self.base.name, "doc.txt", b"version-one")
        blob_path = FileManager().get_local_path(target.file_url)

        with (
            patch.object(put_module, "_bump_folder_size", side_effect=frappe.ValidationError),
            self.assertRaises(frappe.ValidationError),
        ):
            self._put(f"/dav/Home/{self.base_name}/doc.txt", b"v2!")

        self.assertEqual(blob_path.read_bytes(), b"version-one")

    def test_put_overwrite_by_collaborator_keeps_owner(self):
        from suite.drive.utils import get_root_folder

        with self.set_user("Administrator"):
            shared_folder = create_drive_file(
                f"put-shared-{frappe.generate_hash(length=6)}",
                get_root_folder().name,
                "Folder",
                lambda f: FileManager().create_folder(f),
                owner=OWNER,
            )
        with self.set_user(OWNER):
            target = write_file_fixture(shared_folder.name, "shared.txt", b"mine")
        frappe.get_doc(
            {
                "doctype": "Drive Permission",
                "entity": target.name,
                "user": STRANGER,
                "read": 1,
                "write": 1,
            }
        ).insert(ignore_permissions=True)

        response = self._put(f"/dav/Everyone/{shared_folder.file_name}/shared.txt", b"theirs!", user=STRANGER)
        self.assertEqual(response.status_code, 204)
        # content replaced, but ownership (and quota accounting) stays put
        self.assertEqual(frappe.db.get_value("File", target.name, "owner"), OWNER)
        self.assertEqual(frappe.db.get_value("File", target.name, "file_size"), len(b"theirs!"))

    def test_put_statuses(self):
        from suite.drive.webdav.errors import BadRequest, Conflict, Forbidden, MethodNotAllowed

        with self.assertRaises(Conflict):  # missing intermediate
            self._put(f"/dav/Home/{self.base_name}/nowhere/x.txt", b"x")
        with self.assertRaises(MethodNotAllowed):  # target is a collection
            self._put(f"/dav/Home/{self.base_name}", b"x")
        with self.assertRaises(MethodNotAllowed):  # mount
            self._put("/dav/Home", b"x")
        with self.assertRaises(Conflict):  # trailing slash on a new resource
            self._put(f"/dav/Home/{self.base_name}/dir-ish/", b"x")
        with self.assertRaises(BadRequest):  # partial PUT
            self._put(f"/dav/Home/{self.base_name}/x.txt", b"x", headers={"Content-Range": "bytes 0-0/5"})
        from suite.drive.utils import get_root_folder

        with self.set_user("Administrator"):
            foreign = create_drive_file(
                f"put-ro-{frappe.generate_hash(length=6)}",
                get_root_folder().name,
                "Folder",
                lambda f: FileManager().create_folder(f),
                owner=OWNER,
            )
        with self.assertRaises(Forbidden):  # $GENERAL read on Everyone grants no upload
            self._put(f"/dav/Everyone/{foreign.file_name}/x.txt", b"x", user=STRANGER)
        with self.assertRaises(Forbidden):  # the shared root itself: read-only, as in Drive
            self._put("/dav/Everyone/intruder.txt", b"x")

    def test_put_conditionals(self):
        from suite.drive.webdav.errors import PreconditionFailed

        with self.set_user(OWNER):
            write_file_fixture(self.base.name, "locked.txt", b"held")
        with self.assertRaises(PreconditionFailed):
            self._put(f"/dav/Home/{self.base_name}/locked.txt", b"no", headers={"If-None-Match": "*"})
        with self.assertRaises(PreconditionFailed):
            self._put(f"/dav/Home/{self.base_name}/locked.txt", b"no", headers={"If-Match": '"wrong"'})

    def test_put_honors_client_mtime(self):
        response = self._put(
            f"/dav/Home/{self.base_name}/dated.txt", b"x", headers={"X-OC-Mtime": "1700000000"}
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.headers["X-OC-Mtime"], "accepted")

        from datetime import UTC, datetime

        from suite.drive.webdav.properties import to_site_naive

        row = self._resolve(f"Home/{self.base_name}/dated.txt").entity
        stored = frappe.db.get_value("File", row.name, "file_modified")
        # the UTC epoch stored in the site zone, not the OS zone
        self.assertEqual(
            frappe.utils.get_datetime(stored), to_site_naive(datetime.fromtimestamp(1700000000, tz=UTC))
        )

    def test_put_empty_body(self):
        response = self._put(f"/dav/Home/{self.base_name}/empty.bin", b"")
        self.assertEqual(response.status_code, 201)
        row = self._resolve(f"Home/{self.base_name}/empty.bin").entity
        self.assertEqual(row.file_size, 0)

    def test_put_quota_is_507_and_cleans_scratch(self):
        from suite.drive.api.files import get_upload_path
        from suite.drive.webdav.errors import InsufficientStorage

        frappe.db.set_value("Drive Settings", OWNER, "quota", 1, update_modified=False)
        try:
            with self.assertRaises(InsufficientStorage):
                self._put(f"/dav/Home/{self.base_name}/big.bin", b"z" * (2 * 1024 * 1024))
        finally:
            frappe.db.set_value("Drive Settings", OWNER, "quota", 0, update_modified=False)

        uploads_dir = get_upload_path("probe").parent
        leftovers = [p for p in uploads_dir.glob("webdav_*")]
        self.assertEqual(leftovers, [])

    def test_put_after_delete_creates_new_entity(self):
        from suite.drive.webdav import structure

        with self.set_user(OWNER):
            original = write_file_fixture(self.base.name, "cycle.txt", b"one")
        structure.handle_delete(make_ctx("DELETE", f"/dav/Home/{self.base_name}/cycle.txt", OWNER))

        response = self._put(f"/dav/Home/{self.base_name}/cycle.txt", b"two")
        self.assertEqual(response.status_code, 201)
        row = self._resolve(f"Home/{self.base_name}/cycle.txt").entity
        self.assertNotEqual(row.name, original.name)


class _FakeS3Conn:
    """In-memory stand-in for the boto3 client — enough surface for the PUT
    staging flow, with a call log to assert what never happened."""

    def __init__(self):
        self.objects: dict[str, bytes] = {}
        self.calls: list[tuple] = []

    def upload_file(self, path, bucket, key):
        self.calls.append(("upload_file", key))
        self.objects[key] = Path(path).read_bytes()

    def copy(self, source, bucket, key):
        self.calls.append(("copy", source["Key"], key))
        self.objects[key] = self.objects[source["Key"]]

    def delete_object(self, Bucket, Key):
        self.calls.append(("delete_object", Key))
        self.objects.pop(Key, None)


class TestWebDAVPutS3(IntegrationTestCase):
    """PUT against S3-backed rows, boto client faked in memory.

    The invariant under test: the commit that publishes the new metadata must
    also publish the key holding the new bytes. Promoting bytes into a fixed
    key after commit exposed the previous object under the new size/ETag/mtime
    for the whole S3 copy (and, on create, a 404 until the copy finished).
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user_with_password(OWNER, PASSWORD)
        with cls.set_user(OWNER):
            cls.home = get_user_folder(OWNER).name

    def setUp(self):
        frappe.set_user(OWNER)
        with self.set_user(OWNER):
            self.base_name = f"PutS3-{frappe.generate_hash(length=6)}"
            self.base = create_drive_file(
                self.base_name, self.home, "Folder", lambda f: FileManager().create_folder(f)
            )
        self.conn = _FakeS3Conn()
        self.manager = FileManager()
        self.manager.s3_enabled = True
        self.manager.bucket = "test-bucket"
        self.manager.conn = self.conn

    def tearDown(self):
        frappe.set_user("Administrator")
        super().tearDown()

    def _put(self, path: str, data: bytes):
        from suite.drive.webdav import put as put_module

        ctx = make_ctx("PUT", path, OWNER, data=data, content_type="application/octet-stream")
        ctx.__dict__["manager"] = self.manager
        return put_module.handle(ctx)

    def _resolve(self, path: str):
        from suite.drive.webdav import pathmap

        pathmap.reset_memo()
        return pathmap.resolve([segment for segment in path.split("/") if segment], OWNER)

    def _s3_fixture(self, name: str, data: bytes):
        """An S3-native Drive file: a committed row whose file_url names a
        bare bucket key holding the bytes."""
        with self.set_user(OWNER):
            target = write_file_fixture(self.base.name, name, data)
        key = f"s3-fixture-{frappe.generate_hash(length=8)}/{name}"
        frappe.db.set_value("File", target.name, "file_url", get_s3_url(key), update_modified=False)
        # committed, so a mid-test rollback discards only the PUT under test
        frappe.db.commit()
        self.conn.objects[key] = data
        return target, key

    def _stored_key(self, entity: str) -> str:
        return storage_key(frappe.db.get_value("File", entity, "file_url"))

    def _calls(self, kind: str) -> list[tuple]:
        return [call for call in self.conn.calls if call[0] == kind]

    def test_overwrite_publishes_generation_with_the_commit(self):
        target, old_key = self._s3_fixture("doc.txt", b"version-one")

        response = self._put(f"/dav/Home/{self.base_name}/doc.txt", b"v2!")
        self.assertEqual(response.status_code, 204)

        # pointer and metadata ride the same commit: the uncommitted row
        # already names the generation key the bytes were fully uploaded to
        new_key = self._stored_key(target.name)
        self.assertNotEqual(new_key, old_key)
        self.assertTrue(new_key.endswith(".putgen"))
        self.assertEqual(self.conn.objects[new_key], b"v2!")
        # no post-commit promotion copy — its window served the previous
        # bytes under the committed metadata
        self.assertEqual(self._calls("copy"), [])
        # the old object stays intact while the old row is the visible one
        self.assertEqual(self.conn.objects[old_key], b"version-one")

        frappe.db.commit()
        # the replaced object is garbage once the new row is public
        self.assertNotIn(old_key, self.conn.objects)
        self.assertEqual(self.conn.objects[new_key], b"v2!")

    def test_overwrite_rollback_reaps_generation_and_keeps_target(self):
        target, old_key = self._s3_fixture("doc.txt", b"version-one")

        response = self._put(f"/dav/Home/{self.base_name}/doc.txt", b"v2!")
        self.assertEqual(response.status_code, 204)
        frappe.db.rollback()

        self.assertEqual(self.conn.objects[old_key], b"version-one")
        self.assertEqual([key for key in self.conn.objects if key.endswith(".putgen")], [])
        self.assertEqual(self._stored_key(target.name), old_key)

    def test_overwrite_survives_reap_and_logging_failure(self):
        # the reap of the replaced object and even the logging of its failure
        # run after the overwrite succeeded — neither may fail the response
        from unittest.mock import patch

        target, old_key = self._s3_fixture("doc.txt", b"version-one")

        response = self._put(f"/dav/Home/{self.base_name}/doc.txt", b"v2!")
        self.assertEqual(response.status_code, 204)

        def broken_delete(**kwargs):
            raise RuntimeError

        self.conn.delete_object = broken_delete
        with patch("frappe.log_error", side_effect=RuntimeError):
            frappe.db.commit()  # must not raise — the overwrite already succeeded

        new_key = self._stored_key(target.name)
        self.assertEqual(self.conn.objects[new_key], b"v2!")
        # the replaced object leaks (recorded, not fatal)
        self.assertIn(old_key, self.conn.objects)

    def test_repeated_overwrites_do_not_stack_suffixes(self):
        target, _ = self._s3_fixture("doc.txt", b"v1")

        self._put(f"/dav/Home/{self.base_name}/doc.txt", b"v2")
        frappe.db.commit()
        first = self._stored_key(target.name)

        self._put(f"/dav/Home/{self.base_name}/doc.txt", b"v3")
        frappe.db.commit()
        second = self._stored_key(target.name)

        self.assertNotEqual(second, first)
        self.assertEqual(second.count(".putgen"), 1)
        self.assertNotIn(first, self.conn.objects)  # the prior generation was reaped
        self.assertEqual(self.conn.objects[second], b"v3")

    def test_create_uploads_to_the_published_key_before_commit(self):
        response = self._put(f"/dav/Home/{self.base_name}/new.txt", b"fresh")
        self.assertEqual(response.status_code, 201)

        row = self._resolve(f"Home/{self.base_name}/new.txt").entity
        key = storage_key(row.file_url)
        self.assertTrue(key.endswith(".putgen"))
        # a GET the instant after commit finds the bytes at the key the row
        # names (the copy design 404'd until the promotion finished)
        self.assertEqual(self.conn.objects[key], b"fresh")
        self.assertEqual(self._calls("copy"), [])

        frappe.db.commit()
        self.assertEqual(self._calls("delete_object"), [])  # nothing replaced, nothing reaped

    def test_thumbnail_prep_failure_reaps_generation(self):
        # the rollback reaper must be armed the moment the object exists: a
        # failure between the upload and the commit (here the thumbnail
        # source rename) otherwise strands an unreferenced object forever
        from unittest.mock import patch

        with patch("os.rename", side_effect=OSError), self.assertRaises(OSError):
            self._put(f"/dav/Home/{self.base_name}/pixel.png", PIXEL_PNG)

        frappe.db.rollback()  # what dispatch does on any handler exception
        self.assertEqual([key for key in self.conn.objects if key.endswith(".putgen")], [])

    def test_create_rollback_reaps_generation(self):
        response = self._put(f"/dav/Home/{self.base_name}/ghost.txt", b"boo")
        self.assertEqual(response.status_code, 201)
        row = self._resolve(f"Home/{self.base_name}/ghost.txt").entity
        key = storage_key(row.file_url)

        frappe.db.rollback()
        self.assertNotIn(key, self.conn.objects)
