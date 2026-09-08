"""Gate 3 (§14.10, §11.7): every legacy FORWARDER caller is gone."""

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from suite.drive.patches.cleanup.gate import LegacyCallerGateError, check_gate_legacy_callers_removed
from suite.drive.patches.cleanup.tests.fakes import FakeForwarders, cleanup_environment


class TestGateLegacyCallers(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def env(self, forwarders):
        return cleanup_environment(self.path, forwarders=forwarders)

    def test_no_forwarders_left_passes(self):
        classification = {
            "api.s3.fetch": "permanent",
            "overrides.file.get_file_for_doc": "permanent",
            "api.files.download_folder": "retained",
            "api.files.create_auth_token": "retired",
        }
        check_gate_legacy_callers_removed(self.env(FakeForwarders(classification)))

    def test_one_remaining_forwarder_refuses(self):
        classification = {"api.files.upload_file": "forwarder", "api.s3.fetch": "permanent"}
        with self.assertRaises(LegacyCallerGateError) as caught:
            check_gate_legacy_callers_removed(self.env(FakeForwarders(classification)))
        self.assertIn("api.files.upload_file", str(caught.exception))

    def test_permanent_and_retained_never_block(self):
        classification = {
            f"api.product.{name}": "permanent" for name in ("get_my_invites", "signup", "oauth_providers")
        } | {"api.files.download_folder": "retained", "api.scripts.sync_preview": "retained"}
        check_gate_legacy_callers_removed(self.env(FakeForwarders(classification)))

    def test_an_empty_classification_passes_vacuously(self):
        check_gate_legacy_callers_removed(self.env(FakeForwarders({})))

    def test_reading_the_classification_raising_fails_closed(self):
        forwarders = FakeForwarders({})
        forwarders.error = ImportError("suite.drive.http.shims is unavailable")
        with self.assertRaises(LegacyCallerGateError) as caught:
            check_gate_legacy_callers_removed(self.env(forwarders))
        self.assertIn("ImportError", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
