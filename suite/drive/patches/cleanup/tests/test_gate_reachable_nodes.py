"""Gate 1 (§14.10): every reachable Drive File has a node, recomputed live."""

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from suite.drive.patches.cleanup.gate import (
    ReachableNodesGateError,
    check_gate_reachable_nodes,
    recompute_unmigrated_reachable,
)
from suite.drive.patches.cleanup.ports import REMOVED
from suite.drive.patches.cleanup.tests.fakes import FakeFileTable, cleanup_environment


class TestGateReachableNodes(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def env(self, files):
        return cleanup_environment(self.path, files=files)

    def test_a_healthy_site_passes(self):
        files = FakeFileTable().add("Drive").add("a", folder="Drive", has_node=True)
        check_gate_reachable_nodes(self.env(files))

    def test_a_reachable_file_with_no_node_refuses(self):
        files = FakeFileTable().add("Drive").add("a", folder="Drive", has_node=False)
        with self.assertRaises(ReachableNodesGateError) as caught:
            check_gate_reachable_nodes(self.env(files))
        self.assertIn("reachable Drive File", str(caught.exception))
        self.assertIn("a", str(caught.exception))

    def test_the_drive_root_itself_missing_a_node_refuses(self):
        files = FakeFileTable().add("Drive", folder=None, has_node=False)
        with self.assertRaises(ReachableNodesGateError):
            check_gate_reachable_nodes(self.env(files))

    def test_a_removed_row_with_no_node_does_not_block(self):
        files = FakeFileTable().add("Drive").add("trash", folder="Drive", status=REMOVED, has_node=False)
        check_gate_reachable_nodes(self.env(files))

    def test_a_removed_subtree_child_does_not_block(self):
        files = (
            FakeFileTable()
            .add("Drive")
            .add("trash", folder="Drive", status=REMOVED, has_node=False)
            .add("child", folder="trash", has_node=False)
        )
        check_gate_reachable_nodes(self.env(files))

    def test_an_unreachable_home_attachment_does_not_block(self):
        # `Home` is frappe's own row, not Drive's: folder-less, and not one
        # of the two pinned roots, so the climb settles it "outside".
        files = FakeFileTable().add("Drive").add("attachment", folder="Home", has_node=False)
        check_gate_reachable_nodes(self.env(files))

    def test_the_users_index_row_is_never_counted(self):
        files = FakeFileTable().add("Users", folder=None, has_node=False)
        count, samples = recompute_unmigrated_reachable(self.env(files))
        self.assertEqual(count, 0)
        self.assertEqual(samples, [])

    def test_a_broken_chain_does_not_block(self):
        # `folder` names a row that is gone entirely: not reachable from any
        # root, so it cannot be asserted "reachable and migrated".
        files = FakeFileTable().add("orphan", folder="does-not-exist", has_node=False)
        check_gate_reachable_nodes(self.env(files))

    def test_a_migrated_ancestor_short_circuits_the_climb(self):
        # `mid` already has a node, so the climb never needs to read `Drive`
        # itself for `leaf`'s chain.
        files = (
            FakeFileTable()
            .add("Drive")
            .add("mid", folder="Drive", has_node=True)
            .add("leaf", folder="mid", has_node=False)
        )
        with self.assertRaises(ReachableNodesGateError):
            check_gate_reachable_nodes(self.env(files))
        # `mid` already has a node, so `_advance` never needs `chain_of` at
        # all for `leaf`'s only hop: `unknown` is empty once `mid` is found
        # in `nodes_of`, and an empty `unknown` calls `chain_of` on nothing.
        self.assertEqual(files.chain_calls, [])

    def test_a_stale_build_report_is_never_consulted(self):
        # Nothing in this port set can even express Build's persisted state
        # (`suite.drive.patches.build.state.BuildState`): gate 1 only reads
        # `env.tree`/`env.drive`, so there is no attribute a stale report
        # could occupy to change this answer.
        files = FakeFileTable().add("Drive").add("a", folder="Drive", has_node=False)
        env = self.env(files)
        self.assertFalse(hasattr(env, "build_state"))
        with self.assertRaises(ReachableNodesGateError):
            check_gate_reachable_nodes(env)

    def test_paging_finds_every_row_across_batches(self):
        files = FakeFileTable().add("Drive")
        for i in range(5):
            files.add(f"n{i}", folder="Drive", has_node=(i != 3))
        env = self.env(files)
        count, samples = recompute_unmigrated_reachable(env, batch_size=2)
        self.assertEqual(count, 1)
        self.assertEqual(samples, ["n3"])


if __name__ == "__main__":
    unittest.main()
