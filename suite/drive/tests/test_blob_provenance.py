"""A client-named blob has to be bytes the caller can already read.

§11.2 lets `POST /nodes` declare `blob`, `size`, and `mime`. `_validated_blob`
proves the row is Ready, private, and matches the declared pair. It proves
nothing about the caller, and a blob id is not a secret: §6.8 signs it into the
`/f/` URL path, and the content redirect, every row of `GET /nodes/<id>/media`,
the preview expansion, and the version list all hand one out.

§6.8 bounds that disclosure at fifteen minutes and rejects a day-long TTL as
"a different security promise". A node has no TTL, so without a source check a
fifteen-minute read becomes a permanent node in the reader's own root, and it
survives the revoke, the trash, and the purge that were supposed to end the
access. §8.2 already sets the bar for the same outcome: `copy` needs READ on
its source. `nodes.create` holds every client-named blob to it.

`create` is the one door that owes the proof. The other two callers of
`create_file` stored the bytes inside the same request - §8.4's bound upload
session and the WebDAV PUT - so `_client_named_blob` stays unset there, and
`create_file` keeps its contract for every internal caller.
"""

import ast
import inspect
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import MagicMock, patch

import frappe
from frappe.tests import UnitTestCase

from suite.drive._core import nodes as node_workflows
from suite.drive._core import upload as upload_workflows
from suite.drive._core.errors import DriveForbidden
from suite.drive._core.principals import Principals
from suite.drive._core.roles import EDIT, READ
from suite.drive.webdav import put as dav_put

USER = "reader@example.com"
STRANGER_BLOB = "blob-someone-else-stored"


def principals(is_admin: bool = False) -> Principals:
    return Principals(USER, (USER,), ("$PUBLIC",), is_admin=is_admin)


def source_row(name: str = "their-node", root: str = "their-root", path: str = "") -> frappe._dict:
    return frappe._dict(name=name, root=root, path=path, kind="file", own=0)


def grant_row(node: str, role: int, principal: str = USER) -> frappe._dict:
    return frappe._dict(node=node, principal=principal, role=role, password_hash=None)


def forwarded_flags(source: str) -> list:
    """Every `_client_named_blob=<literal>` in one block of source."""
    return [
        keyword.value.value
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.Call)
        for keyword in node.keywords
        if keyword.arg == "_client_named_blob"
    ]


def _import_aliases(node) -> dict:
    """Map a local name to the real name `import ... as <local>` gave it.

    `node` may be a whole module or one function: an `import` inside a
    function body (the public facade's own style) is only visible to a scan
    that walks that function, not the module's top level.
    """
    aliases = {}
    for child in ast.walk(node):
        if isinstance(child, ast.ImportFrom):
            for alias in child.names:
                aliases[alias.asname or alias.name] = alias.name
        elif isinstance(child, ast.Import):
            for alias in child.names:
                aliases[alias.asname or alias.name.split(".")[0]] = alias.name
    return aliases


class StubbedDatabase(UnitTestCase):
    """`frappe.db` replaced per test, so nothing here runs a query.

    Its own mock, not the runner's: `patch` deletes an attribute it created,
    so patching a savepoint onto a shared mock leaves the next module without
    one.
    """

    def setUp(self):
        missing = object()
        previous = getattr(frappe.local, "db", missing)
        self.db = MagicMock()
        frappe.local.db = self.db

        def restore():
            if previous is missing:
                del frappe.local.db
            else:
                frappe.local.db = previous

        self.addCleanup(restore)


