"""Every savepoint on the HTTP, WebDAV, Build, and content-app surface.

A Drive workflow opens a savepoint and takes `FOR UPDATE` locks inside it, so
any request that reaches one can be the InnoDB deadlock victim. InnoDB rolls
the victim's whole transaction back and discards its savepoints, so by the time
an outer `except` arm runs there is nothing left to roll back to.
`frappe.db.rollback(save_point=...)` then fails with "SAVEPOINT does not exist"
and that second error replaces the `QueryDeadlockError` the caller has to retry
on, with the handle left unreset.

`_core/errors.rollback_savepoint` is the one place allowed to make that call.
`suite/drive/tests/test_nodes.py` sweeps `_core`; this module sweeps the
adapters and the content-app call sites around it, and drives the repaired
Drive ones into a deadlock. The two content-app runtime cases live in
`suite/writer/tests/test_docs_savepoint.py` and
`suite/slides/tests/test_presentation_savepoint.py`, because ARCHITECTURE.md
rule 2.4 forbids Drive from importing Writer, Sheets, or Slides
implementations. Meet's own reservation call site is a third such case and
lives in `suite/meet/api/test/test_recording_savepoint.py`, for the same
reason. The sweep below still reaches all of their files: it reads paths and
imports nothing.
"""

import ast
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import frappe
from frappe.tests import UnitTestCase

import suite.drive
from suite.drive._core import nodes as node_workflows
from suite.drive._core.errors import DriveConflict
from suite.drive._core.principals import Principals
from suite.drive.http import routes
from suite.drive.patches.build.ports import BlobConflict, SiteStorage
from suite.drive.webdav import structure

USER = "actor@example.com"

# Review C's owned surface, plus the content-app and cross-product call sites
# that wrap a Drive workflow in a savepoint of their own. `suite/meet/api/
# recording.py` holds the same shape around §7.8's reservation workflows: it
# was in no review's file list, so it kept the bare call until this sweep
# picked it up.
OWNED_SURFACE = (
    "suite/drive/http",
    "suite/drive/webdav",
    "suite/drive/api",
    "suite/drive/patches",
    "suite/drive/e2e_api.py",
    "suite/drive/install.py",
    "suite/writer",
    "suite/slides",
    "suite/sheets",
    "suite/meet/api/recording.py",
)


def repo_root() -> Path:
    return Path(suite.drive.__file__).parent.parent.parent


def surface_modules():
    root = repo_root()
    for entry in OWNED_SURFACE:
        target = root / entry
        sources = [target] if target.is_file() else sorted(target.rglob("*.py"))
        for source in sources:
            parts = source.relative_to(root).parts
            if "tests" in parts or source.name.startswith("test_"):
                continue
            yield source


class LostSavepoint:
    """The database an InnoDB deadlock victim is left holding.

    Only the victim's savepoints go. `arm()` is called at the moment the
    deadlock is raised, so a rollback taken before it - the WebDAV MOVE
    fallback's own, for one - still works, which is what keeps this a mutation
    of the deadlock path and not of every rollback in the workflow.
    """

    def __init__(self, db):
        self.lost = False
        db.rollback.side_effect = self._rollback

    def arm(self, error):
        self.lost = True
        raise error

    def _rollback(self, save_point=None):
        if save_point and self.lost:
            raise Exception("SAVEPOINT does not exist")


class StubbedDatabase(UnitTestCase):
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


class TestNoBareSavepointRollbackOnTheSurface(UnitTestCase):
    def test_the_owned_surface_rolls_back_through_the_shared_helper(self):
        offenders = []
        for source in surface_modules():
            tree = ast.parse(source.read_text())
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call):
                    continue
                if any(keyword.arg == "save_point" for keyword in node.keywords):
                    offenders.append(f"{source.relative_to(repo_root())}:{node.lineno}")
        self.assertEqual(offenders, [])

    def test_the_sweep_covers_the_modules_it_claims_to(self):
        """A guard that walks an empty tree passes for the wrong reason."""
        swept = {str(source.relative_to(repo_root())) for source in surface_modules()}
        for expected in (
            "suite/drive/http/routes.py",
            "suite/drive/webdav/structure.py",
            "suite/drive/patches/build/ports.py",
            "suite/writer/api/docs.py",
            "suite/slides/doctype/presentation/presentation.py",
            "suite/meet/api/recording.py",
        ):
            self.assertIn(expected, swept)

    def test_a_product_reaches_the_helper_through_the_public_interface(self):
        """`suite/writer` and `suite/slides` may not import `suite.drive._core`.

        ARCHITECTURE.md rule 2.2 puts one interface between a product and
        Drive, so the helper every savepoint owner needs is exported on it.
        """
        self.assertIn("rollback_savepoint", suite.drive.__all__)
        self.assertIs(suite.drive.rollback_savepoint, node_workflows._rollback_savepoint)


