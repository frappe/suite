"""Gate 3 (§14.10, §11.7): real evidence, not the registry label, clears it."""

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from suite.drive.patches.cleanup.gate import LegacyCallerGateError, check_gate_legacy_callers_removed
from suite.drive.patches.cleanup.tests.fakes import (
    FakeClientCallerEvidence,
    FakeForwarders,
    cleanup_environment,
)


class TestGateLegacyCallers(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def env(self, forwarders, callers=None):
        return cleanup_environment(self.path, forwarders=forwarders, callers=callers)

    def test_no_forwarders_left_passes(self):
        classification = {
            "api.s3.fetch": "permanent",
            "overrides.file.get_file_for_doc": "permanent",
            "api.files.download_folder": "retained",
            "api.files.create_auth_token": "retired",
        }
        check_gate_legacy_callers_removed(self.env(FakeForwarders(classification)))

    def test_a_forwarder_still_referenced_by_evidence_refuses(self):
        classification = {"api.files.upload_file": "forwarder", "api.s3.fetch": "permanent"}
        callers = FakeClientCallerEvidence({"api.files.upload_file"})
        with self.assertRaises(LegacyCallerGateError) as caught:
            check_gate_legacy_callers_removed(self.env(FakeForwarders(classification), callers))
        self.assertIn("api.files.upload_file", str(caught.exception))

    def test_a_forwarder_label_alone_does_not_refuse_once_evidence_clears_it(self):
        # The point of gate 3: `shims.py` still spells this "forwarder" —
        # nobody relabeled it — but real evidence shows nothing calls it any
        # more, so the gate must not gate on the label by itself.
        classification = {"api.files.upload_file": "forwarder", "api.s3.fetch": "permanent"}
        check_gate_legacy_callers_removed(
            self.env(FakeForwarders(classification), FakeClientCallerEvidence())
        )

    def test_permanent_and_retained_never_reach_the_evidence_check(self):
        classification = {
            f"api.product.{name}": "permanent" for name in ("get_my_invites", "signup", "oauth_providers")
        } | {"api.files.download_folder": "retained", "api.scripts.sync_preview": "retained"}
        callers = FakeClientCallerEvidence({"api.product.get_my_invites", "api.files.download_folder"})
        check_gate_legacy_callers_removed(self.env(FakeForwarders(classification), callers))
        # Never even asked: gate 3 has no forwarder candidate to check evidence for.
        self.assertEqual(callers.calls, [])

    def test_an_empty_classification_passes_vacuously(self):
        check_gate_legacy_callers_removed(self.env(FakeForwarders({})))

    def test_reading_the_classification_raising_fails_closed(self):
        forwarders = FakeForwarders({})
        forwarders.error = ImportError("suite.drive.http.shims is unavailable")
        with self.assertRaises(LegacyCallerGateError) as caught:
            check_gate_legacy_callers_removed(self.env(forwarders))
        self.assertIn("ImportError", str(caught.exception))

    def test_evidence_raising_fails_closed(self):
        classification = {"api.files.upload_file": "forwarder"}
        callers = FakeClientCallerEvidence()
        callers.error = RuntimeError("the SPA source tree is missing")
        with self.assertRaises(LegacyCallerGateError) as caught:
            check_gate_legacy_callers_removed(self.env(FakeForwarders(classification), callers))
        self.assertIn("RuntimeError", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
