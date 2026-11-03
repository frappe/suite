"""Keep replacement readiness responses compatible with recorder protocol v1."""

from unittest import TestCase
from unittest.mock import patch

from suite.meet.api.recording import recorder_replacement_ready


class TestReplacementCallbackResponse(TestCase):
    def test_replacement_readiness_returns_only_the_protocol_status(self):
        for status in ("Interrupted", "Recording"):
            with (
                self.subTest(status=status),
                patch("suite.meet.api.recording.authenticate_callback"),
                patch("suite.meet.api.recording._client"),
                patch(
                    "suite.meet.api.recording._apply_replacement_ready",
                    return_value={"status": status, "grant_delivered": True},
                ),
            ):
                result = recorder_replacement_ready("recording", "job", 7, "interruption", 1, {}, "ready", 1)
                self.assertEqual(result, {"protocol_version": 1, "status": status})
