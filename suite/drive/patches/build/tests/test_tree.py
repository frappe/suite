"""§14.2 step 5 and §14.4: the tree walk, the trash rule, and the census.

Every test runs against `FakeTree` and `FakeDrive`. No site, no database.

The fixtures are small on purpose. A tree with four rows in it says which
row got which path; a tree with four hundred says only that the run
finished.
"""

import json
import tempfile
import unittest
from pathlib import Path

from suite.drive.patches.build import tree as tree_module
from suite.drive.patches.build.ports import ACTIVE, REMOVED, TRASHED, TreeRow
from suite.drive.patches.build.root_pairs import PERSONAL, BuildPairError, RootPlan
from suite.drive.patches.build.state import BuildState, TreeConversion
from suite.drive.patches.build.tests.fakes import (
    BUILD_STAMP,
    FakeDrive,
    FakeTree,
    build_environment,
)

ROOT = "rootnode01"
OWNER = "owner@example.com"


def row(name, folder, **columns):
    """One legacy `File` row, with the columns a test does not care about set."""
    columns.setdefault("file_name", name)
    columns.setdefault("creation", "2020-01-01 00:00:00.000000")
    columns.setdefault("modified", "2020-01-02 00:00:00.000000")
    columns.setdefault("owner", OWNER)
    columns.setdefault("status", ACTIVE)
    return TreeRow(name=name, folder=folder, **columns)


def folder_row(name, parent, **columns):
    return row(name, parent, is_folder=1, **columns)


def plan(node=ROOT):
    return RootPlan(node, PERSONAL, OWNER, "Personal", ACTIVE)


class TreeCase(unittest.TestCase):
    """Shared setup: one Personal root that already has its node."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)
        self.drive = FakeDrive()
        # The root pair is step 4's output. Step 5 starts from it, so the
        # node has to be there or the census would call the root itself
        # unreached.
        self.drive.node_rows[ROOT] = {"name": ROOT, "kind": "root", "root": ROOT, "path": ""}
        self.drive.root_rows[ROOT] = {
            "name": ROOT,
            "node": ROOT,
            "kind": PERSONAL,
            "user": OWNER,
            "state": ACTIVE,
        }
        self.tree_rows = []
        self.legacy = FakeTree(drive=self.drive)
        self.report = TreeConversion()

    def add(self, *rows):
        for one in rows:
            self.legacy.rows[one.name] = one
        return self

    def run_walk(self, batch_size=1000, plans=None):
        self.env = build_environment(self.path, tree=self.legacy, drive=self.drive)
        tree_module.convert_trees(
            self.env, self.report, plans if plans is not None else [plan()], batch_size=batch_size
        )
        return self.report

    def node(self, name):
        return self.drive.node_rows[name]


class PairTest(TreeCase):
    """§14.2: repair or fail on an incomplete pair before descendants."""

    def test_a_root_with_no_metadata_stops_the_walk(self):
        """A tree hung off a half-published root is a namespace nothing can describe."""
        del self.drive.root_rows[ROOT]
        self.add(row("child00001", ROOT))
        with self.assertRaises(BuildPairError):
            self.run_walk()
        self.assertNotIn("child00001", self.drive.node_rows)

    def test_a_root_with_no_node_stops_the_walk(self):
        del self.drive.node_rows[ROOT]
        with self.assertRaises(BuildPairError):
            self.run_walk()

    def test_a_root_that_is_not_a_root_node_stops_the_walk(self):
        self.drive.node_rows[ROOT]["kind"] = "folder"
        with self.assertRaises(BuildPairError):
            self.run_walk()

    def test_the_check_reads_through_the_port(self):
        """It runs with no site bound, which is the point of the seam."""
        self.add(row("child00001", ROOT))
        self.run_walk()
        self.assertIn("child00001", self.drive.node_rows)


class PlaceTest(TreeCase):
    """§14.3 and §14.4: parent, root, and the root-relative path."""

    def test_top_level_points_at_the_root_node(self):
        """A direct child of a root names the root node and holds no path."""
        self.add(row("child00001", ROOT))
        self.run_walk()
        self.assertEqual(self.node("child00001")["parent"], ROOT)
        self.assertEqual(self.node("child00001")["root"], ROOT)
        # §3.1: the root id stays outside `path`. An empty string, not "/".
        self.assertEqual(self.node("child00001")["path"], "")

    def test_path_holds_the_ancestors_and_not_the_node(self):
        """A node's path is its parent's path plus its parent's id."""
        self.add(
            folder_row("folder0001", ROOT),
            folder_row("folder0002", "folder0001"),
            row("leaf000001", "folder0002"),
        )
        self.run_walk()
        # This is `DriveNode._validate_tree_position`'s own formula:
        # "" under a root, then parent.path + parent.name + "/".
        self.assertEqual(self.node("folder0001")["path"], "")
        self.assertEqual(self.node("folder0002")["path"], "/folder0001/")
        self.assertEqual(self.node("leaf000001")["path"], "/folder0001/folder0002/")

    def test_every_node_carries_its_own_root(self):
        """`root` is the root node, at every depth."""
        self.add(folder_row("folder0001", ROOT), row("leaf000001", "folder0001"))
        self.run_walk()
        self.assertEqual(self.node("leaf000001")["root"], ROOT)

    def test_a_file_may_not_be_a_parent(self):
        """A row whose folder names a file is skipped: the engine refuses that parent."""
        self.add(row("file000001", ROOT), row("orphan0001", "file000001"))
        report = self.run_walk()
        self.assertNotIn("orphan0001", self.drive.node_rows)
        self.assertEqual(report.invalid_parent_skipped, 1)

    def test_a_document_may_hold_children(self):
        """A deck is a container, so its media nodes have somewhere to go (§3.1)."""
        self.add(
            row("deck000001", ROOT, content_doctype="Presentation", content_docname="deck-1"),
            row("media00001", "deck000001"),
        )
        self.run_walk()
        self.assertEqual(self.node("deck000001")["kind"], "document")
        self.assertEqual(self.node("media00001")["parent"], "deck000001")