class TestReadableBlobProof(StubbedDatabase):
    """The proof itself: an own-tier scan, then a shared-tier scan, each
    bounded per page and bounded in page count, with those queries stubbed.
    """

    def test_a_blob_no_readable_node_holds_is_refused(self):
        self.db.sql.return_value = []

        with self.assertRaises(DriveForbidden):
            node_workflows._require_readable_blob(principals(), STRANGER_BLOB)

    def test_an_owned_reference_is_admitted_by_the_own_tier_alone(self):
        """The common case: the caller already owns a copy of these bytes.

        The own-tier scan finds it and admits the caller without ever
        querying the shared-tier scan, which is the expensive one for a
        heavily deduplicated blob.
        """
        self.db.sql.side_effect = [[source_row(name="my-node", root="my-root")], [grant_row("my-root", READ)]]

        node_workflows._require_readable_blob(principals(), STRANGER_BLOB)

        self.assertEqual(self.db.sql.call_count, 2)
        own_tier_statement = self.db.sql.call_args_list[0].args[0]
        self.assertIn("`owner` = %(user)s", own_tier_statement)

    def test_a_readable_version_reference_is_admitted(self):
        """A version, not a live head, can be the caller's only proof.

        `GET /nodes/<id>/versions` mints the same signed `/f/` URL a head
        blob gets, so a version-sourced row has to clear the same bar. The
        query returns the owning node's identity either way, and permission
        resolves through that node's grant chain.
        """
        self.db.sql.side_effect = [
            [],
            [source_row(name="their-node", root="their-root")],
            [grant_row("their-root", READ)],
        ]

        node_workflows._require_readable_blob(principals(), STRANGER_BLOB)

        self.assertEqual(self.db.sql.call_count, 3)

    def test_a_source_the_caller_cannot_read_is_refused(self):
        # The row exists and holds the bytes. No grant reaches the caller, so
        # learning the id from a §6.8 URL buys nothing.
        self.db.sql.side_effect = [[], [source_row()], []]

        with self.assertRaises(DriveForbidden):
            node_workflows._require_readable_blob(principals(), STRANGER_BLOB)

    def test_a_denied_source_is_refused_even_under_an_inherited_grant(self):
        # role 0 is §4.1's deny, and nearest-wins makes it final.
        self.db.sql.side_effect = [
            [],
            [source_row(path="/their-folder/")],
            [grant_row("their-root", EDIT), grant_row("their-node", 0)],
        ]

        with self.assertRaises(DriveForbidden):
            node_workflows._require_readable_blob(principals(), STRANGER_BLOB)

    def test_an_unknown_blob_and_an_unreadable_one_refuse_alike(self):
        """No oracle: the refusal must not tell a caller the blob exists.

        Blob ids are 10-char `autoname: hash` values, so guessing one is not a
        real attack. Answering "that one exists" to a caller who may not read
        it still is, because Drive prints ids that outlive their grant.
        """
        self.db.sql.side_effect = [[], []]
        with self.assertRaises(DriveForbidden) as unknown:
            node_workflows._require_readable_blob(principals(), "no-such-blob")

        self.db.sql.side_effect = [[], [source_row()], []]
        with self.assertRaises(DriveForbidden) as unreadable:
            node_workflows._require_readable_blob(principals(), STRANGER_BLOB)

        self.assertEqual(str(unknown.exception), str(unreadable.exception))

    def test_the_own_tier_query_reads_nodes_and_versions_scoped_to_the_caller(self):
        self.db.sql.return_value = []

        with self.assertRaises(DriveForbidden):
            node_workflows._require_readable_blob(principals(), STRANGER_BLOB)

        statement, values = self.db.sql.call_args_list[0].args
        self.assertIn("tabDrive Node", statement)
        self.assertIn("tabDrive Node Version", statement)
        self.assertIn("`owner` = %(user)s", statement)
        self.assertEqual(values["blob"], STRANGER_BLOB)
        self.assertEqual(values["user"], USER)
        self.assertEqual(values["limit"], node_workflows.BLOB_SOURCE_PAGE_SIZE)
        self.assertEqual(values["after"], "")

    def test_the_shared_tier_query_reads_nodes_and_versions_one_page_at_a_time(self):
        """Version bytes are readable too, so a version blob is a real source.

        Both `blob` columns carry `search_index: 1` (§3.1, §3.4), so each arm
        of both tiers is an index range scan.
        """
        self.db.sql.return_value = []

        with self.assertRaises(DriveForbidden):
            node_workflows._require_readable_blob(principals(), STRANGER_BLOB)

        # Call 0 is the empty own-tier scan; call 1 is the shared-tier scan.
        statement, values = self.db.sql.call_args_list[1].args
        self.assertIn("tabDrive Node", statement)
        self.assertIn("tabDrive Node Version", statement)
        self.assertEqual(values["blob"], STRANGER_BLOB)
        self.assertEqual(values["user"], USER)
        self.assertEqual(values["limit"], node_workflows.BLOB_SOURCE_PAGE_SIZE)
        self.assertEqual(values["after"], "")

    def test_a_readable_source_past_a_full_page_of_strangers_is_still_admitted(self):
        """The page size must bound one query's cost, not the whole bound's reach.

        A first page entirely full of unreadable rows must not be the whole
        search: the scan keeps paging past a full, unreadable page, up to
        `BLOB_SOURCE_MAX_PAGES`, instead of stopping at the first one.
        """
        full_page = [source_row(name=f"stranger-{i}") for i in range(node_workflows.BLOB_SOURCE_PAGE_SIZE)]
        second_page = [source_row(name="their-node", root="their-root")]
        self.db.sql.side_effect = [
            [],  # own tier: nothing owned
            full_page,
            [],  # `_readable_rows` over the first shared-tier page: nothing granted
            second_page,
            [grant_row("their-root", READ)],
        ]

        node_workflows._require_readable_blob(principals(), STRANGER_BLOB)

        self.assertEqual(self.db.sql.call_count, 5)
        second_page_call_values = self.db.sql.call_args_list[3].args[1]
        self.assertEqual(second_page_call_values["after"], "stranger-49")

    def test_an_exhausted_scan_with_no_readable_page_is_refused(self):
        """A blob with only unreadable sources must not page forever."""
        short_unreadable_page = [source_row()]
        self.db.sql.side_effect = [[], short_unreadable_page, []]

        with self.assertRaises(DriveForbidden):
            node_workflows._require_readable_blob(principals(), STRANGER_BLOB)

        self.assertEqual(self.db.sql.call_count, 3)

    def test_a_pathological_fanout_is_bounded_in_query_count(self):
        """A blob with thousands of references must cost a fixed number of
        queries, not one page's worth per reference.

        Every page returned here is full (never the short, last page) and
        never readable, so an unbounded scan would keep paging forever while
        `create_file` still holds the parent row locked. Each tier's `for`
        loop stops itself at `BLOB_SOURCE_MAX_PAGES`; the mock's `side_effect`
        list is sized to exactly that many page-plus-grant pairs per tier, so
        a scan that read even one page past the bound would exhaust the list
        and fail the test with `StopIteration` instead of hanging.
        """
        max_pages = node_workflows.BLOB_SOURCE_MAX_PAGES
        full_unreadable_page = [
            source_row(name=f"stranger-{i}") for i in range(node_workflows.BLOB_SOURCE_PAGE_SIZE)
        ]
        one_tier = [full_unreadable_page, []] * max_pages
        self.db.sql.side_effect = one_tier + one_tier  # own tier, then shared tier

        with self.assertRaises(DriveForbidden):
            node_workflows._require_readable_blob(principals(), STRANGER_BLOB)

        self.assertEqual(self.db.sql.call_count, 4 * max_pages)

    def test_a_suite_admin_still_needs_the_blob_to_be_in_drive(self):
        """MANAGE everywhere is not a licence to name bytes Drive does not hold.

        An admin passes the READ resolution on any source row, so the only
        thing left to refuse is a blob no node and no version references, which
        is not Drive's to attach.
        """
        self.db.sql.return_value = []

        with self.assertRaises(DriveForbidden):
            node_workflows._require_readable_blob(principals(is_admin=True), STRANGER_BLOB)


