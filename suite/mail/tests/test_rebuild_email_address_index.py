# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import unittest
from contextlib import contextmanager
from unittest import mock

from suite.mail import store as mail_store
from suite.mail.store import Entity

OWNER = "owner@example.com"
MEMBER = "member@example.com"

SENT = {
    "from_name": "Me",
    "from_email": "me@example.com",
    "sent_at": "2026-10-20T10:00:00Z",
    "recipients": [{"display_name": "Jane Doe", "email": "jane@example.com"}],
}


class RebuildEmailAddressIndex(unittest.TestCase):
    """The rebuild reads the account's own addresses as a user who can still connect."""

    def rebuild(self, connectable_user):
        """Rebuild an account holding one sent message; returns the indexed addresses."""

        session = {"user": "Administrator"}

        @contextmanager
        def user_context(user):
            previous, session["user"] = session["user"], user
            try:
                yield
            finally:
                session["user"] = previous

        def get_account_emails(account):
            # As Administrator the account resolves to its disabled owner, which the server refuses.
            if session["user"] != MEMBER:
                raise Exception(f"User {OWNER} does not exist or is disabled.")
            return ["me@example.com"]

        data_store = mock.Mock()
        data_store.scan.side_effect = lambda entity: {"m1": SENT} if entity == Entity.EMAIL else {}
        index = mock.Mock()

        with (
            mock.patch.object(mail_store, "get_data_store", return_value=data_store),
            mock.patch.object(mail_store, "get_email_address_index", return_value=index),
            mock.patch.object(mail_store, "user_context", user_context),
            mock.patch(
                "suite.mail.doctype.user_account.user_account.get_enabled_account_user",
                return_value=connectable_user,
            ),
            mock.patch("suite.mail.utils.user.get_account_emails", side_effect=get_account_emails),
        ):
            mail_store.rebuild_email_address_index("account", in_background=False)

        return [address for call in index.index_addresses.call_args_list for address in call.args[0]]

    def test_dates_sent_mail_when_owner_is_disabled_but_a_member_can_connect(self):
        addresses = self.rebuild(connectable_user=MEMBER)

        self.assertIn(
            {"name": "Jane Doe", "email": "jane@example.com", "last_sent_at": 1792490400}, addresses
        )

    def test_indexes_undated_when_nobody_can_connect(self):
        addresses = self.rebuild(connectable_user=None)

        self.assertIn({"name": "Jane Doe", "email": "jane@example.com"}, addresses)
        self.assertIn({"name": "Me", "email": "me@example.com"}, addresses)
