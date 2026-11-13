# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""A read of the mail server that began before a message was changed through Suite holds it as it
was: it mustn't cache that copy, or the message reads unchanged until something evicts it again."""

import time
from unittest import mock

import frappe
from frappe.tests import IntegrationTestCase

from suite.mail.doctype.mail_message import mail_message
from suite.mail.doctype.mail_message.mail_message import _remove_cached_messages, _written_since

ACCOUNT = "test-cache-writes"


class TestMessageCacheWrites(IntegrationTestCase):
    def test_a_read_that_began_before_a_change_is_not_cached(self):
        began = time.time()
        _remove_cached_messages(ACCOUNT, ["changed"])
        self.assertEqual(_written_since(ACCOUNT, ["changed", "untouched"], began), {"changed"})

    def test_a_read_that_began_after_the_change_is(self):
        _remove_cached_messages(ACCOUNT, ["changed"])
        time.sleep(0.01)
        self.assertEqual(_written_since(ACCOUNT, ["changed"], time.time()), set())


class TestKeywordWritesNoteTheChange(IntegrationTestCase):
    """Reading, starring and screening patch the cached copies rather than evict them, and note the
    change as filing does: a read already on its way doesn't cache its copy from before the write."""

    def _write(self, writer, *args):
        began = time.time()
        with (
            mock.patch.object(mail_message, "_update_emails"),
            mock.patch.object(mail_message, "_try_update_emails", return_value=(["m1"], True)),
            mock.patch.object(mail_message, "_get_cached_messages", return_value={}),
        ):
            writer(ACCOUNT, ["m1"], *args)
        return _written_since(ACCOUNT, ["m1", "m2"], began)

    def test_marking_read_notes_the_change(self):
        self.assertEqual(self._write(mail_message.set_seen_status, True), {"m1"})

    def test_marking_read_where_the_server_allows_notes_the_change(self):
        self.assertEqual(self._write(mail_message.try_set_seen, False), {"m1"})

    def test_starring_notes_the_change(self):
        self.assertEqual(self._write(mail_message.set_flagged_status, True), {"m1"})

    def test_a_screening_verdict_notes_the_change(self):
        self.assertEqual(self._write(mail_message.set_unscreened_status, False), {"m1"})

    def test_a_write_the_server_refuses_still_holds_back_a_read_from_before_it(self):
        began = time.time()
        with (
            mock.patch.object(mail_message, "_update_emails", side_effect=RuntimeError),
            mock.patch.object(mail_message, "log_mail_error"),
            self.assertRaises(frappe.ValidationError),
        ):
            mail_message.set_flagged_status(ACCOUNT, ["m1"], True)
        self.assertEqual(_written_since(ACCOUNT, ["m1"], began), {"m1"})
