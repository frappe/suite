# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""Wire format of the JMAP submission envelope.

Stalwart >= 0.16.17 rejects epoch seconds for the RFC 4865 HOLDUNTIL parameter
("Invalid parameter: HOLDUNTIL"); it must be an RFC 3339 UTC date-time.
"""

import unittest

from suite.mail.jmap import build_submission_envelope


class TestBuildEnvelope(unittest.TestCase):
    def _envelope(self, hold_until: int | None = None) -> dict:
        return build_submission_envelope(
            from_email="sender@example.com",
            rcpt_emails=["rcpt@example.com"],
            envelope_id="env-1",
            priority=0,
            hold_until=hold_until,
        )

    def test_hold_until_is_rfc3339_utc(self):
        # 1767270896 = 2026-01-01T12:34:56Z; epoch serialization ("1767270896") must not come back.
        parameters = self._envelope(hold_until=1767270896)["mailFrom"]["parameters"]
        self.assertEqual(parameters["HOLDUNTIL"], "2026-01-01T12:34:56Z")

    def test_no_hold_until_omits_parameter(self):
        parameters = self._envelope()["mailFrom"]["parameters"]
        self.assertNotIn("HOLDUNTIL", parameters)
