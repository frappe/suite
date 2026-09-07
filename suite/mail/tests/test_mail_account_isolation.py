# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe

from suite.mail.api.account import get_quota
from suite.mail.api.mail import get_mailboxes
from suite.mail.tests.base import StalwartIntegrationTestCase


class TestMailAccountIsolation(StalwartIntegrationTestCase):
    """Endpoints that take an account id must establish whose account it is.

    Most of them get that for free: anything reaching a JMAP service resolves the account
    through `get_user_for_jmap_account`, which throws for an account the session user is
    not linked to. The ones covered here read the local tables instead — through
    `frappe.get_all`, which bypasses permissions by design — so they have nothing to fall
    back on and have to check for themselves.

    Reported 2026-09-07 against `get_mailboxes`: any JMAP-configured user could pass
    another user's account id and read their mailbox names, message and unread counts, and
    automation rules — and those rules carry the addresses and subjects they filter on.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.owner = cls.create_member()
        cls.other = cls.create_member()
        cls.owner_account = cls.personal_account(cls.owner)
        cls.other_account = cls.personal_account(cls.other)

    def test_mailboxes_are_readable_by_their_owner(self):
        with self.set_user(self.owner.email):
            mailboxes = get_mailboxes(self.owner_account)

        self.assertTrue(mailboxes, "The owner got nothing back for their own account.")

    def test_mailboxes_are_not_readable_across_accounts(self):
        with self.set_user(self.other.email):
            # The other member has an account of their own, so the endpoint's
            # is_jmap_configured gate passes and only ownership stands between them and
            # someone else's mailboxes.
            with self.assertRaises(frappe.ValidationError):
                get_mailboxes(self.owner_account)

    def test_quota_is_readable_by_its_owner(self):
        with self.set_user(self.owner.email):
            quota = get_quota(self.owner_account)

        self.assertIn("used_percentage", quota)

    def test_quota_is_not_readable_across_accounts(self):
        with self.set_user(self.other.email):
            with self.assertRaises(frappe.ValidationError):
                get_quota(self.owner_account)
