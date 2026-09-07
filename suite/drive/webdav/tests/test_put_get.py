"""GET/HEAD and PUT against the caller's own Personal Root.

GET authorizes the node with one point check and then hands the bytes to the
framework's stream-read (§12.3, §13.5). Range, `If-None-Match`, 304, and 416
all belong to that path, against the same strong ETag PROPFIND publishes.

PUT spools the body once into `frappe.storage.blob.put_blob` and then creates
or replaces the head through `_core.nodes` (§12.3). The blob owns its own
rollback, so a failed PUT has no staging copy to promote, no generation key to
reap, and no compensation of its own to replay.
"""

import io
from datetime import UTC, datetime
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from suite.drive._core import activity
from suite.drive._core import nodes as node_core
from suite.drive._core import quota as quota_core
from suite.drive._core.access import grant
from suite.drive._core.errors import DriveConflict, DriveForbidden, DriveNotFound
from suite.drive._core.nodes import EMPTY_BLOB_CHECKSUM
from suite.drive._core.roles import NONE, READ
from suite.drive.tests.fixtures import nodes_in_root
from suite.drive.webdav import context, put
from suite.drive.webdav import get as get_module
from suite.drive.webdav.errors import (
    BadRequest,
    Conflict,
    InsufficientStorage,
    MethodNotAllowed,
    NotFoundError,
    PayloadTooLarge,
    PreconditionFailed,
)
from suite.drive.webdav.properties import compute_etag, to_site_naive
from suite.drive.webdav.tests.utils import (
    dispatch,
    drop_dav_root,
    drop_nodes,
    enable_user_webdav,
    ensure_user_with_password,
    file_node,
    folder_node,
    make_ctx,
    node_principals,
    personal_dav_root,
    raw_child_node,
    raw_document_node,
    reset_dav_request,
)

OWNER = "webdav-content-owner@example.com"
STRANGER = "webdav-content-stranger@example.com"
PASSWORD = "webdav-content-pw"

DATA = b"0123456789abcdefghij"
PIXEL_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082"
)


class _RemoteDriver:
    """A driver with no `get_path`, so `stream_blob` takes its non-local path.

    The bench's own driver is local, and §13.5's ranged read for a remote one is
    a different branch: `send_file` never runs, and the 206/416 are built from
    `read_range` instead. Without this the S3 shape of the byte path would only
    ever be exercised in production.
    """

    name = "remote"

    def __init__(self, payload: bytes):
        self.payload = payload
        self.ranges: list[tuple[int, int]] = []

    def download_url(self, key, filename, ttl, is_private=False):
        return None  # no native redirect unless the site opts in

    def read(self, key, is_private=False):
        return io.BytesIO(self.payload)

    def read_range(self, key, start, end, is_private=False):
        self.ranges.append((start, end))
        return io.BytesIO(self.payload[start : end + 1])