class CapacityTest(TreeCase):
    """§3.1: the depth cap and the `varchar(500)` path column."""

    def test_depth_past_the_cap_is_skipped_with_its_subtree(self):
        """Node 41 and everything under it is refused and counted."""
        parent = ROOT
        for index in range(1, 43):
            name = f"deep{index:06d}"
            self.add(folder_row(name, parent))
            parent = name
        report = self.run_walk()
        self.assertIn("deep000040", self.drive.node_rows)
        # `_validate_tree_position` refuses `len(parts) + 1 > 40`, so the
        # 41st level below the root is the first the engine would reject.
        self.assertNotIn("deep000041", self.drive.node_rows)
        self.assertNotIn("deep000042", self.drive.node_rows)
        self.assertEqual(report.over_capacity_skipped, 1)
        # The measurement reports what the site needed, not what Build was
        # willing to write. It stops at 41 because the walk does not
        # descend past a refused row, so the operator reads "at least 41".
        self.assertEqual(report.max_depth, 41)

    def test_a_path_past_the_column_is_skipped(self):
        """A path over 500 characters would truncate, so the subtree stops."""
        # Long ids are legal in the legacy table; `File` names are
        # `varchar(140)`. Four of them pass 500 characters.
        parent = ROOT
        for index in range(6):
            name = f"{index}" + "x" * 139
            self.add(folder_row(name, parent))
            parent = name
        report = self.run_walk()
        self.assertGreaterEqual(report.over_capacity_skipped, 1)
        for stored in self.drive.node_rows.values():
            self.assertLessEqual(len(stored.get("path") or ""), 500)

    def test_the_measurements_come_from_real_rows(self):
        """§3.1 asks for the real maximum on the target database."""
        self.add(folder_row("folder0001", ROOT), row("leaf000001", "folder0001"))
        report = self.run_walk()
        self.assertEqual(report.max_id_length, len("folder0001"))
        self.assertEqual(report.max_path_length, len("/folder0001/"))
        self.assertEqual(report.max_depth, 2)


