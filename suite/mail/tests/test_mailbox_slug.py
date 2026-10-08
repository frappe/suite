# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""How a folder is named across accounts in the unified folder views."""

import unittest

from suite.mail.api.mail import mailbox_slug


class MailboxSlug(unittest.TestCase):
    def test_system_folders_go_by_role_whatever_they_are_called(self):
        self.assertEqual(mailbox_slug({"role": "sent", "name": "Sent Items"}), "sent")
        self.assertEqual(mailbox_slug({"role": "Sent", "name": "Sent"}), "sent")

    def test_custom_folders_with_the_same_name_share_a_slug(self):
        self.assertEqual(
            mailbox_slug({"role": None, "name": "Client Work"}),
            mailbox_slug({"role": None, "name": "client  work"}),
        )
        self.assertEqual(mailbox_slug({"role": None, "name": "Client Work"}), "client-work")

    def test_punctuation_folds_into_a_single_hyphen(self):
        self.assertEqual(mailbox_slug({"name": "  Bills / 2026 (paid)  "}), "bills-2026-paid")

    def test_non_latin_names_keep_their_letters(self):
        self.assertEqual(mailbox_slug({"name": "Счета"}), "счета")

    def test_unroutable_names_have_no_slug(self):
        self.assertIsNone(mailbox_slug({"name": "!!!"}))
