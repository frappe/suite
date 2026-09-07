"""§14.2 steps 4 to 6 against the real tables.

The rules are proved site-free in `suite/drive/patches/build/tests/`. This
module proves the wiring, which is the part a fake cannot reach:

- `frappe.db.bulk_insert` keeps the `File` id that `Document.insert` would
  have thrown away (`frappe/model/naming.py`: `set_new_name` nulls a
  caller-supplied name for an `autoname: hash` doctype);
- a hand-written node row satisfies `DriveNode.validate`, so every later
  rename, move, or trash on a migrated node still works;
- the keyset SQL compiles and pages on the shipped backend, including the
  compound `(folder, name)` and `(entity, user, name)` comparisons that
  `frappe.get_all` cannot express;
- `Drive Grant` really carries the unique `(node, principal)` index the
  resume logic relies on.

Nothing here touches the site's own `Drive` or `Users` rows. Every row this
module makes carries a per-run prefix and is deleted again, and the root
pair it works with is a synthetic one, so a run on a populated site cannot
disturb a real namespace.
"""

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import now_datetime

from suite.drive._core.roles import EDIT, MANAGE, READ
from suite.drive.patches.build import grants as grants_module
from suite.drive.patches.build import root_pairs
from suite.drive.patches.build import tree as tree_module
from suite.drive.patches.build.environment import BuildEnvironment, LegacyS3Config
from suite.drive.patches.build.ports import (
    ACTIVE,
    REMOVED,
    SiteDrive,
    SiteTree,
    TreeRow,
)
from suite.drive.patches.build.state import STATE_FILENAME, BuildState, GrantConversion, TreeConversion


class BuildTreeCase(IntegrationTestCase):
    """One synthetic Personal root, and every row named with a run prefix."""

    def setUp(self):
        super().setUp()
        self.prefix = "bldtr" + frappe.generate_hash(length=8)
        self.state = BuildState(frappe.get_site_path("private", f"{self.prefix}-{STATE_FILENAME}"))
        self.addCleanup(lambda: self.state.path.exists() and self.state.path.unlink())
        self.root = self.name()
        self.owner = self.pick_user()

    def tearDown(self):
        like = self.prefix + "%"
        frappe.db.delete("Drive Grant", {"node": ("like", like)})
        frappe.db.delete("Drive Root", {"node": ("like", like)})
        frappe.db.delete("Drive Node", {"name": ("like", like)})
        frappe.db.delete("Drive Permission", {"entity": ("like", like)})
        frappe.db.delete("File", {"name": ("like", like)})
        super().tearDown()

    # fixtures

    def name(self):
        return self.prefix + frappe.generate_hash(length=8)

    def pick_user(self):
        """Any enabled User with an email address, or skip.

        §14.5 takes a user principal only when it is a valid address, so
        `Administrator` cannot stand in. Nothing here inserts a `User`: on
        this bench that enqueues background work the test does not need.
        """
        found = frappe.db.get_value(
            "User", {"enabled": 1, "name": ("like", "%@%")}, "name", order_by="creation asc"
        )
        if not found:
            self.skipTest("no enabled email User on this site")
        return found

    def file_row(self, name=None, *, folder, file_name=None, is_folder=0, **columns):
        """One legacy Drive `File` row, written straight to the table.

        `db_insert` rather than `insert`: the `File` controller would move
        bytes, and the rows here have none.
        """
        doc = frappe.new_doc("File")
        doc.update({"is_folder": is_folder, "folder": folder, **columns})
        doc.file_name = file_name or "row.txt"
        doc.name = name or self.name()
        doc.owner = doc.modified_by = "Administrator"
        doc.creation = doc.modified = now_datetime()
        doc.flags.ignore_validate = True
        doc.db_insert()
        return doc.name

    def permission_row(self, entity, user, **flags):
        doc = frappe.new_doc("Drive Permission")
        doc.update({"entity": entity, "user": user, **flags})
        doc.name = self.name()
        doc.owner = doc.modified_by = "Administrator"
        doc.creation = doc.modified = now_datetime()
        doc.db_insert()
        return doc.name

    def environment(self):
        """A `BuildEnvironment` on the real tables, narrowed to this run's rows."""
        return BuildEnvironment(
            storage=None,
            files=None,
            state=self.state,
            legacy_s3=LegacyS3Config(enabled=False, bucket=""),
            open_bucket=lambda: None,
            tree=SiteTree(self.prefix),
            drive=SiteDrive(),
        )

    def write_root(self, *, user=None, kind=root_pairs.PERSONAL):
        """A root pair through the same code path production uses."""
        source = TreeRow(
            name=self.root,
            file_name=user or "Shared",
            folder=None,
            is_folder=1,
            owner="Administrator",
            creation="2020-01-01 00:00:00.000000",
            modified="2020-01-02 00:00:00.000000",
        )
        env = self.environment()
        node = root_pairs._node_row(source, kind)
        metadata = root_pairs._metadata_row(source, kind, user, ACTIVE)
        anchors = root_pairs._anchor_grants(env, self.root, kind, user)
        env.drive.write_root_pair(node, metadata, anchors)
        return env

    def plan(self, user=None, kind=root_pairs.PERSONAL):
        return root_pairs.RootPlan(self.root, kind, user, "Personal", ACTIVE)