class IdentityTest(TreeCase):
    """§14.3: ids and timestamps come from the source, never from the clock."""

    def test_the_node_keeps_the_file_id(self):
        """`Drive Node.name` is the `File.name` it came from."""
        self.add(row("keepthisid", ROOT))
        self.run_walk()
        self.assertIn("keepthisid", self.drive.node_rows)

    def test_timestamps_are_copied_not_regenerated(self):
        """A migrated node keeps the day it was made, not the day Build ran."""
        self.add(
            row(
                "child00001",
                ROOT,
                creation="2019-05-05 10:00:00.000000",
                modified="2019-06-06 11:00:00.000000",
                file_modified="2019-07-07 12:00:00.000000",
            )
        )
        self.run_walk()
        stored = self.node("child00001")
        self.assertEqual(stored["creation"], "2019-05-05 10:00:00.000000")
        self.assertEqual(stored["modified"], "2019-06-06 11:00:00.000000")
        self.assertNotEqual(stored["creation"], BUILD_STAMP)
        # §14.4: `content_modified` is the Drive mtime, which is
        # `file_modified` when the legacy row has one.
        self.assertEqual(stored["content_modified"], "2019-07-07 12:00:00.000000")

    def test_content_modified_falls_back_to_modified(self):
        """A row with no `file_modified` still gets a content stamp."""
        self.add(row("child00001", ROOT, modified="2019-06-06 11:00:00.000000"))
        self.run_walk()
        self.assertEqual(self.node("child00001")["content_modified"], "2019-06-06 11:00:00.000000")

    def test_owner_is_copied(self):
        """§3.1: owner grants no access, but it still records who made the row."""
        self.add(row("child00001", ROOT, owner="someone@example.com"))
        self.run_walk()
        self.assertEqual(self.node("child00001")["owner"], "someone@example.com")


