"""MKCOL and DELETE against the single Personal Root mount.

Both verbs are one call into a §8 node workflow with §12.1's role in front of
it: MKCOL takes UPLOAD on the parent and goes through `_core.nodes.create_folder`,
DELETE takes EDIT on the node and goes through `_core.nodes.update(state="Trashed")`.
Neither verb re-checks a collision or a quota, so the cases below assert what
the handler owns: the status, the role, the naming policy, the lock guard, and
the state the workflow leaves behind.

DELETE is a trash, not a purge. The row survives, the URL stops resolving, and
the bytes stay charged to the root until somebody purges the node.
"""

import frappe
from frappe.tests import IntegrationTestCase

from suite.drive._core import nodes as node_core
from suite.drive._core.access import grant
from suite.drive._core.errors import DriveConflict, DriveForbidden, DriveNotFound
from suite.drive._core.quota import get_storage_usage
from suite.drive._core.roles import NONE, READ
from suite.drive.webdav import DAV_PREFIX, locks, pathmap, structure
from suite.drive.webdav.errors import (
    BadRequest,
    Conflict,
    Forbidden,
    Locked,
    MethodNotAllowed,
    NotFoundError,
    PreconditionFailed,
    UnsupportedMediaType,
)
from suite.drive.webdav.tests.utils import (
    drop_dav_root,
    drop_nodes,
    ensure_user_with_password,
    file_node,
    folder_node,
    make_ctx,
    node_principals,
    personal_dav_root,
    raw_document_node,
)

OWNER = "webdav-structure-owner@example.com"
STRANGER = "webdav-structure-stranger@example.com"
PASSWORD = "webdav-structure-pw"
QUOTA = 10 * 1024 * 1024

SIZED = b"0123456789"


