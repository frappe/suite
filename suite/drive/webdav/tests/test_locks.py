"""LOCK and UNLOCK against the single Personal Root mount.

RFC 4918 §7.3 replaced lock-null resources with "create the resource, then
lock it", so a LOCK at an unmapped URL creates §8.5's empty node under UPLOAD
on the parent and answers 201 (§12.3). A lock is satisfied only when its own
owner submits its token, and a target the caller cannot read answers exactly
as an unmapped one does (§12.1).

The namespace is the caller's own Personal Root and nothing else (§12), so a
second user has no URL for any node in this root. The cases that need a lock
somebody else holds write that row through `locks.create_lock` and say so.
"""

from datetime import timedelta
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase, UnitTestCase
from lxml import etree

from suite.drive._core import nodes as node_core
from suite.drive._core.access import grant
from suite.drive._core.errors import DriveConflict, DriveForbidden, DriveNotFound
from suite.drive._core.roles import NONE, READ
from suite.drive.webdav import copy as copy_module
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
    map_exception,
)
from suite.drive.webdav.properties import compute_etag
from suite.drive.webdav.tests.utils import (
    drop_dav_root,
    file_node,
    folder_node,
    make_ctx,
    node_principals,
    personal_dav_root,
    raw_document_node,
    reset_dav_request,
)
from suite.drive.webdav.xmlutil import dav, parse_xml
from suite.tests.utils import ensure_user

OWNER = "webdav-locks-owner@example.com"
STRANGER = "webdav-locks-stranger@example.com"

OWNER_HREF = "mailto:owner@example.com"
LOCKINFO_EXCLUSIVE = (
    b'<?xml version="1.0"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope>'
    b"<D:locktype><D:write/></D:locktype>"
    b"<D:owner><D:href>mailto:owner@example.com</D:href></D:owner></D:lockinfo>"
)
LOCKINFO_SHARED = LOCKINFO_EXCLUSIVE.replace(b"exclusive", b"shared")
FOREIGN_OWNER_XML = f'<D:owner xmlns:D="DAV:"><D:href>{OWNER_HREF}</D:href></D:owner>'


