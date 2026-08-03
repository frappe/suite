# Copyright (c) 2026, Asif and Contributors
# See license.txt
"""Permission + auth shape tests for the collab server's Frappe endpoints.

These pin the contracts the Hocuspocus process relies on:

  * ``check_collab_access`` is cookie-authenticated and never accepts Guest.
    Read vs write split must match Sheet doctype perms.
  * The persistence endpoints reject any call missing the shared secret —
    they're ``allow_guest=True`` so the secret check is the only gate.
"""

from __future__ import annotations

import unittest
from unittest import mock

# Eagerly import the module under test so `mock.patch("suite.sheets.collab.frappe")`
# can resolve the attribute — the patcher's lazy import doesn't populate
# `suite.sheets.collab` on the parent package.
from suite.sheets import collab as _collab  # noqa: F401


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


def _b64_update(**cells) -> str:
	"""A real base64 Y.Doc update carrying ``cells`` in a 'cells' map."""
	import base64

	import pycrdt

	doc = pycrdt.Doc()
	m = doc.get("cells", type=pycrdt.Map)
	for k, v in cells.items():
		m[k] = v
	return base64.b64encode(doc.get_update()).decode()


def _cells_of(b64: str) -> dict:
	"""Decode a stored base64 blob back to a plain dict of the 'cells' map."""
	import base64

	import pycrdt

	doc = pycrdt.Doc()
	doc.apply_update(base64.b64decode(b64))
	return dict(doc.get("cells", type=pycrdt.Map).items())


def _perm(**by_ptype):
	"""has_permission side-effect keyed on ptype — e.g. ``_perm(read=True, write=False)``."""
	return lambda _dt, doc=None, ptype="read", throw=False, user=None: bool(by_ptype.get(ptype, False))


class GetCollabSession(unittest.TestCase):
	"""The P2P path's only access gate.

	The signaling server authenticates nobody, so whoever holds the room key
	can read the live document. That makes this endpoint — not the transport —
	the thing enforcing permissions.
	"""

	def setUp(self):
		self.frappe, patcher = _patched_frappe()
		self.addCleanup(patcher.stop)
		self.frappe.PermissionError = type("PermissionError", (Exception,), {})

	def test_rejects_guest(self):
		from suite.sheets import collab

		self.frappe.session.user = "Guest"
		with self.assertRaises(self.frappe.AuthenticationError):
			collab.get_collab_session("SH-1")

	def test_rejects_user_without_read(self):
		from suite.sheets import collab

		self.frappe.has_permission.side_effect = _perm(read=False, write=False)
		with self.assertRaises(self.frappe.PermissionError):
			collab.get_collab_session("SH-1")

	def test_returns_room_and_transport_config(self):
		from suite.sheets import collab

		out = collab.get_collab_session("SH-1")
		self.assertEqual(out["room"], "fsheet-SH-1")
		self.assertTrue(out["password"])
		self.assertEqual(out["signaling"], "shh-its-a-secret")  # conf override
		self.assertTrue(out["canWrite"])

	def test_falls_back_to_shared_signaling_defaults(self):
		from suite.sheets import collab

		# No per-site override → the signal.frappe.cloud pair Writer uses.
		self.frappe.conf.get.return_value = None
		with mock.patch("frappe.utils.password.get_encryption_key", return_value="k"):
			out = collab.get_collab_session("SH-1")
		self.assertEqual(out["signaling"], ["wss://signal.frappe.cloud"])
		self.assertIn("stun:stun.l.google.com:19302", str(out["iceServers"]))

	def test_room_key_is_stable_per_sheet_and_distinct_across_sheets(self):
		from suite.sheets import collab

		a1 = collab.get_collab_session("SH-1")["password"]
		a2 = collab.get_collab_session("SH-1")["password"]
		b = collab.get_collab_session("SH-2")["password"]
		self.assertEqual(a1, a2)  # stable across opens — no coordination needed
		self.assertNotEqual(a1, b)  # one room's key reveals nothing about another

	def test_room_key_changes_when_the_epoch_is_bumped(self):
		"""Revocation has to actually revoke.

		Every other input to the derivation is fixed for the life of the
		sheet, so without the epoch a key handed out once would keep working
		forever — including for someone whose access was taken away. Nothing
		in a P2P session would stop them rejoining.
		"""
		from suite.sheets import collab

		self.frappe.db.get_value.return_value = 0
		before = collab.get_collab_session("SH-1")["password"]

		self.frappe.db.get_value.return_value = 1  # epoch bumped
		after = collab.get_collab_session("SH-1")["password"]

		self.assertNotEqual(before, after)

	def test_room_key_is_not_the_site_secret(self):
		from suite.sheets import collab

		# The derivation must not hand the site's encryption key to the browser.
		out = collab.get_collab_session("SH-1")
		self.assertNotIn("shh-its-a-secret", out["password"])

	def test_viewer_gets_a_key_but_no_write_flag(self):
		from suite.sheets import collab

		# P2P can't enforce read-only downstream, so a viewer does join the
		# room — `save_collab_state` is what stops their edits persisting.
		self.frappe.has_permission.side_effect = _perm(read=True, write=False)
		out = collab.get_collab_session("SH-1")
		self.assertTrue(out["password"])
		self.assertFalse(out["canWrite"])