class TestWebDAVMkcolDelete(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user_with_password(OWNER, PASSWORD)
        ensure_user_with_password(STRANGER, PASSWORD)
        # a root of its own, so the quota case has a stated limit rather than
        # whichever site default `Drive Disk Settings` happens to carry
        drop_dav_root(OWNER)
        cls.root = personal_dav_root(OWNER, quota_bytes=QUOTA)
        personal_dav_root(STRANGER)

    def setUp(self):
        super().setUp()
        self.base_name = f"Struct-{frappe.generate_hash(length=6)}"
        self.base = folder_node(OWNER, self.root, self.base_name)

    def tearDown(self):
        frappe.set_user("Administrator")
        # every node under this mount is this suite's fixture, and a case that
        # denies `$GENERAL` on one cannot read it back to clean up by hand
        mine = frappe.get_all("Drive Node", filters={"root": self.root}, pluck="name")
        if mine:
            # scoped to this mount: another module's lock rows are not ours to drop
            frappe.db.delete("Drive DAV Lock", {"entity": ["in", mine]})
        drop_nodes(mine)
        super().tearDown()

    # --- helpers ---

    def _mkcol(self, path: str, user: str = OWNER, data: bytes = b"", headers: dict | None = None):
        return structure.handle_mkcol(make_ctx("MKCOL", path, user, data=data, headers=headers))

    def _delete(self, path: str, user: str = OWNER, headers: dict | None = None):
        return structure.handle_delete(make_ctx("DELETE", path, user, headers=headers))

    def _resolve(self, *segments: str):
        pathmap.reset_memo()
        return pathmap.resolve([self.base_name, *segments], OWNER)

    def _lock(self, entity: str, owner: str, *, depth: str = "infinity") -> str:
        return locks.create_lock(
            entity,
            scope="Exclusive",
            depth=depth,
            owner_user=owner,
            owner_xml=None,
            requested_timeout=600,
            lock_root=f"{DAV_PREFIX}/{self.base_name}",
        ).token

    def _state(self, node: str) -> str | None:
        return frappe.db.get_value("Drive Node", node, "state")

    # --- MKCOL ---

    def test_mkcol_creates_a_folder(self):
        """§8.1: MKCOL is `create_folder`, and 201 is the only success."""
        response = self._mkcol(f"/dav/{self.base_name}/NewFolder")
        self.assertEqual(response.status_code, 201)

        created = self._resolve("NewFolder")
        self.assertTrue(created.exists)
        self.assertTrue(created.is_collection)
        self.assertEqual(created.node.kind, "folder")
        self.assertEqual(created.node.parent, self.base)

    def test_mkcol_on_an_existing_resource_or_the_mount_is_405(self):
        """RFC 4918 §9.3: MKCOL never replaces what is already mapped."""
        file_node(OWNER, self.base, "taken.txt", b"x")
        for path in (f"/dav/{self.base_name}", f"/dav/{self.base_name}/taken.txt", "/dav/", "/dav"):
            with self.subTest(path=path), self.assertRaises(MethodNotAllowed):
                self._mkcol(path)

    def test_mkcol_needs_its_intermediate_collections(self):
        """RFC 4918 §9.3: a gap in the path is 409, not an implicit create."""
        with self.assertRaises(Conflict):
            self._mkcol(f"/dav/{self.base_name}/no/such")
        self.assertFalse(self._resolve("no").exists)

    def test_mkcol_refuses_a_request_body(self):
        """RFC 4918 §9.3: an extended MKCOL body this server cannot honour is 415."""
        with self.assertRaises(UnsupportedMediaType):
            self._mkcol(f"/dav/{self.base_name}/WithBody", data=b"<mkcol/>")
        self.assertFalse(self._resolve("WithBody").exists)

    def test_mkcol_rejects_a_name_the_dav_policy_refuses(self):
        """§12.2: `pathmap.validate_dav_name` is the naming policy on create.

        Drive itself accepts all of these. DAV does not: a reserved name would
        claim a place Drive means to own, and the rest have no spelling a
        client could address afterwards.
        """
        long_name = "a" * (pathmap.MAX_NAME_LENGTH + 1)
        for name, refusal in ((".embeds", Forbidden), (long_name, BadRequest), ("back\\slash", BadRequest)):
            with self.subTest(name=name), self.assertRaises(refusal):
                self._mkcol(f"/dav/{self.base_name}/{name}")

    def test_mkcol_collides_with_a_live_sibling(self):
        """§8.1: one active title per parent, in either spelling of it.

        The walk falls back to a case-insensitive match when it is
        unambiguous, so a client on a case-folding filesystem is refused the
        duplicate instead of being handed a second folder it cannot tell
        apart.
        """
        file_node(OWNER, self.base, "Reports", b"live")
        for spelling in ("Reports", "reports"):
            with self.subTest(spelling=spelling), self.assertRaises(MethodNotAllowed):
                self._mkcol(f"/dav/{self.base_name}/{spelling}")

    def test_mkcol_below_read_only_is_403_and_below_unreadable_is_404(self):
        """§12.1: MKCOL needs UPLOAD on the parent, and below READ it is 404.

        The mount is the caller's own Personal Root, and §11.2 refuses a deny
        that names that root's own user inside it. Both grants therefore name
        `$GENERAL`, which the caller carries as well: nearest depth beats
        identity tier (§5.1), so each folder answers its own role while the
        mount above them is unchanged. They are separate folders because a
        second grant on a node the first one lowered would need MANAGE the
        caller no longer has there.
        """
        read_only = folder_node(OWNER, self.base, "ReadOnly")
        grant(read_only, "$GENERAL", READ, node_principals(OWNER))
        with self.assertRaises(DriveForbidden):
            self._mkcol(f"/dav/{self.base_name}/ReadOnly/Intruder")

        # below READ the parent must look absent, so MKCOL is not an existence
        # oracle for a folder the caller cannot see
        hidden = folder_node(OWNER, self.base, "Hidden")
        grant(hidden, "$GENERAL", NONE, node_principals(OWNER))
        with self.assertRaises(DriveNotFound):
            self._mkcol(f"/dav/{self.base_name}/Hidden/Intruder")

    # --- DELETE ---

    def test_delete_trashes_rather_than_purges(self):
        """§8.4: DELETE is `update(state="Trashed")`, so the row survives."""
        victim = file_node(OWNER, self.base, "victim.txt", b"bye")

        response = self._delete(f"/dav/{self.base_name}/victim.txt")
        self.assertEqual(response.status_code, 204)

        row = frappe.db.get_value("Drive Node", victim.name, ["state", "trash_root"], as_dict=True)
        self.assertIsNotNone(row)
        self.assertEqual(row.state, "Trashed")
        self.assertEqual(row.trash_root, victim.name)
        self.assertFalse(self._resolve("victim.txt").exists)

        # recoverable through the same workflow the Drive web UI restores with
        node_core.update(node_principals(OWNER), victim.name, state="Active")
        self.assertEqual(self._state(victim.name), "Active")
        self.assertTrue(self._resolve("victim.txt").exists)

    def test_delete_of_a_collection_unmaps_the_subtree_and_drops_its_locks(self):
        """RFC 4918 §9.6 and §7.5: the whole subtree leaves the namespace, and
        no lock survives the unmapping.

        The child's own lock is the caller's, and its token is submitted, so
        the descendant sweep in `locks.enforce` finds it satisfied instead of
        blocking. What is proved after the 204 is that `drop_locks_under`
        removed it anyway.
        """
        doomed = folder_node(OWNER, self.base, "Doomed")
        inner = file_node(OWNER, doomed, "inner.txt", b"inner")
        token = self._lock(inner.name, OWNER, depth="0")

        inner_url = f"/dav/{self.base_name}/Doomed/inner.txt"
        response = self._delete(f"/dav/{self.base_name}/Doomed", headers={"If": f"<{inner_url}> (<{token}>)"})
        self.assertEqual(response.status_code, 204)

        # the bulk stamp trashes the subtree, not only the node the URL named
        self.assertEqual(self._state(doomed), "Trashed")
        self.assertEqual(self._state(inner.name), "Trashed")
        self.assertFalse(self._resolve("Doomed").exists)
        self.assertFalse(self._resolve("Doomed", "inner.txt").exists)
        self.assertIsNone(locks.find_lock(token))

    def test_delete_refusals(self):
        """RFC 4918 §9.6: a missing URL is 404; the mount itself is refused."""
        with self.assertRaises(NotFoundError):
            self._delete(f"/dav/{self.base_name}/never-there.txt")
        for mount in ("/dav/", "/dav"):
            with self.subTest(path=mount), self.assertRaises(Forbidden):
                self._delete(mount)

    def test_delete_requires_edit_on_the_node(self):
        """§12.1: DELETE takes EDIT, so READ alone is 403 and the node stays."""
        protected = file_node(OWNER, self.base, "keep.txt", b"safe")
        grant(protected.name, "$GENERAL", READ, node_principals(OWNER))

        with self.assertRaises(DriveForbidden):
            self._delete(f"/dav/{self.base_name}/keep.txt")
        self.assertEqual(self._state(protected.name), "Active")

    def test_a_write_verb_hides_an_unreadable_node_as_404(self):
        """§12.1: below READ is 404, never 403, on every write verb.

        A 403 would make DELETE and MOVE an existence oracle for a resource
        the caller cannot see. `require` refuses below READ with the engine's
        own not-found, which `errors.map_exception` turns into 404.
        """
        secret = file_node(OWNER, self.base, "hidden.txt", b"nope")
        grant(secret.name, "$GENERAL", NONE, node_principals(OWNER))

        path = f"/dav/{self.base_name}/hidden.txt"
        with self.assertRaises(DriveNotFound):
            self._delete(path)
        with self.assertRaises(DriveNotFound):
            structure.handle_move(
                make_ctx(
                    "MOVE",
                    path,
                    OWNER,
                    headers={"Destination": f"/dav/{self.base_name}/stolen.txt"},
                )
            )
        self.assertEqual(self._state(secret.name), "Active")

    def test_delete_honours_if_match_and_if_none_match(self):
        """RFC 7232: a validator that does not match is 412 and no mutation."""
        victim = file_node(OWNER, self.base, "conditional.txt", SIZED)
        path = f"/dav/{self.base_name}/conditional.txt"

        with self.assertRaises(PreconditionFailed):
            self._delete(path, headers={"If-Match": '"not-the-etag"'})
        with self.assertRaises(PreconditionFailed):
            self._delete(path, headers={"If-None-Match": "*"})
        self.assertEqual(self._state(victim.name), "Active")

        # the strong validator PROPFIND and GET publish is the blob's checksum
        response = self._delete(path, headers={"If-Match": f'"{victim.checksum}"'})
        self.assertEqual(response.status_code, 204)
        self.assertEqual(self._state(victim.name), "Trashed")

    # --- shared guards ---

    def test_a_foreign_depth_infinity_lock_refuses_mkcol_and_delete(self):
        """RFC 4918 §7.1: a lock covers the member list and the whole subtree.

        The token belongs to somebody else, so no submission the caller could
        make satisfies it: `locks.enforce` refuses both verbs with 423.
        """
        victim = file_node(OWNER, self.base, "under-lock.txt", b"held")
        self._lock(self.base, STRANGER)

        # MKCOL is guarded through `membership_parent`: adding a member changes
        # the locked collection even though the collection itself is untouched
        with self.assertRaises(Locked) as caught:
            self._mkcol(f"/dav/{self.base_name}/Intruder")
        self.assertEqual(caught.exception.status, 423)
        self.assertFalse(self._resolve("Intruder").exists)

        # DELETE is guarded through the node's own ancestor chain
        with self.assertRaises(Locked):
            self._delete(f"/dav/{self.base_name}/under-lock.txt")
        self.assertEqual(self._state(victim.name), "Active")

    def test_a_content_document_is_not_reachable_by_mkcol_or_delete(self):
        """§12.2: a `document` node has no DAV URL, so neither verb reaches it.

        DELETE 404s on the segment. MKCOL cannot see the collision either, and
        the workflow refuses it under the parent's row lock, so a client cannot
        quietly take the title a hidden document holds.
        """
        deck = raw_document_node(self.base, "Deck")

        with self.assertRaises(NotFoundError):
            self._delete(f"/dav/{self.base_name}/Deck")
        with self.assertRaises(DriveConflict):
            self._mkcol(f"/dav/{self.base_name}/Deck")
        # the walk cannot descend through it either
        with self.assertRaises(Conflict):
            self._mkcol(f"/dav/{self.base_name}/Deck/Slides")

        self.assertEqual(self._state(deck), "Active")
        self.assertEqual(frappe.db.get_value("Drive Node", deck, "kind"), "document")

    def test_a_trashed_title_is_reusable(self):
        """§8.1: only an active sibling collides, so a deleted name comes free."""
        original = file_node(OWNER, self.base, "cycle.txt", b"v1")
        self._delete(f"/dav/{self.base_name}/cycle.txt")

        response = self._mkcol(f"/dav/{self.base_name}/cycle.txt")
        self.assertEqual(response.status_code, 201)

        replacement = self._resolve("cycle.txt")
        self.assertTrue(replacement.is_collection)
        self.assertNotEqual(replacement.node.name, original.name)

    def test_delete_keeps_the_bytes_charged_until_purge(self):
        """§8.4: a trash releases nothing; only `purge` moves the counter.

        `_core.quota.get_storage_usage` is the authoritative reading, and it is
        what a client's quota-available-bytes property is built from, so the
        two have to agree about what DELETE did.
        """
        before = get_storage_usage(self.root).used_bytes
        victim = file_node(OWNER, self.base, "sized.bin", SIZED)
        charged = get_storage_usage(self.root).used_bytes
        self.assertEqual(charged, before + victim.size)

        response = self._delete(f"/dav/{self.base_name}/sized.bin")
        self.assertEqual(response.status_code, 204)
        # the bytes are still recoverable, so they are still spent
        self.assertEqual(get_storage_usage(self.root).used_bytes, charged)

        node_core.purge(node_principals(OWNER), victim.name)
        self.assertEqual(get_storage_usage(self.root).used_bytes, before)
