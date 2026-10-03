# Copyright (c) 2026, Asif and Contributors
# See license.txt
"""Permission-shape tests for the whitelisted API.

These are *not* end-to-end (no DB), they just assert that each endpoint asks
the right gate for the right level before doing anything else. That's the
specific shape the security audit said needed to stick: read-only users must
not be able to push mutation-shaped broadcasts, and write-shaped endpoints
must consult write permission first.

The realtime broadcasts ask `frappe.has_permission`, which Drive answers
through the `Sheet` permission hooks. The Yjs relay asks
`suite.sheets.drive.require_sheet` directly, with `write=` saying which level.
"""

from __future__ import annotations

import unittest
from unittest import mock


class _PermCheckBase(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch("suite.sheets.api.frappe")
        self.frappe = patcher.start()
        self.addCleanup(patcher.stop)
        self.frappe.session.user = "alice@example.com"
        # `has_permission` returns True by default — endpoints proceed past
        # the gate so we can also assert what they emit downstream.
        self.frappe.has_permission.return_value = True
        self.frappe.db.get_value.return_value = 0
        gate = mock.patch("suite.sheets.api.sheets_drive")
        self.sheets_drive = gate.start()
        self.addCleanup(gate.stop)


class BroadcastsRequireWrite(_PermCheckBase):
    def test_broadcast_op_requires_write(self):
        from suite.sheets import api

        api.broadcast_op("SH-1", '{"op_type":"edit"}')
        self.frappe.has_permission.assert_called_with("Sheet", doc="SH-1", ptype="write", throw=True)

    def test_yjs_update_requires_write(self):
        from suite.sheets import api

        api.yjs_relay("SH-1", "yjs_update", "<opaque>")
        self.sheets_drive.require_sheet.assert_called_once_with("SH-1", write=True)

    def test_yjs_state_requires_write(self):
        from suite.sheets import api

        api.yjs_relay("SH-1", "yjs_state", "<opaque>")
        self.sheets_drive.require_sheet.assert_called_once_with("SH-1", write=True)


class PresenceStaysRead(_PermCheckBase):
    def test_ping_presence_is_read(self):
        from suite.sheets import api

        # user_identity does a db lookup; stub the fields out.
        self.frappe.db.get_value.return_value = ""
        api.ping_presence("SH-1")
        # Only the read-shape call matters here.
        _, kwargs = self.frappe.has_permission.call_args
        self.assertEqual(kwargs.get("doc"), "SH-1")
        self.assertEqual(kwargs.get("throw"), True)
        # No ptype kwarg ⇒ defaults to read.
        self.assertNotIn("ptype", kwargs)

    def test_yjs_awareness_is_read(self):
        from suite.sheets import api

        api.yjs_relay("SH-1", "yjs_awareness", "<opaque>")
        self.sheets_drive.require_sheet.assert_called_once_with("SH-1", write=False)

    def test_yjs_state_request_is_read(self):
        from suite.sheets import api

        api.yjs_relay("SH-1", "yjs_state_request", "<opaque>")
        self.sheets_drive.require_sheet.assert_called_once_with("SH-1", write=False)


class UnknownYjsEventRejected(_PermCheckBase):
    def test_unknown_event_throws_before_perm_check(self):
        from suite.sheets import api

        self.frappe.throw.side_effect = RuntimeError("nope")
        with self.assertRaises(RuntimeError):
            api.yjs_relay("SH-1", "yjs_eval_payload", "<opaque>")
        # Throw must fire before we even consult the gate — otherwise an
        # attacker can use the gate as an oracle for sheet existence.
        self.sheets_drive.require_sheet.assert_not_called()


if __name__ == "__main__":
    unittest.main()
