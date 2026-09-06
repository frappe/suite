# Copyright (c) 2026, Asif and Contributors
# See license.txt
"""Permission + auth shape tests for the collab server's Frappe endpoints.

These pin the contracts the Hocuspocus process relies on:

  * ``check_collab_access`` on a sheet Build has not linked is
    cookie-authenticated and never accepts Guest. Read vs write split must
    match Sheet doctype perms. The Drive-native side is in
    ``suite.sheets.tests.test_collab_access``.
  * The persistence endpoints reject any call missing the shared secret —
    they're ``allow_guest=True`` so the secret check is the only gate.
"""

from __future__ import annotations

import unittest
from unittest import mock

# Eagerly import the module under test so `mock.patch("suite.sheets.collab.frappe")`
# can resolve the attribute — the patcher's lazy import doesn't populate
# `suite.sheets.collab` on the parent package.
from suite.sheets import collab as _collab


def _patched_frappe():
    """Patch ``suite.sheets.collab.frappe`` with a baseline-permissive mock."""
    patcher = mock.patch("suite.sheets.collab.frappe")
    frappe = patcher.start()
    frappe.session.user = "alice@example.com"
    frappe.has_permission.return_value = True
    frappe.conf.get.return_value = "shh-its-a-secret"
    frappe.get_request_header.return_value = "shh-its-a-secret"
    frappe.db.exists.return_value = True
    frappe.db.get_value.return_value = ""
    frappe.utils.now.return_value = "2026-06-03 12:00:00"
    # Real AuthenticationError so `raises` checks line up with what
    # Frappe raises in prod.
    frappe.AuthenticationError = type("AuthenticationError", (Exception,), {})
    frappe.DoesNotExistError = type("DoesNotExistError", (Exception,), {})
    frappe.throw.side_effect = lambda msg, exc=Exception: (_ for _ in ()).throw(exc(msg))
    return frappe, patcher


class CheckCollabAccess(unittest.TestCase):
    def setUp(self):
        self.frappe, patcher = _patched_frappe()
        self.addCleanup(patcher.stop)

    def test_rejects_guest(self):
        from suite.sheets import collab

        self.frappe.session.user = "Guest"
        with self.assertRaises(self.frappe.AuthenticationError):
            collab.check_collab_access("SH-1")

    def test_no_read_returns_false_flags(self):
        from suite.sheets import collab

        self.frappe.has_permission.return_value = False
        out = collab.check_collab_access("SH-1")
        self.assertFalse(out["canRead"])
        self.assertFalse(out["canWrite"])
        # Ticket 19: a refusal states the cadence too, so a client that retries
        # knows when the server will ask again.
        self.assertEqual(out["recheckSeconds"], collab.RECHECK_SECONDS)
        # Only the read probe should have run — no point asking about write
        # once read is denied.
        self.frappe.has_permission.assert_called_once_with("Sheet", doc="SH-1", ptype="read", throw=False)

    def test_read_only_user_gets_view_grant(self):
        from suite.sheets import collab

        # True for read, False for write.
        self.frappe.has_permission.side_effect = [True, False]
        out = collab.check_collab_access("SH-1")
        self.assertTrue(out["canRead"])
        self.assertFalse(out["canWrite"])
        self.assertEqual(out["user"], "alice@example.com")

    def test_writer_gets_write_grant(self):
        from suite.sheets import collab

        self.frappe.has_permission.side_effect = [True, True]
        out = collab.check_collab_access("SH-1")
        self.assertTrue(out["canWrite"])


class CollabSecretGate(unittest.TestCase):
    def setUp(self):
        self.frappe, patcher = _patched_frappe()
        self.addCleanup(patcher.stop)

    def test_load_rejects_missing_header(self):
        from suite.sheets import collab

        self.frappe.get_request_header.return_value = None
        with self.assertRaises(self.frappe.AuthenticationError):
            collab.load_collab_state("SH-1")

    def test_load_rejects_wrong_secret(self):
        from suite.sheets import collab

        self.frappe.get_request_header.return_value = "wrong"
        with self.assertRaises(self.frappe.AuthenticationError):
            collab.load_collab_state("SH-1")

    def test_load_rejects_unconfigured_server(self):
        # Misconfigured site (no secret in site_config) must not silently
        # accept anonymous callers — that would make every collab write
        # unauthenticated.
        from suite.sheets import collab

        self.frappe.conf.get.return_value = None
        with self.assertRaises(self.frappe.AuthenticationError):
            collab.load_collab_state("SH-1")

    def test_persist_rejects_missing_header(self):
        from suite.sheets import collab

        self.frappe.get_request_header.return_value = None
        with self.assertRaises(self.frappe.AuthenticationError):
            collab.persist_collab_state("SH-1", "<b64>", 10)


class LoadCollabState(unittest.TestCase):
    def setUp(self):
        self.frappe, patcher = _patched_frappe()
        self.addCleanup(patcher.stop)

    def test_returns_null_blob_when_missing(self):
        from suite.sheets import collab

        self.frappe.db.exists.return_value = False
        out = collab.load_collab_state("SH-1")
        self.assertEqual(out, {"sheet": "SH-1", "ydoc_state": None, "byte_size": 0})

    def test_returns_row_when_present(self):
        from suite.sheets import collab

        self.frappe.db.exists.return_value = True
        self.frappe.db.get_value.return_value = {"ydoc_state": "<b64>", "byte_size": 42}
        out = collab.load_collab_state("SH-1")
        self.assertEqual(out["ydoc_state"], "<b64>")
        self.assertEqual(out["byte_size"], 42)


class PersistCollabState(unittest.TestCase):
    def setUp(self):
        self.frappe, patcher = _patched_frappe()
        self.addCleanup(patcher.stop)

    def test_rejects_when_sheet_missing(self):
        from suite.sheets import collab

        # `db.exists` returns False only for the Sheet existence check.
        self.frappe.db.exists.side_effect = lambda dt, _: dt != "Sheet"
        with self.assertRaises(self.frappe.DoesNotExistError):
            collab.persist_collab_state("SH-1", "<b64>", 10)

    def test_updates_when_state_row_exists(self):
        from suite.sheets import collab

        # Sheet exists AND state row exists → take UPDATE path.
        self.frappe.db.exists.return_value = True
        collab.persist_collab_state("SH-1", "<b64>", 99)
        self.frappe.db.set_value.assert_called_once()
        args, _ = self.frappe.db.set_value.call_args
        self.assertEqual(args[0], "Sheet Collab State")
        self.assertEqual(args[1], "SH-1")
        self.assertEqual(args[2]["ydoc_state"], "<b64>")
        self.assertEqual(args[2]["byte_size"], 99)

    def test_inserts_when_state_row_missing(self):
        from suite.sheets import collab

        # Sheet exists but state row does not → take INSERT path.
        self.frappe.db.exists.side_effect = lambda dt, _: dt == "Sheet"
        doc = mock.MagicMock()
        self.frappe.new_doc.return_value = doc
        collab.persist_collab_state("SH-1", "<b64>", 7)
        self.frappe.new_doc.assert_called_once_with("Sheet Collab State")
        self.assertEqual(doc.sheet, "SH-1")
        self.assertEqual(doc.ydoc_state, "<b64>")
        self.assertEqual(doc.byte_size, 7)
        doc.insert.assert_called_once_with(ignore_permissions=True)
