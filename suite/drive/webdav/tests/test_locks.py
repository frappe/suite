import unittest
from datetime import timedelta
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase
from lxml import etree

from suite.drive.utils import STATUS_ACTIVE, create_drive_file, get_root_folder, get_user_folder
from suite.drive.utils.files import FileManager
from suite.drive.webdav import lock as lock_module
from suite.drive.webdav import locks, pathmap, propfind, put, structure
from suite.drive.webdav.errors import (
    BadRequest,
    Conflict,
    Forbidden,
    InsufficientStorage,
    Locked,
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
from suite.drive.webdav.xmlutil import dav
from suite.tests.utils import ensure_user

OWNER = "webdav-locks-owner@example.com"
EDITOR = "webdav-locks-editor@example.com"
PASSWORD = "webdav-locks-pw"

LOCKINFO_EXCLUSIVE = (
    b'<?xml version="1.0"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope>'
    b"<D:locktype><D:write/></D:locktype>"
    b"<D:owner><D:href>mailto:owner@example.com</D:href></D:owner></D:lockinfo>"
)
LOCKINFO_SHARED = LOCKINFO_EXCLUSIVE.replace(b"exclusive", b"shared")


PARKED_FOR_25 = "LOCK and UNLOCK are not relinked by ticket 24. `suite/drive/webdav/lock.py` still reads `webdav/perms.py` and creates legacy `File` rows for a lock on an unmapped URL, so both verbs are absent from `RELINKED_METHODS` and `dispatch._HANDLERS` and answer 405 - which also drops class 2 from the advertised DAV header. `locks.py` itself is already on node identity and is exercised by the PROPFIND lockdiscovery path. Un-skip in ticket 25, once LOCK on an unmapped URL creates an empty node under UPLOAD on the parent (§12.3), and after these cases are rewritten onto node fixtures."


@unittest.skip(PARKED_FOR_25)
class TestWebDAVLocks(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user_with_password(OWNER, PASSWORD)
        ensure_user(EDITOR)
        with cls.set_user(OWNER):
            cls.home = get_user_folder(OWNER).name

    def setUp(self):
        frappe.set_user(OWNER)
        with self.set_user(OWNER):
            self.base_name = f"Lk-{frappe.generate_hash(length=6)}"
            self.base = create_drive_file(
                self.base_name, self.home, "Folder", lambda f: FileManager().create_folder(f)
            )
            self.file = write_file_fixture(self.base.name, "doc.docx", b"office file")
        # a shared folder EDITOR can write into, so cross-user conflicts are testable
        with self.set_user("Administrator"):
            self.shared = create_drive_file(
                f"lk-shared-{frappe.generate_hash(length=6)}",
                get_root_folder().name,
                "Folder",
                lambda f: FileManager().create_folder(f),
                owner=OWNER,
            )
        with self.set_user(OWNER):
            self.shared_file = write_file_fixture(self.shared.name, "team.txt", b"team data")
        frappe.get_doc(
            {
                "doctype": "Drive Permission",
                "entity": self.shared.name,
                "user": EDITOR,
                "read": 1,
                "upload": 1,
                "write": 1,
            }
        ).insert(ignore_permissions=True)

    def tearDown(self):
        frappe.db.sql("DELETE FROM `tabDrive DAV Lock`")
        frappe.set_user("Administrator")
        super().tearDown()

    def _lock(self, path: str, user: str = OWNER, body: bytes = LOCKINFO_EXCLUSIVE, **headers):
        return lock_module.handle_lock(make_ctx("LOCK", path, user, data=body, headers=headers))

    def _unlock(self, path: str, token: str, user: str = OWNER):
        return lock_module.handle_unlock(make_ctx("UNLOCK", path, user, headers={"Lock-Token": f"<{token}>"}))

    def _token(self, response) -> str:
        return response.headers["Lock-Token"][1:-1]

    def test_lock_and_discovery(self):
        response = self._lock(f"/dav/Home/{self.base_name}/doc.docx", Timeout="Second-3600")
        self.assertEqual(response.status_code, 200)
        token = self._token(response)
        self.assertTrue(token.startswith("urn:uuid:"))

        parsed = etree.fromstring(response.get_data())
        active = parsed.find(f"{dav('lockdiscovery')}/{dav('activelock')}")
        self.assertIsNotNone(active.find(f"{dav('lockscope')}/{dav('exclusive')}"))
        self.assertEqual(active.find(f"{dav('locktoken')}/{dav('href')}").text, token)
        self.assertIn("doc.docx", active.find(f"{dav('lockroot')}/{dav('href')}").text)
        # Office's habitual hour is granted verbatim (remaining is live-computed)
        remaining = int(active.find(dav("timeout")).text.removeprefix("Second-"))
        self.assertTrue(3590 < remaining <= 3600, remaining)
        # client-supplied owner element round-trips
        self.assertIn("mailto:owner@example.com", etree.tostring(active, encoding="unicode"))

    def test_conflict_matrix(self):
        path = f"/dav/Everyone/{self.shared.file_name}/team.txt"
        self._lock(path, user=OWNER, body=LOCKINFO_SHARED)
        # shared + shared coexists
        response = self._lock(path, user=EDITOR, body=LOCKINFO_SHARED)
        self.assertEqual(response.status_code, 200)
        # exclusive over shared: 423
        with self.assertRaises(Locked) as caught:
            self._lock(path, user=EDITOR, body=LOCKINFO_EXCLUSIVE)
        self.assertEqual(caught.exception.condition, "no-conflicting-lock")

        frappe.db.sql("DELETE FROM `tabDrive DAV Lock`")
        self._lock(path, user=OWNER, body=LOCKINFO_EXCLUSIVE)
        for body in (LOCKINFO_EXCLUSIVE, LOCKINFO_SHARED):
            with self.assertRaises(Locked):
                self._lock(path, user=EDITOR, body=body)

    def test_lock_blocks_writes_without_token(self):
        path = f"/dav/Everyone/{self.shared.file_name}/team.txt"
        token = self._token(self._lock(path, user=OWNER))

        # EDITOR has write permission but no token
        with self.assertRaises(Locked):
            put.handle(make_ctx("PUT", path, EDITOR, data=b"stomp"))
        # the owner without the token is blocked too (a second client of theirs)
        with self.assertRaises(Locked):
            put.handle(make_ctx("PUT", path, OWNER, data=b"stomp"))
        # owner + token passes
        response = put.handle(make_ctx("PUT", path, OWNER, data=b"proper", headers={"If": f"(<{token}>)"}))
        self.assertEqual(response.status_code, 204)
        # a leaked token in another user's hands grants nothing
        with self.assertRaises(Locked):
            put.handle(make_ctx("PUT", path, EDITOR, data=b"stomp", headers={"If": f"(<{token}>)"}))

    def test_depth_infinity_lock_covers_descendants(self):
        folder_path = f"/dav/Everyone/{self.shared.file_name}"
        token = self._token(self._lock(folder_path, user=OWNER, Depth="infinity"))

        child = f"{folder_path}/team.txt"
        with self.assertRaises(Locked):
            put.handle(make_ctx("PUT", child, EDITOR, data=b"x"))
        # depth-inf lock protects new members anywhere below
        with self.assertRaises(Locked):
            structure.handle_mkcol(make_ctx("MKCOL", f"{folder_path}/NewDir", EDITOR))
        response = put.handle(make_ctx("PUT", child, OWNER, data=b"fine", headers={"If": f"(<{token}>)"}))
        self.assertEqual(response.status_code, 204)

    def test_depth_zero_collection_lock_protects_membership(self):
        folder_path = f"/dav/Everyone/{self.shared.file_name}"
        self._lock(folder_path, user=OWNER, Depth="0")
        # RFC 4918 §7.4: adding a member is protected even by a depth-0 lock
        with self.assertRaises(Locked):
            structure.handle_mkcol(make_ctx("MKCOL", f"{folder_path}/Blocked", EDITOR))
        # but a depth-0 lock does NOT cover existing members' content
        response = put.handle(make_ctx("PUT", f"{folder_path}/team.txt", EDITOR, data=b"ok"))
        self.assertEqual(response.status_code, 204)

    def test_lock_unmapped_url_creates_empty_resource(self):
        path = f"/dav/Home/{self.base_name}/fresh.docx"
        response = self._lock(path)
        self.assertEqual(response.status_code, 201)
        token = self._token(response)

        row = self._resolve_entity(path)
        self.assertEqual(row.file_size, 0)
        self.assertEqual(frappe.db.get_value("File", row.name, "status"), STATUS_ACTIVE)

        # the Office flow: PUT with the token, then UNLOCK
        response = put.handle(make_ctx("PUT", path, OWNER, data=b"content", headers={"If": f"(<{token}>)"}))
        self.assertEqual(response.status_code, 204)
        with self.assertRaises(Locked):
            put.handle(make_ctx("PUT", path, OWNER, data=b"no-token"))

        self.assertEqual(self._unlock(path, token).status_code, 204)
        response = put.handle(make_ctx("PUT", path, OWNER, data=b"unlocked now"))
        self.assertEqual(response.status_code, 204)

    def test_lock_unmapped_with_trailing_slash_raises_conflict(self):
        # a collection URL must not mint a lock-null *file* (RFC 4918 §7.3)
        with self.assertRaises(Conflict):
            self._lock(f"/dav/Home/{self.base_name}/nonexistent/")

    def _hide_from_editor(self, name: str, data: bytes = b"secret"):
        with self.set_user(OWNER):
            hidden = write_file_fixture(self.shared.name, name, data)
        frappe.get_doc(
            {"doctype": "Drive Permission", "entity": hidden.name, "user": EDITOR, "read": 1, "deny": 1}
        ).insert(ignore_permissions=True)
        return hidden

    def test_if_header_cannot_probe_unreadable_resources(self):
        from suite.drive.webdav.properties import compute_etag

        hidden = self._hide_from_editor("secret.txt")
        etag = compute_etag(pathmap.fetch(hidden.name))
        hidden_url = f"/dav/Everyone/{self.shared.file_name}/secret.txt"
        target = f"/dav/Everyone/{self.shared.file_name}/team.txt"

        # a tagged condition on a hidden resource evaluates as if it were
        # unmapped — even a correct ETag guess must not turn the 412 off
        with self.assertRaises(PreconditionFailed):
            put.handle(
                make_ctx("PUT", target, EDITOR, data=b"x", headers={"If": f"<{hidden_url}> ([{etag}])"})
            )
        # a reader evaluates the same condition for real
        response = put.handle(
            make_ctx("PUT", target, OWNER, data=b"x", headers={"If": f"<{hidden_url}> ([{etag}])"})
        )
        self.assertEqual(response.status_code, 204)

    def test_refresh_on_unreadable_path_reads_as_unmapped(self):
        self._hide_from_editor("secret2.txt")
        path = f"/dav/Everyone/{self.shared.file_name}/secret2.txt"
        token = self._token(self._lock(path, user=OWNER))
        # a leaked token must not confirm the hidden resource or its lock: the
        # reply matches an unmapped URL, not the owner-mismatch Forbidden
        with self.assertRaises(PreconditionFailed):
            lock_module.handle_lock(make_ctx("LOCK", path, EDITOR, headers={"If": f"(<{token}>)"}))

    def test_refresh_extends_and_expiry_frees(self):
        path = f"/dav/Home/{self.base_name}/doc.docx"
        token = self._token(self._lock(path, Timeout="Second-60"))

        response = lock_module.handle_lock(
            make_ctx("LOCK", path, OWNER, headers={"If": f"(<{token}>)", "Timeout": "Second-1200"})
        )
        self.assertEqual(response.status_code, 200)
        lock = locks.find_lock(token)
        self.assertGreater(lock.remaining, 600)

        # refresh by a non-owner is refused (on a path the editor can address)
        shared_path = f"/dav/Everyone/{self.shared.file_name}/team.txt"
        shared_token = self._token(self._lock(shared_path, user=OWNER))
        with self.assertRaises(Forbidden):
            lock_module.handle_lock(
                make_ctx("LOCK", shared_path, EDITOR, headers={"If": f"(<{shared_token}>)"})
            )

        # an expired lock neither blocks nor is discoverable, and is lazily purged
        frappe.db.set_value(
            "Drive DAV Lock",
            token,
            "expires_at",
            frappe.utils.now_datetime() - timedelta(seconds=5),
            update_modified=False,
        )
        response = put.handle(make_ctx("PUT", path, OWNER, data=b"free"))
        self.assertEqual(response.status_code, 204)
        self.assertIsNone(locks.find_lock(token))

    def test_unlock_statuses(self):
        path = f"/dav/Everyone/{self.shared.file_name}/team.txt"
        token = self._token(self._lock(path, user=OWNER))

        with self.assertRaises(BadRequest):  # missing/malformed header
            lock_module.handle_unlock(make_ctx("UNLOCK", path, OWNER))
        with self.assertRaises(Conflict):  # unknown token
            self._unlock(path, "urn:uuid:00000000-0000-0000-0000-000000000000")
        with self.assertRaises(Conflict):  # token exists but does not cover this URL
            self._unlock(f"/dav/Home/{self.base_name}/doc.docx", token)
        with self.assertRaises(Forbidden):  # not the owner
            self._unlock(path, token, user=EDITOR)

        self.assertEqual(self._unlock(path, token).status_code, 204)

    def test_admin_can_force_unlock(self):
        path = f"/dav/Everyone/{self.shared.file_name}/team.txt"
        token = self._token(self._lock(path, user=OWNER))
        response = self._unlock(path, token, user="Administrator")
        self.assertEqual(response.status_code, 204)

    def test_if_condition_fails_before_lock_check(self):
        path = f"/dav/Home/{self.base_name}/doc.docx"
        token = self._token(self._lock(path))
        # correct token AND wrong etag: 412, not 423 (litmus complex_cond_put)
        with self.assertRaises(PreconditionFailed):
            put.handle(make_ctx("PUT", path, OWNER, data=b"x", headers={"If": f'(<{token}> ["wrong-etag"])'}))
        with self.assertRaises(BadRequest):
            put.handle(make_ctx("PUT", path, OWNER, data=b"x", headers={"If": "(corrupt"}))

    def test_delete_and_move_drop_locks(self):
        path = f"/dav/Home/{self.base_name}/doc.docx"
        token = self._token(self._lock(path))

        with self.assertRaises(Locked):
            structure.handle_delete(make_ctx("DELETE", path, OWNER))
        response = structure.handle_delete(make_ctx("DELETE", path, OWNER, headers={"If": f"(<{token}>)"}))
        self.assertEqual(response.status_code, 204)
        self.assertIsNone(locks.find_lock(token))

        write_file_fixture(self.base.name, "mv.txt", b"mv")
        token = self._token(self._lock(f"/dav/Home/{self.base_name}/mv.txt"))
        structure.handle_move(
            make_ctx(
                "MOVE",
                f"/dav/Home/{self.base_name}/mv.txt",
                OWNER,
                headers={
                    "Destination": f"/dav/Home/{self.base_name}/mv2.txt",
                    "If": f"(<{token}>)",
                },
            )
        )
        # RFC §7.5: locks do not travel with the resource
        self.assertIsNone(locks.find_lock(token))

    def test_propfind_reports_lockdiscovery(self):
        path = f"/dav/Home/{self.base_name}/doc.docx"
        token = self._token(self._lock(path))

        ctx = make_ctx("PROPFIND", f"/dav/Home/{self.base_name}", OWNER, headers={"Depth": "1"})
        parsed = etree.fromstring(propfind.handle(ctx).get_data())
        for response in parsed.findall(dav("response")):
            href = response.find(dav("href")).text
            prop = response.find(f"{dav('propstat')}/{dav('prop')}")
            self.assertIsNotNone(prop.find(f"{dav('supportedlock')}/{dav('lockentry')}"), href)
            discovery = prop.find(dav("lockdiscovery"))
            if href.endswith("doc.docx"):
                token_el = discovery.find(f"{dav('activelock')}/{dav('locktoken')}/{dav('href')}")
                self.assertEqual(token_el.text, token)
            else:
                self.assertEqual(len(discovery), 0, href)

    def test_lock_depth_one_is_400(self):
        with self.assertRaises(BadRequest):
            self._lock(f"/dav/Home/{self.base_name}/doc.docx", Depth="1")

    def test_unlock_unreadable_is_404_not_409(self):
        # UNLOCK must hide an unreadable resource as 404, not reveal it via 409
        with self.set_user(OWNER):
            secret = create_drive_file(
                f"lk-secret-{frappe.generate_hash(length=6)}",
                get_root_folder().name,
                "Folder",
                lambda f: FileManager().create_folder(f),
            )
            write_file_fixture(secret.name, "hidden.txt", b"x")
        frappe.get_doc(
            {"doctype": "Drive Permission", "entity": secret.name, "user": EDITOR, "deny": 1, "read": 1}
        ).insert(ignore_permissions=True)
        with self.assertRaises(NotFoundError):
            self._unlock(
                f"/dav/Everyone/{secret.file_name}/hidden.txt",
                "urn:uuid:00000000-0000-0000-0000-000000000000",
                user=EDITOR,
            )

    def test_lock_cap_rejects_before_creating_resource(self):
        # hitting the per-user lock cap must reject before materializing a File/blob
        path = f"/dav/Home/{self.base_name}/capped.docx"
        with patch.object(locks, "MAX_ACTIVE_LOCKS_PER_USER", 0):
            with self.assertRaises(InsufficientStorage):
                self._lock(path)
        self.assertIsNone(self._resolve_entity(path))

    def test_lockdiscovery_redacts_other_users_lock(self):
        # OWNER holds the lock; EDITOR can read the file but must not learn the
        # token or owner identity via PROPFIND lockdiscovery
        path = f"/dav/Everyone/{self.shared.file_name}/team.txt"
        self._lock(path, user=OWNER)

        ctx = make_ctx("PROPFIND", f"/dav/Everyone/{self.shared.file_name}", EDITOR, headers={"Depth": "1"})
        parsed = etree.fromstring(propfind.handle(ctx).get_data())
        checked = False
        for response in parsed.findall(dav("response")):
            if not response.find(dav("href")).text.endswith("team.txt"):
                continue
            checked = True
            prop = response.find(f"{dav('propstat')}/{dav('prop')}")
            active = prop.find(dav("lockdiscovery")).find(dav("activelock"))
            # the lock's presence and scope are visible
            self.assertIsNotNone(active.find(f"{dav('lockscope')}/{dav('exclusive')}"))
            # but the token and the owner identity are not
            self.assertIsNone(active.find(dav("locktoken")))
            self.assertNotIn("mailto:owner@example.com", etree.tostring(active, encoding="unicode"))
        self.assertTrue(checked, "team.txt was not in the listing")

    def _resolve_entity(self, path: str):
        pathmap.reset_memo()
        segments = [segment for segment in path.split("/") if segment][1:]
        return pathmap.resolve(segments, OWNER).entity