class TestWebDAVLocks(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(OWNER)
        # STRANGER never addresses a URL here; the user exists because
        # `Drive DAV Lock.owner_user` is a `User` link
        ensure_user(STRANGER)
        cls.root = personal_dav_root(OWNER)
        # the dispatcher commits mid-request, so the fixtures have to be
        # durable and are dropped explicitly rather than rolled back
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.set_user("Administrator")
        cls._drop_locks()
        drop_dav_root(OWNER)
        # `ensure_user(STRANGER)` provisioned a root through `after_user_insert`
        # and `setUpClass` committed it. Nothing else here addresses it, so it
        # would otherwise stay on the site after the class is gone.
        drop_dav_root(STRANGER)
        frappe.db.commit()
        super().tearDownClass()

    def setUp(self):
        super().setUp()
        frappe.set_user(OWNER)
        # one folder per case: the class shares a transaction, so a fixed
        # title would collide with the case that ran before it
        self.folder_name = f"Lk-{frappe.generate_hash(length=6)}"
        self.folder = folder_node(OWNER, self.root, self.folder_name)
        # the fixtures hold node ids: every call below names a node, never a row
        self.doc = file_node(OWNER, self.folder, "doc.docx", b"office file").name
        self.other = file_node(OWNER, self.folder, "other.txt", b"other bytes").name
        self.base = f"/dav/{self.folder_name}"
        self.doc_path = f"{self.base}/doc.docx"
        self.other_path = f"{self.base}/other.txt"

    def tearDown(self):
        self._drop_locks()
        frappe.set_user("Administrator")
        reset_dav_request()
        super().tearDown()

    @classmethod
    def _drop_locks(cls):
        """Every lock row on this mount, and only on this mount.

        A lock the caller does not own cannot be released over the wire, and a
        node a case denied `$GENERAL` on cannot be read back, so the rows go by
        entity. Another module's rows are not this suite's to drop.
        """
        mine = frappe.get_all("Drive Node", filters={"root": cls.root}, pluck="name")
        if mine:
            frappe.db.delete("Drive DAV Lock", {"entity": ["in", mine]})

    # --- helpers ---

    def _lock(self, path: str, user: str = OWNER, body: bytes = LOCKINFO_EXCLUSIVE, **headers):
        return lock_module.handle_lock(make_ctx("LOCK", path, user, data=body, headers=headers))

    def _refresh(self, path: str, token: str, user: str = OWNER, **headers):
        """An empty-body LOCK carrying the token in an If header."""
        return lock_module.handle_lock(
            make_ctx("LOCK", path, user, headers={"If": f"(<{token}>)", **headers})
        )

    def _unlock(self, path: str, token: str, user: str = OWNER):
        return lock_module.handle_unlock(make_ctx("UNLOCK", path, user, headers={"Lock-Token": f"<{token}>"}))

    def _foreign_lock(self, node: str, lock_root: str, *, depth: str = "0") -> str:
        """One lock row somebody other than OWNER holds.

        One mount gives a second user no URL for a node in OWNER's root (§12),
        so the row is written through the lifecycle call rather than over the
        wire. Ownership is what UNLOCK, refresh, enforcement and lockdiscovery
        redaction all answer for, and this is the only way to state it.
        """
        return locks.create_lock(
            node,
            scope="Exclusive",
            depth=depth,
            owner_user=STRANGER,
            owner_xml=FOREIGN_OWNER_XML,
            requested_timeout=600,
            lock_root=lock_root,
        ).token

    def _make_unreadable(self, node: str) -> None:
        """Deny `$GENERAL` so the caller cannot read one node of their own.

        §11.2 refuses a deny that names a Personal Root's own owner inside it,
        so the deny names `$GENERAL`, which the caller carries as well.
        Nearest depth beats identity tier (§5.1), so the node answers NONE
        while the folder above it stays readable.
        """
        grant(node, "$GENERAL", NONE, node_principals(OWNER))

    def _node_at(self, path: str):
        pathmap.reset_memo()
        segments = [segment for segment in path.split("/") if segment][1:]
        return pathmap.resolve(segments, OWNER).node

    @staticmethod
    def _token(response) -> str:
        return response.headers["Lock-Token"][1:-1]

    @staticmethod
    def _activelock(response):
        parsed = etree.fromstring(response.get_data())
        return parsed.find(f"{dav('lockdiscovery')}/{dav('activelock')}")

    # --- granting a lock ---

    def test_lock_and_discovery(self):
        """§12.1: LOCK answers 200 with the granted lock, token and all."""
        response = self._lock(self.doc_path, Timeout="Second-3600")
        self.assertEqual(response.status_code, 200)
        token = self._token(response)
        self.assertTrue(token.startswith("urn:uuid:"))

        active = self._activelock(response)
        self.assertIsNotNone(active.find(f"{dav('lockscope')}/{dav('exclusive')}"))
        self.assertEqual(active.find(f"{dav('locktoken')}/{dav('href')}").text, token)
        self.assertIn("doc.docx", active.find(f"{dav('lockroot')}/{dav('href')}").text)
        # Office's habitual hour is granted verbatim; remaining is live-computed
        remaining = int(active.find(dav("timeout")).text.removeprefix("Second-"))
        self.assertTrue(3590 < remaining <= 3600, remaining)
        # the client's own DAV:owner element round-trips (RFC 4918 §14.17)
        self.assertIn(OWNER_HREF, etree.tostring(active, encoding="unicode"))

    def test_the_lock_row_names_a_drive_node(self):
        """§12.3: `Drive DAV Lock.entity` holds a `Drive Node` id.

        Every read of the lock is on node identity: the row names the node the
        URL resolved to, and coverage matches that id. A lock anchored to
        anything else would block nothing and discover nothing.
        """
        token = self._token(self._lock(self.doc_path))

        entity = frappe.db.get_value("Drive DAV Lock", token, "entity")
        self.assertEqual(entity, self.doc)
        self.assertEqual(node_core.stored(entity).title, "doc.docx")
        self.assertEqual(locks.find_lock(token).entity, self.doc)
        self.assertEqual([lock.token for lock in locks.covering_locks(self.doc)], [token])

    def test_conflict_matrix(self):
        """RFC 4918 §6.1: exclusive conflicts with everything, shared only
        with exclusive.

        Both requests come from one user because one mount gives no second
        addressable caller. That is the real Office shape anyway: a second
        client of the same person, holding none of the first one's tokens.
        """
        self._lock(self.other_path, body=LOCKINFO_SHARED)
        self.assertEqual(self._lock(self.other_path, body=LOCKINFO_SHARED).status_code, 200)

        with self.assertRaises(Locked) as caught:
            self._lock(self.other_path, body=LOCKINFO_EXCLUSIVE)
        self.assertEqual(caught.exception.condition, "no-conflicting-lock")

        self._drop_locks()
        self._lock(self.other_path, body=LOCKINFO_EXCLUSIVE)
        for body in (LOCKINFO_EXCLUSIVE, LOCKINFO_SHARED):
            with self.assertRaises(Locked):
                self._lock(self.other_path, body=body)

    def test_a_second_lock_on_a_resource_the_caller_already_locked_is_refused(self):
        """RFC 4918 §9.10.5's table: exclusive conflicts with everything, and
        "It is illegal for a principal to request the same lock twice."

        Exempting a lock whose token the caller submitted minted a second
        token over the same node. `locks.enforce` then wanted both, so the
        holder could write with neither until one expired, and UNLOCK of
        either did not free the file.
        """
        token = self._token(self._lock(self.doc_path))

        with self.assertRaises(Locked):
            self._lock(self.doc_path, **{"If": f"(<{token}>)"})
        with self.assertRaises(Locked):
            self._lock(self.doc_path, body=LOCKINFO_SHARED, **{"If": f"(<{token}>)"})

        # exactly one lock, and the token the client holds still writes
        self.assertEqual(len(locks.covering_locks(self._node_at(self.doc_path).name)), 1)
        response = put.handle(
            make_ctx("PUT", self.doc_path, OWNER, data=b"still mine", headers={"If": f"(<{token}>)"})
        )
        self.assertEqual(response.status_code, 204)

    def test_a_depth_infinity_lock_refuses_a_member_it_cannot_lock(self):
        """RFC 4918 §9.10.3: "If the lock cannot be granted to all resources,
        the server MUST return a Multi-Status response ... Either the entire
        hierarchy is locked or no resources are locked."

        §5.1's nearest-wins lets a deeper `$GENERAL` row lower the caller
        inside their own root, so EDIT on the collection alone handed out a
        lock over a member the very next PUT would refuse.
        """
        collection = self._node_at(self.base).name
        member = folder_node(OWNER, collection, "ReadOnly")
        grant(member, "$GENERAL", READ, node_principals(OWNER))

        response = self._lock(self.base, Depth="infinity")
        self.assertEqual(response.status_code, 207)
        self.assertNotIn("Lock-Token", response.headers)

        parsed = etree.fromstring(response.get_data())
        answers = {
            entry.find(dav("href")).text: entry.find(dav("status")).text
            for entry in parsed.findall(dav("response"))
        }
        self.assertEqual(answers[f"{self.base}/ReadOnly/"], "HTTP/1.1 403 Forbidden")
        self.assertEqual(answers[f"{self.base}/"], "HTTP/1.1 424 Failed Dependency")

        # no resource is locked, so the collection still takes an ordinary write
        self.assertEqual(locks.covering_locks(collection), [])
        self.assertEqual(
            structure.handle_mkcol(make_ctx("MKCOL", f"{self.base}/After", OWNER)).status_code, 201
        )

    def test_a_depth_infinity_lock_is_granted_when_every_member_is_editable(self):
        """The check costs one query and refuses nothing on an ordinary tree."""
        collection = self._node_at(self.base).name
        folder_node(OWNER, collection, "Ordinary")

        response = self._lock(self.base, Depth="infinity")
        self.assertEqual(response.status_code, 200)
        self.assertIn("Lock-Token", response.headers)

    def test_lock_depth_one_is_400(self):
        """RFC 4918 §9.10.3: a lock is depth 0 or infinity."""
        with self.assertRaises(BadRequest):
            self._lock(self.doc_path, Depth="1")

    def test_the_mount_itself_cannot_be_locked(self):
        """§12: `/dav/` is the Personal Root, and the root is not a resource
        a client may take a write lock on."""
        with self.assertRaises(Forbidden):
            self._lock("/dav/")

    def test_lock_authorizes_an_existing_node_with_edit(self):
        """§12.1: LOCK needs EDIT, and below READ it is 404 rather than 403.

        The grant names `$GENERAL` for the reason `_make_unreadable` states;
        READ there is what proves EDIT is the bar, since the caller keeps READ
        on the node and still cannot lock it. The two roles land on two nodes
        because a caller who is no longer MANAGE on a node cannot grant on it
        a second time.
        """
        grant(self.other, "$GENERAL", READ, node_principals(OWNER))
        with self.assertRaises(DriveForbidden):
            self._lock(self.other_path)

        hidden = file_node(OWNER, self.folder, "hidden.txt", b"hidden")
        self._make_unreadable(hidden.name)
        with self.assertRaises(DriveNotFound) as caught:
            self._lock(f"{self.base}/hidden.txt")
        self.assertEqual(map_exception(caught.exception).status, 404)

    def test_a_hidden_document_node_is_not_lockable(self):
        """§12.2: a content document is not reachable over DAV, LOCK included.

        The walk cannot see the node, so LOCK reads the URL as unmapped and
        tries to mint one there. The sibling collision refuses that, so no
        shadow node is created and the document is neither locked nor
        overwritten.
        """
        document = raw_document_node(self.folder, "Notes")

        with self.assertRaises(DriveConflict):
            self._lock(f"{self.base}/Notes")

        self.assertFalse(frappe.db.exists("Drive DAV Lock", {"entity": document}))
        self.assertEqual(node_core.stored(document).kind, "document")
        # no shadow file was left at the URL either
        self.assertIsNone(self._node_at(f"{self.base}/Notes"))

    # --- LOCK on an unmapped URL (§12.3) ---

    def test_lock_unmapped_url_creates_an_empty_node(self):
        """§12.3: LOCK at an unmapped URL creates §8.5's empty head and 201s.

        RFC 4918 §7.3 asks for "create the resource, then lock it", and the
        resource a client is about to PUT into holds no bytes yet: no blob, no
        size and no MIME, so nothing is stored and nothing is charged.
        """
        path = f"{self.base}/fresh.docx"
        response = self._lock(path)
        self.assertEqual(response.status_code, 201)
        self.assertTrue(self._token(response).startswith("urn:uuid:"))

        row = self._node_at(path)
        self.assertIsNotNone(row)
        self.assertEqual(row.kind, "file")
        self.assertEqual(row.state, "Active")
        self.assertFalse(row.blob)
        self.assertEqual(int(row.size or 0), 0)
        self.assertFalse(row.mime)

    def test_lock_unmapped_url_requires_upload_on_the_parent(self):
        """§12.1: the role for a create is UPLOAD on the collection."""
        grant(self.folder, "$GENERAL", READ, node_principals(OWNER))
        with self.assertRaises(DriveForbidden):
            self._lock(f"{self.base}/fresh.docx")
        self.assertIsNone(self._node_at(f"{self.base}/fresh.docx"))

    def test_lock_put_unlock_is_the_office_flow(self):
        """RFC 4918 §7.3: the created resource is locked, so only the token
        holder may write it, and UNLOCK frees it again."""
        path = f"{self.base}/fresh.docx"
        token = self._token(self._lock(path))

        response = put.handle(make_ctx("PUT", path, OWNER, data=b"content", headers={"If": f"(<{token}>)"}))
        self.assertEqual(response.status_code, 204)
        with self.assertRaises(Locked):
            put.handle(make_ctx("PUT", path, OWNER, data=b"no-token"))

        self.assertEqual(self._unlock(path, token).status_code, 204)
        self.assertEqual(put.handle(make_ctx("PUT", path, OWNER, data=b"unlocked now")).status_code, 204)

    def test_an_unused_lock_leaves_its_empty_node_behind(self):
        """§12.3: nothing purges the node when the lock ends unused.

        The node holds no blob, so an expired or released lock leaves an empty
        file exactly where the client asked for one, which is what a client
        that crashed between LOCK and PUT comes back to.
        """
        expired_path = f"{self.base}/expired.docx"
        released_path = f"{self.base}/released.docx"
        expired = self._token(self._lock(expired_path))
        released = self._token(self._lock(released_path))

        frappe.db.set_value(
            "Drive DAV Lock",
            expired,
            "expires_at",
            frappe.utils.now_datetime() - timedelta(seconds=5),
            update_modified=False,
        )
        locks.purge_expired_locks(lazy=True)
        self._unlock(released_path, released)

        self.assertIsNone(locks.find_lock(expired))
        self.assertIsNone(locks.find_lock(released))
        for path in (expired_path, released_path):
            row = self._node_at(path)
            self.assertEqual(row.state, "Active", path)
            self.assertFalse(row.blob, path)

    def test_unmapped_urls_that_cannot_mint_a_node(self):
        """RFC 4918 §7.3: only a mappable URL gets the create.

        A collection URL would mint a file at a name the client spelled as a
        folder, and a missing intermediate has no parent to create under.
        Both are 409.
        """
        with self.assertRaises(Conflict):
            self._lock(f"{self.base}/nonexistent/")
        with self.assertRaises(Conflict):
            self._lock(f"{self.base}/nope/deep.docx")

    def test_lock_cap_rejects_before_creating_the_node(self):
        """§12.3: the per-user cap is checked before anything is written, so a
        refused LOCK never leaves an empty node behind."""
        path = f"{self.base}/capped.docx"
        with patch.object(locks, "MAX_ACTIVE_LOCKS_PER_USER", 0):
            with self.assertRaises(InsufficientStorage):
                self._lock(path)
        self.assertIsNone(self._node_at(path))

    # --- enforcement ---

    def test_lock_blocks_writes_without_the_token(self):
        """RFC 4918 §7: a write needs the token, from the lock's own owner.

        The lock holder's other client has no token either, so it is blocked
        the same way the file's next writer is.
        """
        token = self._token(self._lock(self.doc_path))

        with self.assertRaises(Locked):
            put.handle(make_ctx("PUT", self.doc_path, OWNER, data=b"stomp"))
        response = put.handle(
            make_ctx("PUT", self.doc_path, OWNER, data=b"proper", headers={"If": f"(<{token}>)"})
        )
        self.assertEqual(response.status_code, 204)

    def test_a_leaked_token_grants_nothing(self):
        """RFC 4918 §6.4: possession of a token is not authority.

        The lock is somebody else's, so submitting its token satisfies
        nothing: the write is still 423.
        """
        token = self._foreign_lock(self.doc, self.doc_path)

        with self.assertRaises(Locked):
            put.handle(make_ctx("PUT", self.doc_path, OWNER, data=b"stomp", headers={"If": f"(<{token}>)"}))

    def test_depth_infinity_lock_covers_the_whole_subtree(self):
        """RFC 4918 §7.1: a depth-infinity collection lock reaches every
        descendant, and every mutating verb consults it.

        PUT, DELETE, MKCOL, MOVE and COPY all call the one enforcement guard,
        so the lock answers for a member's bytes, for a new member anywhere
        below, and for a member leaving.
        """
        file_node(OWNER, self.root, f"{self.folder_name}.txt", b"source")
        token = self._token(self._lock(self.base, Depth="infinity"))

        with self.assertRaises(Locked):
            put.handle(make_ctx("PUT", self.doc_path, OWNER, data=b"x"))
        with self.assertRaises(Locked):
            structure.handle_mkcol(make_ctx("MKCOL", f"{self.base}/NewDir", OWNER))
        with self.assertRaises(Locked):
            structure.handle_delete(make_ctx("DELETE", self.doc_path, OWNER))
        with self.assertRaises(Locked):
            structure.handle_move(
                make_ctx("MOVE", self.doc_path, OWNER, headers={"Destination": f"{self.base}/mv.txt"})
            )
        with self.assertRaises(Locked):
            copy_module.handle(
                make_ctx(
                    "COPY",
                    f"/dav/{self.folder_name}.txt",
                    OWNER,
                    headers={"Destination": f"{self.base}/copied.txt"},
                )
            )

        response = put.handle(
            make_ctx("PUT", self.doc_path, OWNER, data=b"fine", headers={"If": f"(<{token}>)"})
        )
        self.assertEqual(response.status_code, 204)
        for path in (f"{self.base}/NewDir", f"{self.base}/mv.txt", f"{self.base}/copied.txt"):
            self.assertIsNone(self._node_at(path), path)

    def test_a_lock_below_a_collection_refuses_deleting_or_moving_it(self):
        """RFC 4918 §9.6.1: DELETE of a collection fails if any member is
        locked, "even if the resource was not locked itself".

        This is the descendant direction of the subtree walk, the one an
        ancestor lock cannot stand in for: the lock is strictly below the URL
        the client named, so nothing on the target's own ancestry carries it.
        MOVE removes the collection from its parent too, so it answers alike.
        """
        self._foreign_lock(self.doc, self.doc_path)

        with self.assertRaises(Locked):
            structure.handle_delete(make_ctx("DELETE", self.base, OWNER))
        with self.assertRaises(Locked):
            structure.handle_move(
                make_ctx(
                    "MOVE",
                    self.base,
                    OWNER,
                    headers={"Destination": f"/dav/{self.folder_name}-moved", "Depth": "infinity"},
                )
            )
        # the collection is still there, with its member
        self.assertIsNotNone(self._node_at(self.doc_path))

    def test_a_lock_request_evaluates_the_if_header_conditions(self):
        """RFC 4918 §10.4.1: the If header is not method-specific.

        LOCK cannot call `locks.enforce` - its own rule is §9.10.5's table, not
        the write gate - so the conditions are evaluated on their own. A state
        token or ETag the client asserted and the server cannot match is 412,
        and a true one leaves the lock granted.
        """
        # `compute_etag` returns the entity-tag already quoted, and that is the
        # form the client reads off `getetag` and writes back between brackets
        etag = compute_etag(node_core.stored(self.doc))

        with self.assertRaises(PreconditionFailed):
            self._lock(self.doc_path, **{"If": '(["not-the-etag"])'})
        self.assertEqual(frappe.db.count("Drive DAV Lock", {"entity": self.doc}), 0)

        response = self._lock(self.doc_path, **{"If": f"([{etag}])"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(frappe.db.count("Drive DAV Lock", {"entity": self.doc}), 1)

    def test_depth_zero_collection_lock_protects_membership_only(self):
        """RFC 4918 §7.4: a depth-0 collection lock protects the member list,
        and nothing below it."""
        self._lock(self.base, Depth="0")

        with self.assertRaises(Locked):
            structure.handle_mkcol(make_ctx("MKCOL", f"{self.base}/Blocked", OWNER))
        response = put.handle(make_ctx("PUT", self.doc_path, OWNER, data=b"ok"))
        self.assertEqual(response.status_code, 204)

    def test_if_condition_fails_before_the_lock_check(self):
        """RFC 4918 §10.4: a failed If condition is 412, whatever the lock
        state is (litmus complex_cond_put)."""
        token = self._token(self._lock(self.doc_path))

        with self.assertRaises(PreconditionFailed):
            put.handle(
                make_ctx(
                    "PUT", self.doc_path, OWNER, data=b"x", headers={"If": f'(<{token}> ["wrong-etag"])'}
                )
            )
        with self.assertRaises(BadRequest):
            put.handle(make_ctx("PUT", self.doc_path, OWNER, data=b"x", headers={"If": "(corrupt"}))

    def test_the_litmus_complex_conditional_writes_and_refuses(self):
        """litmus `locks:complex_cond_put` and `locks:fail_complex_cond_put`.

        Both send `(<token> [etag]) (Not <DAV:no-lock> [etag])`, the exact
        format string in the shipped litmus 0.13 `locks` binary. The pair
        differs only in the ETag: the real one must let the PUT happen, and a
        corrupted one must be 412 on both alternatives, because
        `Not <DAV:no-lock>` is ANDed with the entity-tag rather than standing
        in for the whole list.

        litmus itself cannot get either header to us intact — it formats them
        into a 200-byte buffer and §12.4's SHA-256 tag makes the header 207.
        See `TestLitmusComplexConditional` and litmus_expected.txt.
        """
        token = self._token(self._lock(self.doc_path))
        etag = compute_etag(node_core.stored(self.doc))
        # litmus corrupts the tag the way `fail_complex_cond_put` does:
        # `pnt = etag + strlen(etag) - 3; (*pnt)++`. One byte, inside the
        # quotes. An all-zero tag would be a far easier thing to tell apart.
        stale = etag[:-3] + chr(ord(etag[-3]) + 1) + etag[-2:]
        complex_if = "(<%s> [%s]) (Not <DAV:no-lock> [%s])"

        response = put.handle(
            make_ctx(
                "PUT",
                self.doc_path,
                OWNER,
                data=b"written under the complex conditional",
                headers={"If": complex_if % (token, etag, etag)},
            )
        )
        self.assertEqual(response.status_code, 204)

        landed = node_core.stored(self.doc).blob
        with self.assertRaises(PreconditionFailed):
            put.handle(
                make_ctx(
                    "PUT",
                    self.doc_path,
                    OWNER,
                    data=b"must not land",
                    headers={"If": complex_if % (token, stale, stale)},
                )
            )
        self.assertEqual(node_core.stored(self.doc).blob, landed)

    def test_a_truncated_complex_conditional_is_refused_not_guessed(self):
        """A conditional cut off mid entity-tag is not §10.4 grammar, and the
        write it guards must not happen on the half that arrived."""
        token = self._token(self._lock(self.doc_path))
        etag = compute_etag(node_core.stored(self.doc))
        header = f"(<{token}> [{etag}]) (Not <DAV:no-lock> [{etag}])"
        # the header litmus wants to send, against the buffer it has: 30
        # literal characters, a 45-character `urn:uuid` token and §12.4's
        # 66-character quoted SHA-256 tag twice. A shorter tag would end the
        # ledger line, so pin the arithmetic here rather than let it drift.
        self.assertEqual(len(header), 207)
        before = node_core.stored(self.doc).blob

        with self.assertRaises(BadRequest):
            put.handle(make_ctx("PUT", self.doc_path, OWNER, data=b"x", headers={"If": header[:199]}))
        self.assertEqual(node_core.stored(self.doc).blob, before)

    def test_if_header_cannot_probe_an_unreadable_resource(self):
        """§12.1: a tagged condition on an unreadable URL evaluates as unmapped.

        Otherwise the observable 412 reports whether a node exists and what
        its ETag is to anyone who can name its URL.
        """
        hidden = file_node(OWNER, self.folder, "secret.txt", b"secret")
        condition = {"If": f"<{self.base}/secret.txt> ([{compute_etag(node_core.stored(hidden.name))}])"}

        # while it is readable the condition is evaluated for real
        response = put.handle(make_ctx("PUT", self.doc_path, OWNER, data=b"x", headers=condition))
        self.assertEqual(response.status_code, 204)

        self._make_unreadable(hidden.name)
        # a correct ETag guess must not turn the 412 off
        with self.assertRaises(PreconditionFailed):
            put.handle(make_ctx("PUT", self.doc_path, OWNER, data=b"x", headers=condition))

    def test_delete_and_move_drop_the_locks(self):
        """RFC 4918 §7.5: a lock does not survive unmapping, and does not
        travel with the resource."""
        token = self._token(self._lock(self.doc_path))
        response = structure.handle_delete(
            make_ctx("DELETE", self.doc_path, OWNER, headers={"If": f"(<{token}>)"})
        )
        self.assertEqual(response.status_code, 204)
        self.assertIsNone(locks.find_lock(token))

        token = self._token(self._lock(self.other_path))
        structure.handle_move(
            make_ctx(
                "MOVE",
                self.other_path,
                OWNER,
                headers={"Destination": f"{self.base}/moved.txt", "If": f"(<{token}>)"},
            )
        )
        self.assertIsNone(locks.find_lock(token))

    def test_purging_a_node_drops_its_lock_rows(self):
        """§8.10: a purge takes the node's DAV rows with it.

        The lock's entity is a `Drive Node` link, so a row left behind would
        outlive the node it names.
        """
        token = self._token(self._lock(self.doc_path))
        node_core.purge(node_principals(OWNER), self.doc)

        self.assertFalse(frappe.db.exists("Drive DAV Lock", token))
        self.assertIsNone(locks.find_lock(token))

    def test_an_expired_lock_stops_blocking_and_is_purged(self):
        """RFC 4918 §6.6: a lock lapses on its own, with no request to end it."""
        token = self._token(self._lock(self.doc_path, Timeout="Second-60"))
        frappe.db.set_value(
            "Drive DAV Lock",
            token,
            "expires_at",
            frappe.utils.now_datetime() - timedelta(seconds=5),
            update_modified=False,
        )

        response = put.handle(make_ctx("PUT", self.doc_path, OWNER, data=b"free"))
        self.assertEqual(response.status_code, 204)
        self.assertIsNone(locks.find_lock(token))

    # --- refresh (§12.3) ---

    def test_refresh_extends_the_timeout(self):
        """RFC 4918 §9.10.2: an empty-body LOCK with the token refreshes it.

        A refresh grants no new lock, so it carries no Lock-Token header.
        """
        token = self._token(self._lock(self.doc_path, Timeout="Second-60"))

        response = self._refresh(self.doc_path, token, Timeout="Second-1200")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("Lock-Token", response.headers)
        self.assertGreater(locks.find_lock(token).remaining, 600)

    def test_refresh_takes_the_same_edit_the_lock_took(self):
        """§12.1 gives LOCK on an existing node EDIT, and a refresh is that
        same LOCK.

        On READ alone a holder whose grant had since been lowered could keep
        the write lock alive for as long as they kept asking, and
        `locks.enforce` refuses every non-owner, so the owner stayed locked
        out of their own file by a role that cannot write it.
        """
        token = self._token(self._lock(self.doc_path))
        grant(self._node_at(self.doc_path).name, "$GENERAL", READ, node_principals(OWNER))

        with self.assertRaises(DriveForbidden):
            self._refresh(self.doc_path, token)

    def test_a_refresh_evaluates_the_if_conditions_it_carries(self):
        """RFC 4918 §10.4.1 gates a refresh exactly as it gates the LOCK that
        minted the lock.

        `_create` evaluated the conditions and `_refresh` did not, so a client
        could keep a lock alive on an ETag that had stopped holding: the very
        state it was submitting the header to assert. The plain
        `(<token>)` refresh above is unaffected, because the token is active.
        """
        token = self._token(self._lock(self.doc_path))
        etag = compute_etag(node_core.stored(self.doc))
        stale = etag[:-3] + chr(ord(etag[-3]) + 1) + etag[-2:]

        self.assertEqual(
            self._refresh(self.doc_path, token, **{"If": f"(<{token}> [{etag}])"}).status_code, 200
        )

        with self.assertRaises(PreconditionFailed):
            self._refresh(self.doc_path, token, **{"If": f"(<{token}> [{stale}])"})
        # the lock the refresh was asking about is still there and unextended
        self.assertIsNotNone(locks.find_lock(token))

    def test_a_refresh_ignores_the_depth_header(self):
        """RFC 4918 §9.10.2: "A server MUST ignore the Depth header on a LOCK
        refresh." A client that stamps `Depth: 1` on everything it sends would
        otherwise lose the lock it is asking to keep."""
        token = self._token(self._lock(self.doc_path))
        self.assertEqual(self._refresh(self.doc_path, token, Depth="1").status_code, 200)

    def test_refresh_by_a_non_owner_is_403(self):
        """§12.1: only the lock's owner may extend its lifetime."""
        token = self._foreign_lock(self.other, self.other_path)
        with self.assertRaises(Forbidden):
            self._refresh(self.other_path, token)

    def test_refresh_on_an_unreadable_target_is_412(self):
        """§12.1: an unreadable target reads as unmapped, so 412 beats 403.

        The 403 above would otherwise confirm both the hidden node and the
        lock on it to anyone holding a leaked token.
        """
        token = self._foreign_lock(self.other, self.other_path)
        self._make_unreadable(self.other)

        with self.assertRaises(PreconditionFailed):
            self._refresh(self.other_path, token)

    def test_refresh_without_a_covering_token_is_412(self):
        """RFC 4918 §9.10.2: a refresh names the lock it refreshes."""
        token = self._token(self._lock(self.doc_path))

        with self.assertRaises(PreconditionFailed):
            lock_module.handle_lock(make_ctx("LOCK", self.doc_path, OWNER))
        with self.assertRaises(PreconditionFailed):
            self._refresh(self.other_path, token)

    # --- UNLOCK (§12.1) ---

    def test_unlock_statuses(self):
        """RFC 4918 §9.11: a Lock-Token that does not name a lock on this URL
        is 409, and a missing one is 400."""
        token = self._token(self._lock(self.doc_path))

        with self.assertRaises(BadRequest):
            lock_module.handle_unlock(make_ctx("UNLOCK", self.doc_path, OWNER))
        with self.assertRaises(Conflict) as caught:
            self._unlock(self.doc_path, "urn:uuid:00000000-0000-0000-0000-000000000000")
        self.assertEqual(caught.exception.condition, "lock-token-matches-request-uri")
        with self.assertRaises(Conflict):
            self._unlock(self.other_path, token)

        self.assertEqual(self._unlock(self.doc_path, token).status_code, 204)
        self.assertIsNone(locks.find_lock(token))

    def test_only_the_lock_owner_or_an_admin_may_unlock(self):
        """§12.1: ownership is preserved across the whole lock lifetime.

        A user who can write the node is still not the lock holder, so their
        UNLOCK is 403. A Suite Admin is the release valve for the editing
        session that crashed holding the token.
        """
        token = self._foreign_lock(self.doc, self.doc_path)

        with self.assertRaises(Forbidden):
            self._unlock(self.doc_path, token)

        with patch("suite.drive.framework.is_drive_admin", return_value=True):
            self.assertEqual(self._unlock(self.doc_path, token).status_code, 204)

    def test_unlock_on_an_unreadable_target_is_404(self):
        """§12.1: unreadable is 404, never 403 and never 409.

        The 409 an unknown token earns would otherwise be an existence oracle
        for a node the caller may not read.
        """
        self._make_unreadable(self.other)

        with self.assertRaises(DriveNotFound) as caught:
            self._unlock(self.other_path, "urn:uuid:00000000-0000-0000-0000-000000000000")
        self.assertEqual(map_exception(caught.exception).status, 404)

    def test_unlock_on_an_unmapped_url_is_404(self):
        """RFC 4918 §9.11: there is no lock at a URL that names nothing."""
        with self.assertRaises(NotFoundError):
            self._unlock(f"{self.base}/absent.txt", "urn:uuid:00000000-0000-0000-0000-000000000000")

    # --- discovery (§12.4) ---

    def test_propfind_reports_lockdiscovery(self):
        """RFC 4918 §15.8: the lock is discoverable on the node it names, and
        `supportedlock` is published for every resource."""
        token = self._token(self._lock(self.doc_path))

        ctx = make_ctx("PROPFIND", self.base, OWNER, headers={"Depth": "1"})
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

    def test_lockdiscovery_redacts_a_lock_the_viewer_does_not_own(self):
        """§12.4: a reader learns that a resource is locked, not by whom.

        The token is inert to a non-owner anyway, and the DAV:owner element
        would name whoever is editing the file.
        """
        self._foreign_lock(self.doc, self.doc_path)

        ctx = make_ctx("PROPFIND", self.base, OWNER, headers={"Depth": "1"})
        parsed = etree.fromstring(propfind.handle(ctx).get_data())
        checked = False
        for response in parsed.findall(dav("response")):
            if not response.find(dav("href")).text.endswith("doc.docx"):
                continue
            checked = True
            prop = response.find(f"{dav('propstat')}/{dav('prop')}")
            active = prop.find(dav("lockdiscovery")).find(dav("activelock"))
            self.assertIsNotNone(active.find(f"{dav('lockscope')}/{dav('exclusive')}"))
            self.assertIsNone(active.find(dav("locktoken")))
            self.assertNotIn(OWNER_HREF, etree.tostring(active, encoding="unicode"))
        self.assertTrue(checked, "doc.docx was not in the listing")


class TestLockRequestParsing(UnitTestCase):
    """The two request parsers, on their own.

    Site-free: `Timeout` and the `DAV:lockinfo` body are read before anything
    is resolved or written, so neither parser touches the database. Every
    refusal below is reachable from the wire, and none of them was exercised
    by a case that also needed a mount.
    """

    def _scope(self, body: bytes):
        return lock_module._parse_lockinfo(parse_xml(body))

    def test_timeout_header_choices(self):
        for header, expected in (
            (None, locks.DEFAULT_LOCK_TIMEOUT),
            ("", locks.DEFAULT_LOCK_TIMEOUT),
            ("Second-3600", 3600),  # Office sends this on every open
            ("Infinite", locks.MAX_LOCK_TIMEOUT),
            ("infinite, Second-30", locks.MAX_LOCK_TIMEOUT),
            # the first *supported* entry wins, not the first entry
            ("Bogus-9, Second-30", 30),
            ("Second-0", 1),
            ("Second-99999999", locks.MAX_LOCK_TIMEOUT),
            # unparseable is the default, never a crash out of every LOCK
            ("Second-", locks.DEFAULT_LOCK_TIMEOUT),
            ("Second-2.5", locks.DEFAULT_LOCK_TIMEOUT),
            ("Second--5", locks.DEFAULT_LOCK_TIMEOUT),
            ("garbage", locks.DEFAULT_LOCK_TIMEOUT),
        ):
            with self.subTest(header=header):
                self.assertEqual(locks.parse_timeout_header(header), expected)

    def test_lockinfo_scopes_and_owner(self):
        self.assertEqual(self._scope(LOCKINFO_EXCLUSIVE)[0], "Exclusive")
        self.assertEqual(self._scope(LOCKINFO_SHARED)[0], "Shared")
        self.assertIn(OWNER_HREF, self._scope(LOCKINFO_EXCLUSIVE)[1])
        # no DAV:owner at all is legal; the column simply stays empty
        bare = (
            b'<D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope>'
            b"<D:locktype><D:write/></D:locktype></D:lockinfo>"
        )
        self.assertEqual(self._scope(bare), ("Exclusive", None))

    def test_lockinfo_refusals(self):
        wrong_root = b'<D:prop xmlns:D="DAV:"/>'
        no_scope = b'<D:lockinfo xmlns:D="DAV:"><D:locktype><D:write/></D:locktype></D:lockinfo>'
        unknown_scope = LOCKINFO_EXCLUSIVE.replace(b"<D:exclusive/>", b"<D:local/>")
        for body in (wrong_root, no_scope, unknown_scope):
            with self.subTest(body=body), self.assertRaises(BadRequest):
                self._scope(body)

        # RFC 4918 §9.10.6 names DAV:lockinfo\'s own preconditions: a locktype
        # the server does not support is 412, not 400
        no_locktype = LOCKINFO_EXCLUSIVE.replace(
            b"<D:locktype><D:write/></D:locktype>", b"<D:locktype><D:read/></D:locktype>"
        )
        for body in (no_locktype, LOCKINFO_EXCLUSIVE.replace(b"<D:locktype><D:write/></D:locktype>", b"")):
            with self.subTest(body=body), self.assertRaises(PreconditionFailed):
                self._scope(body)

    def test_an_oversized_owner_element_is_refused(self):
        """DAV:owner is echoed into every lockdiscovery another reader sees, so
        it is capped like a dead property rather than stored as sent."""
        padding = b"x" * (lock_module.MAX_OWNER_XML_BYTES + 1)
        with self.assertRaises(BadRequest):
            self._scope(LOCKINFO_EXCLUSIVE.replace(b"mailto:owner@example.com", padding))
