# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""The cache held mail that had been sent as the draft it was on its way out, and drafts that a
save had replaced. It cannot tell either from a real draft, so the cleanup drops every copy it
holds as a draft and leaves the rest: a real draft is fetched again when it is next read."""

import shutil
import tempfile
import unittest
from unittest import mock

from suite.mail.doctype.mail_message import mail_message
from suite.mail.patches import drop_cached_drafts
from suite.mail.store import Entity
from suite.store.data_store import DataStore

ACCOUNT = "test-cached-drafts"
SENT_BUT_CACHED_AS_A_DRAFT = {"id": "sent", "draft": 1, "subject": "Went out"}
RECEIVED = {"id": "received", "draft": 0, "subject": "Came in"}


class DropCachedDrafts(unittest.TestCase):
    def setUp(self) -> None:
        path = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, path, ignore_errors=True)
        self.store = DataStore(base_path=path, namespace=ACCOUNT)
        self.store.set_many(Entity.EMAIL, items={"sent": SENT_BUT_CACHED_AS_A_DRAFT, "received": RECEIVED})
        self.stores = {ACCOUNT: self.store}

        def get_data_store(account: str) -> DataStore:
            return self.stores[account]

        for module in (drop_cached_drafts, mail_message):
            patcher = mock.patch.object(module, "get_data_store", side_effect=get_data_store)
            patcher.start()
            self.addCleanup(patcher.stop)

    def cached(self) -> dict:
        return self.store.get_many(Entity.EMAIL, keys=["sent", "received"])

    def test_a_copy_cached_as_a_draft_is_dropped_and_other_mail_is_kept(self):
        drop_cached_drafts.drop_cached_drafts([ACCOUNT])

        self.assertEqual(self.cached(), {"sent": None, "received": RECEIVED})

    def test_a_read_already_on_its_way_does_not_cache_the_draft_again(self):
        began = mail_message._now()

        drop_cached_drafts.drop_cached_drafts([ACCOUNT])

        self.assertEqual(mail_message._written_since(ACCOUNT, ["sent", "received"], began), {"sent"})

    def test_an_account_whose_cache_cannot_be_read_does_not_stop_the_others(self):
        # No store for it: reading its cache fails.
        with mock.patch.object(drop_cached_drafts, "log_mail_error") as logged:
            drop_cached_drafts.drop_cached_drafts(["unreadable", ACCOUNT])

        self.assertIsNone(self.cached()["sent"])
        logged.assert_called_once()
