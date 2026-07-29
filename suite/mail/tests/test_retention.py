# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt
"""Tests for Trash/Junk retention.

The purge decides what to delete from a mailbox's current message ids and the first-seen
stamps recorded for them. That decision is pure: given (seen, current_ids, observed_at,
cutoff) it returns what has expired, what to stamp, and what to prune. We exercise the
matrix without a JMAP server or a data store.
"""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

import frappe

from suite.mail import retention as retention_mod


def _stamp(base: datetime, days_ago: float) -> str:
	return str(base - timedelta(days=days_ago))


class Reconcile(unittest.TestCase):
	def setUp(self):
		self.now = datetime(2026, 7, 29, 3, 0, 0)
		self.observed_at = str(self.now)
		self.cutoff = self.now - timedelta(days=30)

	def reconcile(self, seen: dict[str, str], current_ids: list[str]):
		return retention_mod._reconcile(seen, current_ids, self.observed_at, self.cutoff)

	def test_unseen_message_is_stamped_not_purged(self):
		expired, new_stamps, stale = self.reconcile({}, ["a"])

		self.assertEqual(expired, [])
		self.assertEqual(new_stamps, {"a": self.observed_at})
		self.assertEqual(stale, [])

	def test_message_inside_the_window_is_left_alone(self):
		seen = {"a": _stamp(self.now, 29)}

		expired, new_stamps, stale = self.reconcile(seen, ["a"])

		self.assertEqual(expired, [])
		self.assertEqual(new_stamps, {})
		self.assertEqual(stale, [])

	def test_message_older_than_the_window_expires(self):
		seen = {"a": _stamp(self.now, 31)}

		expired, new_stamps, _stale = self.reconcile(seen, ["a"])

		self.assertEqual(expired, ["a"])
		self.assertEqual(new_stamps, {})

	def test_message_exactly_at_the_cutoff_is_kept(self):
		# The window is "older than 30 days", so the boundary itself survives one more run.
		seen = {"a": str(self.cutoff)}

		expired, _new_stamps, _stale = self.reconcile(seen, ["a"])

		self.assertEqual(expired, [])

	def test_message_that_left_the_mailbox_is_pruned(self):
		seen = {"a": _stamp(self.now, 5), "b": _stamp(self.now, 5)}

		expired, new_stamps, stale = self.reconcile(seen, ["a"])

		self.assertEqual(expired, [])
		self.assertEqual(new_stamps, {})
		self.assertEqual(stale, ["b"])

	def test_restore_then_retrash_starts_a_fresh_window(self):
		# Day 29 in Trash, then restored: the stamp is pruned while the message is away...
		seen = {"a": _stamp(self.now, 29)}
		_expired, _new_stamps, stale = self.reconcile(seen, [])
		self.assertEqual(stale, ["a"])

		# ...so when it comes back it is unseen again and gets a full window, not one day.
		expired, new_stamps, _stale = self.reconcile({}, ["a"])
		self.assertEqual(expired, [])
		self.assertEqual(new_stamps, {"a": self.observed_at})

	def test_unreadable_stamp_restarts_the_clock_instead_of_purging(self):
		expired, new_stamps, stale = self.reconcile({"a": "not-a-date"}, ["a"])

		self.assertEqual(expired, [])
		self.assertEqual(new_stamps, {"a": self.observed_at})
		self.assertEqual(stale, [])

	def test_mixed_mailbox_splits_three_ways(self):
		seen = {
			"old": _stamp(self.now, 45),
			"recent": _stamp(self.now, 2),
			"gone": _stamp(self.now, 2),
		}

		expired, new_stamps, stale = self.reconcile(seen, ["old", "recent", "fresh"])

		self.assertEqual(expired, ["old"])
		self.assertEqual(new_stamps, {"fresh": self.observed_at})
		self.assertEqual(stale, ["gone"])

	def test_emptied_mailbox_prunes_every_stamp(self):
		seen = {"a": _stamp(self.now, 45), "b": _stamp(self.now, 2)}

		expired, new_stamps, stale = self.reconcile(seen, [])

		self.assertEqual(expired, [])
		self.assertEqual(new_stamps, {})
		self.assertEqual(sorted(stale), ["a", "b"])