class TestTheClientDoorProvesItsBlob(StubbedDatabase):
    """`nodes.create` is what `POST /nodes` reaches, and it stored nothing."""

    def authorized_parent(self, stack: ExitStack) -> None:
        """The parent checks §8.2 runs first, all of them satisfied."""
        stack.enter_context(
            patch.object(node_workflows, "_lock_create_parent", return_value=frappe._dict(kind="folder"))
        )
        stack.enter_context(patch.object(node_workflows, "require", return_value=None))
        stack.enter_context(patch.object(node_workflows, "_validate_parent"))
        stack.enter_context(patch.object(node_workflows, "_rollback_savepoint"))

    def create(self, **overrides):
        arguments = {
            "kind": "file",
            "blob": STRANGER_BLOB,
            "size": 1,
            "mime": "image/png",
            **overrides,
        }
        return node_workflows.create(principals(), "parent", "t.png", **arguments)

    def test_a_client_naming_a_blob_it_cannot_read_is_refused(self):
        """The whole attack, end to end through the entry the route calls.

        Nothing about the blob row is stubbed: the refusal lands before
        `_validated_blob` would look at one.
        """
        self.db.sql.return_value = []

        with ExitStack() as stack:
            self.authorized_parent(stack)
            with self.assertRaises(DriveForbidden):
                self.create()

    def test_removing_the_proof_is_what_lets_the_attack_through(self):
        """The mutation: with the check gone, the same call reaches the bytes.

        `_validated_blob` raising is the marker that the create got past the
        proof, so the test fails loudly if the refusal ever stops depending on
        `_require_readable_blob`.
        """
        with ExitStack() as stack:
            self.authorized_parent(stack)
            stack.enter_context(patch.object(node_workflows, "_require_readable_blob"))
            stack.enter_context(
                patch.object(node_workflows, "_validated_blob", side_effect=RuntimeError("reached the bytes"))
            )
            with self.assertRaises(RuntimeError):
                self.create()

    def test_the_proof_runs_before_the_blob_is_revived(self):
        """`revive_blob` writes: it pulls a blob out of the GC orphan window.

        Running it first would let an unauthorized create keep a stranger's
        orphaned bytes alive for another day (§13.1), and would answer
        "exists" through its own refusal message.
        """
        order = []

        def proof(_principals, _blob):
            order.append("proof")
            raise DriveForbidden("refused")

        with ExitStack() as stack:
            self.authorized_parent(stack)
            stack.enter_context(patch.object(node_workflows, "_require_readable_blob", side_effect=proof))
            stack.enter_context(
                patch.object(node_workflows, "_validated_blob", side_effect=lambda *a: order.append("blob"))
            )
            with self.assertRaises(DriveForbidden):
                self.create()

        self.assertEqual(order, ["proof"])

    def test_the_parent_is_authorized_before_the_blob_is_looked_for(self):
        """An unauthorized parent still answers for the parent (§8.2).

        The proof must not become a way to ask "does this blob exist" from
        outside any folder the caller may upload to.
        """
        with (
            patch.object(node_workflows, "_lock_create_parent", return_value=frappe._dict(kind="folder")),
            patch.object(node_workflows, "require", side_effect=DriveForbidden("no upload rights")),
            patch.object(node_workflows, "_rollback_savepoint"),
            patch.object(node_workflows, "_require_readable_blob") as proof,
            self.assertRaises(DriveForbidden),
        ):
            self.create()

        proof.assert_not_called()


