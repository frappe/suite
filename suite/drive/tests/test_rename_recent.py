"""§3.9 and §14.6: `Drive Entity Log` becomes `Drive Recent` before sync.

No database. The patch is a thin `execute` over decisions this file reads
directly, because the schema change it makes cannot be rehearsed against a
site without migrating that site.

The SQL itself was checked against MariaDB before the patch was written: a
temporary copy of the real `tabDrive Entity Log` was deduped, altered by
`ALTER_STATEMENTS` in order, and then accepted `UNIQUE recent_user_node`.
That is what these tests pin, not what they prove.
"""

import unittest
from unittest import mock

from suite.drive.patches import rename_entity_log_to_recent as patch
from suite.drive.patches.rename_entity_log_to_recent import (
    ALTER_STATEMENTS,
    CLEAR_TARGET,
    LEGACY,
    RENAME,
    SKIP,
    TARGET,
    DriveRecentRenameError,
    plan,
)


class PlanTest(unittest.TestCase):
    """Which of the four sites this is, decided from three facts."""

    def test_a_site_without_the_legacy_table_is_left_alone(self):
        self.assertEqual(plan(legacy_table=False, target_table=False, target_rows=0), SKIP)
        self.assertEqual(plan(legacy_table=False, target_table=True, target_rows=99), SKIP)

    def test_the_upgrade_path_renames(self):
        self.assertEqual(plan(legacy_table=True, target_table=False, target_rows=0), RENAME)

    def test_an_empty_target_is_replaced_by_the_table_with_the_rows(self):
        self.assertEqual(plan(legacy_table=True, target_table=True, target_rows=0), CLEAR_TARGET)

    def test_two_populated_tables_are_refused(self):
        with self.assertRaises(DriveRecentRenameError) as raised:
            plan(legacy_table=True, target_table=True, target_rows=5)
        self.assertIn(TARGET, str(raised.exception))
        self.assertIn(LEGACY, str(raised.exception))


class StatementTest(unittest.TestCase):
    """What the ALTERs do, and in what order."""

    def test_every_statement_names_the_renamed_table(self):
        for statement in ALTER_STATEMENTS:
            with self.subTest(statement=statement):
                self.assertIn(f"`tab{TARGET}`", statement)
                self.assertNotIn(LEGACY, statement)

    def test_the_engine_is_changed_first(self):
        self.assertIn("ENGINE=InnoDB", ALTER_STATEMENTS[0])

    def test_the_name_column_is_retyped_in_two_steps(self):
        # MariaDB will not retype a column that is still AUTO_INCREMENT, and
        # the legacy doctype is autoincrement while `Drive Recent` is `hash`.
        self.assertIn("MODIFY COLUMN `name` bigint(20)", ALTER_STATEMENTS[1])
        self.assertIn("MODIFY COLUMN `name` varchar(140)", ALTER_STATEMENTS[2])

    def test_both_columns_are_renamed_rather_than_added(self):
        # `CHANGE COLUMN` keeps the values. Adding `node` beside
        # `entity_name` is what would lose them.
        self.assertIn("CHANGE COLUMN `entity_name` `node`", ALTER_STATEMENTS[3])
        self.assertIn("CHANGE COLUMN `last_interaction` `opened_at`", ALTER_STATEMENTS[4])

    def test_the_collapse_keeps_the_newest_open_per_pair(self):
        collapse = " ".join(patch.COLLAPSE_DUPLICATES.split())
        self.assertIn("DELETE stale", collapse)
        self.assertIn("newer.`last_interaction` > stale.`last_interaction`", collapse)
        # The tie-break, so the survivor does not depend on row order.
        self.assertIn("newer.`name` > stale.`name`", collapse)


class ExecuteCase(unittest.TestCase):
    """`execute`, with the database and the gate replaced."""

    def setUp(self):
        self.frappe = mock.MagicMock()
        self.frappe.db.sql.return_value = [[0]]
        self.enterContext(mock.patch.object(patch, "frappe", self.frappe))
        self.gate = mock.MagicMock()
        self.enterContext(mock.patch.object(patch, "_refuse_a_site_that_cannot_build", self.gate))
        self.enterContext(mock.patch.object(patch, "_rename_docfields", mock.MagicMock()))

    def tables(self, legacy, target, rows=0):
        self.frappe.db.table_exists.side_effect = lambda name: legacy if name == LEGACY else target
        self.frappe.db.count.return_value = rows


class ExecuteTest(ExecuteCase):
    def test_a_site_without_the_legacy_table_changes_nothing(self):
        self.tables(legacy=False, target=True)
        patch.execute()
        self.gate.assert_not_called()
        self.frappe.rename_doc.assert_not_called()
        self.frappe.db.sql_ddl.assert_not_called()

    def test_the_gate_runs_before_the_schema_changes(self):
        self.tables(legacy=True, target=False)
        self.gate.side_effect = RuntimeError("this site cannot complete Build")
        with self.assertRaises(RuntimeError):
            patch.execute()
        self.frappe.rename_doc.assert_not_called()
        self.frappe.db.sql_ddl.assert_not_called()

    def test_it_renames_the_doctype_and_then_the_columns(self):
        self.tables(legacy=True, target=False)
        patch.execute()
        self.frappe.rename_doc.assert_called_once_with("DocType", LEGACY, TARGET, force=True)
        self.assertEqual(
            [call.args[0] for call in self.frappe.db.sql_ddl.call_args_list],
            list(ALTER_STATEMENTS),
        )

    def test_it_collapses_duplicates_before_the_rename(self):
        self.tables(legacy=True, target=False)
        self.frappe.db.sql.return_value = [[3]]
        patch.execute()
        collapsed = [call.args[0] for call in self.frappe.db.sql.call_args_list]
        self.assertIn(patch.COLLAPSE_DUPLICATES, collapsed)

    def test_it_collapses_nothing_when_there_is_nothing_to_collapse(self):
        self.tables(legacy=True, target=False)
        self.frappe.db.sql.return_value = [[0]]
        patch.execute()
        self.assertEqual(
            [call.args[0] for call in self.frappe.db.sql.call_args_list],
            [patch.COUNT_DUPLICATES],
        )

    def test_an_empty_target_is_dropped_first(self):
        self.tables(legacy=True, target=True, rows=0)
        patch.execute()
        self.frappe.delete_doc.assert_called_once_with("DocType", TARGET, force=True, ignore_permissions=True)
        self.frappe.rename_doc.assert_called_once_with("DocType", LEGACY, TARGET, force=True)

    def test_a_populated_target_stops_the_migration(self):
        self.tables(legacy=True, target=True, rows=7)
        with self.assertRaises(DriveRecentRenameError):
            patch.execute()
        self.gate.assert_not_called()
        self.frappe.delete_doc.assert_not_called()
        self.frappe.rename_doc.assert_not_called()

    def test_it_commits_and_clears_the_cache(self):
        self.tables(legacy=True, target=False)
        patch.execute()
        self.frappe.db.commit.assert_called_once_with()
        self.frappe.clear_cache.assert_called_once_with(doctype=TARGET)


if __name__ == "__main__":
    unittest.main()