class KindTest(TreeCase):
    """§14.4's kind rules and the columns each kind carries."""

    def test_a_folder_becomes_a_folder_with_no_size(self):
        """A legacy folder's `file_size` is a rolled-up total, so it is dropped."""
        self.add(folder_row("folder0001", ROOT, file_size=9999))
        self.run_walk()
        stored = self.node("folder0001")
        self.assertEqual(stored["kind"], "folder")
        # Step 12 recomputes usage from the file nodes. Carrying the legacy
        # total here would count every byte under the folder twice.
        self.assertEqual(stored["size"], 0)
        self.assertIsNone(stored["blob"])

    def test_a_link_row_becomes_a_link_node(self):
        """`file_type = "Link"` carries a URL and no bytes."""
        self.add(row("link000001", ROOT, file_type="Link", file_url="https://example.com/x"))
        self.run_walk()
        stored = self.node("link000001")
        self.assertEqual(stored["kind"], "link")
        self.assertEqual(stored["url"], "https://example.com/x")
        self.assertIsNone(stored["blob"])

    def test_a_content_row_becomes_a_document(self):
        """A Writer, Slides, or Sheets row keeps its content link."""
        self.add(row("doc0000001", ROOT, content_doctype="Sheet", content_docname="sheet-1"))
        self.run_walk()
        stored = self.node("doc0000001")
        self.assertEqual(stored["kind"], "document")
        self.assertEqual(stored["content_doctype"], "Sheet")
        self.assertEqual(stored["content_docname"], "sheet-1")

    def test_an_adopted_attachment_loses_its_content_link(self):
        """§14.4: a `File` content row becomes a plain file node from its own blob."""
        self.add(
            row(
                "attach0001",
                ROOT,
                content_doctype="File",
                content_docname="some-file",
                blob="blob000001",
                file_size=12,
                mime_type="text/plain",
            )
        )
        self.run_walk()
        stored = self.node("attach0001")
        self.assertEqual(stored["kind"], "file")
        self.assertIsNone(stored["content_doctype"])
        self.assertIsNone(stored["content_docname"])
        self.assertEqual(stored["blob"], "blob000001")

    def test_a_file_with_bytes_and_no_mime_still_validates(self):
        """`_validate_kind_shape` refuses a blob with no MIME, so Build supplies one."""
        self.add(row("file000001", ROOT, blob="blob000001", file_size=5, mime_type=None))
        self.run_walk()
        self.assertEqual(self.node("file000001")["mime"], "application/octet-stream")

    def test_a_file_with_no_blob_is_counted(self):
        """§14.1: bytes Build could not reach leave a node with no blob."""
        self.add(row("file000001", ROOT), folder_row("folder0001", ROOT))
        report = self.run_walk()
        self.assertIsNone(self.node("file000001")["blob"])
        # The folder is not blobless. Only file nodes count.
        self.assertEqual(report.blobless_nodes, 1)

    def test_a_blobless_file_carries_no_size_and_no_mime(self):
        """`_validate_kind_shape` refuses a file with no blob that still has either.

        §14.1 leaves a node with no blob when Build could not reach the
        bytes. Copying the legacy `file_size` onto it would make the row
        unsaveable, and would charge the owner for bytes that are gone.
        """
        self.add(row("file000001", ROOT, file_size=12345, mime_type="text/plain", blob=None))
        self.run_walk()
        stored = self.node("file000001")
        self.assertIsNone(stored["blob"])
        self.assertEqual(stored["size"], 0)
        self.assertIsNone(stored["mime"])

    def test_a_file_with_bytes_keeps_its_size(self):
        self.add(row("file000001", ROOT, file_size=12345, blob="blob000001"))
        self.run_walk()
        self.assertEqual(self.node("file000001")["size"], 12345)

    def test_a_link_with_no_url_is_skipped(self):
        """`_validate_kind_shape` refuses a link node with no URL."""
        self.add(row("link000001", ROOT, file_type="Link", file_url=None))
        report = self.run_walk()
        self.assertNotIn("link000001", self.drive.node_rows)
        self.assertEqual(report.unsaveable_skipped, 1)

    def test_a_url_past_the_column_is_skipped(self):
        """`File.file_url` is a Code column. `Drive Node.url` is `varchar(500)`.

        Half a URL is a link to somewhere else, so truncation is not an
        option, and writing it whole would fail the batch on the insert.
        """
        self.add(row("link000001", ROOT, file_type="Link", file_url="https://x/" + "q" * 500))
        report = self.run_walk()
        self.assertNotIn("link000001", self.drive.node_rows)
        self.assertEqual(report.unsaveable_skipped, 1)

    def test_modified_by_comes_from_the_source_row(self):
        """Nothing about a migrated node is invented that the source recorded."""
        self.add(row("child00001", ROOT, owner=OWNER, modified_by="editor@example.com"))
        self.run_walk()
        self.assertEqual(self.node("child00001")["modified_by"], "editor@example.com")

    def test_nothing_is_marked_as_a_template(self):
        """§14.7 owns templates. The legacy `File` table says nothing about them."""
        self.add(row("child00001", ROOT))
        self.run_walk()
        self.assertEqual(self.node("child00001")["is_template"], 0)


