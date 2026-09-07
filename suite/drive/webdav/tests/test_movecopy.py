"""MOVE and COPY against the single Personal Root mount.

Both verbs are one call into the shared node workflows: MOVE through
`_core.nodes.update`, COPY through §8.9's copy primitive. §12 gives the
namespace one mount, so every path below is inside the caller's own Personal
Root, and the cross-root refusal has to be provoked with a node charged to a
second Drive root.

Refusals are asserted as the status the client is given. A handler refuses
with its own `DAVError` and a workflow refuses with its own exception, which
the dispatcher maps (§12.1), so the Python class alone would not state the
requirement.
"""

import frappe
from frappe.tests import IntegrationTestCase
from lxml import etree

from suite.drive._core import nodes as node_core
from suite.drive._core.access import grant
from suite.drive._core.roles import NONE, READ
from suite.drive.webdav import copy as copy_module
from suite.drive.webdav import deadprops, locks, pathmap, structure
from suite.drive.webdav.errors import DAVError, map_exception
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
    reset_dav_request,
)

OWNER = "webdav-movecopy-owner@example.com"
NEIGHBOUR = "webdav-movecopy-neighbour@example.com"
PASSWORD = "webdav-movecopy-pw"
QUOTA = 10 * 1024 * 1024

PAYLOAD = b"move me"
DEEP = b"deep-data"

COLOUR = b'<z:colour xmlns:z="urn:z">indigo</z:colour>'
COLOUR_TAG = "{urn:z}colour"


def set_dead_prop(node: str) -> None:
    """One dead property on a node, written the way PROPPATCH writes it."""
    deadprops.upsert(node, etree.fromstring(COLOUR))


def dead_prop(node: str):
    return deadprops.get_dead_props([node]).get(node, {}).get(COLOUR_TAG)