class TestTheDavMoveReportsItsDeadlock(StubbedDatabase):
    """§12.3's MOVE is two `update` calls, and either one can be the victim."""

    def relocate(self, update):
        ctx = SimpleNamespace(principals=Principals(USER, (USER,), ()))
        row = frappe._dict(name="node", parent="here", title="old.txt")
        destination = frappe._dict(name="there")
        with patch.object(structure.node_core, "update", side_effect=update):
            structure._relocate(ctx, row, destination, "new.txt")

    def test_a_deadlocked_leg_raises_the_deadlock_not_the_lost_savepoint(self):
        deadlock = frappe.QueryDeadlockError("victim")
        database = LostSavepoint(self.db)

        with self.assertRaises(frappe.QueryDeadlockError) as raised:
            self.relocate(update=lambda *a, **k: database.arm(deadlock))

        self.assertIs(raised.exception, deadlock)
        # The full rollback is what resets a handle InnoDB already emptied.
        self.assertIn(((), {}), [(c.args, c.kwargs) for c in self.db.rollback.call_args_list])

    def test_a_deadlock_in_the_fallback_order_is_reported_too(self):
        """The retry's own first leg has to be discarded, deadlock or not."""
        deadlock = frappe.QueryDeadlockError("victim")
        calls = []
        database = LostSavepoint(self.db)

        def update(*args, **kwargs):
            calls.append(kwargs)
            if len(calls) == 1:
                raise DriveConflict("title taken at the destination")
            database.arm(deadlock)

        with self.assertRaises(frappe.QueryDeadlockError) as raised:
            self.relocate(update=update)

        self.assertIs(raised.exception, deadlock)

    def test_an_ordinary_collision_still_falls_back_and_commits(self):
        """The repair must not change the retry §12.3 depends on."""
        calls = []

        def update(_principals, _node, **kwargs):
            calls.append(kwargs)
            if len(calls) == 1:
                raise DriveConflict("title taken at the destination")

        self.relocate(update=update)

        self.assertEqual(
            calls,
            [{"parent": "there"}, {"title": "new.txt"}, {"parent": "there"}],
        )
        self.db.release_savepoint.assert_called_once()


class TestTheBatchRouteDoesNotFlattenADeadlock(StubbedDatabase):
    """§11.5 reports refusals per node. A deadlock is not a refusal."""

    def test_a_deadlock_leaves_the_batch_instead_of_becoming_a_failed_row(self):
        deadlock = frappe.QueryDeadlockError("victim")
        database = LostSavepoint(self.db)

        with (
            patch.object(routes, "_principals", return_value=Principals(USER, (USER,), ())),
            patch.object(routes.node_core, "update", side_effect=lambda *a, **k: database.arm(deadlock)),
            self.assertRaises(frappe.QueryDeadlockError) as raised,
        ):
            routes.node_batch(nodes=["a", "b"], patch={"title": "renamed"})

        self.assertIs(raised.exception, deadlock)

    def test_a_refusal_is_still_rolled_back_narrowly_and_reported(self):
        with (
            patch.object(routes, "_principals", return_value=Principals(USER, (USER,), ())),
            patch.object(
                routes.node_core,
                "update",
                side_effect=[node_workflows.DriveForbidden("no"), None],
            ),
        ):
            answer = routes.node_batch(nodes=["a", "b"], patch={"title": "renamed"})

        self.assertEqual(answer["ok"], ["b"])
        self.assertEqual(answer["failed"][0]["type"], "DriveForbidden")
        narrow = [c for c in self.db.rollback.call_args_list if c.kwargs.get("save_point")]
        self.assertEqual(len(narrow), 1)


class TestTheBuildBlobInsertReportsItsDeadlock(StubbedDatabase):
    """§14.2 step 2. A deadlock must not be filed as "this content exists"."""

    def setUp(self):
        super().setUp()
        self.storage = SiteStorage()

    def test_a_deadlocked_insert_is_not_reported_as_a_blob_conflict(self):
        deadlock = frappe.QueryDeadlockError("victim")
        blob = MagicMock()
        blob.insert.side_effect = deadlock

        with (
            patch.object(frappe, "new_doc", return_value=blob),
            self.assertRaises(frappe.QueryDeadlockError) as raised,
        ):
            self.storage.insert_blob(key="ab/cd/x", checksum="x", size=12, mime_type="text/plain")

        self.assertIs(raised.exception, deadlock)

    def test_a_unique_violation_still_rolls_back_narrowly_and_carries_on(self):
        blob = MagicMock()
        blob.insert.side_effect = frappe.UniqueValidationError("File Blob")

        with patch.object(frappe, "new_doc", return_value=blob), self.assertRaises(BlobConflict):
            self.storage.insert_blob(key="ab/cd/x", checksum="x", size=12, mime_type="text/plain")

        self.db.rollback.assert_called_once_with(save_point="drive_build_insert_blob")