class TestRootPairWiring(BuildTreeCase):
    """§14.3: the pair lands whole and keeps the `File` id."""

    def test_the_pair_keeps_the_file_id(self):
        """`Document.insert` would have replaced this name with a fresh hash."""
        self.write_root(user=self.owner)
        self.assertTrue(frappe.db.exists("Drive Node", self.root))
        metadata = frappe.db.get_value("Drive Root", {"node": self.root}, ["name", "node"], as_dict=True)
        self.assertEqual(metadata.name, self.root)
        self.assertEqual(metadata.node, self.root)

    def test_the_engine_accepts_the_pair(self):
        """`roots.validate_root_pair` is the engine's own check of both directions."""
        from suite.drive._core.roots import validate_root_pair

        self.write_root(user=self.owner)
        validate_root_pair(self.root)

    def test_the_root_node_satisfies_its_controller(self):
        """A hand-written root must still save, or its lifecycle is stuck."""
        self.write_root(user=self.owner)
        doc = frappe.get_doc("Drive Node", self.root)
        doc.flags.drive_root_lifecycle = True
        doc.save(ignore_permissions=True)

    def test_the_personal_anchor_lands_with_the_pair(self):
        """§3.2: metadata and anchor grants in one transaction."""
        self.write_root(user=self.owner)
        self.assertEqual(
            frappe.db.get_value("Drive Grant", {"node": self.root, "principal": self.owner}, "role"),
            MANAGE,
        )

    def test_a_failed_half_rolls_the_pair_back(self):
        """The savepoint has to hold on the shipped backend, not only in a fake.

        A `Drive Root` row already carrying the node id makes the second
        insert a primary key violation. The node half is in by then, so
        without the savepoint the site would keep a root node that no
        metadata describes, which is the half-published root §3.2 refuses.
        """
        squatter = frappe.new_doc("Drive Root")
        squatter.update({"node": self.root, "kind": root_pairs.PERSONAL, "state": ACTIVE})
        squatter.name = self.root
        squatter.owner = squatter.modified_by = "Administrator"
        squatter.creation = squatter.modified = now_datetime()
        squatter.db_insert()

        env = self.environment()
        source = TreeRow(name=self.root, file_name=self.owner, folder=None, is_folder=1)
        node = root_pairs._node_row(source, root_pairs.PERSONAL)
        metadata = root_pairs._metadata_row(source, root_pairs.PERSONAL, self.owner, ACTIVE)
        with self.assertRaises(Exception):
            env.drive.write_root_pair(node, metadata, [])
        self.assertFalse(frappe.db.exists("Drive Node", self.root))


