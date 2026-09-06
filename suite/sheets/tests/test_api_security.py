# Copyright (c) 2026, Asif and Contributors
# See license.txt
"""Permission-shape tests for the whitelisted API.

These are *not* end-to-end (no DB), they just assert that each endpoint
calls ``frappe.has_permission`` with the right ptype. That's the
specific shape the security audit said needed to stick: read-only users
must not be able to push mutation-shaped broadcasts, and write-shaped
endpoints must consult write permission before doing anything else.
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
        # Ticket 19: the legacy endpoints read the sheet's node column first
        # and refuse a sheet Drive owns. These tests pin the legacy ptype
        # shape, so the sheet here has no node; the refusal has its own tests
        # in `suite.sheets.tests.test_drive_adoption`.
        node = mock.patch("suite.sheets.drive.node_of", return_value=None)
        node.start()
        self.addCleanup(node.stop)


class BroadcastsRequireWrite(_PermCheckBase):
    def test_broadcast_op_requires_write(self):
        from suite.sheets import api

        api.broadcast_op("SH-1", '{"op_type":"edit"}')
        self.frappe.has_permission.assert_called_with("Sheet", doc="SH-1", ptype="write", throw=True)

    def test_yjs_update_requires_write(self):
        from suite.sheets import api

        api.yjs_relay("SH-1", "yjs_update", "<opaque>")
        self.frappe.has_permission.assert_called_with("Sheet", doc="SH-1", ptype="write", throw=True)

    def test_yjs_state_requires_write(self):
        from suite.sheets import api

        api.yjs_relay("SH-1", "yjs_state", "<opaque>")
        self.frappe.has_permission.assert_called_with("Sheet", doc="SH-1", ptype="write", throw=True)


class PresenceStaysRead(_PermCheckBase):
    def test_ping_presence_is_read(self):
        from suite.sheets import api

        # user_identity does a db lookup; stub the fields out.
        self.frappe.db.get_value.return_value = ""
        api.ping_presence("SH-1")
        # Only the read-shape call matters here.
        args, kwargs = self.frappe.has_permission.call_args
        self.assertEqual(kwargs.get("doc"), "SH-1")
        self.assertEqual(kwargs.get("throw"), True)
        # No ptype kwarg ⇒ defaults to read.
        self.assertNotIn("ptype", kwargs)

    def test_yjs_awareness_is_read(self):
        from suite.sheets import api

        api.yjs_relay("SH-1", "yjs_awareness", "<opaque>")
        self.frappe.has_permission.assert_called_with("Sheet", doc="SH-1", ptype="read", throw=True)

    def test_yjs_state_request_is_read(self):
        from suite.sheets import api

        api.yjs_relay("SH-1", "yjs_state_request", "<opaque>")
        self.frappe.has_permission.assert_called_with("Sheet", doc="SH-1", ptype="read", throw=True)


class UnknownYjsEventRejected(_PermCheckBase):
    def test_unknown_event_throws_before_perm_check(self):
        from suite.sheets import api

        self.frappe.throw.side_effect = RuntimeError("nope")
        with self.assertRaises(RuntimeError):
            api.yjs_relay("SH-1", "yjs_eval_payload", "<opaque>")
        # Throw must fire before we even consult perms — otherwise an attacker
        # can use the perm check as an oracle for sheet existence.
        self.frappe.has_permission.assert_not_called()


class ShareSheetRejectsDisabledUsers(_PermCheckBase):
    def test_disabled_user_rejected(self):
        from suite.sheets import api

        # `enabled = 0` → throw.
        self.frappe.db.get_value.return_value = 0
        self.frappe.throw.side_effect = RuntimeError("disabled")
        with self.assertRaises(RuntimeError):
            api.share_sheet("SH-1", "bob@example.com")
        self.frappe.share.add.assert_not_called()

    def test_missing_user_rejected(self):
        from suite.sheets import api

        self.frappe.db.get_value.return_value = None
        self.frappe.throw.side_effect = RuntimeError("not found")
        with self.assertRaises(RuntimeError):
            api.share_sheet("SH-1", "ghost@example.com")
        self.frappe.share.add.assert_not_called()

    def test_enabled_user_shared(self):
        from suite.sheets import api

        self.frappe.db.get_value.return_value = 1
        api.share_sheet("SH-1", "bob@example.com", write=1)
        self.frappe.share.add.assert_called_once()


class RenameSheetGated(_PermCheckBase):
    def test_rename_checks_write_before_load(self):
        from suite.sheets import api

        self.frappe.get_doc.return_value = mock.Mock(name="SH-1")
        api.rename_sheet("SH-1", "New title")
        # Write perm must be the first thing checked.
        first_call = self.frappe.has_permission.call_args_list[0]
        self.assertEqual(first_call.kwargs.get("ptype"), "write")
        self.assertEqual(first_call.kwargs.get("doc"), "SH-1")


if __name__ == "__main__":
    unittest.main()
