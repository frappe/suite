"""Site-free tests for the durable `DocShare` preimage journal."""

import importlib.util
import json
import sys
import unittest
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

# Load the pure module without importing Build's package initializer, the way
# `test_slide_journal` does: that initializer wires site ports, which is
# outside this unit test's boundary.
MODULE_PATH = Path(__file__).parents[1] / "docshare_journal.py"
SPEC = importlib.util.spec_from_file_location("_build_docshare_journal", MODULE_PATH)
docshare_journal = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = docshare_journal
SPEC.loader.exec_module(docshare_journal)

DOCSHARE_COLUMNS = docshare_journal.DOCSHARE_COLUMNS
CorruptJournalError = docshare_journal.CorruptJournalError
DocSharePreimageJournal = docshare_journal.DocSharePreimageJournal
JournalConflictError = docshare_journal.JournalConflictError
name_hash = docshare_journal.name_hash
row_hash = docshare_journal.row_hash
row_values = docshare_journal.row_values

CREATED = "2026-09-08 12:34:56.000000"


def share_row(name="d1", **columns):
    row = {
        "name": name,
        "share_doctype": "Sheet",
        "share_name": "sheet-1",
        "user": "friend@example.com",
        "read": 1,
        "write": 0,
        "share": 0,
        "submit": 0,
        "everyone": 0,
        "owner": "owner@example.com",
        "creation": "2020-01-01 00:00:00.000000",
        "modified": "2020-01-02 00:00:00.000000",
        "modified_by": "owner@example.com",
    }
    row.update(columns)
    return row


class JournalCase(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "private" / "drive-build-docshare-preimages"
        self.journal = DocSharePreimageJournal(self.root)

    def record_path(self, name: str) -> Path:
        digest = name_hash(name)
        return self.root / digest[:2] / f"{digest}.json"


class ColumnTest(unittest.TestCase):
    """The record has to be a whole row, or it cannot put one back."""

    def test_every_docshare_column_a_rollback_insert_needs(self):
        self.assertEqual(
            DOCSHARE_COLUMNS,
            (
                "name",
                "share_doctype",
                "share_name",
                "user",
                "read",
                "write",
                "share",
                "submit",
                "everyone",
                "owner",
                "creation",
                "modified",
                "modified_by",
            ),
        )

    def test_a_missing_column_is_refused_by_name(self):
        row = share_row()
        del row["submit"]
        with self.assertRaises(ValueError) as caught:
            row_values(row)
        self.assertIn("submit", str(caught.exception))

    def test_a_null_column_is_a_value_and_not_an_absence(self):
        values = row_values(share_row(user=None))
        self.assertIsNone(values[DOCSHARE_COLUMNS.index("user")])

    def test_a_datetime_is_stored_as_the_text_an_insert_takes(self):
        stamp = datetime(2020, 1, 1, 3, 4, 5, 678901)
        values = row_values(share_row(creation=stamp))
        self.assertEqual(values[DOCSHARE_COLUMNS.index("creation")], "2020-01-01 03:04:05.678901")

    def test_a_bool_and_its_integer_produce_one_record(self):
        self.assertEqual(row_hash(row_values(share_row(read=True))), row_hash(row_values(share_row(read=1))))

    def test_a_row_with_no_name_cannot_be_journaled(self):
        with self.assertRaises(ValueError):
            row_values(share_row(name=""))


class AppendTest(JournalCase):
    def test_the_record_holds_the_whole_row(self):
        row = share_row()

        preimage = self.journal.append(row, created_at=CREATED)

        self.assertEqual(preimage.columns(), row)
        self.assertEqual(preimage.name, "d1")
        self.assertEqual(preimage.share_doctype, "Sheet")
        self.assertEqual(json.loads(self.record_path("d1").read_bytes())["row"], row)

    def test_the_file_is_published_under_a_shard_of_the_row_name(self):
        self.journal.append(share_row(), created_at=CREATED)
        path = self.record_path("d1")
        self.assertTrue(path.is_file())
        self.assertEqual(path.parent.name, name_hash("d1")[:2])

    def test_appending_the_same_row_twice_reuses_the_record(self):
        first = self.journal.append(share_row(), created_at=CREATED)
        second = self.journal.append(share_row(), created_at="2026-09-09 00:00:00.000000")
        self.assertEqual(first.values, second.values)
        self.assertEqual(len(self.journal.preimages()), 1)
        # The stamp is diagnostic, so the published record keeps its own.
        self.assertEqual(second.created_at, CREATED)

    def test_a_different_row_under_one_name_is_a_conflict(self):
        self.journal.append(share_row(), created_at=CREATED)
        with self.assertRaises(JournalConflictError):
            self.journal.append(share_row(write=1), created_at=CREATED)

    def test_no_record_is_published_when_the_write_fails(self):
        with patch.object(docshare_journal.os, "link", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                self.journal.append(share_row(), created_at=CREATED)
        self.assertFalse(self.record_path("d1").exists())
        self.assertEqual(list(self.root.rglob("*.tmp")), [])

    def test_the_record_is_fsynced_before_the_caller_can_delete(self):
        with patch.object(docshare_journal.os, "fsync") as fsync:
            self.journal.append(share_row(), created_at=CREATED)
        self.assertTrue(fsync.called)

    def test_a_blank_stamp_is_refused(self):
        with self.assertRaises(ValueError):
            self.journal.append(share_row(), created_at="")


class ReadBackTest(JournalCase):
    def test_the_restore_plan_is_one_mapping_per_deleted_row(self):
        self.journal.append(share_row("d2", share_name="sheet-2"), created_at=CREATED)
        self.journal.append(share_row("d1"), created_at=CREATED)

        plan = self.journal.restore_plan()

        self.assertEqual([row["name"] for row in plan], ["d1", "d2"])
        self.assertEqual(plan[0], share_row("d1"))

    def test_an_empty_journal_reads_back_as_nothing(self):
        self.assertEqual(self.journal.preimages(), ())
        self.assertEqual(self.journal.restore_plan(), ())

    def test_a_tampered_record_is_quarantined_rather_than_trusted(self):
        self.journal.append(share_row(), created_at=CREATED)
        path = self.record_path("d1")
        payload = json.loads(path.read_bytes())
        payload["row"]["write"] = 1
        path.write_text(json.dumps(payload))

        with self.assertRaises(CorruptJournalError) as caught:
            self.journal.preimages()

        self.assertFalse(path.exists())
        self.assertTrue(caught.exception.quarantined.exists())

    def test_a_record_moved_to_another_name_is_refused(self):
        self.journal.append(share_row(), created_at=CREATED)
        source = self.record_path("d1")
        destination = self.record_path("d2")
        destination.parent.mkdir(parents=True, exist_ok=True)
        source.rename(destination)

        with self.assertRaises(CorruptJournalError):
            self.journal.preimages()

    def test_an_unknown_schema_version_is_refused(self):
        self.journal.append(share_row(), created_at=CREATED)
        path = self.record_path("d1")
        payload = json.loads(path.read_bytes())
        payload["schema_version"] = 99
        path.write_text(json.dumps(payload))

        with self.assertRaises(CorruptJournalError):
            self.journal.preimages()


if __name__ == "__main__":
    unittest.main()