class TitleTest(TreeCase):
    """§14.4 and §8.6: Active siblings get unique titles, oldest first."""

    def test_duplicate_active_titles_are_deduplicated_in_creation_order(self):
        """The oldest sibling keeps the plain title."""
        self.add(
            row("late000001", ROOT, file_name="report.pdf", creation="2020-03-01 00:00:00.000000"),
            row("early00001", ROOT, file_name="report.pdf", creation="2020-01-01 00:00:00.000000"),
            row("middle0001", ROOT, file_name="report.pdf", creation="2020-02-01 00:00:00.000000"),
        )
        report = self.run_walk()
        self.assertEqual(self.node("early00001")["title"], "report.pdf")
        self.assertEqual(self.node("middle0001")["title"], "report (2).pdf")
        self.assertEqual(self.node("late000001")["title"], "report (3).pdf")
        self.assertEqual(report.title_renames, 2)

    def test_renames_are_recorded_with_both_titles(self):
        """The report has to say what a file was called before."""
        self.add(
            row("early00001", ROOT, file_name="a.txt", creation="2020-01-01 00:00:00.000000"),
            row("late000001", ROOT, file_name="a.txt", creation="2020-02-01 00:00:00.000000"),
        )
        report = self.run_walk()
        self.assertEqual([r.node for r in report.renames], ["late000001"])
        self.assertEqual(report.renames[0].was, "a.txt")
        self.assertEqual(report.renames[0].now, "a (2).txt")

    def test_a_trashed_sibling_holds_no_title(self):
        """§3.1 makes titles unique among Active siblings only."""
        self.add(
            row(
                "trashed001",
                ROOT,
                file_name="report.pdf",
                status=TRASHED,
                file_modified="2020-05-05 00:00:00.000000",
                creation="2020-01-01 00:00:00.000000",
            ),
            row("active0001", ROOT, file_name="report.pdf", creation="2020-02-01 00:00:00.000000"),
        )
        report = self.run_walk()
        # The Active row keeps the plain title even though it is younger:
        # a Trashed sibling reserves nothing.
        self.assertEqual(self.node("active0001")["title"], "report.pdf")
        self.assertEqual(self.node("trashed001")["title"], "report.pdf")
        self.assertEqual(report.title_renames, 0)

    def test_dedupe_is_per_folder(self):
        """Two folders may each hold a `report.pdf`."""
        self.add(
            folder_row("folder0001", ROOT),
            folder_row("folder0002", ROOT),
            row("first00001", "folder0001", file_name="report.pdf"),
            row("second0001", "folder0002", file_name="report.pdf"),
        )
        self.run_walk()
        self.assertEqual(self.node("first00001")["title"], "report.pdf")
        self.assertEqual(self.node("second0001")["title"], "report.pdf")

    def test_a_nameless_row_falls_back_to_its_id(self):
        """`Drive Node.title` is mandatory, so an empty `file_name` cannot pass through."""
        self.add(row("child00001", ROOT, file_name=None))
        self.run_walk()
        self.assertEqual(self.node("child00001")["title"], "child00001")

    def test_a_whitespace_title_falls_back_to_its_id(self):
        """`DriveNode.validate` throws on a title that is blank after a strip."""
        self.add(row("child00001", ROOT, file_name="   "))
        self.run_walk()
        self.assertEqual(self.node("child00001")["title"], "child00001")

    def test_a_deduplicated_title_fits_the_column(self):
        """Two siblings with a full 140-character name: the suffix must still fit."""
        long_name = "n" * 136 + ".txt"
        self.add(
            row("early00001", ROOT, file_name=long_name, creation="2020-01-01 00:00:00.000000"),
            row("late000001", ROOT, file_name=long_name, creation="2020-02-01 00:00:00.000000"),
        )
        self.run_walk()
        self.assertEqual(len(self.node("early00001")["title"]), 140)
        self.assertLessEqual(len(self.node("late000001")["title"]), 140)
        self.assertTrue(self.node("late000001")["title"].endswith(" (2).txt"))


