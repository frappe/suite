# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""A read of the mail server that began before a message was changed through Suite holds it as it
was: it mustn't cache that copy, or the message reads unchanged until something evicts it again."""

import time

from frappe.tests import IntegrationTestCase

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