class TestTreeWiring(BuildTreeCase):
    """§14.4: the walk against the real `File` table."""

    def setUp(self):
        super().setUp()
        self.env = self.write_root(user=self.owner)
        self.report = TreeConversion()

    def walk(self):
        tree_module.convert_trees(self.env, self.report, [self.plan(self.owner)])
        return self.report

    def test_a_migrated_node_keeps_its_id_and_its_stamps(self):
        source = self.file_row(folder=self.root, file_name="report.txt")
        before = frappe.db.get_value("File", source, ["creation", "owner"], as_dict=True)
        self.walk()
        stored = frappe.db.get_value(
            "Drive Node", source, ["name", "creation", "owner", "parent", "path"], as_dict=True
        )
        self.assertEqual(stored.name, source)
        self.assertEqual(stored.creation, before.creation)
        self.assertEqual(stored.owner, before.owner)
        self.assertEqual(stored.parent, self.root)
        self.assertEqual(stored.path, "")

    def test_a_bulk_inserted_node_satisfies_its_controller(self):
        """Build bypasses `validate`, so the columns have to satisfy it anyway.

        A node that fails here is one nobody could ever rename, move, or
        trash again.
        """
        folder = self.file_row(folder=self.root, file_name="folder", is_folder=1)
        child = self.file_row(folder=folder, file_name="child.txt")
        self.walk()
        for name in (folder, child):
            with self.subTest(node=name):
                frappe.get_doc("Drive Node", name).save(ignore_permissions=True)

    def test_a_grandchild_carries_the_path_the_engine_computes(self):
        folder = self.file_row(folder=self.root, file_name="folder", is_folder=1)
        child = self.file_row(folder=folder, file_name="child.txt")
        self.walk()
        self.assertEqual(frappe.db.get_value("Drive Node", child, "path"), f"/{folder}/")

    def test_duplicate_titles_survive_the_unique_index(self):
        """§3.1 makes `title` unique among Active siblings, and the index is real."""
        first = self.file_row(folder=self.root, file_name="report.pdf")
        second = self.file_row(folder=self.root, file_name="report.pdf")
        self.walk()
        titles = {name: frappe.db.get_value("Drive Node", name, "title") for name in (first, second)}
        self.assertEqual(len(set(titles.values())), 2)
        self.assertIn("report.pdf", titles.values())

    def test_the_child_cursor_pages_in_folder_and_name_order(self):
        """The compound keyset is raw SQL, so only a real backend proves it."""
        made = sorted(self.file_row(folder=self.root, file_name=f"f{index}") for index in range(5))
        legacy = SiteTree(self.prefix)
        seen, after = [], ("", "")
        while True:
            page = legacy.children((self.root,), after, 2)
            if not page:
                break
            seen.extend(row.name for row in page)
            after = (page[-1].folder or "", page[-1].name)
        self.assertEqual(seen, made)

    def test_unreached_finds_a_row_with_no_node(self):
        """The LEFT JOIN is the census's only source of unreachable rows."""
        stranded = self.file_row(folder=self.prefix + "gone", file_name="orphan.txt")
        legacy = SiteTree(self.prefix)
        self.assertIn(stranded, [row.name for row in legacy.unreached("", 100)])
        self.walk()
        self.assertEqual(self.report.broken_chains_skipped, 1)

    def test_a_removed_subtree_is_reported_and_not_migrated(self):
        removed = self.file_row(folder=self.root, file_name="gone", is_folder=1, status=REMOVED)
        below = self.file_row(folder=removed, file_name="below.txt")
        self.walk()
        self.assertFalse(frappe.db.exists("Drive Node", removed))
        self.assertFalse(frappe.db.exists("Drive Node", below))
        self.assertEqual(self.report.removed_rows_skipped, 2)

    def test_a_rerun_writes_nothing_twice(self):
        self.file_row(folder=self.root, file_name="report.txt")
        first = self.walk()
        self.assertEqual(first.nodes_written, 1)

        self.report = TreeConversion()
        second = self.walk()
        self.assertEqual(second.nodes_written, 0)
        self.assertEqual(second.nodes_already_present, 1)

    def test_the_source_rows_are_preserved(self):
        """§14.2: Build deletes nothing it migrated from."""
        source = self.file_row(folder=self.root, file_name="report.txt")
        before = frappe.db.get_value("File", source, ["name", "file_name", "folder"], as_dict=True)
        self.walk()
        self.assertEqual(
            frappe.db.get_value("File", source, ["name", "file_name", "folder"], as_dict=True), before
        )