class TestOnlyTheClientDoorAsksForTheProof(StubbedDatabase):
    """`_client_named_blob` is the flag, and one caller sets it."""

    def test_the_client_create_entry_forwards_the_flag(self):
        """A static read, not a mock: if a later edit drops the flag from
        `create`, the client door reopens with no runtime test failing."""
        self.assertEqual(forwarded_flags(inspect.getsource(node_workflows.create)), [True])

    def test_no_whitelisted_handler_can_reach_the_flag(self):
        """The HTTP surface must not name it, in a body or in a call."""
        routes = Path(node_workflows.__file__).parent.parent / "http" / "routes.py"
        self.assertNotIn("_client_named_blob", routes.read_text())

    def test_the_bound_upload_session_owes_no_source(self):
        """§8.4's finish stored the bytes itself, through a bound session."""
        self.assertEqual(forwarded_flags(inspect.getsource(upload_workflows.finish_upload)), [])

    def test_the_dav_put_owes_no_source(self):
        """`webdav.put` spools the request body straight into `put_blob`,
        and DAV has no field a client could name a blob id in."""
        self.assertEqual(forwarded_flags(Path(dav_put.__file__).read_text()), [])

    def test_create_file_keeps_its_contract_for_an_internal_caller(self):
        """The default is the old behaviour, so no internal write changed."""
        with (
            patch.object(node_workflows, "_require_readable_blob") as proof,
            patch.object(node_workflows, "_validated_blob", side_effect=RuntimeError("stop")),
            patch.object(node_workflows, "_lock_create_parent", return_value=frappe._dict(kind="folder")),
            patch.object(node_workflows, "require", return_value=None),
            patch.object(node_workflows, "_validate_parent"),
            patch.object(node_workflows, "_rollback_savepoint"),
            self.assertRaises(RuntimeError),
        ):
            node_workflows.create_file(
                principals(), "parent", "t.png", blob="blob-we-just-stored", size=1, mime="image/png"
            )

        proof.assert_not_called()

    def test_the_caller_set_of_create_file_is_the_one_that_was_reviewed(self):
        """A fifth caller must come back through this test.

        The flag defaults to "already proved", so the guard that keeps it
        honest is the caller set, not the default. `create` and the
        public facade are the two client doors; the other two hold §8.4's
        binding.

        A caller can reach `_core.nodes.create_file` under an alias - the
        public facade imports it as `_create_file` inside the function body -
        so the scan resolves both module-level and local `import ... as`
        aliases before comparing a call's name. A scan that only matched the
        literal name `create_file` would miss that call site entirely and
        never notice it forwards no proof.
        """
        root = Path(node_workflows.__file__).parents[3]
        self.assertTrue((root / "suite" / "drive").is_dir(), root)
        callers = set()
        for source in sorted((root / "suite").rglob("*.py")):
            parts = source.relative_to(root).parts
            if "tests" in parts or source.name.startswith("test_"):
                continue
            tree = ast.parse(source.read_text())
            module_aliases = _import_aliases(tree)
            functions = [
                node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef)
            ]
            for function in functions:
                aliases = {**module_aliases, **_import_aliases(function)}
                for node in ast.walk(function):
                    called = node.func if isinstance(node, ast.Call) else None
                    name = getattr(called, "attr", None) or getattr(called, "id", None)
                    if name and aliases.get(name, name) == "create_file":
                        callers.add(f"{source.relative_to(root)}:{function.name}")

        self.assertEqual(
            callers,
            {
                "suite/drive/_core/nodes.py:create",
                "suite/drive/__init__.py:create_file",
                "suite/drive/_core/upload.py:finish_upload",
                "suite/drive/webdav/put.py:handle",
                # The legacy `File` adoption helper, a different function of
                # the same name in `suite/drive/utils` (§11.7's expand phase).
                "suite/drive/overrides/file.py:create_for_doc",
            },
        )

    def test_the_public_facade_forwards_the_flag_too(self):
        """The fifth caller found above must be a proven one, not a silent gap."""
        import suite.drive as public_facade

        self.assertEqual(forwarded_flags(inspect.getsource(public_facade.create_file)), [True])


class TestTheReplacePathHasNoClientDoor(StubbedDatabase):
    """§8.5's replace takes a blob, and §11.2 gives no client a way to name one."""

    def test_no_patch_body_carries_bytes(self):
        from suite.drive.http import shapes

        with self.assertRaises(frappe.ValidationError):
            shapes.patch({"blob": STRANGER_BLOB}, "patch")

    def test_the_patch_routes_have_no_blob_parameter(self):
        """Read off the source, because both handlers are twice wrapped."""
        routes = Path(node_workflows.__file__).parent.parent / "http" / "routes.py"
        handlers = {
            node.name: node
            for node in ast.walk(ast.parse(routes.read_text()))
            if isinstance(node, ast.FunctionDef)
        }
        for name in ("node_patch", "node_batch"):
            taken = [argument.arg for argument in handlers[name].args.args]
            self.assertNotIn("blob", taken)
