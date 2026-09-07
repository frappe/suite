"""§14.3: one root pair per legacy root folder, written whole or not at all."""

import unittest
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory

from suite.drive._core.roles import MANAGE
from suite.drive.patches.build.ports import (
    ACTIVE,
    DRIVE_ROOT_ROW,
    REMOVED,
    TRASHED,
    USERS_ROW,
    TreeRow,
)
from suite.drive.patches.build.root_pairs import (
    ARCHIVED,
    PERSONAL,
    SHARED,
    BuildPairError,
    convert_root_pairs,
)
from suite.drive.patches.build.state import BuildState, TreeConversion
from suite.drive.patches.build.tests.fakes import (
    BUILD_STAMP,
    FakeDrive,
    FakeTree,
    InterruptedRun,
    build_environment,
)

ALICE = "alice@example.com"
BOB = "bob@example.com"
CAROL = "carol@example.com"

# The stamps on the legacy rows. §14.4 copies them, so a node that carries
# `BUILD_STAMP` instead is a node Build invented rather than migrated.
SOURCE_CREATION = "2019-05-04 09:00:00.000000"
SOURCE_MODIFIED = "2020-07-08 10:30:00.000000"


def drive_row(**overrides) -> TreeRow:
    """The pinned `Drive` folder: the legacy shared tree."""
    return TreeRow(
        **{
            "name": DRIVE_ROOT_ROW,
            "file_name": "Drive",
            "folder": None,
            "is_folder": 1,
            "owner": "Administrator",
            "creation": SOURCE_CREATION,
            "modified": SOURCE_MODIFIED,
            **overrides,
        }
    )


def users_row() -> TreeRow:
    """The pinned `Users` folder. It holds the personal folders and is dropped."""
    return TreeRow(
        name=USERS_ROW,
        file_name="Users",
        folder=None,
        is_folder=1,
        owner="Administrator",
        creation=SOURCE_CREATION,
        modified=SOURCE_MODIFIED,
    )


def personal_row(name: str, email: str | None, **overrides) -> TreeRow:
    """One `Users/<email>` folder: the legacy shape of one person's space."""
    return TreeRow(
        **{
            "name": name,
            "file_name": email,
            "folder": USERS_ROW,
            "is_folder": 1,
            "owner": email,
            "creation": SOURCE_CREATION,
            "modified": SOURCE_MODIFIED,
            **overrides,
        }
    )


class RecordingDrive(FakeDrive):
    """A `FakeDrive` that remembers when each row landed.

    A pair is atomic, so the tests need two things the plain fake does not
    keep: the commit count at the moment each half went in, and what the
    tables held at every commit.
    """

    def __init__(self):
        super().__init__()
        self.pair_calls = []
        self.commit_snapshots = []
        self.commits_at_node = {}
        self.commits_at_grant = {}

    def write_root_pair(self, node, metadata, grants):
        self.pair_calls.append(
            (
                node["name"] if node else None,
                metadata["name"] if metadata else None,
                len(grants),
            )
        )
        super().write_root_pair(node, metadata, grants)

    def insert_nodes(self, rows):
        super().insert_nodes(rows)
        for row in rows:
            self.commits_at_node[row["name"]] = self.commits

    def insert_grants(self, rows):
        super().insert_grants(rows)
        for row in rows:
            self.commits_at_grant[row["node"]] = self.commits

    def commit(self):
        super().commit()
        self.commit_snapshots.append((set(self.node_rows), set(self.root_rows)))