class TrashTest(TreeCase):
    """§14.4 and §8.8: the nearest independently trashed ancestor wins."""

    def test_a_trashed_row_is_its_own_trash_root(self):
        """One act of trashing anchors on the row the user picked."""
        self.add(folder_row("trashed001", ROOT, status=TRASHED, file_modified="2021-01-01 00:00:00.000000"))
        self.run_walk()
        stored = self.node("trashed001")
        self.assertEqual(stored["state"], TRASHED)
        self.assertEqual(stored["trash_root"], "trashed001")
        self.assertEqual(stored["trashed_at"], "2021-01-01 00:00:00.000000")

    def test_an_active_descendant_inherits_the_ancestor_stamp(self):
        """A row swept into the trash points at the folder that took it there."""
        self.add(
            folder_row("trashed001", ROOT, status=TRASHED, file_modified="2021-01-01 00:00:00.000000"),
            folder_row("inner00001", "trashed001"),
            row("leaf000001", "inner00001"),
        )
        self.run_walk()
        for name in ("inner00001", "leaf000001"):
            stored = self.node(name)
            self.assertEqual(stored["state"], TRASHED)
            self.assertEqual(stored["trash_root"], "trashed001")
            self.assertEqual(stored["trashed_at"], "2021-01-01 00:00:00.000000")

    def test_an_earlier_trashed_row_keeps_its_own_stamp(self):
        """This is what "nearest independently trashed ancestor" buys.

        The inner folder went to the trash in March. The outer folder
        followed in June. Restoring the outer folder must put back only
        what June took away, so the inner folder stays trashed. That works
        because the inner subtree is anchored on its own earlier act.
        """
        self.add(
            folder_row("outer00001", ROOT, status=TRASHED, file_modified="2021-06-01 00:00:00.000000"),
            folder_row(
                "inner00001", "outer00001", status=TRASHED, file_modified="2021-03-01 00:00:00.000000"
            ),
            row("leaf000001", "inner00001"),
        )
        self.run_walk()
        self.assertEqual(self.node("outer00001")["trash_root"], "outer00001")
        self.assertEqual(self.node("inner00001")["trash_root"], "inner00001")
        self.assertEqual(self.node("inner00001")["trashed_at"], "2021-03-01 00:00:00.000000")
        # The leaf follows the nearest one, not the outer one.
        self.assertEqual(self.node("leaf000001")["trash_root"], "inner00001")
        self.assertEqual(self.node("leaf000001")["trashed_at"], "2021-03-01 00:00:00.000000")

    def test_a_trashed_row_with_no_drive_stamp_uses_modified(self):
        """A Trashed node with no `trashed_at` is a row the engine refuses."""
        self.add(
            folder_row(
                "trashed001",
                ROOT,
                status=TRASHED,
                file_modified=None,
                modified="2021-02-02 00:00:00.000000",
            )
        )
        self.run_walk()
        self.assertEqual(self.node("trashed001")["trashed_at"], "2021-02-02 00:00:00.000000")

    def test_an_active_row_carries_no_trash_columns(self):
        """`state` and the two trash columns move together."""
        self.add(row("child00001", ROOT))
        self.run_walk()
        stored = self.node("child00001")
        self.assertEqual(stored["state"], ACTIVE)
        self.assertIsNone(stored["trash_root"])
        self.assertIsNone(stored["trashed_at"])


class RemovedTest(TreeCase):
    """§14.4: a Removed row and its subtree are not migrated."""

    def test_a_removed_row_gets_no_node(self):
        self.add(row("removed001", ROOT, status=REMOVED))
        self.run_walk()
        self.assertNotIn("removed001", self.drive.node_rows)

    def test_a_removed_subtree_is_counted_by_the_census(self):
        """The walk stops at the Removed row. The census finds what is below."""
        self.add(
            folder_row("removed001", ROOT, status=REMOVED),
            row("below00001", "removed001"),
            row("below00002", "removed001"),
        )
        report = self.run_walk()
        self.assertNotIn("below00001", self.drive.node_rows)
        # Three rows: the Removed folder and its two children.
        self.assertEqual(report.removed_rows_skipped, 3)
        self.assertEqual(report.broken_chains_skipped, 0)
        self.assertEqual(report.unmigrated_reachable, 0)