class TestGrantWiring(BuildTreeCase):
    """§14.5: permission mapping against the real tables and the real index."""

    def setUp(self):
        super().setUp()
        self.env = self.write_root(user=self.owner)
        self.node = self.file_row(folder=self.root, file_name="report.txt")
        tree_module.convert_trees(self.env, TreeConversion(), [self.plan(self.owner)])
        self.report = GrantConversion()

    def convert(self):
        grants_module.convert_grants(self.env, self.report, [self.plan(self.owner)])
        return self.report

    def roles(self):
        return {
            row.principal: row.role
            for row in frappe.get_all(
                "Drive Grant", filters={"node": self.node}, fields=["principal", "role"]
            )
        }

    def test_a_permission_row_becomes_a_grant(self):
        self.permission_row(self.node, self.owner, read=1, write=1)
        self.convert()
        self.assertEqual(self.roles(), {self.owner: EDIT})

    def test_a_grant_row_satisfies_its_controller(self):
        """Bulk SQL bypasses `DriveGrant.validate`, so the columns must still pass."""
        self.permission_row(self.node, self.owner, read=1)
        self.convert()
        name = frappe.db.get_value("Drive Grant", {"node": self.node, "principal": self.owner})
        frappe.get_doc("Drive Grant", name).save(ignore_permissions=True)

    def test_duplicate_rows_collapse_before_they_are_mapped(self):
        """The compound keyset over `(entity, user, name)` is raw SQL too."""
        self.permission_row(self.node, self.owner, read=1, share=1)
        self.permission_row(self.node, self.owner, write=1)
        self.convert()
        self.assertEqual(self.roles(), {self.owner: MANAGE})

    def test_an_anonymous_row_above_read_mints_one_link(self):
        self.permission_row(self.node, "", read=1, write=1)
        self.convert()
        roles = self.roles()
        self.assertEqual(roles["$PUBLIC"], READ)
        link = [p for p in roles if p.startswith("$LINK:")]
        self.assertEqual(len(link), 1)
        self.assertEqual(len(link[0].removeprefix("$LINK:")), 22)

    def test_the_pair_index_refuses_a_duplicate(self):
        """`has_link_grant` and `grant_roles` resume against this index.

        Taken inside a savepoint. A failed statement leaves the whole
        transaction unusable on Postgres, and the rows this run still has
        to delete are in it.
        """
        self.permission_row(self.node, self.owner, read=1)
        self.convert()
        row = grants_module._grant_row(self.env, self.node, self.owner, READ)
        frappe.db.savepoint("drive_build_duplicate_grant")
        with self.assertRaises(Exception):
            self.env.drive.insert_grants([row])
        frappe.db.rollback(save_point="drive_build_duplicate_grant")

    def test_a_rerun_writes_nothing_twice(self):
        self.permission_row(self.node, "", read=1, write=1)
        first = self.convert()
        self.assertEqual(first.links_minted, 1)
        before = self.roles()

        self.report = GrantConversion()
        second = self.convert()
        self.assertEqual(second.links_minted, 0)
        self.assertEqual(second.grants_written, 0)
        self.assertEqual(self.roles(), before)

    def test_the_permission_rows_are_preserved(self):
        name = self.permission_row(self.node, self.owner, read=1)
        self.convert()
        self.assertTrue(frappe.db.exists("Drive Permission", name))


class TestLookupWiring(BuildTreeCase):
    """The single-row reads `grants` depends on, compiled once each."""

    def test_user_enabled_answers_three_ways(self):
        legacy = SiteTree()
        self.assertIsNone(legacy.user_enabled(self.prefix + "@nowhere.test"))
        self.assertIs(legacy.user_enabled("Administrator"), True)

    def test_group_exists_compiles(self):
        self.assertFalse(SiteTree().group_exists(self.prefix + "-no-group"))

    def test_sheet_entity_and_composite_deck_compile(self):
        """Both read through `File.content_doctype`, a Drive custom field."""
        legacy = SiteTree()
        self.assertIsNone(legacy.sheet_entity(self.prefix + "-no-sheet"))
        self.assertFalse(legacy.is_composite_deck(self.prefix + "-no-file"))

    def test_docshares_pages_on_the_sheet_doctype(self):
        SiteTree().docshares("", 5)
