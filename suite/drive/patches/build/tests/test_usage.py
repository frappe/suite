"""§14.2 step 12, §7.7, and §14.9: the recompute and its second opinion.

§7.7 fixes the sum as nodes plus versions plus reserved bytes, per Active
and Archived root. §14.9 asks for that total to be reconciled independently,
so `FakeUsage` can be given a grouped answer that disagrees with the
per-root one, which is the case the reconciliation exists to find.
"""

import tempfile
import unittest
from pathlib import Path

from suite.drive.patches.build.ports import ACTIVE, RootUsageRow
from suite.drive.patches.build.root_pairs import ARCHIVED
from suite.drive.patches.build.tests.fakes import (
    FakeUsage,
    InterruptedRun,
    build_environment,
)
from suite.drive.patches.build.usage import BuildUsageError, recompute_usage


def totals(nodes=0, versions=0, reserved=0):
    return {"nodes": nodes, "versions": versions, "reserved": reserved}


class UsageCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def ledger(self, roots, sums, grouped=None):
        return FakeUsage(roots=roots, totals=sums, grouped=grouped)

    def run_usage(self, ledger, batch_size=1000, env=None):
        self.env = env if env is not None else build_environment(self.path, usage=ledger, usage_ready=True)
        return recompute_usage(self.env, batch_size=batch_size)

    def root(self, name, used_bytes=0, state=ACTIVE):
        return RootUsageRow(name=name, kind="Personal", state=state, used_bytes=used_bytes)


class GateTest(UsageCase):
    """§14.8: the recompute is the last step, so it refuses to run early."""

    def test_it_refuses_before_the_trees_exist(self):
        env = build_environment(self.path, usage=FakeUsage())
        with self.assertRaises(BuildUsageError):
            recompute_usage(env)

    def test_it_refuses_before_the_content_steps_finish(self):
        env = build_environment(self.path, usage=FakeUsage(), tree_ready=True, settings_ready=True)
        with self.assertRaises(BuildUsageError):
            recompute_usage(env)

    def test_it_refuses_before_step_eleven_finishes(self):
        env = build_environment(self.path, usage=FakeUsage(), content_ready=True)
        content = env.state.content()
        content.completed = True
        env.state.put_content(content)
        with self.assertRaises(BuildUsageError):
            recompute_usage(env)

    def test_it_refuses_without_a_ledger(self):
        env = build_environment(self.path, usage_ready=True)
        env.usage = None
        with self.assertRaises(BuildUsageError):
            recompute_usage(env)


class RecomputeTest(UsageCase):
    """§7.7: nodes plus versions plus reserved, and nothing else."""

    def test_it_sums_the_three_charged_tables(self):
        ledger = self.ledger([self.root("r1", used_bytes=0)], {"r1": totals(10, 20, 30)})
        result = self.run_usage(ledger)
        self.assertEqual(ledger.root_rows[0].used_bytes, 60)
        self.assertEqual(result.used_bytes, 60)
        self.assertEqual((result.node_bytes, result.version_bytes, result.reserved_bytes), (10, 20, 30))
        self.assertEqual(result.roots_corrected, 1)

    def test_it_recomputes_an_archived_root(self):
        ledger = self.ledger([self.root("r1", state=ARCHIVED)], {"r1": totals(5)})
        result = self.run_usage(ledger)
        self.assertEqual(ledger.root_rows[0].used_bytes, 5)
        self.assertEqual(result.roots_recomputed, 1)

    def test_it_skips_a_root_in_any_other_state(self):
        ledger = self.ledger([self.root("r1", state="Removed")], {"r1": totals(5)})
        result = self.run_usage(ledger)
        self.assertEqual(ledger.writes, [])
        self.assertEqual(result.roots_skipped, 1)
        self.assertEqual(result.roots_recomputed, 0)

    def test_a_correct_counter_is_not_rewritten(self):
        ledger = self.ledger([self.root("r1", used_bytes=60)], {"r1": totals(10, 20, 30)})
        result = self.run_usage(ledger)
        self.assertEqual(ledger.writes, [])
        self.assertEqual(result.roots_corrected, 0)
        self.assertEqual(result.roots_recomputed, 1)

    def test_a_root_with_no_charged_rows_falls_to_zero(self):
        ledger = self.ledger([self.root("r1", used_bytes=99)], {})
        self.run_usage(ledger)
        self.assertEqual(ledger.root_rows[0].used_bytes, 0)

    def test_a_rerun_corrects_nothing(self):
        ledger = self.ledger([self.root("r1", used_bytes=0)], {"r1": totals(10, 20, 30)})
        self.run_usage(ledger)
        result = self.run_usage(ledger)
        self.assertEqual(result.roots_corrected, 0)
        self.assertEqual(result.used_bytes, 60)