class RetentionDays(unittest.TestCase):
	def test_defaults_to_thirty_days(self):
		with patch.dict(frappe.conf, {}, clear=False):
			frappe.conf.pop("mail_trash_retention_days", None)
			self.assertEqual(retention_mod.retention_days(), 30)

	def test_site_config_overrides_the_default(self):
		with patch.dict(frappe.conf, {"mail_trash_retention_days": 7}):
			self.assertEqual(retention_mod.retention_days(), 7)

	def test_zero_is_floored_so_trash_is_never_an_instant_delete(self):
		with patch.dict(frappe.conf, {"mail_trash_retention_days": 0}):
			self.assertEqual(retention_mod.retention_days(), retention_mod.MIN_RETENTION_DAYS)

	def test_negative_is_floored_too(self):
		with patch.dict(frappe.conf, {"mail_trash_retention_days": -5}):
			self.assertEqual(retention_mod.retention_days(), retention_mod.MIN_RETENTION_DAYS)


class PurgeAccount(unittest.TestCase):
	"""The account-level sweep: which mailboxes it touches, and what it deletes."""

	def setUp(self):
		self.stamps: dict[str, str] = {}
		self.store = MagicMock()
		# Stand in for the store's prefix scan, so each mailbox sees only its own stamps.
		self.store.scan.side_effect = lambda _entity, prefix="": {
			key: value for key, value in self.stamps.items() if key.startswith(prefix)
		}
		self.service = MagicMock()

	def _run(self, mailbox_ids: dict[str, str | None]):
		with (
			patch.object(retention_mod, "get_data_store", return_value=self.store),
			patch.object(retention_mod, "get_email_service", return_value=self.service),
			patch.object(
				retention_mod,
				"get_mailbox_id_by_role",
				side_effect=lambda _account, role: mailbox_ids.get(role),
			),
			patch.object(retention_mod, "delete_messages") as delete,
			patch.object(retention_mod, "get_admin_logger"),
		):
			result = retention_mod.purge_account("acct")

		return result, delete

	def test_stamps_a_fresh_mailbox_without_deleting_anything(self):
		self.service.query.return_value = {"ids": ["a", "b"], "total": 2}

		result, delete = self._run({"trash": "mbx-trash", "junk": None})

		self.assertEqual(result, {"purged": 0})
		delete.assert_not_called()
		self.store.set_many.assert_called_once()
		entity, items = self.store.set_many.call_args[0]
		self.assertEqual(entity, retention_mod.Entity.RETENTION)
		self.assertEqual(sorted(items), ["mbx-trash:a", "mbx-trash:b"])

	def test_skips_roles_the_account_has_no_mailbox_for(self):
		self.service.query.return_value = {"ids": [], "total": 0}

		self._run({"trash": None, "junk": None})

		self.service.query.assert_not_called()

	def test_deletes_messages_past_the_window(self):
		self.service.query.return_value = {"ids": ["old"], "total": 1}
		self.stamps = {"mbx-trash:old": str(datetime(2020, 1, 1))}

		result, delete = self._run({"trash": "mbx-trash", "junk": None})

		self.assertEqual(result, {"purged": 1})
		delete.assert_called_once_with("acct", ["old"])

	def test_purged_stamps_are_left_for_the_next_run_to_prune(self):
		# Dropping them here would restamp a failed delete as new and hand it a fresh window.
		self.service.query.return_value = {"ids": ["old"], "total": 1}
		self.stamps = {"mbx-trash:old": str(datetime(2020, 1, 1))}

		self._run({"trash": "mbx-trash", "junk": None})

		self.store.delete_many.assert_not_called()

	def test_prunes_stamps_for_messages_that_left_the_mailbox(self):
		self.service.query.return_value = {"ids": [], "total": 0}
		self.stamps = {"mbx-trash:restored": str(datetime(2020, 1, 1))}

		result, delete = self._run({"trash": "mbx-trash", "junk": None})

		self.assertEqual(result, {"purged": 0})
		delete.assert_not_called()
		self.store.delete_many.assert_called_once_with(retention_mod.Entity.RETENTION, ["mbx-trash:restored"])

	def test_sweeps_both_trash_and_junk(self):
		self.service.query.return_value = {"ids": ["old"], "total": 1}
		self.stamps = {
			"mbx-trash:old": str(datetime(2020, 1, 1)),
			"mbx-junk:old": str(datetime(2020, 1, 1)),
		}

		result, delete = self._run({"trash": "mbx-trash", "junk": "mbx-junk"})

		self.assertEqual(result, {"purged": 2})
		self.assertEqual(delete.call_count, 2)