class RootPairCase(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def build(self, *rows, users=None):
        """An environment over these legacy rows and an empty Drive."""
        drive = RecordingDrive()
        tree = FakeTree(rows, drive=drive, users=users or {})
        return build_environment(self.path, tree=tree, drive=drive)

    def run_roots(self, env, *, batch_size=1000):
        """One step 4 run with fresh counters, the way a rerun starts."""
        tree = TreeConversion()
        plans = convert_root_pairs(env, tree, batch_size=batch_size)
        return tree, plans

    def snapshot(self, drive):
        return deepcopy((drive.node_rows, drive.root_rows, drive.grant_rows))


class TestSharedRootPair(RootPairCase):
    """The `Drive` folder becomes the site's one Shared root pair."""

    def setUp(self):
        super().setUp()
        self.env = self.build(drive_row(), users_row())
        self.tree, _ = self.run_roots(self.env)
        self.node = self.env.drive.node_rows[DRIVE_ROOT_ROW]
        self.metadata = self.env.drive.root_rows[DRIVE_ROOT_ROW]

    def test_the_node_carries_the_empty_root_shape(self):
        """§3.1: a root node is Active, has no parent, and holds no content."""
        self.assertEqual(self.node["kind"], "root")
        self.assertEqual(self.node["state"], ACTIVE)
        self.assertEqual(self.node["path"], "")
        self.assertIsNone(self.node["parent"])
        self.assertIsNone(self.node["root"])
        self.assertIsNone(self.node["blob"])
        self.assertEqual(self.node["size"], 0)

    def test_the_node_title_comes_from_the_legacy_file_name(self):
        """§14.4 maps `title` from `file_name`."""
        self.assertEqual(self.node["title"], "Drive")

    def test_the_shared_node_owner_is_forced_to_administrator(self):
        """§3.2: the Shared root pair has `owner = Administrator`."""
        self.assertEqual(self.node["owner"], "Administrator")
        self.assertEqual(self.metadata["owner"], "Administrator")

    def test_a_hand_edited_owner_is_forced_back_to_administrator(self):
        """The legacy row is normally Administrator. Build does not trust that."""
        env = self.build(drive_row(owner=BOB))
        self.run_roots(env)

        self.assertEqual(env.drive.node_rows[DRIVE_ROOT_ROW]["owner"], "Administrator")
        self.assertEqual(env.drive.root_rows[DRIVE_ROOT_ROW]["owner"], "Administrator")

    def test_the_metadata_names_the_node_in_both_directions(self):
        """§14.3: `Drive Root.name` and `.node` both equal the File id."""
        self.assertEqual(self.metadata["name"], DRIVE_ROOT_ROW)
        self.assertEqual(self.metadata["node"], DRIVE_ROOT_ROW)

    def test_the_metadata_is_an_active_shared_root_with_no_user(self):
        """A Shared root names no user, and this one is the first."""
        self.assertEqual(self.metadata["kind"], SHARED)
        self.assertEqual(self.metadata["state"], ACTIVE)
        self.assertIsNone(self.metadata["user"])

    def test_the_shared_root_gets_no_anchor_grant_here(self):
        """§14.5: the Shared anchor is whatever the legacy `$GENERAL` row maps to."""
        self.assertEqual(self.env.drive.principals(DRIVE_ROOT_ROW), {})

    def test_the_users_row_becomes_no_pair(self):
        """The `Users` row is scaffolding, so it is read but never published."""
        self.assertEqual(set(self.env.drive.node_rows), {DRIVE_ROOT_ROW})
        self.assertEqual(self.tree.roots_seen, 1)
        self.assertEqual(self.tree.roots_created, 1)


class TestPersonalRootPair(RootPairCase):
    """A `Users/<email>` folder becomes a Personal root pair with its anchor."""

    def setUp(self):
        super().setUp()
        self.env = self.build(drive_row(), users_row(), personal_row("u-alice", ALICE), users={ALICE: True})
        self.tree, self.plans = self.run_roots(self.env)
        self.node = self.env.drive.node_rows["u-alice"]
        self.metadata = self.env.drive.root_rows["u-alice"]

    def test_the_metadata_is_personal_and_names_the_user(self):
        """§14.3: Personal metadata carries `user = <email>`."""
        self.assertEqual(self.metadata["kind"], PERSONAL)
        self.assertEqual(self.metadata["user"], ALICE)
        self.assertEqual(self.metadata["state"], ACTIVE)

    def test_the_personal_node_keeps_the_legacy_owner(self):
        """§14.4 copies `owner`. Only the Shared pair is forced."""
        self.assertEqual(self.node["owner"], ALICE)

    def test_the_user_holds_a_manage_anchor_grant(self):
        """§3.2: a Personal root node carries one grant, MANAGE for its user."""
        self.assertEqual(self.env.drive.principals("u-alice"), {ALICE: MANAGE})

    def test_the_pair_and_its_anchor_go_in_one_call(self):
        """A second call could publish a root nobody can reach."""
        self.assertEqual(
            self.env.drive.pair_calls,
            [(DRIVE_ROOT_ROW, DRIVE_ROOT_ROW, 0), ("u-alice", "u-alice", 1)],
        )

    def test_no_commit_falls_between_the_node_and_its_grant(self):
        """A commit there would publish a root with no way in."""
        self.assertEqual(
            self.env.drive.commits_at_node["u-alice"], self.env.drive.commits_at_grant["u-alice"]
        )

    def test_the_plan_answers_the_root_step_five_walks(self):
        """Step 5 hangs the tree off this node, so the plan must name it."""
        plan = next(plan for plan in self.plans if plan.kind == PERSONAL)
        self.assertEqual((plan.node, plan.user, plan.state), ("u-alice", ALICE, ACTIVE))


class TestIdentityAndStamps(RootPairCase):
    """The pair keeps the File id and the File's own timestamps."""

    def setUp(self):
        super().setUp()
        self.env = self.build(personal_row("u-alice", ALICE), users={ALICE: True})
        self.tree, _ = self.run_roots(self.env)
        self.node = self.env.drive.node_rows["u-alice"]
        self.metadata = self.env.drive.root_rows["u-alice"]

    def test_the_node_id_is_the_file_id(self):
        """§14.3: bookmarks and side tables keep working because of this."""
        self.assertEqual(self.node["name"], "u-alice")

    def test_the_metadata_id_is_the_file_id(self):
        """`autoname: field:node`, so bulk SQL has to write both by hand."""
        self.assertEqual(self.metadata["name"], "u-alice")
        self.assertEqual(self.metadata["node"], "u-alice")

    def test_the_node_stamps_come_from_the_source_row(self):
        """A migrated row keeps its age. `env.now()` is for rows Build authors."""
        self.assertEqual(self.node["creation"], SOURCE_CREATION)
        self.assertEqual(self.node["modified"], SOURCE_MODIFIED)
        self.assertNotEqual(self.node["creation"], BUILD_STAMP)
        self.assertNotEqual(self.node["modified"], BUILD_STAMP)

    def test_the_metadata_stamps_come_from_the_source_row(self):
        """The metadata is the same root, so it carries the same age."""
        self.assertEqual(self.metadata["creation"], SOURCE_CREATION)
        self.assertEqual(self.metadata["modified"], SOURCE_MODIFIED)

    def test_the_anchor_grant_is_stamped_by_the_run(self):
        """Build authors the grant, so this row is the run's own."""
        (grant,) = self.env.drive.grant_rows.values()
        self.assertEqual(grant["creation"], BUILD_STAMP)
        self.assertEqual(grant["modified"], BUILD_STAMP)


class TestBlankUserFolder(RootPairCase):
    """A `Users/<email>` folder that names nobody cannot become a root."""

    def setUp(self):
        super().setUp()
        self.env = self.build(
            drive_row(),
            users_row(),
            personal_row("u-blank", "   "),
            personal_row("u-none", None),
        )
        self.tree, _ = self.run_roots(self.env)

    def test_no_pair_is_written_for_either_row(self):
        """A Personal root with no user is a row `DriveRoot.validate` refuses."""
        self.assertEqual(set(self.env.drive.node_rows), {DRIVE_ROOT_ROW})
        self.assertEqual(set(self.env.drive.root_rows), {DRIVE_ROOT_ROW})

    def test_both_rows_are_counted_as_skipped(self):
        """§14.9 prints the count, so it must not understate the two rows."""
        self.assertEqual(self.tree.roots_seen, 3)
        self.assertEqual(self.tree.roots_skipped, 2)
        self.assertEqual(self.tree.roots_created, 1)

    def test_each_skip_records_the_row_and_the_reason(self):
        """The operator has to find the folder that was left behind."""
        self.assertEqual(
            [(skip.file, skip.reason) for skip in self.tree.skipped],
            [
                ("u-blank", "a Users/<email> folder names no user"),
                ("u-none", "a Users/<email> folder names no user"),
            ],
        )


class TestRemovedRoot(RootPairCase):
    """§14.4: a Removed row is not migrated, and a root takes its space with it."""

    def setUp(self):
        super().setUp()
        self.env = self.build(
            drive_row(status=REMOVED),
            users_row(),
            personal_row("u-alice", ALICE, status=REMOVED),
            users={ALICE: True},
        )
        self.tree, self.plans = self.run_roots(self.env)

    def test_neither_half_of_the_pair_is_written(self):
        """Publishing the pair would resurrect a deleted namespace."""
        self.assertEqual(self.env.drive.node_rows, {})
        self.assertEqual(self.env.drive.root_rows, {})
        self.assertEqual(self.env.drive.pair_calls, [])

    def test_both_removed_roots_are_counted_as_skipped(self):
        self.assertEqual(self.tree.roots_skipped, 2)
        self.assertEqual(self.tree.roots_created, 0)

    def test_the_skip_reason_names_the_status(self):
        self.assertEqual(
            [(skip.file, skip.reason) for skip in self.tree.skipped],
            [
                (DRIVE_ROOT_ROW, "root folder status is Removed"),
                ("u-alice", "root folder status is Removed"),
            ],
        )

    def test_step_five_is_given_no_root_to_walk(self):
        """No plan means no descendant of a Removed root is ever visited."""
        self.assertEqual(self.plans, [])


class TestTrashedRootFolder(RootPairCase):
    """A trashed root folder keeps an Active node and takes the trash on its metadata."""

    def setUp(self):
        super().setUp()
        self.env = self.build(
            drive_row(status=TRASHED),
            users_row(),
            personal_row("u-alice", ALICE, status=TRASHED),
            users={ALICE: True},
        )
        self.tree, _ = self.run_roots(self.env)

    def test_the_root_nodes_stay_active(self):
        """§3.1: a root node is Active by definition, so the trash cannot land there."""
        for name in (DRIVE_ROOT_ROW, "u-alice"):
            node = self.env.drive.node_rows[name]
            self.assertEqual(node["state"], ACTIVE)
            self.assertIsNone(node["trashed_at"])
            self.assertIsNone(node["trash_root"])

    def test_the_metadata_is_archived(self):
        """Archived is the only state left that keeps the trash visible."""
        for name in (DRIVE_ROOT_ROW, "u-alice"):
            self.assertEqual(self.env.drive.root_rows[name]["state"], ARCHIVED)

    def test_both_archived_roots_are_counted(self):
        self.assertEqual(self.tree.roots_archived, 2)
        self.assertEqual(self.tree.roots_created, 2)


class TestUserStateDecidesMetadata(RootPairCase):
    """§14.3: metadata Active when the user is enabled, otherwise Archived."""

    def setUp(self):
        super().setUp()
        self.env = self.build(
            users_row(),
            personal_row("u-alice", ALICE),
            personal_row("u-bob", BOB),
            personal_row("u-carol", CAROL),
            # CAROL is absent on purpose: `user_enabled` answers None, which
            # is the `User` row a site deleted rather than disabled.
            users={ALICE: True, BOB: False},
        )
        self.tree, _ = self.run_roots(self.env)

    def test_an_enabled_user_gets_active_metadata(self):
        self.assertEqual(self.env.drive.root_rows["u-alice"]["state"], ACTIVE)

    def test_a_disabled_user_gets_archived_metadata(self):
        self.assertEqual(self.env.drive.root_rows["u-bob"]["state"], ARCHIVED)

    def test_a_user_row_that_is_gone_gets_archived_metadata(self):
        """`DriveRoot.validate` demands a live user only for an Active row."""
        self.assertEqual(self.env.drive.root_rows["u-carol"]["state"], ARCHIVED)

    def test_every_node_stays_active_whatever_the_user_is(self):
        """The bytes are still there, so the tree below each root is still walked."""
        for name in ("u-alice", "u-bob", "u-carol"):
            self.assertEqual(self.env.drive.node_rows[name]["state"], ACTIVE)
        self.assertEqual(self.tree.roots_archived, 2)


class TestDuplicateUserFolders(RootPairCase):
    """Two folders for one address: only the first may be Active."""

    def setUp(self):
        super().setUp()
        # `_root_rows` pages the `Users` children in `(folder, name)` order,
        # so "u-alice-1" is read first on every run.
        self.env = self.build(
            users_row(),
            personal_row("u-alice-2", ALICE),
            personal_row("u-alice-1", ALICE),
            users={ALICE: True},
        )
        self.tree, _ = self.run_roots(self.env)

    def test_the_first_folder_in_id_order_stays_active(self):
        self.assertEqual(self.env.drive.root_rows["u-alice-1"]["state"], ACTIVE)

    def test_the_second_folder_is_archived(self):
        """§3.2: a user may hold at most one Active Personal root."""
        self.assertEqual(self.env.drive.root_rows["u-alice-2"]["state"], ARCHIVED)

    def test_both_pairs_are_written_and_one_is_counted_archived(self):
        """The second folder still holds files, so its node has to exist."""
        self.assertEqual(set(self.env.drive.node_rows), {"u-alice-1", "u-alice-2"})
        self.assertEqual(self.tree.roots_archived, 1)


class TestRerun(RootPairCase):
    """A second run over a finished site writes nothing and reports the same."""

    def setUp(self):
        super().setUp()
        self.env = self.build(
            drive_row(),
            users_row(),
            personal_row("u-alice", ALICE),
            personal_row("u-bob", BOB),
            users={ALICE: True, BOB: True},
        )
        self.first, _ = self.run_roots(self.env)
        self.before = self.snapshot(self.env.drive)
        self.calls = len(self.env.drive.pair_calls)
        self.second, _ = self.run_roots(self.env)

    def test_the_second_run_writes_no_row(self):
        """A duplicate insert would raise; an updated row would lose the source stamps."""
        self.assertEqual(self.snapshot(self.env.drive), self.before)

    def test_the_second_run_makes_no_pair_call(self):
        self.assertEqual(len(self.env.drive.pair_calls), self.calls)

    def test_the_second_run_counts_every_pair_as_complete(self):
        """§14.9 prints the state of the migration, not the diary of one run."""
        self.assertEqual(self.first.roots_created, 3)
        self.assertEqual(self.second.roots_already_complete, 3)
        self.assertEqual(self.second.roots_created, 0)
        self.assertEqual(self.second.roots_repaired, 0)
        self.assertEqual(self.second.roots_seen, self.first.roots_seen)


class TestRepair(RootPairCase):
    """A pair with one half missing is completed, not created again."""

    def setUp(self):
        super().setUp()
        self.env = self.build(drive_row(), users_row())
        self.run_roots(self.env)
        self.created = deepcopy(self.env.drive.node_rows[DRIVE_ROOT_ROW])
        del self.env.drive.root_rows[DRIVE_ROOT_ROW]
        self.tree, _ = self.run_roots(self.env)

    def test_the_missing_metadata_comes_back(self):
        metadata = self.env.drive.root_metadata(DRIVE_ROOT_ROW)
        self.assertEqual(metadata["name"], DRIVE_ROOT_ROW)
        self.assertEqual(metadata["kind"], SHARED)

    def test_the_repair_is_counted_apart_from_a_creation(self):
        self.assertEqual(self.tree.roots_repaired, 1)
        self.assertEqual(self.tree.roots_created, 0)
        self.assertEqual(self.tree.roots_already_complete, 0)

    def test_the_node_is_not_written_again(self):
        """A second insert would raise, and an update would lose the source stamps."""
        self.assertEqual(self.env.drive.node_rows[DRIVE_ROOT_ROW], self.created)
        self.assertEqual(self.env.drive.pair_calls[-1], (None, DRIVE_ROOT_ROW, 0))


class TestPersonalRepair(RootPairCase):
    """A Personal pair repairs without sending its anchor grant twice.

    `Drive Grant` carries a unique index on `(node, principal)`. Writing
    the anchor again fails the pair transaction, so a site whose `Drive
    Root` row was lost could never be repaired: every rerun would die in
    the same place.
    """

    def setUp(self):
        super().setUp()
        self.env = self.build(drive_row(), users_row(), personal_row("u-alice", ALICE), users={ALICE: True})
        self.run_roots(self.env)
        del self.env.drive.root_rows["u-alice"]
        self.tree, _ = self.run_roots(self.env)

    def test_the_metadata_comes_back(self):
        self.assertEqual(self.env.drive.root_metadata("u-alice")["user"], ALICE)

    def test_the_repair_is_counted(self):
        self.assertEqual(self.tree.roots_repaired, 1)

    def test_the_anchor_grant_is_not_written_twice(self):
        anchors = [row for row in self.env.drive.grant_rows.values() if row["node"] == "u-alice"]
        self.assertEqual(len(anchors), 1)
        self.assertEqual(anchors[0]["principal"], ALICE)


class TestMismatchRefusals(RootPairCase):
    """Stored state that contradicts the legacy row stops Build before step 5."""

    def refuse(self, *rows, users=None, node=None, metadata=None):
        """Seed Drive with a contradiction and return the refusal message."""
        env = self.build(*rows, users=users)
        if node:
            env.drive.node_rows[node["name"]] = node
        if metadata:
            env.drive.root_rows[metadata["name"]] = metadata
        with self.assertRaises(BuildPairError) as caught:
            self.run_roots(env)
        return str(caught.exception)

    def test_a_node_that_is_not_a_root_is_refused(self):
        """A tree hung off a folder node would have no root at all."""
        message = self.refuse(drive_row(), node={"name": DRIVE_ROOT_ROW, "kind": "folder", "parent": None})
        self.assertIn("'folder'", message)

    def test_a_root_node_with_a_parent_is_refused(self):
        """§3.1: a root node has no parent, so this row is not the root Build means."""
        message = self.refuse(
            drive_row(), node={"name": DRIVE_ROOT_ROW, "kind": "root", "parent": "elsewhere"}
        )
        self.assertIn("no parent", message)

    def test_metadata_named_after_another_row_is_refused(self):
        """§14.3 pins `name` to the node id, and a rerun cannot rename a row."""
        message = self.refuse(
            drive_row(),
            metadata={
                "name": "other",
                "node": DRIVE_ROOT_ROW,
                "user": None,
                "kind": SHARED,
                "state": ACTIVE,
            },
        )
        self.assertIn("must equal the node id", message)

    def test_metadata_of_the_other_kind_is_refused(self):
        """A Shared row and a Personal row are two different namespaces."""
        message = self.refuse(
            drive_row(),
            metadata={
                "name": DRIVE_ROOT_ROW,
                "node": DRIVE_ROOT_ROW,
                "user": ALICE,
                "kind": PERSONAL,
                "state": ACTIVE,
            },
        )
        self.assertIn(f"is a {PERSONAL!r} root", message)

    def test_metadata_that_belongs_to_another_user_is_refused(self):
        """Continuing would hang one person's files under another person's root."""
        message = self.refuse(
            users_row(),
            personal_row("u-alice", ALICE),
            users={ALICE: True, BOB: True},
            metadata={
                "name": "u-alice",
                "node": "u-alice",
                "user": BOB,
                "kind": PERSONAL,
                "state": ACTIVE,
            },
        )
        self.assertIn(f"belongs to {BOB!r}", message)


class TestInterruption(RootPairCase):
    """A run killed inside one pair leaves no half of that pair behind."""

    def setUp(self):
        super().setUp()
        self.env = self.build(drive_row(), users_row(), personal_row("u-alice", ALICE), users={ALICE: True})
        self.env.drive.fail_pair = "u-alice"
        with self.assertRaises(InterruptedRun):
            self.run_roots(self.env)

    def test_no_part_of_the_killed_pair_landed(self):
        """A published node with no metadata is the half pair §3.2 refuses."""
        self.assertNotIn("u-alice", self.env.drive.node_rows)
        self.assertIsNone(self.env.drive.root_metadata("u-alice"))
        self.assertEqual(self.env.drive.principals("u-alice"), {})

    def test_the_pair_before_it_is_untouched(self):
        """The kill is per pair, so the work before it does not have to be redone."""
        self.assertIn(DRIVE_ROOT_ROW, self.env.drive.node_rows)
        self.assertIsNotNone(self.env.drive.root_metadata(DRIVE_ROOT_ROW))

    def test_the_rerun_completes_the_pair(self):
        """The migration resumes; it does not need a truncated database."""
        self.env.drive.fail_pair = None
        tree, _ = self.run_roots(self.env)

        self.assertEqual(self.env.drive.node_rows["u-alice"]["kind"], "root")
        self.assertEqual(self.env.drive.root_rows["u-alice"]["user"], ALICE)
        self.assertEqual(self.env.drive.principals("u-alice"), {ALICE: MANAGE})
        self.assertEqual(tree.roots_created, 1)
        self.assertEqual(tree.roots_already_complete, 1)


class TestBatching(RootPairCase):
    """The batch boundary sits between pairs, never inside one."""

    def setUp(self):
        super().setUp()
        self.env = self.build(
            drive_row(),
            users_row(),
            personal_row("u-alice", ALICE),
            personal_row("u-bob", BOB),
            personal_row("u-carol", CAROL),
            users={ALICE: True, BOB: True, CAROL: True},
        )
        self.tree, _ = self.run_roots(self.env, batch_size=2)

    def test_every_pair_is_written(self):
        expected = {DRIVE_ROOT_ROW, "u-alice", "u-bob", "u-carol"}
        self.assertEqual(set(self.env.drive.node_rows), expected)
        self.assertEqual(set(self.env.drive.root_rows), expected)

    def test_the_commit_count_is_one_per_batch_plus_the_last(self):
        """Four pairs at two a batch: two full batches, then the closing commit."""
        self.assertEqual(self.env.drive.commits, 3)

    def test_no_commit_falls_inside_a_pair(self):
        """A kill at any commit must leave whole pairs only."""
        for nodes, roots in self.env.drive.commit_snapshots:
            self.assertEqual(nodes, roots)

    def test_each_batch_holds_two_pairs(self):
        """The batch is counted in pairs, so the halves cannot be split across one."""
        self.assertEqual(
            [len(nodes) for nodes, _ in self.env.drive.commit_snapshots],
            [2, 4, 4],
        )


class TestStateFile(RootPairCase):
    """The counters reach the record on disk, which is what §14.9 reads back."""

    def setUp(self):
        super().setUp()
        self.env = self.build(
            drive_row(),
            users_row(),
            personal_row("u-alice", ALICE),
            personal_row("u-bob", BOB),
            personal_row("u-blank", "  "),
            users={ALICE: True, BOB: False},
        )
        self.tree, _ = self.run_roots(self.env, batch_size=2)
        self.stored = BuildState(self.path / "drive-build-state.json").tree()

    def test_the_stored_counters_match_the_run(self):
        """Build is resumable, so the numbers cannot live in memory alone."""
        self.assertEqual(self.stored.roots_seen, self.tree.roots_seen)
        self.assertEqual(self.stored.roots_created, 3)
        self.assertEqual(self.stored.roots_archived, 1)
        self.assertEqual(self.stored.roots_skipped, 1)

    def test_the_stored_record_keeps_the_skipped_rows(self):
        """The operator reads the evidence out of the file, not out of the log."""
        self.assertEqual(
            [(skip.file, skip.reason) for skip in self.stored.skipped],
            [("u-blank", "a Users/<email> folder names no user")],
        )

    def test_the_stored_record_keeps_the_longest_id(self):
        """§3.1 asks for the id length to be measured against real migrated rows."""
        self.assertEqual(self.stored.max_id_length, len("u-alice"))


if __name__ == "__main__":
    unittest.main()
