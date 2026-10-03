"""Gate 2 (§14.10, §3.17): the framework GC can discover Drive's blob columns."""

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from suite.drive.patches.cleanup.gate import GCDiscoveryGateError, check_gate_gc_discovery
from suite.drive.patches.cleanup.tests.fakes import RaisingBlobColumns, cleanup_environment, fake_blob_columns


class TestGateGCDiscovery(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def env(self, blob_columns):
        return cleanup_environment(self.path, blob_columns=blob_columns)

    def test_all_four_columns_present_passes(self):
        check_gate_gc_discovery(self.env(fake_blob_columns()))

    def test_a_missing_column_refuses(self):
        pairs = [
            ("Drive Node", "blob"),
            ("Drive Node Version", "blob"),
            ("Drive Node Preview", "blob"),
            # source_blob missing
        ]
        with self.assertRaises(GCDiscoveryGateError) as caught:
            check_gate_gc_discovery(self.env(fake_blob_columns(pairs)))
        self.assertIn("source_blob", str(caught.exception))

    def test_no_columns_at_all_refuses(self):
        with self.assertRaises(GCDiscoveryGateError):
            check_gate_gc_discovery(self.env(fake_blob_columns([])))

    def test_extra_unrelated_columns_do_not_matter(self):
        pairs = [
            ("Drive Node", "blob"),
            ("Drive Node Version", "blob"),
            ("Drive Node Preview", "blob"),
            ("Drive Node Preview", "source_blob"),
            ("Some Other Doctype", "blob"),
        ]
        check_gate_gc_discovery(self.env(fake_blob_columns(pairs)))

    def test_the_call_raising_fails_closed(self):
        with self.assertRaises(GCDiscoveryGateError) as caught:
            check_gate_gc_discovery(self.env(RaisingBlobColumns(ImportError("no frappe.storage.gc"))))
        self.assertIn("ImportError", str(caught.exception))

    def test_a_malformed_row_missing_a_key_fails_closed(self):
        with self.assertRaises(GCDiscoveryGateError):
            check_gate_gc_discovery(self.env(lambda: [{"doctype": "Drive Node"}]))


if __name__ == "__main__":
    unittest.main()