class CensusTest(TreeCase):
    """§14.4: broken chains are skipped and reported."""

    def test_a_dangling_folder_link_is_a_broken_chain(self):
        """`folder` names a row that is gone."""
        self.add(row("orphan0001", "missing001"))
        report = self.run_walk()
        self.assertEqual(report.broken_chains_skipped, 1)
        self.assertEqual(report.removed_rows_skipped, 0)

    def test_a_cycle_is_a_broken_chain(self):
        """`folder` is a plain Link with nothing to stop a loop."""
        self.add(folder_row("loopa00001", "loopb00001"), folder_row("loopb00001", "loopa00001"))
        report = self.run_walk()
        self.assertEqual(report.broken_chains_skipped, 2)

    def test_a_row_outside_drive_is_not_counted(self):
        """A folder-less row that is not `Drive` or `Users` belongs to frappe."""
        self.add(row("attach0001", None))
        report = self.run_walk()
        self.assertEqual(report.broken_chains_skipped, 0)
        self.assertEqual(report.removed_rows_skipped, 0)
        self.assertEqual(report.unmigrated_reachable, 0)

    def test_a_row_under_frappes_home_is_not_counted(self):
        """The chain terminates cleanly outside Drive, so §14.4 ignores it."""
        self.add(folder_row("Home", None), row("attach0001", "Home"))
        report = self.run_walk()
        self.assertEqual(report.broken_chains_skipped, 0)
        self.assertEqual(report.unmigrated_reachable, 0)

    def test_a_skipped_subtree_is_reported_as_reachable_and_unmigrated(self):
        """A depth-capped subtree is reachable, so the report must not hide it."""
        parent = ROOT
        for index in range(1, 43):
            name = f"deep{index:06d}"
            self.add(folder_row(name, parent))
            parent = name
        report = self.run_walk()
        # Two rows past the cap: neither got a node, and neither is Removed
        # or broken.
        self.assertEqual(report.unmigrated_reachable, 2)
        self.assertEqual(report.broken_chains_skipped, 0)

    def test_a_removed_ancestor_counts_through_the_memo(self):
        """A row two levels under a Removed folder is Removed, not a defect.

        The first chain to climb memoises the ids it passed. The next one
        meets that memo half way up, so the memo has to carry "something at
        or above me was Removed" and not only where the chain ended.
        """
        self.add(
            folder_row("rrr0000001", ROOT, status=REMOVED),
            folder_row("aaa0000001", "rrr0000001"),
            row("xxx0000001", "aaa0000001"),
        )
        report = self.run_walk()
        self.assertEqual(report.removed_rows_skipped, 3)
        self.assertEqual(report.unmigrated_reachable, 0)

    def test_the_users_row_is_never_a_defect(self):
        """§14.3 drops the `Users` row, so it has no node on any site."""
        self.add(folder_row("Users", None))
        report = self.run_walk()
        self.assertEqual(report.unmigrated_reachable, 0)
        self.assertEqual(report.broken_chains_skipped, 0)
        self.assertEqual([r.file for r in report.skipped], [])

    def test_a_wide_chain_is_walked_once_per_id(self):
        """The memo means a hundred siblings do not walk the same chain a hundred times."""
        self.add(folder_row("removed001", ROOT, status=REMOVED))
        for index in range(100):
            self.add(row(f"below{index:05d}", "removed001"))
        report = self.run_walk()
        self.assertEqual(report.removed_rows_skipped, 101)