class TestWebDAVContent(IntegrationTestCase):
    """GET/HEAD against the caller's own Personal Root."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user_with_password(OWNER, PASSWORD)
        ensure_user_with_password(STRANGER, PASSWORD)
        cls.root = personal_dav_root(OWNER)
        personal_dav_root(STRANGER)
        cls.folder_name = f"Media-{frappe.generate_hash(length=6)}"
        cls.folder = folder_node(OWNER, cls.root, cls.folder_name)
        cls.blob_file = file_node(OWNER, cls.folder, "data.bin", DATA)
        cls.pixel = file_node(OWNER, cls.folder, "pixel.png", PIXEL_PNG)
        # the dispatcher commits mid-request, so the fixtures have to be
        # durable and are dropped explicitly rather than rolled back
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.set_user("Administrator")
        drop_dav_root(OWNER)
        frappe.db.commit()
        super().tearDownClass()

    def tearDown(self):
        frappe.set_user("Administrator")
        reset_dav_request()
        super().tearDown()

    def _get(self, path: str, user: str = OWNER, method: str = "GET", headers: dict | None = None):
        return get_module.handle(make_ctx(method, path, user, headers=headers))

    @staticmethod
    def _body(response) -> bytes:
        if response.direct_passthrough:
            return b"".join(response.response)
        return response.get_data()

    def test_get_streams_content_with_the_blob_checksum_as_etag(self):
        response = self._get(f"/dav/{self.folder_name}/data.bin")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._body(response), DATA)
        self.assertEqual(response.headers["Accept-Ranges"], "bytes")
        # §12.4: the same strong validator PROPFIND publishes
        self.assertEqual(response.headers["ETag"], f'"{self.blob_file.checksum}"')
        self.assertEqual(response.headers["ETag"], compute_etag(frappe._dict(blob=self.blob_file.blob)))
        self.assertTrue(response.headers["Last-Modified"].endswith(" GMT"))
        # user bytes must come back inert for browsers; DAV clients ignore all three
        self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(response.headers["Content-Security-Policy"], "sandbox")
        self.assertEqual(response.headers["Content-Disposition"], "attachment; filename=data.bin")
        self.assertEqual(response.headers["Cache-Control"], "private, no-cache")

    def test_content_type_is_the_blob_type(self):
        response = self._get(f"/dav/{self.folder_name}/pixel.png")
        self.assertEqual(response.headers["Content-Type"], "image/png")
        self.assertEqual(self._body(response), PIXEL_PNG)

    def test_range_request_yields_206(self):
        response = self._get(f"/dav/{self.folder_name}/data.bin", headers={"Range": "bytes=0-4"})
        self.assertEqual(response.status_code, 206)
        self.assertEqual(self._body(response), DATA[:5])
        self.assertIn("bytes 0-4/", response.headers["Content-Range"])

    def test_if_none_match_yields_304(self):
        response = self._get(
            f"/dav/{self.folder_name}/data.bin",
            headers={"If-None-Match": f'"{self.blob_file.checksum}"'},
        )
        self.assertEqual(response.status_code, 304)

    def test_head_reports_length(self):
        response = self._get(f"/dav/{self.folder_name}/data.bin", method="HEAD")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Content-Length"], str(len(DATA)))
        self.assertEqual(response.headers["Content-Disposition"], "attachment; filename=data.bin")

    def test_a_non_local_driver_serves_ranges_from_read_range(self):
        """§13.5: no `get_path`, so the 206 is built from the driver's read."""
        driver = _RemoteDriver(DATA)
        with patch("frappe.storage.serve.get_driver", return_value=driver):
            response = self._get(f"/dav/{self.folder_name}/data.bin", headers={"Range": "bytes=5-9"})
            self.assertEqual(response.status_code, 206)
            self.assertEqual(self._body(response), DATA[5:10])
            self.assertEqual(response.headers["Content-Range"], f"bytes 5-9/{len(DATA)}")
            self.assertEqual(response.headers["ETag"], f'"{self.blob_file.checksum}"')
            self.assertEqual(driver.ranges, [(5, 9)])

            whole = self._get(f"/dav/{self.folder_name}/data.bin")
            self.assertEqual(whole.status_code, 200)
            self.assertEqual(self._body(whole), DATA)

    def test_a_non_local_driver_refuses_an_unsatisfiable_range(self):
        driver = _RemoteDriver(DATA)
        with patch("frappe.storage.serve.get_driver", return_value=driver):
            response = self._get(
                f"/dav/{self.folder_name}/data.bin", headers={"Range": f"bytes={len(DATA) + 10}-"}
            )
        self.assertEqual(response.status_code, 416)
        self.assertEqual(response.headers["Content-Range"], f"bytes */{len(DATA)}")
        self.assertEqual(driver.ranges, [])

    def test_an_empty_head_is_a_file_not_a_conflict(self):
        """§8.5: a file node with no blob answers 200 with no body, and its
        validator is the checksum of zero bytes."""
        empty = raw_child_node(self.folder, "empty.txt", kind="file")
        try:
            response = self._get(f"/dav/{self.folder_name}/empty.txt")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(self._body(response), b"")
            self.assertEqual(response.headers["ETag"], f'"{EMPTY_BLOB_CHECKSUM}"')
        finally:
            drop_nodes([empty])

    def test_collection_get_redirects_to_the_drive_ui(self):
        response = self._get(f"/dav/{self.folder_name}")
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers["Location"], f"/drive/d/{self.folder}")

        # the mount is the Personal Root itself, so it lands on the root view
        response = self._get("/dav")
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers["Location"], "/drive")

        response = self._get(f"/dav/{self.folder_name}", method="HEAD")
        self.assertEqual(response.status_code, 200)

    def test_missing_paths_are_404(self):
        with self.assertRaises(NotFoundError):
            self._get(f"/dav/{self.folder_name}/absent.bin")
        # there is no mount of anybody else's root, so this tree is simply not
        # in the stranger's namespace
        with self.assertRaises(NotFoundError):
            self._get(f"/dav/{self.folder_name}/data.bin", user=STRANGER)

    def test_an_unreadable_node_is_404_not_403(self):
        """§12.1: a node below READ answers 404, never 403.

        The mount is the caller's own Personal Root, and §11.2 refuses a deny
        that names that root's own user inside it. The deny therefore names
        `$GENERAL`, which the caller carries as well: nearest depth beats
        identity tier (§5.1), so the node answers NONE while the folder above
        it stays readable and the mount is unchanged.
        """
        hidden = file_node(OWNER, self.folder, "hidden.bin", b"secret")
        try:
            grant(hidden.name, "$GENERAL", NONE, node_principals(OWNER))
            # `require` refuses below READ with the engine's own not-found,
            # which `errors.map_exception` turns into 404 (§12.1)
            with self.assertRaises(DriveNotFound):
                self._get(f"/dav/{self.folder_name}/hidden.bin")
        finally:
            drop_nodes([hidden.name])

    def test_a_hidden_document_and_its_media_cannot_be_downloaded(self):
        """§12.2: the document segment 404s before the walk reaches the media."""
        document = raw_document_node(self.folder, "Deck")
        media = file_node(OWNER, document, "slide-1.png", PIXEL_PNG)
        try:
            with self.assertRaises(NotFoundError):
                self._get(f"/dav/{self.folder_name}/Deck")
            with self.assertRaises(NotFoundError):
                self._get(f"/dav/{self.folder_name}/Deck/slide-1.png")
        finally:
            drop_nodes([media.name, document])

    def test_an_uploaded_office_file_downloads(self):
        docx = file_node(OWNER, self.folder, "report.docx", b"PK\x03\x04 not really a docx")
        try:
            response = self._get(f"/dav/{self.folder_name}/report.docx")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(self._body(response), docx.data)
            self.assertEqual(response.headers["Content-Disposition"], "attachment; filename=report.docx")
        finally:
            drop_nodes([docx.name])

    def test_end_to_end_get_through_dispatcher(self):
        frappe.db.set_single_value("Drive Disk Settings", "webdav_enabled", 1)
        frappe.clear_document_cache("Drive Disk Settings", "Drive Disk Settings")
        enable_user_webdav(OWNER)
        frappe.db.commit()
        try:
            response = dispatch("GET", f"/dav/{self.folder_name}/data.bin", user=OWNER, password=PASSWORD)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(self._body(response), DATA)

            response = dispatch(
                "PROPFIND",
                f"/dav/{self.folder_name}",
                user=OWNER,
                password=PASSWORD,
                headers={"Depth": "1"},
            )
            self.assertEqual(response.status_code, 207)
            self.assertIn(b"data.bin", response.get_data())

            # ticket 25 relinked the write verbs, so PUT now runs the whole
            # way through the dispatcher instead of being refused at the gate
            response = dispatch(
                "PUT", f"/dav/{self.folder_name}/new.txt", user=OWNER, password=PASSWORD, data=b"x"
            )
            self.assertEqual(response.status_code, 201)
            self.assertEqual(self._body(self._get(f"/dav/{self.folder_name}/new.txt")), b"x")
        finally:
            frappe.db.set_single_value("Drive Disk Settings", "webdav_enabled", 0)
            frappe.clear_document_cache("Drive Disk Settings", "Drive Disk Settings")
            frappe.db.set_value("Drive Settings", OWNER, "webdav_enabled", 0, update_modified=False)
            frappe.db.commit()