class TestWebDAVMoveCopy(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user_with_password(OWNER, PASSWORD)
        ensure_user_with_password(NEIGHBOUR, PASSWORD)
        # a root of this suite's own, so the quota case has a stated limit
        # rather than whichever site default `Drive Disk Settings` carries
        drop_dav_root(OWNER)
        cls.root = personal_dav_root(OWNER, quota_bytes=QUOTA)
        # the neighbour's root is never mounted; it is here to be a second
        # `root` id, which is the only way §12's cross-root check is reachable
        cls.other_root = personal_dav_root(NEIGHBOUR)

    def setUp(self):
        super().setUp()
        frappe.set_user(OWNER)
        # writes are not rolled back between tests, so every case gets a tree
        # of its own rather than inheriting the last one's
        self.base_name = f"MC-{frappe.generate_hash(length=6)}"
        self.base = folder_node(OWNER, self.root, self.base_name)
        self.sub = folder_node(OWNER, self.base, "sub")
        self.file = file_node(OWNER, self.base, "b.txt", PAYLOAD)

    def tearDown(self):
        frappe.set_user("Administrator")
        reset_dav_request()
        super().tearDown()

    # -- harness ---------------------------------------------------------

    def _path(self, *segments: str) -> str:
        return "/".join(["/dav", self.base_name, *segments])

    def _move(self, path: str, destination: str, user: str = OWNER, overwrite: bool | None = None, **headers):
        headers["Destination"] = destination
        if overwrite is not None:
            headers["Overwrite"] = "T" if overwrite else "F"
        return structure.handle_move(make_ctx("MOVE", path, user, headers=headers))

    def _copy(self, path: str, destination: str, user: str = OWNER, **headers):
        headers["Destination"] = destination
        return copy_module.handle(make_ctx("COPY", path, user, headers=headers))

    def _resolve(self, path: str, user: str = OWNER) -> pathmap.ResolvedPath:
        pathmap.reset_memo()
        return pathmap.resolve([segment for segment in path.split("/") if segment], user)

    def _lock(self, entity: str, lock_root: str, depth: str = "0"):
        lock = locks.create_lock(
            entity,
            scope="Exclusive",
            depth=depth,
            owner_user=OWNER,
            owner_xml=None,
            requested_timeout=600,
            lock_root=lock_root,
        )
        self.addCleanup(locks.delete_lock, lock.token)
        return lock

    def assert_refused(self, status: int, call, *args, **kwargs) -> DAVError:
        """The status a client is given, whichever layer refused."""
        try:
            call(*args, **kwargs)
        except Exception as error:
            refusal = map_exception(error)
            self.assertEqual(refusal.status, status, f"{type(error).__name__}: {error}")
            return refusal
        raise AssertionError(f"expected a {status} refusal")

    # -- MOVE ------------------------------------------------------------

    def test_move_renames_in_place(self):
        """RFC 4918 §9.9: a MOVE inside one collection is a rename."""
        response = self._move(self._path("b.txt"), self._path("renamed.txt"))
        self.assertEqual(response.status_code, 201)

        moved = node_core.stored(self.file.name)
        self.assertEqual(moved.title, "renamed.txt")
        self.assertEqual(moved.parent, self.base)
        # the same blob: no byte of a moved file is rewritten
        self.assertEqual(moved.blob, self.file.blob)
        self.assertFalse(self._resolve(f"{self.base_name}/b.txt").exists)
        self.assertTrue(self._resolve(f"{self.base_name}/renamed.txt").exists)

    def test_move_reparents(self):
        """RFC 4918 §9.9: the same leaf name under a different collection."""
        response = self._move(self._path("b.txt"), self._path("sub", "b.txt"))
        self.assertEqual(response.status_code, 201)

        moved = node_core.stored(self.file.name)
        self.assertEqual(moved.parent, self.sub)
        self.assertEqual(moved.title, "b.txt")
        self.assertEqual(moved.blob, self.file.blob)

    def test_move_and_rename_lands_both_changes(self):
        """`_core.nodes.update` refuses a combined move and rename, so one
        request is two writes, and both have to land."""
        response = self._move(self._path("b.txt"), self._path("sub", "c.txt"))
        self.assertEqual(response.status_code, 201)

        moved = node_core.stored(self.file.name)
        self.assertEqual(moved.parent, self.sub)
        self.assertEqual(moved.title, "c.txt")
        self.assertTrue(self._resolve(f"{self.base_name}/sub/c.txt").exists)

    def test_move_and_rename_retries_in_the_other_order(self):
        """§8.6 refuses the move leg when the source's own title is taken at
        the destination, and the rename-first order is free to succeed."""
        blocker = file_node(OWNER, self.sub, "b.txt", b"already here")

        response = self._move(self._path("b.txt"), self._path("sub", "c.txt"))
        self.assertEqual(response.status_code, 201)

        moved = node_core.stored(self.file.name)
        self.assertEqual(moved.parent, self.sub)
        self.assertEqual(moved.title, "c.txt")
        # the sibling that forced the retry is untouched
        blocked = node_core.stored(blocker.name)
        self.assertEqual(blocked.title, "b.txt")
        self.assertEqual(blocked.parent, self.sub)

    def test_a_refused_move_and_rename_leaves_no_partial_effect(self):
        """Neither order can place a collection inside itself, and the client
        asked for one change, not half of one.

        §8.6 answers 409 whichever leg runs first, so the request has to end
        with the source exactly as it started: not renamed where it stands,
        not moved under its old title.
        """
        self.assert_refused(409, self._move, self._path(), self._path("sub", "inner"))

        source = node_core.stored(self.base)
        self.assertEqual(source.title, self.base_name)
        self.assertEqual(source.parent, self.root)

    def test_move_case_only_rename(self):
        """The case-insensitive fallback resolves the source itself, and the
        client still means to change its title."""
        response = self._move(self._path("b.txt"), self._path("B.TXT"))
        self.assertEqual(response.status_code, 201)
        self.assertEqual(node_core.stored(self.file.name).title, "B.TXT")

    def test_move_to_self_is_403(self):
        """RFC 4918 §9.9.4: source and destination naming one resource."""
        self.assert_refused(403, self._move, self._path("b.txt"), self._path("b.txt"))

    def test_move_overwrite_replaces_the_destination(self):
        """RFC 4918 §9.9.4: Overwrite F over an existing resource is 412, and
        an overwrite answers 204 rather than 201."""
        target = file_node(OWNER, self.base, "existing.txt", b"old")

        self.assert_refused(412, self._move, self._path("b.txt"), self._path("existing.txt"), overwrite=False)
        self.assertEqual(node_core.stored(target.name).state, "Active")

        response = self._move(self._path("b.txt"), self._path("existing.txt"), overwrite=True)
        self.assertEqual(response.status_code, 204)
        self.assertEqual(node_core.stored(target.name).state, "Trashed")

        moved = node_core.stored(self.file.name)
        # the mover took the exact title the client named, with no §8.6 suffix
        self.assertEqual(moved.title, "existing.txt")
        self.assertEqual(moved.blob, self.file.blob)

    def test_move_into_own_subtree_is_409(self):
        """§8.6: a node cannot be placed inside itself."""
        self.assert_refused(409, self._move, self._path(), self._path("sub", self.base_name))
        self.assertEqual(node_core.stored(self.base).parent, self.root)

    def test_move_error_statuses(self):
        """RFC 4918 §9.9.4, and §12's refusal to write the mount itself."""
        self.assert_refused(404, self._move, self._path("ghost.txt"), self._path("x.txt"))
        self.assert_refused(409, self._move, self._path("b.txt"), self._path("nope", "x.txt"))
        self.assert_refused(502, self._move, self._path("b.txt"), "http://elsewhere.example/dav/x.txt")
        self.assert_refused(403, self._move, self._path("b.txt"), "/dav/")
        self.assert_refused(403, self._move, "/dav/", self._path("x.txt"))

    def test_move_accepts_depth_infinity_only(self):
        """RFC 4918 §9.9.3: MOVE carries Depth infinity, or no Depth at all.

        A client sending `Depth: 0` on a collection means "move the collection
        without its members", which this verb cannot do. Answering it with a
        whole-subtree move does something other than what was asked, silently.
        `Depth: 1` is not a MOVE value at all.
        """
        self.assert_refused(400, self._move, self._path("sub"), self._path("moved"), Depth="0")
        self.assert_refused(400, self._move, self._path("sub"), self._path("moved"), Depth="1")
        self.assertEqual(node_core.stored(self.sub).parent, self.base)

        # the header is optional, and the explicit value is accepted
        response = self._move(self._path("sub"), self._path("moved"), Depth="infinity")
        self.assertEqual(response.status_code, 201)

    def test_an_unreadable_destination_parent_answers_like_an_absent_one(self):
        """§12.1 and RFC 4918 §9.9.4: 409 for both, or the pair is an oracle.

        A destination parent below READ answered 404 through its read gate
        while a parent that was never there answered 409, so a caller could
        still map which folders inside their own root had been taken from
        them, one Destination header at a time.
        """
        sealed = folder_node(OWNER, self.base, "Sealed")
        grant(sealed, "$GENERAL", NONE, node_principals(OWNER))

        for verb in (self._move, self._copy):
            unreadable = self.assert_refused(409, verb, self._path("b.txt"), self._path("Sealed", "x.txt"))
            absent = self.assert_refused(409, verb, self._path("b.txt"), self._path("NeverThere", "x.txt"))
            self.assertEqual(unreadable.message, absent.message)

    # -- §12.1's method-role table ---------------------------------------

    def test_move_needs_edit_on_the_source(self):
        """§12.1: MOVE is EDIT on the resource it unmaps.

        The row names `$GENERAL`, which the caller carries as well: §11.2
        refuses a row naming the Personal Root's own user inside it, and
        §5.1's nearest-wins makes the deeper row the answer.
        """
        grant(self.file.name, "$GENERAL", READ, node_principals(OWNER))
        self.assert_refused(403, self._move, self._path("b.txt"), self._path("sub", "b.txt"))
        self.assertEqual(node_core.stored(self.file.name).parent, self.base)

    def test_move_needs_upload_on_the_destination_parent(self):
        """§12.1: the destination's parent gains a member, which is UPLOAD."""
        grant(self.sub, "$GENERAL", READ, node_principals(OWNER))
        self.assert_refused(403, self._move, self._path("b.txt"), self._path("sub", "b.txt"))
        self.assertEqual(node_core.stored(self.file.name).parent, self.base)

    def test_copy_needs_read_on_the_source(self):
        """§12.1: COPY reads the source, and below READ is 404, never 403."""
        grant(self.file.name, "$GENERAL", NONE, node_principals(OWNER))
        self.assert_refused(404, self._copy, self._path("b.txt"), self._path("sub", "copy.txt"))
        self.assertFalse(self._resolve(f"{self.base_name}/sub/copy.txt").exists)

    def test_copy_needs_upload_on_the_destination_parent(self):
        """§12.1: COPY asks nothing of the destination beyond UPLOAD on its
        parent, and asks that much."""
        grant(self.sub, "$GENERAL", READ, node_principals(OWNER))
        self.assert_refused(403, self._copy, self._path("b.txt"), self._path("sub", "copy.txt"))

    def test_an_unreadable_destination_is_404_not_403(self):
        """§12.1: an overwrite must not confirm a name the caller cannot see."""
        target = file_node(OWNER, self.base, "spot.txt", b"old")
        grant(target.name, "$GENERAL", NONE, node_principals(OWNER))

        self.assert_refused(404, self._move, self._path("b.txt"), self._path("spot.txt"))
        self.assertEqual(node_core.stored(target.name).state, "Active")

    def test_overwrite_f_does_not_confirm_an_unreadable_destination(self):
        """§12.1: the read gate runs before RFC 4918 §9.9.4's 412.

        `Overwrite: F` answers 412 only because something is already there, so
        a 412 on a node the caller cannot read is an existence oracle for it.
        Below READ both verbs have to answer 404 instead.
        """
        target = file_node(OWNER, self.base, "spot.txt", b"old")
        grant(target.name, "$GENERAL", NONE, node_principals(OWNER))

        self.assert_refused(404, self._move, self._path("b.txt"), self._path("spot.txt"), overwrite=False)
        self.assert_refused(404, self._copy, self._path("b.txt"), self._path("spot.txt"), Overwrite="F")
        self.assertEqual(node_core.stored(target.name).state, "Active")
        self.assertEqual(node_core.stored(self.file.name).title, "b.txt")

    def test_neither_verb_crosses_drive_roots(self):
        """§12: no DAV move or copy crosses roots.

        One mount puts no such URL in the namespace, so the refusal is
        provoked with a folder charged to the neighbour's root. `Drive Node`
        refuses a row whose parent and root disagree, so the second root is
        stamped after the insert. That is the shape the check exists to catch:
        a second mount, or a Destination the walk resolved elsewhere, must not
        reach a cross-root rewrite through this door.
        """
        elsewhere = folder_node(OWNER, self.base, "Elsewhere")
        frappe.db.set_value("Drive Node", elsewhere, "root", self.other_root, update_modified=False)
        try:
            destination = self._path("Elsewhere", "b.txt")
            self.assert_refused(403, self._move, self._path("b.txt"), destination)
            self.assert_refused(403, self._copy, self._path("b.txt"), destination)
            self.assertEqual(node_core.stored(self.file.name).parent, self.base)
        finally:
            drop_nodes([elsewhere])

    def test_a_content_document_is_reachable_by_neither_verb(self):
        """§12.2: a document node is outside this namespace, as a source and
        as a destination collection alike."""
        document = raw_document_node(self.base, "Deck")
        try:
            for verb in (self._move, self._copy):
                self.assert_refused(404, verb, self._path("Deck"), self._path("Deck-copy"))
                # the walk stops at the segment it cannot see, so a write below
                # it is a missing intermediate collection
                self.assert_refused(409, verb, self._path("b.txt"), self._path("Deck", "b.txt"))
        finally:
            drop_nodes([document])

    # -- conditional headers and locks -----------------------------------

    def test_move_honours_the_rfc_7232_preconditions(self):
        """The preconditions run against the source's strong validator, which
        is the blob checksum PROPFIND publishes (§12.4)."""
        self.assert_refused(
            412, self._move, self._path("b.txt"), self._path("c.txt"), **{"If-Match": '"not-the-etag"'}
        )
        self.assert_refused(
            412, self._move, self._path("b.txt"), self._path("c.txt"), **{"If-None-Match": "*"}
        )

        response = self._move(
            self._path("b.txt"), self._path("c.txt"), **{"If-Match": f'"{self.file.checksum}"'}
        )
        self.assertEqual(response.status_code, 201)

    def test_copy_honours_the_rfc_7232_preconditions(self):
        """COPY evaluates them against the source it is about to read."""
        self.assert_refused(
            412,
            self._copy,
            self._path("b.txt"),
            self._path("sub", "copy.txt"),
            **{"If-Match": '"not-the-etag"'},
        )

        response = self._copy(
            self._path("b.txt"), self._path("sub", "copy.txt"), **{"If-Match": f'"{self.file.checksum}"'}
        )
        self.assertEqual(response.status_code, 201)

    def test_an_if_header_that_does_not_hold_is_412(self):
        """RFC 4918 §10.4: the If header is evaluated before any lock is."""
        self.assert_refused(
            412, self._move, self._path("b.txt"), self._path("sub", "b.txt"), If='(["no-such-etag"])'
        )

        response = self._move(
            self._path("b.txt"), self._path("sub", "b.txt"), If=f'(["{self.file.checksum}"])'
        )
        self.assertEqual(response.status_code, 201)

    def test_a_locked_source_refuses_a_move_without_its_token(self):
        """RFC 4918 §9.9.3: the MOVE unmaps the source, so its lock has to be
        submitted by the user holding it."""
        lock = self._lock(self.file.name, self._path("b.txt"))

        refusal = self.assert_refused(423, self._move, self._path("b.txt"), self._path("sub", "b.txt"))
        self.assertEqual(refusal.condition, "lock-token-submitted")

        response = self._move(self._path("b.txt"), self._path("sub", "b.txt"), If=f"(<{lock.token}>)")
        self.assertEqual(response.status_code, 201)
        # RFC 4918 §7.5: a lock does not travel with the resource
        self.assertIsNone(locks.find_lock(lock.token))

    def test_a_lock_inside_the_moved_collection_refuses_the_move(self):
        """A MOVE unmaps every URL below it, so a lock anywhere in the subtree
        covers it (RFC 4918 §9.9.3)."""
        deep = file_node(OWNER, self.sub, "deep.txt", DEEP)
        self._lock(deep.name, self._path("sub", "deep.txt"))

        self.assert_refused(423, self._move, self._path("sub"), self._path("moved-sub"))
        self.assertEqual(node_core.stored(self.sub).title, "sub")

    def test_a_locked_destination_parent_refuses_both_verbs(self):
        """RFC 4918 §7.4: a lock on a collection protects its member list, so
        a write into it needs the token even when the source is free."""
        self._lock(self.sub, self._path("sub") + "/")

        self.assert_refused(423, self._move, self._path("b.txt"), self._path("sub", "b.txt"))
        self.assert_refused(423, self._copy, self._path("b.txt"), self._path("sub", "b.txt"))

    def test_a_locked_source_does_not_refuse_a_copy(self):
        """RFC 4918 §9.8.2: COPY does not modify the source, so §12.1 asks
        nothing of its lock state."""
        self._lock(self.file.name, self._path("b.txt"))

        response = self._copy(self._path("b.txt"), self._path("sub", "copy.txt"))
        self.assertEqual(response.status_code, 201)

    # -- COPY ------------------------------------------------------------

    def test_copy_shares_the_blob_and_leaves_the_source(self):
        """§8.9: a copy shares the source's blob, so no byte is copied."""
        response = self._copy(self._path("b.txt"), self._path("sub", "copy.txt"))
        self.assertEqual(response.status_code, 201)

        duplicate = self._resolve(f"{self.base_name}/sub/copy.txt").node
        self.assertIsNotNone(duplicate)
        self.assertNotEqual(duplicate.name, self.file.name)
        self.assertEqual(duplicate.blob, self.file.blob)
        self.assertEqual(duplicate.size, len(PAYLOAD))
        self.assertEqual(duplicate.owner, OWNER)
        self.assertTrue(self._resolve(f"{self.base_name}/b.txt").exists)

    def test_copy_copies_the_whole_subtree(self):
        """RFC 4918 §9.8.3: the default depth is infinity."""
        deep = file_node(OWNER, self.sub, "deep.txt", DEEP)

        response = self._copy(f"/dav/{self.base_name}", f"/dav/{self.base_name}-copy")
        self.assertEqual(response.status_code, 201)

        self.assertTrue(self._resolve(f"{self.base_name}-copy").is_collection)
        self.assertTrue(self._resolve(f"{self.base_name}-copy/sub").is_collection)
        copied_deep = self._resolve(f"{self.base_name}-copy/sub/deep.txt").node
        self.assertEqual(copied_deep.blob, deep.blob)
        self.assertEqual(copied_deep.size, len(DEEP))

    def test_copy_depth_zero_copies_the_collection_without_its_members(self):
        """RFC 4918 §9.8.3. The shell is a create, not a copy, so the dead
        properties are cloned by the adapter rather than by §8.9."""
        set_dead_prop(self.base)

        response = self._copy(f"/dav/{self.base_name}", f"/dav/{self.base_name}-shell", Depth="0")
        self.assertEqual(response.status_code, 201)

        shell = self._resolve(f"{self.base_name}-shell")
        self.assertTrue(shell.is_collection)
        self.assertFalse(self._resolve(f"{self.base_name}-shell/b.txt").exists)
        self.assertFalse(self._resolve(f"{self.base_name}-shell/sub").exists)
        self.assertEqual(dead_prop(shell.node.name).text, "indigo")

    def test_copy_depth_one_on_a_collection_is_400(self):
        """RFC 4918 §9.8.3 admits 0 and infinity only."""
        self.assert_refused(
            400, self._copy, f"/dav/{self.base_name}", f"/dav/{self.base_name}-one", Depth="1"
        )

    def test_copy_clones_dead_properties_through_the_subtree(self):
        """RFC 4918 §9.8.2: a copy carries dead properties, and §8.9 walks the
        subtree, so a nested descendant's copy carries its own."""
        deep = file_node(OWNER, self.sub, "deep.txt", DEEP)
        set_dead_prop(self.base)
        set_dead_prop(deep.name)

        self._copy(f"/dav/{self.base_name}", f"/dav/{self.base_name}-copy")

        copied_root = self._resolve(f"{self.base_name}-copy").node
        copied_deep = self._resolve(f"{self.base_name}-copy/sub/deep.txt").node
        self.assertEqual(dead_prop(copied_root.name).text, "indigo")
        self.assertEqual(dead_prop(copied_deep.name).text, "indigo")
        # the source keeps its own
        self.assertEqual(dead_prop(self.base).text, "indigo")

    def test_copy_overwrite_replaces_the_destination(self):
        """RFC 4918 §9.8.4: Overwrite F over an existing resource is 412, and
        an overwrite answers 204."""
        target = file_node(OWNER, self.base, "spot.txt", b"old")

        self.assert_refused(412, self._copy, self._path("b.txt"), self._path("spot.txt"), Overwrite="F")
        self.assertEqual(node_core.stored(target.name).state, "Active")

        response = self._copy(self._path("b.txt"), self._path("spot.txt"))
        self.assertEqual(response.status_code, 204)
        self.assertEqual(node_core.stored(target.name).state, "Trashed")
        self.assertEqual(self._resolve(f"{self.base_name}/spot.txt").node.blob, self.file.blob)

    def test_copy_refuses_a_title_the_workflow_would_deduplicate(self):
        """§8.6 deduplicates a colliding title instead of refusing, which is
        right for a person clicking Duplicate and wrong for COPY: the client
        named a URL, and a body published at ` (2)` is not that URL.

        The exact title was cleared for every sibling DAV can see, so what is
        left is a sibling it cannot: here a content document (§12.2).
        """
        document = raw_document_node(self.base, "taken.txt")
        try:
            self.assert_refused(409, self._copy, self._path("b.txt"), self._path("taken.txt"))
            # nothing was published at the URL the client named
            self.assertFalse(self._resolve(f"{self.base_name}/taken.txt").exists)
        finally:
            drop_nodes([document])

    def test_copy_skips_children_the_caller_cannot_read(self):
        """§8.9 drops an unreadable child rather than refusing the copy,
        exactly as PROPFIND drops it from a listing (§12.1)."""
        hidden = file_node(OWNER, self.base, "hidden.txt", b"no")
        grant(hidden.name, "$GENERAL", NONE, node_principals(OWNER))

        response = self._copy(f"/dav/{self.base_name}", f"/dav/{self.base_name}-copy")
        self.assertEqual(response.status_code, 201)

        self.assertTrue(self._resolve(f"{self.base_name}-copy/b.txt").exists)
        self.assertFalse(self._resolve(f"{self.base_name}-copy/hidden.txt").exists)

    def test_copy_to_self_is_403(self):
        """RFC 4918 §9.8.4: source and destination naming one resource."""
        self.assert_refused(403, self._copy, self._path("b.txt"), self._path("b.txt"))

    def test_copy_error_statuses(self):
        """RFC 4918 §9.8.5, and §12's refusal to copy the mount itself."""
        self.assert_refused(404, self._copy, self._path("ghost.txt"), self._path("x.txt"))
        self.assert_refused(409, self._copy, self._path("b.txt"), self._path("nope", "x.txt"))
        self.assert_refused(502, self._copy, self._path("b.txt"), "http://elsewhere.example/dav/x.txt")
        self.assert_refused(403, self._copy, "/dav/", self._path("x.txt"))

    def test_a_copy_over_the_root_quota_is_507(self):
        """§7.9: the copy is admitted against the destination root's quota,
        and a refused admission is 507, not 403."""
        used = int(frappe.db.get_value("Drive Root", self.root, "used_bytes") or 0)
        self.assertGreater(used, 0)
        frappe.db.set_value("Drive Root", self.root, "quota_bytes", used, update_modified=False)
        try:
            self.assert_refused(507, self._copy, self._path("b.txt"), self._path("too-big.txt"))
        finally:
            frappe.db.set_value("Drive Root", self.root, "quota_bytes", QUOTA, update_modified=False)

        self.assertFalse(self._resolve(f"{self.base_name}/too-big.txt").exists)