class BatchTest(TreeCase):
    """§14.2: commit every 1000 rows, and resume where the kill landed."""

    def test_rows_are_committed_per_batch(self):
        self.add(*[row(f"child{index:05d}", ROOT) for index in range(5)])
        self.run_walk(batch_size=2)
        # Two full batches, then the flush of the remainder, then the
        # census pass. The point is that a commit happened before the run
        # ended, not the exact total.
        self.assertGreaterEqual(self.drive.commits, 3)

    def test_a_rerun_writes_nothing_twice(self):
        """A finished run over a finished site is a read."""
        self.add(folder_row("folder0001", ROOT), row("leaf000001", "folder0001"))
        first = self.run_walk()
        self.assertEqual(first.nodes_written, 2)

        second = TreeConversion()
        self.report = second
        self.run_walk()
        self.assertEqual(second.nodes_written, 0)
        self.assertEqual(second.nodes_already_present, 2)
        self.assertEqual(len(self.drive.node_rows), 3)

    def test_a_rerun_reports_the_same_source_counters(self):
        """§14.9 describes the migration, not one attempt at it."""
        self.add(
            row("early00001", ROOT, file_name="a.txt", creation="2020-01-01 00:00:00.000000"),
            row("late000001", ROOT, file_name="a.txt", creation="2020-02-01 00:00:00.000000"),
            row("file000001", ROOT),
        )
        first = self.run_walk()
        second = TreeConversion()
        self.report = second
        self.run_walk()
        self.assertEqual(second.title_renames, first.title_renames)
        self.assertEqual(second.blobless_nodes, first.blobless_nodes)

    def test_an_interrupted_run_resumes_to_the_same_titles(self):
        """A kill inside a sibling group must not change who keeps the plain title.

        Titles are decided from the source rows, so the second run reaches
        the same answer the first would have. Reading the titles already
        written back would make the answer depend on where the kill fell.
        """
        self.add(
            *[
                row(
                    f"dup{index:07d}",
                    ROOT,
                    file_name="report.pdf",
                    creation=f"2020-01-{index + 1:02d} 00:00:00.000000",
                )
                for index in range(4)
            ]
        )
        # The kill lands after the first batch of two.
        self.run_walk(batch_size=2)
        killed = dict(self.drive.node_rows)
        self.drive.node_rows = {
            name: stored for name, stored in killed.items() if name in (ROOT, "dup0000000", "dup0000001")
        }
        self.drive.commit()

        self.report = TreeConversion()
        self.run_walk(batch_size=2)
        self.assertEqual(self.node("dup0000000")["title"], "report.pdf")
        self.assertEqual(self.node("dup0000001")["title"], "report (2).pdf")
        self.assertEqual(self.node("dup0000002")["title"], "report (3).pdf")
        self.assertEqual(self.node("dup0000003")["title"], "report (4).pdf")

    def test_the_counters_reach_the_state_file(self):
        """A resumed run reads its counters back off disk."""
        self.add(row("child00001", ROOT))
        self.run_walk()
        stored = json.loads((self.path / "drive-build-state.json").read_text())
        self.assertEqual(stored["tree"]["nodes_written"], 1)
        self.assertEqual(BuildState(self.path / "drive-build-state.json").tree().nodes_written, 1)


class StallTest(TreeCase):
    """A cursor that does not move is a loop, not a slow run."""

    def test_the_child_cursor_refuses_to_loop(self):
        class Stuck(FakeTree):
            def children(self, parents, after, limit):
                return [row("child00001", ROOT)]

        self.legacy = Stuck(drive=self.drive)
        with self.assertRaises(RuntimeError) as caught:
            self.run_walk(batch_size=1)
        self.assertIn("stalled", str(caught.exception))

    def test_the_census_cursor_refuses_to_loop(self):
        class Stuck(FakeTree):
            def unreached(self, after, limit):
                from suite.drive.patches.build.ports import ChainRow

                return [ChainRow("stuck00001", None, ACTIVE)]

        self.legacy = Stuck(drive=self.drive)
        with self.assertRaises(RuntimeError) as caught:
            self.run_walk(batch_size=1)
        self.assertIn("stalled", str(caught.exception))


class SourceTest(TreeCase):
    """§14.2: Build preserves every migration source table."""

    def test_the_legacy_rows_are_untouched(self):
        self.add(folder_row("folder0001", ROOT), row("leaf000001", "folder0001"))
        before = {name: legacy for name, legacy in self.legacy.rows.items()}
        self.run_walk()
        self.assertEqual(self.legacy.rows, before)

    def test_the_read_port_has_no_write_method(self):
        """`LegacyTree` cannot delete a `File` row, so no rule has to remember not to."""
        from suite.drive.patches.build.ports import LegacyTree

        for name in dir(LegacyTree):
            if name.startswith("_"):
                continue
            self.assertNotIn(name, ("delete", "insert", "update", "commit", "set_value"))


if __name__ == "__main__":
    unittest.main()