class BumpRoomEpoch(unittest.TestCase):
	def setUp(self):
		self.frappe, patcher = _patched_frappe()
		self.addCleanup(patcher.stop)

	def test_increments_an_existing_row(self):
		from suite.sheets import collab

		self.frappe.db.exists.return_value = True
		self.frappe.db.get_value.return_value = 4

		self.assertEqual(collab.bump_room_epoch("SH-1"), 5)
		self.frappe.db.set_value.assert_called_once_with(
			"Sheet Collab State", "SH-1", "room_epoch", 5
		)

	def test_creates_a_row_when_the_sheet_has_no_collab_state(self):
		"""A key can be issued before any collab state row exists.

		`get_collab_session` derives one on demand, so a revocation on a
		never-collab-edited sheet still has to record the bump — otherwise
		the key that was already handed out stays valid.
		"""
		from suite.sheets import collab

		self.frappe.db.exists.return_value = False
		doc = mock.MagicMock()
		self.frappe.new_doc.return_value = doc

		self.assertEqual(collab.bump_room_epoch("SH-1"), 1)
		self.assertEqual(doc.sheet, "SH-1")
		self.assertEqual(doc.room_epoch, 1)
		doc.insert.assert_called_once_with(ignore_permissions=True)


class SaveCollabState(unittest.TestCase):
	def setUp(self):
		self.frappe, patcher = _patched_frappe()
		self.addCleanup(patcher.stop)
		self.frappe.PermissionError = type("PermissionError", (Exception,), {})
		self.frappe.ValidationError = type("ValidationError", (Exception,), {})
		self.frappe.db.get_value.return_value = None  # no stored state by default
		# The baseline mock returns a string for every conf lookup, which the
		# size-cap read would try to int(). None → the built-in default.
		self.frappe.conf.get.return_value = None

	def test_rejects_an_oversized_update(self):
		"""Newly reachable by any editor, so the size has to be checked.

		Until this endpoint existed, `ydoc_state` could only be written by the
		collab server behind the shared secret, and its payload size was
		implicitly trusted.
		"""
		from suite.sheets import collab

		# Must be a *valid* Y update, or the malformed-payload guard rejects it
		# first and this passes without ever exercising the size check.
		oversized = _b64_update(**{f"A{i}": "x" * 100 for i in range(50)})
		self.frappe.conf.get.return_value = 64  # cap well below that

		with self.assertRaises(self.frappe.ValidationError):
			collab.save_collab_state("SH-1", oversized)
		self.frappe.db.set_value.assert_not_called()

	def test_accepts_an_update_within_the_cap(self):
		from suite.sheets import collab

		self.frappe.conf.get.return_value = 10 * 1024 * 1024
		self.frappe.db.exists.return_value = True
		collab.save_collab_state("SH-1", _b64_update(A1=1))
		self.frappe.db.set_value.assert_called_once()

	def test_rejects_user_without_write(self):
		from suite.sheets import collab

		self.frappe.has_permission.side_effect = _perm(read=True, write=False)
		with self.assertRaises(self.frappe.PermissionError):
			collab.save_collab_state("SH-1", _b64_update(A1="nope"))

	def test_rejects_malformed_payload(self):
		from suite.sheets import collab

		with self.assertRaises(self.frappe.ValidationError):
			collab.save_collab_state("SH-1", "not-valid-base64!!")

	def test_rejects_well_formed_base64_that_is_not_a_y_update(self):
		"""Reachable by anyone who can edit, so it must fail cleanly.

		pycrdt raises a Rust ``PanicException`` here. It descends from
		``BaseException``, so without an explicit guard it bypasses Frappe's
		error handling and surfaces as a bare 500 rather than a validation
		error.
		"""
		import base64

		from suite.sheets import collab

		payload = base64.b64encode(b"\xff\xff\xff definitely not a y-doc").decode()
		with self.assertRaises(self.frappe.ValidationError):
			collab.save_collab_state("SH-1", payload)
		self.frappe.db.set_value.assert_not_called()

	def test_merges_rather_than_overwrites(self):
		"""The whole reason for server-side CRDT merge.

		Writer overwrites its stored blob with the last save. If a peer that
		never saw someone else's edits saves, that overwrite loses them. Here
		the stored state must end up holding both.
		"""
		from suite.sheets import collab

		self.frappe.db.get_value.return_value = _b64_update(A1="from-peer-a")
		self.frappe.db.exists.return_value = True

		collab.save_collab_state("SH-1", _b64_update(B2="from-peer-b"))

		args, _ = self.frappe.db.set_value.call_args
		self.assertEqual(_cells_of(args[2]["ydoc_state"]), {"A1": "from-peer-a", "B2": "from-peer-b"})

	def test_inserts_when_no_state_row_yet(self):
		from suite.sheets import collab

		self.frappe.db.exists.return_value = False
		doc = mock.MagicMock()
		self.frappe.new_doc.return_value = doc

		collab.save_collab_state("SH-1", _b64_update(A1=1))

		self.frappe.new_doc.assert_called_once_with("Sheet Collab State")
		self.assertEqual(doc.sheet, "SH-1")
		self.assertEqual(_cells_of(doc.ydoc_state), {"A1": 1})
		doc.insert.assert_called_once_with(ignore_permissions=True)

	def test_recovers_from_a_corrupt_stored_blob(self):
		from suite.sheets import collab

		# A row we can't decode must not strand the sheet — the incoming
		# update becomes the new base instead.
		self.frappe.db.get_value.return_value = "//// not a y-doc ////"
		self.frappe.db.exists.return_value = True

		collab.save_collab_state("SH-1", _b64_update(A1="recovered"))

		args, _ = self.frappe.db.set_value.call_args
		self.assertEqual(_cells_of(args[2]["ydoc_state"]), {"A1": "recovered"})

	def test_concurrent_flush_collision_is_reported_as_skipped(self):
		from frappe.exceptions import QueryDeadlockError

		from suite.sheets import collab

		self.frappe.db.exists.return_value = True
		self.frappe.db.set_value.side_effect = QueryDeadlockError("deadlock")

		out = collab.save_collab_state("SH-1", _b64_update(A1=1))

		self.assertTrue(out["skipped"])
		self.assertIsNone(out["persisted_at"])


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
		self.assertEqual(out, {"canRead": False, "canWrite": False})
		# Only the read probe should have run — no point asking about write
		# once read is denied.
		self.frappe.has_permission.assert_called_once_with(
			"Sheet", doc="SH-1", ptype="read", throw=False
		)

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