class ReconciliationTest(UsageCase):
    """§14.9: the second opinion is a different statement, not a repeat."""

    def test_the_grouped_pass_runs_once_for_the_whole_site(self):
        roots = [self.root(f"r{index}") for index in range(4)]
        ledger = self.ledger(roots, {row.name: totals(1) for row in roots})
        self.run_usage(ledger)
        self.assertEqual(ledger.grouped_calls, 1)
        self.assertEqual(sorted(ledger.totals_calls), sorted(row.name for row in roots))

    def test_agreement_records_no_mismatch(self):
        ledger = self.ledger([self.root("r1")], {"r1": totals(10, 20, 30)})
        result = self.run_usage(ledger)
        self.assertEqual(result.reconciled_roots, 1)
        self.assertEqual(result.reconciliation_mismatches, 0)

    def test_a_disagreement_is_reported_with_both_numbers(self):
        ledger = self.ledger(
            [self.root("r1")],
            {"r1": totals(10, 20, 30)},
            grouped={"r1": totals(10, 20, 999)},
        )
        result = self.run_usage(ledger)
        self.assertEqual(result.reconciliation_mismatches, 1)
        self.assertEqual(result.mismatches_total, 1)
        mismatch = result.mismatches[0]
        self.assertEqual((mismatch.root, mismatch.recomputed, mismatch.reconciled), ("r1", 60, 1029))

    def test_a_root_missing_from_the_grouped_pass_disagrees(self):
        ledger = self.ledger([self.root("r1")], {"r1": totals(10)}, grouped={})
        result = self.run_usage(ledger)
        self.assertEqual(result.reconciliation_mismatches, 1)

    def test_bytes_charged_to_no_root_are_reported(self):
        ledger = self.ledger(
            [self.root("r1")],
            {"r1": totals(10)},
            grouped={"r1": totals(10), "ghost": totals(7, 0, 5)},
        )
        result = self.run_usage(ledger)
        self.assertEqual(result.unattributed_roots, 1)
        self.assertEqual(result.unattributed_bytes, 12)

    def test_a_skipped_root_is_not_unattributed(self):
        # A Removed root is not recomputed, but it is seen, so its bytes are
        # accounted for rather than reported as charged to nobody.
        ledger = self.ledger(
            [self.root("r1", state="Removed")],
            {"r1": totals(10)},
            grouped={"r1": totals(10)},
        )
        result = self.run_usage(ledger)
        self.assertEqual(result.unattributed_roots, 0)


class BatchTest(UsageCase):
    """§14.2: commit per batch, and resume at any batch boundary."""

    def roots(self, count=6):
        return [self.root(f"r{index}", used_bytes=0) for index in range(count)]

    def build(self, count=6):
        roots = self.roots(count)
        return self.ledger(roots, {row.name: totals(index + 1) for index, row in enumerate(roots)})

    def test_it_commits_more_than_once_at_a_small_batch(self):
        ledger = self.build()
        self.run_usage(ledger, batch_size=2)
        self.assertGreater(ledger.commits, 2)

    def test_a_kill_at_every_write_resumes_to_one_state(self):
        clean = self.build()
        self.run_usage(clean, batch_size=2)
        expected = {row.name: row.used_bytes for row in clean.root_rows}
        for victim in ("r1", "r3", "r5"):
            with self.subTest(killed=victim):
                self.setUp()
                ledger = self.build()
                ledger.fail_write = victim
                with self.assertRaises(InterruptedRun):
                    self.run_usage(ledger, batch_size=2)
                ledger.fail_write = None
                resumed = self.run_usage(ledger, batch_size=2, env=self.env)
                self.assertEqual({row.name: row.used_bytes for row in ledger.root_rows}, expected)
                self.assertTrue(resumed.completed)
                self.assertEqual(resumed.used_bytes, 1 + 2 + 3 + 4 + 5 + 6)


class DurableRecordTest(UsageCase):
    def test_it_stores_the_census_and_marks_the_step_complete(self):
        ledger = self.ledger([self.root("r1")], {"r1": totals(10, 20, 30)})
        self.run_usage(ledger)
        stored = self.env.state.usage()
        self.assertTrue(stored.completed)
        self.assertEqual(stored.used_bytes, 60)
        self.assertEqual(stored.roots_recomputed, 1)


if __name__ == "__main__":
    unittest.main()