class TestWebDAVPut(IntegrationTestCase):
    """PUT into the caller's own Personal Root (§12.3).

    Every case here is about one claim: the bytes and the node commit or roll
    back together. `put_blob` stores the body once, dedupes it on its checksum,
    and arms its own rollback, so there is no staging copy to promote, no
    generation key to reap, and no compensation to replay.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user_with_password(OWNER, PASSWORD)
        ensure_user_with_password(STRANGER, PASSWORD)
        cls.root = personal_dav_root(OWNER)
        personal_dav_root(STRANGER)
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.set_user("Administrator")
        drop_dav_root(OWNER)
        drop_dav_root(STRANGER)
        frappe.db.commit()
        super().tearDownClass()

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.base_name = f"Put-{frappe.generate_hash(length=6)}"
        self.base = folder_node(OWNER, self.root, self.base_name)
        # the dispatcher commits mid-request, so the fixture has to be durable
        # and is dropped explicitly rather than rolled back
        frappe.db.commit()
        self.before = nodes_in_root(self.root)

    def tearDown(self):
        frappe.set_user("Administrator")
        reset_dav_request()
        drop_nodes(nodes_in_root(self.root) - self.before | {self.base})
        frappe.db.commit()
        super().tearDown()

    # ------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------

    def _url(self, name: str) -> str:
        return f"/dav/{self.base_name}/{name}"

    def _put(self, path: str, data: bytes, user: str = OWNER, headers: dict | None = None):
        return put.handle(
            make_ctx("PUT", path, user, data=data, content_type="application/octet-stream", headers=headers)
        )

    def _put_without_length(self, path: str, data: bytes):
        """A body whose size the client never declared.

        rclone and Finder both send chunked, so `Content-Length` is absent and
        the §7.3 preflight has nothing to check. The spool bound is then the
        only thing standing between the client and the driver, which is exactly
        what these cases have to reach.
        """
        ctx = make_ctx("PUT", path, OWNER, data=data, content_type="application/octet-stream")
        ctx.request.environ.pop("CONTENT_LENGTH", None)
        ctx.body = context.BufferedBody(data)
        self.assertIsNone(ctx.request.content_length)
        return put.handle(ctx)

    def _row(self, name: str) -> frappe._dict:
        resolved = self._resolve(f"{self.base_name}/{name}")
        if resolved.node is None:
            raise AssertionError(f"{name} is not in the namespace")
        return node_core.stored(resolved.node.name)

    @staticmethod
    def _resolve(path: str, user: str = OWNER):
        from suite.drive.webdav import pathmap

        pathmap.reset_memo()
        return pathmap.resolve([segment for segment in path.split("/") if segment], user)

    def _content(self, name: str) -> bytes:
        """The bytes GET now serves back, which is the only witness that counts."""
        response = get_module.handle(make_ctx("GET", self._url(name), OWNER))
        if response.direct_passthrough:
            return b"".join(response.response)
        return response.get_data()

    def _set_quota(self, quota_bytes: int) -> None:
        """A root override, which §7.2 lets win over the site default."""
        frappe.db.set_value("Drive Root", self.root, "quota_bytes", quota_bytes, update_modified=False)
        self.addCleanup(frappe.db.set_value, "Drive Root", self.root, "quota_bytes", 0, update_modified=False)

    def _set_site_quota(self, quota_bytes: int) -> None:
        # `or 0`: the Single reads NULL on a site that never set it, and
        # restoring None would leave the column holding NULL rather than the 0
        # it started with
        previous = frappe.db.get_single_value("Drive Disk Settings", "default_personal_quota") or 0
        self.addCleanup(self._write_site_quota, previous)
        self._write_site_quota(quota_bytes)

    @staticmethod
    def _write_site_quota(quota_bytes) -> None:
        frappe.db.set_single_value("Drive Disk Settings", "default_personal_quota", quota_bytes)
        frappe.clear_document_cache("Drive Disk Settings", "Drive Disk Settings")

    def _set_conf(self, key: str, value) -> None:
        missing = object()
        previous = frappe.conf.get(key, missing)
        if previous is missing:
            self.addCleanup(frappe.conf.pop, key, None)
        else:
            self.addCleanup(frappe.conf.__setitem__, key, previous)
        frappe.conf[key] = value

    def _versions(self, node: str) -> list[frappe._dict]:
        return frappe.get_all(
            "Drive Node Version",
            filters={"node": node},
            fields=["name", "seq", "kind", "size", "blob"],
            order_by="seq asc",
        )

    # ------------------------------------------------------------------
    # create and replace
    # ------------------------------------------------------------------

    def test_put_creates_a_file_node_whose_head_is_the_stored_blob(self):
        body = b"fresh content here"
        response = self._put(self._url("new.txt"), body)
        self.assertEqual(response.status_code, 201)

        row = self._row("new.txt")
        self.assertEqual(row.kind, "file")
        self.assertEqual(row.size, len(body))
        self.assertTrue(row.blob)
        self.assertEqual(self._content("new.txt"), body)
        # the strong validator is the blob's own checksum, the same string
        # PROPFIND and GET publish for these bytes (§12.4)
        self.assertEqual(response.headers["ETag"], compute_etag(row))

    def test_the_stored_mime_is_sniffed_not_declared(self):
        """`put_blob` takes no MIME override, so a lying header changes nothing."""
        self._put(self._url("claimed.png"), b"plain text, not a PNG")
        row = self._row("claimed.png")
        blob_mime = frappe.db.get_value("File Blob", row.blob, "mime_type")
        self.assertEqual(row.mime, blob_mime)
        self.assertNotEqual(row.mime, "image/png")

    def test_put_overwrites_in_place(self):
        created = self._put(self._url("doc.txt"), b"version-one")
        self.assertEqual(created.status_code, 201)
        first = self._row("doc.txt")

        response = self._put(self._url("doc.txt"), b"v2!")
        self.assertEqual(response.status_code, 204)

        row = self._row("doc.txt")
        # the same node, never an auto-rename: Office and Finder save by
        # replacing the resource they locked
        self.assertEqual(row.name, first.name)
        self.assertEqual(row.size, 3)
        self.assertEqual(self._content("doc.txt"), b"v2!")
        self.assertTrue(frappe.db.exists("Drive Activity", {"node": row.name, "action": "edit"}))

    def test_a_replace_keeps_exactly_one_nonempty_previous_version(self):
        """§8.5: the old head becomes one auto version, and only one."""
        self._put(self._url("hist.txt"), b"one")
        node = self._row("hist.txt").name
        self.assertEqual(self._versions(node), [])

        self._put(self._url("hist.txt"), b"two")
        versions = self._versions(node)
        self.assertEqual(len(versions), 1)
        self.assertEqual(versions[0].kind, "auto")
        self.assertEqual(versions[0].size, 3)

    def test_a_replaced_empty_head_is_never_kept_as_a_version(self):
        """§8.5: a zero-byte head holds nothing worth keeping."""
        self._put(self._url("blank.txt"), b"")
        node = self._row("blank.txt").name
        self.assertEqual(self._row("blank.txt").size, 0)

        self._put(self._url("blank.txt"), b"now it has content")
        self.assertEqual(self._versions(node), [])

    def test_an_empty_body_creates_an_empty_head(self):
        response = self._put(self._url("empty.bin"), b"")
        self.assertEqual(response.status_code, 201)
        row = self._row("empty.bin")
        self.assertEqual(row.size, 0)
        self.assertEqual(response.headers["ETag"], f'"{EMPTY_BLOB_CHECKSUM}"')

    def test_identical_bytes_share_one_blob(self):
        """`put_blob` dedupes on the checksum, so a second copy stores nothing."""
        self._put(self._url("a.bin"), b"the very same bytes")
        self._put(self._url("b.bin"), b"the very same bytes")
        self.assertEqual(self._row("a.bin").blob, self._row("b.bin").blob)

    def test_put_after_delete_creates_a_new_node(self):
        from suite.drive.webdav import structure

        self._put(self._url("cycle.txt"), b"one")
        original = self._row("cycle.txt").name
        structure.handle_delete(make_ctx("DELETE", self._url("cycle.txt"), OWNER))

        response = self._put(self._url("cycle.txt"), b"two")
        self.assertEqual(response.status_code, 201)
        self.assertNotEqual(self._row("cycle.txt").name, original)

    # ------------------------------------------------------------------
    # quota
    # ------------------------------------------------------------------

    def test_a_declared_overshoot_is_refused_before_a_byte_lands(self):
        """§7.3's preflight: `Content-Length` alone decides, and nothing spools."""
        self._set_quota(int(quota_core.get_storage_usage(self.root).used_bytes) + 32)
        blobs_before = frappe.db.count("File Blob")

        with self.assertRaises(InsufficientStorage):
            self._put(self._url("big.bin"), b"z" * 4096)

        self.assertIsNone(self._resolve(f"{self.base_name}/big.bin").node)
        self.assertEqual(frappe.db.count("File Blob"), blobs_before)

    def test_an_undeclared_body_is_stopped_at_the_free_bytes(self):
        """§7.3: with no `Content-Length` the spool bound is the only guard."""
        self._set_quota(int(quota_core.get_storage_usage(self.root).used_bytes) + 32)

        with self.assertRaises(InsufficientStorage):
            self._put_without_length(self._url("chunked.bin"), b"z" * 4096)

        self.assertIsNone(self._resolve(f"{self.base_name}/chunked.bin").node)

    def test_an_undeclared_body_inside_the_quota_still_lands(self):
        self._set_quota(int(quota_core.get_storage_usage(self.root).used_bytes) + 4096)
        response = self._put_without_length(self._url("chunked-ok.bin"), b"z" * 100)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self._row("chunked-ok.bin").size, 100)

    def test_an_unlimited_root_has_no_spool_bound(self):
        """RFC 4331 §4 and §7.2 both read 0 as unlimited, not as "no bytes".

        The bench site may carry a default personal quota, so the case says so
        rather than depending on what the site happens to hold.
        """
        self._set_site_quota(0)
        # and no site body cap: `drive_webdav_max_upload_size` is the other
        # bound, and a site that sets it would refuse this body for a reason
        # the case is not about
        self._set_conf("drive_webdav_max_upload_size", 0)
        self.assertEqual(int(quota_core.get_storage_usage(self.root).effective_quota), 0)
        response = self._put_without_length(self._url("free.bin"), b"z" * 5000)
        self.assertEqual(response.status_code, 201)

    def test_the_site_cap_bounds_a_declared_body_and_answers_413(self):
        """`drive_webdav_max_upload_size` is the site's own absolute ceiling.

        It is documented on the settings table in webdav/README.md, and it must
        refuse a body the quota alone would have let through. The status is
        413, not 507: RFC 7231 §6.5.11 is the server's own body limit, and
        rclone abandons a whole sync on 507 while it skips one file on 413.
        """
        self._set_site_quota(0)
        self._set_conf("drive_webdav_max_upload_size", 512)
        blobs_before = frappe.db.count("File Blob")

        with self.assertRaises(PayloadTooLarge) as caught:
            self._put(self._url("capped.bin"), b"z" * 4096)
        self.assertEqual(caught.exception.status, 413)

        self.assertIsNone(self._resolve(f"{self.base_name}/capped.bin").node)
        self.assertEqual(frappe.db.count("File Blob"), blobs_before)

    def test_the_site_cap_bounds_an_undeclared_body_in_an_unlimited_root(self):
        """The one case the quota number cannot bound on its own.

        An unlimited root gives no free-bytes figure, so a chunked PUT would
        spool without any stop. The site cap is what supplies one.
        """
        self._set_site_quota(0)
        self._set_conf("drive_webdav_max_upload_size", 512)
        self.assertEqual(int(quota_core.get_storage_usage(self.root).effective_quota), 0)

        with self.assertRaises(PayloadTooLarge):
            self._put_without_length(self._url("capped-chunked.bin"), b"z" * 4096)

        self.assertIsNone(self._resolve(f"{self.base_name}/capped-chunked.bin").node)

        response = self._put_without_length(self._url("under-cap.bin"), b"z" * 100)
        self.assertEqual(response.status_code, 201)

    def test_an_exhausted_quota_still_answers_507_beside_the_cap(self):
        """The two bounds keep their own statuses; the cap does not swallow one.

        A body inside the site cap but past the root's free bytes is a storage
        problem, and a client that reads 413 there would delete nothing and
        retry the same file forever.
        """
        self._set_conf("drive_webdav_max_upload_size", 1_000_000)
        self._set_quota(int(quota_core.get_storage_usage(self.root).used_bytes) + 32)

        with self.assertRaises(InsufficientStorage) as caught:
            self._put(self._url("over-quota.bin"), b"z" * 4096)
        self.assertEqual(caught.exception.status, 507)

    def test_an_unparsable_site_cap_is_no_cap_rather_than_a_500(self):
        """A site that wrote "5GB" into the key must not break every PUT.

        `int("5GB")` raised `ValueError` out of the ceiling read, which the
        mapper answers 500 and logs, on every upload the site takes. A cap
        nobody can parse is the same as no cap.
        """
        self._set_site_quota(0)
        self._set_conf("drive_webdav_max_upload_size", "5GB")

        response = self._put(self._url("unparsable-cap.bin"), b"z" * 100)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self._row("unparsable-cap.bin").size, 100)

    def test_a_replace_is_charged_the_whole_new_head(self):
        """§7.6: the old head keeps its charge as a version, so a replace adds."""
        self._put(self._url("grow.bin"), b"z" * 100)
        after_create = int(quota_core.get_storage_usage(self.root).used_bytes)

        self._put(self._url("grow.bin"), b"z" * 40)
        after_replace = int(quota_core.get_storage_usage(self.root).used_bytes)
        self.assertEqual(after_replace, after_create + 40)

    # ------------------------------------------------------------------
    # authorization and the namespace
    # ------------------------------------------------------------------

    def test_put_statuses(self):
        with self.assertRaises(Conflict):  # missing intermediate
            self._put(f"/dav/{self.base_name}/nowhere/x.txt", b"x")
        with self.assertRaises(MethodNotAllowed):  # the target is a collection
            self._put(f"/dav/{self.base_name}", b"x")
        with self.assertRaises(MethodNotAllowed):  # the mount itself
            self._put("/dav", b"x")
        with self.assertRaises(Conflict):  # trailing slash on a new resource
            self._put(f"/dav/{self.base_name}/dir-ish/", b"x")
        with self.assertRaises(BadRequest):  # partial PUT
            self._put(self._url("x.txt"), b"x", headers={"Content-Range": "bytes 0-0/5"})

    def test_a_collection_405_names_what_the_url_does_take(self):
        """RFC 7231 §6.5.5: a 405 without `Allow` leaves Windows retrying PUT."""
        with self.assertRaises(MethodNotAllowed) as caught:
            self._put(f"/dav/{self.base_name}", b"x")
        allow = caught.exception.headers["Allow"]
        self.assertNotIn("PUT", allow)
        self.assertIn("PROPFIND", allow)
        self.assertIn("DELETE", allow)

    def test_put_refuses_a_name_the_namespace_will_not_publish(self):
        with self.assertRaises(BadRequest):
            self._put(self._url("a" * 500), b"x")

    def test_put_needs_upload_on_the_parent(self):
        """§12.1's method-role table: READ on the parent creates nothing."""
        folder = folder_node(OWNER, self.base, "read-only")
        # §11.2 refuses a deny naming the root's own user inside it, so the
        # grant names `$GENERAL`, which the caller carries too. Nearest depth
        # beats identity tier (§5.1), so this folder answers READ.
        grant(folder, "$GENERAL", READ, node_principals(OWNER))
        with self.assertRaises(DriveForbidden):
            self._put(f"/dav/{self.base_name}/read-only/x.txt", b"x")

    def test_put_needs_edit_to_replace(self):
        self._put(self._url("held.txt"), b"one")
        row = self._row("held.txt")
        grant(row.name, "$GENERAL", READ, node_principals(OWNER))
        with self.assertRaises(DriveForbidden):
            self._put(self._url("held.txt"), b"two")

    def test_an_unreadable_target_is_404_and_not_an_existence_oracle(self):
        """§12.1: below READ the answer is 404, ahead of 412, 423 and 405."""
        self._put(self._url("secret.txt"), b"nope")
        row = self._row("secret.txt")
        grant(row.name, "$GENERAL", NONE, node_principals(OWNER))

        # `If-None-Match: *` would be a 412 on an existing resource, which is
        # exactly the oracle the read gate has to close
        with self.assertRaises(DriveNotFound):
            self._put(self._url("secret.txt"), b"x", headers={"If-None-Match": "*"})
        with self.assertRaises(DriveNotFound):
            self._put(self._url("secret.txt"), b"x")

    def test_an_unreadable_collection_is_404_and_not_a_405(self):
        """The collection refusal is a resource-level 405, so it is an oracle.

        `pathmap` resolves without asking permission. Without a read gate ahead
        of it, PUT at a folder the caller cannot see answers "cannot PUT to a
        collection" while a name that was never there answers 201, and the pair
        tells a stranger which of their own folders were taken away from them.
        """
        folder = node_core.create_folder(node_principals(OWNER), self.base, "Vault")
        grant(folder, "$GENERAL", NONE, node_principals(OWNER))

        with self.assertRaises(DriveNotFound):
            self._put(f"/dav/{self.base_name}/Vault", b"x")
        # and the free name beside it still creates, so the two really would
        # have been distinguishable
        self.assertEqual(self._put(f"/dav/{self.base_name}/Open", b"x").status_code, 201)

    def test_an_unreadable_intermediate_answers_exactly_like_an_absent_one(self):
        """§12.1: the 404-vs-409 pair was an oracle of its own.

        `PUT /dav/<denied folder>/x.txt` answered 404 through the parent's read
        gate while `PUT /dav/<absent>/x.txt` answered 409, so the pair still
        named every folder inside a caller's own root that had been taken away
        from them - the 405 oracle above with two other numbers. RFC 4918
        §9.7.1 fixes the absent parent at 409, so the unreadable parent joins
        it: a parent the caller cannot see is a parent that is not there.
        """
        folder = node_core.create_folder(node_principals(OWNER), self.base, "Sealed")
        grant(folder, "$GENERAL", NONE, node_principals(OWNER))

        with self.assertRaises(Conflict) as unreadable:
            self._put(f"/dav/{self.base_name}/Sealed/x.txt", b"x")
        with self.assertRaises(Conflict) as absent:
            self._put(f"/dav/{self.base_name}/NeverThere/x.txt", b"x")
        self.assertEqual(str(unreadable.exception), str(absent.exception))

        # a parent the caller can see but not write still says so
        readable = node_core.create_folder(node_principals(OWNER), self.base, "Shown")
        grant(readable, "$GENERAL", READ, node_principals(OWNER))
        with self.assertRaises(DriveForbidden):
            self._put(f"/dav/{self.base_name}/Shown/x.txt", b"x")

    def test_there_is_no_mount_of_another_users_root(self):
        self._put(self._url("mine.txt"), b"mine")
        # the stranger's `/dav/` is their own Personal Root, so this path names
        # nothing they can reach and the parent segment is simply absent
        with self.assertRaises(Conflict):
            self._put(self._url("mine.txt"), b"theirs", user=STRANGER)

    def test_a_caller_with_no_personal_root_is_refused_not_a_500(self):
        """`/dav` itself resolves to no node and no parent for a user who has
        no Active Personal Root - `Administrator`, which
        `provision_personal_root` skips, and anyone whose root was archived.

        Reading `segments[-1]` past that raised IndexError and `require(None)`
        raised AttributeError, which the mapper answers 500 and which commits
        one Error Log row per attempt. The refusal is the one an absent parent
        already gets.
        """
        from suite.drive.webdav import pathmap

        with patch.object(pathmap, "personal_root_for", return_value=None):
            with self.assertRaises(Conflict):
                self._put("/dav", b"x")

    def test_a_hidden_content_document_is_closed_to_put(self):
        """§12.2: a document node is out of the namespace for writes too."""
        document = raw_document_node(self.base, "Deck")
        self.addCleanup(drop_nodes, [document])

        # the document segment is invisible, so the walk stops above it
        with self.assertRaises(Conflict):
            self._put(f"/dav/{self.base_name}/Deck/slide.txt", b"x")
        # and its own URL cannot be turned into a file: `pathmap` never returns
        # the row, so this reads as a create and collides with the live sibling
        with self.assertRaises(DriveConflict):
            self._put(f"/dav/{self.base_name}/Deck", b"x")

    # ------------------------------------------------------------------
    # conditionals, client times, attribution
    # ------------------------------------------------------------------

    def test_put_conditionals(self):
        self._put(self._url("locked.txt"), b"held")
        row = self._row("locked.txt")

        with self.assertRaises(PreconditionFailed):
            self._put(self._url("locked.txt"), b"no", headers={"If-None-Match": "*"})
        with self.assertRaises(PreconditionFailed):
            self._put(self._url("locked.txt"), b"no", headers={"If-Match": '"wrong"'})

        # the ETag a previous PUT handed back is the one that matches
        response = self._put(self._url("locked.txt"), b"yes", headers={"If-Match": compute_etag(row)})
        self.assertEqual(response.status_code, 204)

    def test_if_none_match_star_creates_only_when_absent(self):
        response = self._put(self._url("once.txt"), b"first", headers={"If-None-Match": "*"})
        self.assertEqual(response.status_code, 201)

    def test_put_honors_client_mtime(self):
        response = self._put(self._url("dated.txt"), b"x", headers={"X-OC-Mtime": "1700000000"})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.headers["X-OC-Mtime"], "accepted")

        stored = self._row("dated.txt").content_modified
        # the UTC epoch read into the site zone, not the OS zone: rclone
        # re-syncs everything whenever the two disagree
        self.assertEqual(
            frappe.utils.get_datetime(stored),
            to_site_naive(datetime.fromtimestamp(1700000000, tz=UTC)),
        )

    def test_an_out_of_range_mtime_is_dropped_and_not_claimed(self):
        """A huge stamp must not overflow `fromtimestamp` into a 500.

        It must also not come back as `accepted`. The header is how the
        nextcloud vendor decides whether to re-sync, so claiming a time that
        was never stored would leave the client waiting for it forever.
        """
        response = self._put(
            self._url("stamped.txt"), b"data", headers={"X-OC-Mtime": "99999999999999999999"}
        )
        self.assertEqual(response.status_code, 201)
        self.assertNotIn("X-OC-Mtime", response.headers)

    def test_put_records_the_actor_and_the_client_once(self):
        """§9.4 and §12.4: one activity row, naming the user and the agent."""
        agent = "Microsoft-WebDAV-MiniRedir/10.0.19041"
        frappe.db.set_single_value("Drive Disk Settings", "webdav_enabled", 1)
        frappe.clear_document_cache("Drive Disk Settings", "Drive Disk Settings")
        enable_user_webdav(OWNER)
        frappe.db.commit()
        try:
            response = dispatch(
                "PUT",
                self._url("agented.txt"),
                user=OWNER,
                password=PASSWORD,
                data=b"through the dispatcher",
                headers={"User-Agent": agent},
            )
            self.assertEqual(response.status_code, 201)
            node = self._row("agented.txt").name
            rows = frappe.get_all(
                "Drive Activity", filters={"node": node}, fields=["action", "actor", "client"]
            )
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0].action, "create")
            self.assertEqual(rows[0].actor, OWNER)
            self.assertEqual(rows[0].client, agent)
        finally:
            frappe.db.set_single_value("Drive Disk Settings", "webdav_enabled", 0)
            frappe.clear_document_cache("Drive Disk Settings", "Drive Disk Settings")
            frappe.db.set_value("Drive Settings", OWNER, "webdav_enabled", 0, update_modified=False)
            frappe.db.commit()

    def test_an_unnamed_client_leaves_the_column_empty(self):
        """`bind_client` is per request, so one named agent cannot bleed on."""
        activity.bind_client("Some-Client/1.0")
        activity.bind_client(None)
        self._put(self._url("anon.txt"), b"x")
        node = self._row("anon.txt").name
        self.assertIsNone(frappe.db.get_value("Drive Activity", {"node": node}, "client"))

    # ------------------------------------------------------------------
    # failure leaves nothing behind
    # ------------------------------------------------------------------

    def test_a_failed_put_leaves_no_stored_bytes(self):
        """The node write and the blob roll back together (§12.3).

        `put_blob` registers its own `after_rollback` byte deletion, so the
        handler owns no compensation: the transaction that loses the node also
        loses the object.
        """
        blobs_before = set(frappe.get_all("File Blob", pluck="name"))
        payload = frappe.generate_hash(length=32).encode() * 8

        with patch.object(node_core, "create_file", side_effect=RuntimeError("boom")):
            with self.assertRaises(RuntimeError):
                self._put(self._url("orphan.bin"), payload)
        frappe.db.rollback()

        self.assertEqual(set(frappe.get_all("File Blob", pluck="name")), blobs_before)
        self.assertIsNone(self._resolve(f"{self.base_name}/orphan.bin").node)
